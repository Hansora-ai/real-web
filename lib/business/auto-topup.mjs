// Auto top-up of customer credits (Dodo on-demand subscriptions).
//
// 1. The customer picks a pack and a level on their profile. netlify/functions/auto-topup.mjs opens a Dodo checkout
//    for the DODO_AUTO_TOPUP_PRODUCT_ID product with `mandate_only`: the card is saved, nothing is charged.
// 2. Dodo sends subscription.active (metadata auto_topup=1): the card is saved and auto top-up is switched on.
// 3. Every 2 minutes netlify/functions/auto-topup-run.mjs finds people whose balance is under their level and charges
//    the saved card (POST /subscriptions/{id}/charge) for their pack. A charge row is written first; its id travels in
//    the payment metadata.
// 4. Dodo sends payment.succeeded: the webhook grants the credits written on that charge row (never what the payload
//    says), once per payment id, into the pay-as-you-go bucket. payment.failed counts a failure; three failures in a
//    row switch auto top-up off and the customer sees why on their profile.
// Limits: at most MAX_PER_DAY top-ups in 24 hours, and RETRY_HOURS between a failed charge and the next attempt.
// All credit amounts here are stored credits (1 stored = 10 displayed).

export const PACKS = [
  { credits: 90, amount_cents: 999 },
  { credits: 200, amount_cents: 1999 },
  { credits: 510, amount_cents: 4999 },
  { credits: 1050, amount_cents: 9999 }
];
export const THRESHOLDS = [10, 30, 50, 100];
export const DEFAULTS = { pack_credits: 90, threshold_credits: 30 };
export const MAX_PER_DAY = 3;
export const RETRY_HOURS = 6;
export const MAX_FAILURES = 3;
const STALE_CHARGE_MS = 2 * 60 * 60 * 1000;
const TIMEOUT_MS = 15000;

export const packFor = (credits) => PACKS.find((pack) => pack.credits === Number(credits)) || null;
export const validThreshold = (credits) => THRESHOLDS.includes(Number(credits));

// Dodo errors that mean the saved card can never be charged again: switch off at once instead of retrying.
const FATAL_CHARGE = /SUBSCRIPTION_NOT_ON_DEMAND|NOT_FOUND|CANCELLED|EXPIRED|STOLEN_CARD|FRAUDULENT|LOST_CARD/i;

// Accepts the bare id or a pasted Dodo link (https://checkout.dodopayments.com/buy/pdt_…?quantity=1).
export function productIdFrom(value) {
  const text = String(value || "").trim();
  return (text.match(/pdt_[A-Za-z0-9]+/) || [""])[0];
}

export function config(env = process.env) {
  return {
    supabaseUrl: env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    dodoKey: env.DODO_PAYMENTS_API_KEY,
    dodoBase: String(env.DODO_PAYMENTS_BASE_URL || env.DODO_API_BASE || "https://live.dodopayments.com").replace(/\/+$/, ""),
    productId: productIdFrom(env.DODO_AUTO_TOPUP_PRODUCT_ID),
    site: String(env.URL || "https://hansora.co").replace(/\/+$/, "")
  };
}

// ---------- Supabase REST ----------

export function db(cfg, fetchImpl = fetch) {
  const headers = { "Content-Type": "application/json", Accept: "application/json", apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` };
  async function call(path, { method = "GET", body, prefer } = {}) {
    const res = await fetchImpl(`${cfg.supabaseUrl}/rest/v1/${path}`, {
      method,
      headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }
  const one = (result) => (result.ok && Array.isArray(result.data) ? result.data[0] || null : null);
  const q = encodeURIComponent;
  return {
    call,
    async settings(userId) {
      return one(await call(`auto_topups?user_id=eq.${q(userId)}&select=*`));
    },
    async saveSettings(row) {
      return one(await call("auto_topups?on_conflict=user_id", { method: "POST", body: [{ ...row, updated_at: new Date().toISOString() }], prefer: "resolution=merge-duplicates,return=representation" }));
    },
    async patchSettings(filter, patch) {
      return one(await call(`auto_topups?${filter}`, { method: "PATCH", body: { ...patch, updated_at: new Date().toISOString() }, prefer: "return=representation" }));
    },
    async recentCharges(userId, limit = 5) {
      const result = await call(`auto_topup_charges?user_id=eq.${q(userId)}&select=credits,amount_cents,status,error,created_at&order=created_at.desc&limit=${limit}`);
      return result.ok && Array.isArray(result.data) ? result.data : [];
    },
    async due() {
      const result = await call("rpc/auto_topup_due", { method: "POST", body: { p_max_per_day: MAX_PER_DAY, p_retry_hours: RETRY_HOURS } });
      if (!result.ok) throw new Error(`auto_topup_due_${result.status}`);
      return Array.isArray(result.data) ? result.data : [];
    },
    // Returns the new row, or null when another charge for this person is already in flight (unique index).
    async startCharge(row) {
      return one(await call("auto_topup_charges", { method: "POST", body: [row], prefer: "return=representation" }));
    },
    async patchCharge(filter, patch) {
      return one(await call(`auto_topup_charges?${filter}`, { method: "PATCH", body: patch, prefer: "return=representation" }));
    },
    async charge(filter) {
      return one(await call(`auto_topup_charges?${filter}&select=*&limit=1`));
    },
    async expireStale(now = Date.now()) {
      const before = new Date(now - STALE_CHARGE_MS).toISOString();
      await call(`auto_topup_charges?status=eq.charging&created_at=lt.${q(before)}`, { method: "PATCH", body: { status: "expired", error: "no_webhook", finished_at: new Date(now).toISOString() } });
    }
  };
}

// ---------- Dodo ----------

export async function dodo(cfg, path, { method = "GET", body } = {}, fetchImpl = fetch) {
  const res = await fetchImpl(`${cfg.dodoBase}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${cfg.dodoKey}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

export function checkoutBody({ cfg, userId, email, returnPath = "/profile.html" }) {
  return {
    product_cart: [{ product_id: cfg.productId, quantity: 1 }],
    customer: email ? { email } : undefined,
    return_url: `${cfg.site}${returnPath}?auto_topup=saved`,
    metadata: { uid: userId, auto_topup: "1" },
    subscription_data: { on_demand: { mandate_only: true } },
    // Short form: country and postcode only (no street), no phone or discount fields; nothing is charged here.
    minimal_address: true,
    feature_flags: { allow_phone_number_collection: false, allow_discount_code: false }
  };
}

export function chargeBody({ userId, chargeId, pack }) {
  return {
    product_price: pack.amount_cents,
    product_currency: "USD",
    product_description: `Hansora auto top-up: ${(pack.credits * 10).toLocaleString("en-US")} credits`,
    metadata: { uid: userId, auto_topup: "1", charge_id: String(chargeId) }
  };
}

function errorCode(result) {
  const d = result?.data || {};
  return String(d.code || d.error_code || d.error || d.message || `http_${result?.status}`).slice(0, 200);
}

// ---------- Scheduled run ----------

export async function runAutoTopups({ env = process.env, fetchImpl = fetch, notify = async () => {}, now = Date.now() } = {}) {
  const cfg = config(env);
  if (!cfg.supabaseUrl || !cfg.serviceKey || !cfg.dodoKey || !cfg.productId) return { ok: false, skipped: "not_configured" };
  const store = db(cfg, fetchImpl);
  await store.expireStale(now);
  const due = await store.due();
  const results = [];
  for (const row of due) results.push(await chargeOne({ cfg, store, row, fetchImpl, notify }));
  return { ok: true, due: due.length, results };
}

async function chargeOne({ cfg, store, row, fetchImpl, notify }) {
  const pack = packFor(row.pack_credits);
  if (!pack) return { user_id: row.user_id, skipped: "unknown_pack" };
  const charge = await store.startCharge({ user_id: row.user_id, subscription_id: row.subscription_id, credits: pack.credits, amount_cents: pack.amount_cents, status: "charging" });
  if (!charge) return { user_id: row.user_id, skipped: "in_flight" };
  const result = await dodo(cfg, `/subscriptions/${encodeURIComponent(row.subscription_id)}/charge`, { method: "POST", body: chargeBody({ userId: row.user_id, chargeId: charge.id, pack }) }, fetchImpl)
    .catch((error) => ({ ok: false, status: 0, data: { code: String(error?.message || error) } }));
  if (result.ok && result.data?.payment_id) {
    // The webhook may already have finished this charge; only fill in the payment id.
    await store.patchCharge(`id=eq.${charge.id}`, { payment_id: result.data.payment_id });
    return { user_id: row.user_id, charge_id: charge.id, payment_id: result.data.payment_id };
  }
  const code = errorCode(result);
  if (result.status === 409) {
    // Dodo still has an earlier payment pending for this card: try again on a later run, not a failure.
    await store.patchCharge(`id=eq.${charge.id}`, { status: "expired", error: "previous_payment_pending", finished_at: new Date().toISOString() });
    return { user_id: row.user_id, skipped: "dodo_pending" };
  }
  if (result.status === 0 || result.status >= 500) {
    // Network or Dodo outage: we do not know if a payment started. Leave the row in flight; a webhook finishes it,
    // or it expires after two hours and the next run tries again.
    return { user_id: row.user_id, charge_id: charge.id, unknown: code };
  }
  await store.patchCharge(`id=eq.${charge.id}`, { status: "failed", error: code, finished_at: new Date().toISOString() });
  await recordFailure({ store, userId: row.user_id, code, fatal: FATAL_CHARGE.test(code) || result.status === 404, notify });
  return { user_id: row.user_id, charge_id: charge.id, failed: code };
}

async function recordFailure({ store, userId, code, fatal = false, notify }) {
  const current = await store.settings(userId);
  const failures = Number(current?.failures || 0) + 1;
  const off = fatal || failures >= MAX_FAILURES;
  await store.patchSettings(`user_id=eq.${encodeURIComponent(userId)}`, { failures, last_error: code, ...(off ? { enabled: false } : {}) });
  if (off) await notify(`⚠️ Auto top-up switched off for ${userId} after ${failures} failed charge(s): ${code}`);
  return { failures, off };
}

// ---------- Owner dashboard ----------

// What the owner sees: everyone who set up auto top-up, and the top-up charges of the period.
export function autoTopupReport({ settings = [], charges = [], emails = {} } = {}) {
  const list = (rows) => (Array.isArray(rows) ? rows : []);
  const people = list(settings).map((r) => ({
    user_id: r.user_id,
    email: emails[r.user_id] || null,
    state: r.enabled ? "on" : r.status === "pending" ? "card not saved" : r.status === "cancelled" ? "card removed" : "off",
    pack_credits: r.pack_credits * 10,
    level_credits: r.threshold_credits * 10,
    failures: r.failures || 0,
    last_error: r.last_error || null,
    since: r.created_at
  }));
  const rows = list(charges).map((c) => ({
    at: c.created_at,
    user_id: c.user_id,
    email: emails[c.user_id] || null,
    credits: c.credits * 10,
    amount_usd: c.amount_cents / 100,
    status: c.status,
    error: c.error || null,
    payment_id: c.payment_id || null
  }));
  const paid = rows.filter((c) => c.status === "succeeded");
  return {
    totals: {
      switched_on: people.filter((p) => p.state === "on").length,
      set_up: people.filter((p) => p.state !== "card not saved").length,
      checkout_not_finished: people.filter((p) => p.state === "card not saved").length,
      topups: paid.length,
      topup_usd: Math.round(paid.reduce((sum, c) => sum + c.amount_usd, 0) * 100) / 100,
      failed: rows.filter((c) => c.status === "failed").length
    },
    people,
    charges: rows,
    payment_ids: new Set(paid.map((c) => c.payment_id).filter(Boolean))
  };
}

// ---------- Webhook ----------

export function isAutoTopupEvent({ meta = {}, productId = null, env = process.env } = {}) {
  const product = productIdFrom(env.DODO_AUTO_TOPUP_PRODUCT_ID);
  return String(meta.auto_topup || "") === "1" || Boolean(product && productId === product);
}

// Called by netlify/functions/dodo-webhook.mjs for auto top-up events. `addCredits` is the webhook's own
// once-per-transaction credit function. Returns { status, body }.
export async function handleAutoTopupWebhook({ type, root, data, meta = {}, env = process.env, fetchImpl = fetch, addCredits, notifySale = async () => {} }) {
  const cfg = config(env);
  if (!cfg.supabaseUrl || !cfg.serviceKey) return { status: 500, body: { error: "missing_env" } };
  const store = db(cfg, fetchImpl);
  const q = encodeURIComponent;
  const now = new Date().toISOString();
  const uid = meta.uid || null;
  const subscriptionId = data.subscription_id || data.subscription?.subscription_id || null;

  if (type === "subscription.active") {
    if (!uid || !subscriptionId) return { status: 400, body: { error: "missing_uid_or_subscription", auto_topup: true } };
    const current = await store.settings(uid);
    const saved = await store.saveSettings({
      user_id: uid,
      enabled: true,
      status: "active",
      pack_credits: current?.pack_credits || DEFAULTS.pack_credits,
      threshold_credits: current?.threshold_credits ?? DEFAULTS.threshold_credits,
      subscription_id: subscriptionId,
      customer_id: data.customer?.customer_id || data.customer_id || current?.customer_id || null,
      failures: current?.subscription_id === subscriptionId ? current.failures : 0,
      last_error: current?.subscription_id === subscriptionId ? current.last_error : null
    });
    if (!saved) return { status: 500, body: { error: "auto_topup_save_failed" } };
    return { status: 200, body: { ok: true, auto_topup: "card_saved" } };
  }
  if (["subscription.cancelled", "subscription.canceled", "subscription.expired", "subscription.failed"].includes(type)) {
    if (subscriptionId) await store.patchSettings(`subscription_id=eq.${q(subscriptionId)}`, { status: "cancelled", enabled: false });
    return { status: 200, body: { ok: true, auto_topup: "card_removed" } };
  }
  if (type.startsWith("subscription.")) return { status: 200, body: { ok: true, auto_topup: "ignored", type } };

  const paymentId = data.payment_id || root.payment_id || null;
  const chargeId = /^\d+$/.test(String(meta.charge_id || "")) ? String(meta.charge_id) : null;
  let charge = null;
  if (chargeId) charge = await store.charge(`id=eq.${chargeId}`);
  if (!charge && paymentId) charge = await store.charge(`payment_id=eq.${q(paymentId)}`);
  // The card-saving checkout itself (no charge row) and payments we did not start: nothing to grant.
  if (!charge) return { status: 200, body: { ok: true, auto_topup: "no_charge", type } };
  if (uid && charge.user_id !== uid) return { status: 400, body: { error: "charge_user_mismatch", auto_topup: true } };
  const chargeFilter = `id=eq.${charge.id}`;

  if (type === "payment.succeeded") {
    if (!paymentId) return { status: 400, body: { error: "missing_payment_id", auto_topup: true } };
    const amountCents = Number.isFinite(Number(data.total_amount)) ? Math.trunc(Number(data.total_amount)) : charge.amount_cents;
    const currency = data.currency || "USD";
    const result = await addCredits({
      transaction_id: paymentId,
      uid: charge.user_id,
      credits: charge.credits,
      amount_cents: amountCents,
      currency,
      status: "succeeded",
      provider: "dodopayments",
      return_url: null,
      payload: root,
      paid_at: data.created_at || now,
      creditBucket: "payg"
    });
    if (!result.credited && result.reason !== "already credited") return { status: 500, body: { error: "auto_topup_credit_failed", reason: result.reason } };
    await store.patchCharge(chargeFilter, { status: "succeeded", payment_id: paymentId, error: null, finished_at: now });
    await store.patchSettings(`user_id=eq.${q(charge.user_id)}`, { failures: 0, last_error: null });
    if (result.credited) await notifySale({ uid: charge.user_id, transactionId: paymentId, provider: "dodo", amountCents, currency, credits: charge.credits, autoTopup: true });
    return { status: 200, body: { ok: true, auto_topup: "credited", credited: result.credited, credits: charge.credits } };
  }

  if (type === "payment.failed" || type === "payment.cancelled" || type === "payment.canceled") {
    if (charge.status === "succeeded" || charge.status === "failed") return { status: 200, body: { ok: true, auto_topup: "already_final" } };
    const code = String(data.error_code || data.error_message || type).slice(0, 200);
    await store.patchCharge(chargeFilter, { status: "failed", error: code, payment_id: paymentId || charge.payment_id, finished_at: now });
    const failure = await recordFailure({ store, userId: charge.user_id, code, fatal: FATAL_CHARGE.test(code), notify: async (text) => notifyOwner(text) });
    return { status: 200, body: { ok: true, auto_topup: "charge_failed", ...failure } };
  }

  return { status: 200, body: { ok: true, auto_topup: "ignored", type } };
}

async function notifyOwner(text) {
  const { sendOwnerTelegram } = await import("./sale-alert.mjs");
  return sendOwnerTelegram(text).catch(() => ({ sent: false }));
}
export { notifyOwner };
