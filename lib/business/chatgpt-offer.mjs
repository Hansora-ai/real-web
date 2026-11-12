// Welcome offer: a one-time, 8-hour offer for every signed-in person who has never bought.
// (It began as a ChatGPT-only offer; ChatGPT signups are not always recorded as such, so nobody is left out now.
// The file, table and endpoint keep the "chatgpt" name.)
//   - every credit pack gives 25% of its base credits free (instead of its usual gift) on that first purchase;
//   - a small $4.99 starter pack is offered in a popup on the pricing page (never in the pack list).
// The timer starts the first time the signed-in person opens the pricing page, runs once and
// never restarts. Before that, other pages only say that an offer is waiting. Nothing about the offer is said inside ChatGPT (OpenAI does not allow selling credits there); it lives on
// the website only. The server decides who gets it and how many credits a payment grants: the page only shows it.
// All credit amounts here are stored credits (1 stored = 10 displayed).

export const OFFER_HOURS = 8;
export const BONUS_PERCENT = 25;
// A checkout opened just before the deadline still counts if it is paid within this time.
export const GRACE_MINUTES = 45;
export const STARTER = { credits: 45, price_cents: 499 };
// The $4.99 starter product in Dodo. DODO_CHATGPT_STARTER_PRODUCT (a checkout link or a product id) replaces it.
export const STARTER_PRODUCT_ID = "pdt_0NrmWsHzjAdxHAYd4QOSG";

// Dodo product -> what the pack normally grants, its base credits (without the usual gift) and its dollar price.
export const OFFER_PACKS = {
  pdt_Gi01FZTv21T44htKut7lG: { credits: 90, base: 90, price_cents: 999 },
  pdt_YNeJAH4NMLe8gJF7ff0Fe: { credits: 200, base: 180, price_cents: 1999 },
  pdt_oVJI6GNjziGZKrXtVczUY: { credits: 510, base: 450, price_cents: 4999 },
  pdt_e8UPGoRi6Sf36NoxV7fAF: { credits: 1050, base: 900, price_cents: 9999 }
};

// Stored credits are whole numbers, so half credits round up in the buyer's favour (112.5 -> 113).
export function offerCredits(pack, percent = BONUS_PERCENT) {
  return Math.max(pack.credits, Math.ceil(pack.base * (1 + percent / 100)));
}

export function config(env = process.env) {
  // The starter product is a Dodo checkout link or a product id (pdt_...), pasted as one setting.
  const raw = String(env.DODO_CHATGPT_STARTER_PRODUCT || "").trim();
  const starterProductId = (raw.match(/pdt_[A-Za-z0-9]+/) || [STARTER_PRODUCT_ID])[0];
  return {
    supabaseUrl: String(env.SUPABASE_URL || "").replace(/\/+$/, ""),
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE || "",
    enabled: String(env.CHATGPT_OFFER || "on").toLowerCase() !== "off",
    starterProductId,
    starterCheckout: starterProductId ? `https://checkout.dodopayments.com/buy/${starterProductId}` : ""
  };
}

const q = encodeURIComponent;
const PAID_STATUSES = "succeeded,paid,completed,success";

export function db(cfg, fetchImpl = fetch) {
  async function call(path, { method = "GET", body, prefer } = {}) {
    const res = await fetchImpl(`${cfg.supabaseUrl}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: cfg.serviceKey,
        Authorization: `Bearer ${cfg.serviceKey}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(prefer ? { Prefer: prefer } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(6000)
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }
  const first = (result) => (result.ok && Array.isArray(result.data) && result.data.length ? result.data[0] : null);
  return {
    call,
    async offer(userId) {
      return first(await call(`chatgpt_offers?user_id=eq.${q(userId)}&select=*&limit=1`));
    },
    async hasPaid(userId) {
      return Boolean(first(await call(`payments?uid=eq.${q(userId)}&status=in.(${PAID_STATUSES})&select=transaction_id&limit=1`)));
    },
    // Starts the timer. If two page loads race, the first row wins and both read the same deadline.
    async start(userId, now = Date.now()) {
      const row = { user_id: userId, started_at: new Date(now).toISOString(), expires_at: new Date(now + OFFER_HOURS * 3600000).toISOString() };
      const made = first(await call("chatgpt_offers?on_conflict=user_id", { method: "POST", body: [row], prefer: "resolution=ignore-duplicates,return=representation" }));
      return made || (await this.offer(userId));
    },
    // Marks the offer used by one payment. Only the first payment gets it; the same payment asking again
    // (a webhook retry) gets the same answer.
    async claim(userId, transactionId, productId, credits, now = Date.now()) {
      const patch = { used_at: new Date(now).toISOString(), used_transaction_id: transactionId, used_product: productId, granted_credits: credits };
      return first(await call(`chatgpt_offers?user_id=eq.${q(userId)}&used_at=is.null`, { method: "PATCH", body: patch, prefer: "return=representation" }));
    }
  };
}

export function isActive(offer, now = Date.now(), graceMinutes = 0) {
  if (!offer || offer.used_at) return false;
  const end = Date.parse(offer.expires_at || "");
  return Number.isFinite(end) && now <= end + graceMinutes * 60000;
}

// What the website shows for this person. `start` is true on the pricing page: the first look there starts the timer.
// Elsewhere someone whose timer has not started gets { pending: true }: an offer is waiting, no clock yet.
export async function offerView({ cfg, store, userId, start = false, now = Date.now() }) {
  const none = { eligible: false, active: false };
  if (!cfg.enabled || !userId) return none;
  let offer = await store.offer(userId);
  if (!offer) {
    // Only people who never paid get a timer.
    if (await store.hasPaid(userId)) return none;
    if (!start) return { eligible: true, active: false, pending: true, bonus_percent: BONUS_PERCENT };
    offer = await store.start(userId, now);
    if (!offer) return none;
  }
  if (!isActive(offer, now)) return { eligible: true, active: false, used: Boolean(offer.used_at) };
  // Someone who paid another way since the timer started (a plan, a Russian card) no longer has a first purchase.
  if (await store.hasPaid(userId)) return { eligible: true, active: false, used: true };
  const end = Date.parse(offer.expires_at);
  return {
    eligible: true,
    active: true,
    expires_at: offer.expires_at,
    seconds_left: Math.max(0, Math.round((end - now) / 1000)),
    bonus_percent: BONUS_PERCENT,
    packs: Object.values(OFFER_PACKS).map((pack) => ({ credits: pack.credits, offer_credits: offerCredits(pack), price_cents: pack.price_cents })),
    starter: cfg.starterCheckout ? { credits: STARTER.credits, price_cents: STARTER.price_cents, checkout_url: cfg.starterCheckout } : null
  };
}

// Called by the Dodo webhook for a paid one-time pack: how many credits this payment grants.
// Returns { credits, offer } where offer is "bonus", "starter" or null (the normal amount).
// Any failure here returns the normal amount: a payment is never held up by the offer.
export async function creditsForPayment({ cfg = config(), store, userId, productId, quantity = 1, credits, transactionId, paidAt, now = Date.now() }) {
  const normal = { credits, offer: null };
  try {
    if (!cfg.enabled || !userId || !productId || !transactionId) return normal;
    const isStarter = Boolean(cfg.starterProductId) && productId === cfg.starterProductId;
    const pack = OFFER_PACKS[productId];
    if (!isStarter && !pack) return normal;
    store = store || db(cfg);
    const offer = await store.offer(userId);
    if (!offer) return normal;
    // A retry of the payment that already used the offer gets the same amount again.
    if (offer.used_at) {
      return offer.used_transaction_id === transactionId && Number(offer.granted_credits) > 0
        ? { credits: Number(offer.granted_credits), offer: isStarter ? "starter" : "bonus" }
        : normal;
    }
    const paidTime = Date.parse(paidAt || "") || now;
    if (!isActive(offer, paidTime, GRACE_MINUTES)) return normal;
    // The starter grants its normal amount; buying it uses up the offer. A pack gets the bonus on one unit.
    const granted = isStarter ? credits : offerCredits(pack) + pack.credits * (Math.max(1, quantity) - 1);
    const claimed = await store.claim(userId, transactionId, productId, granted, now);
    if (!claimed) return normal;
    return { credits: granted, offer: isStarter ? "starter" : "bonus" };
  } catch (error) {
    console.error("ChatGPT offer check failed; normal credits granted", error?.message || error);
    return normal;
  }
}
