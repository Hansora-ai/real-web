// netlify/functions/dodo-webhook.mjs
// Idempotent via CAS: credits added exactly once.
// - Matches your `public.payments` schema.
// - Uses `profiles.user_id`.
// - Adds `apikey` header on all Supabase REST calls.
// - First insert ensures a row exists; then a CAS PATCH updates `status` from NULL → 'succeeded'.
//   Only the request that wins the CAS adds user credits.
// - Sends a server-side Meta Purchase event. Meta deduplicates retries by transaction ID.

import { createHash } from "node:crypto";

const SUBSCRIPTION_PLANS = {
  premium_monthly: {
    monthlyCredits: 250,
    unlimitedModels: [
      "Nano Banana 2 Lite",
      "Nano Banana 2 1K",
      "Z Image",
      "GPT Image 2 1K",
      "Seedream 5.0 Lite",
      "Grok Video 6s"
    ]
  },
  pro_monthly: {
    monthlyCredits: 450,
    unlimitedModels: [
      "Nano Banana 2 Lite",
      "Nano Banana 2 1K",
      "Z Image",
      "GPT Image 2 1K",
      "Seedream 5.0 Lite",
      "Grok Video 6s",
      "Veo 3.1 Lite 720p 8s"
    ]
  },
  pro_max_monthly: {
    monthlyCredits: 1000,
    unlimitedModels: [
      "Nano Banana 2 Lite",
      "Nano Banana 2 1K-2K",
      "Z Image",
      "GPT Image 2 1K-2K",
      "Seedream 5.0 Lite",
      "Wan 2.7 Image",
      "Grok Video 6s",
      "Veo 3.1 Lite 1080p 8s",
      "Kling 2.5 Turbo 1080p 5s"
    ]
  }
};

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method Not Allowed" });
    }

    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return json(400, { error: "Bad JSON" }); }

    // ---- Normalize Dodo payload ----
    const root = body || {};
    const data = root.data || root;
    const type = root.type || root.payload_type || data.type || data.payload_type || null;
    const normalizedType = String(type || "").toLowerCase();
    let status = root.status || data.status || null;
    if (!status && normalizedType === "payment.succeeded") status = "succeeded";

    const meta = (root.metadata || data.metadata || (data.payment && data.payment.metadata)) || {};

    const transaction_id =
      root.transaction_id || data.transaction_id || data.payment_id || root.payment_id || null;
    const uid = meta.uid || null;
    const plan_id = meta.plan_id || null;
    const planConfig = plan_id ? SUBSCRIPTION_PLANS[plan_id] : null;
    const credits = Number(meta.credits || 0);
    const monthly_credits = Number(meta.monthly_credits || planConfig?.monthlyCredits || 0);

    const amount_cents = toInt(data.total_amount ?? data.settlement_amount ?? data.recurring_pre_tax_amount ?? null);
    const currency = data.currency || data.settlement_currency || null;
    const provider = "dodopayments";
    const return_url = meta.return_url || null;
    const paid_at = data.created_at || data.updated_at || new Date().toISOString();
    const isSubscriptionWebhook = normalizedType.startsWith("subscription.");
    const isSuccessfulPayment =
      status === "paid" ||
      status === "succeeded" ||
      status === "successful" ||
      (normalizedType === "payment" && !!transaction_id && !root.error_code && !data.error_code);

    if (isSubscriptionWebhook) {
      const SUPABASE_URL = process.env.SUPABASE_URL;
      const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return json(500, { error: "Missing Supabase env (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" });
      }
      return await handleSubscriptionWebhook({
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        root,
        data,
        type,
        status,
        uid,
        plan_id,
        planConfig,
        monthly_credits,
        amount_cents,
        currency,
        provider,
        return_url,
        paid_at,
        subscriptionPaymentTransactionId: null
      });
    }
    if (plan_id) {
      if (!isSuccessfulPayment) {
        return json(200, {
          ok: true,
          skipped: "subscription payment not successful",
          status,
          type,
          plan_id
        });
      }

      const SUPABASE_URL = process.env.SUPABASE_URL;
      const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return json(500, { error: "Missing Supabase env (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" });
      }

      return await handleSubscriptionWebhook({
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        root,
        data,
        type: "subscription.active",
        status: "active",
        uid,
        plan_id,
        planConfig,
        monthly_credits,
        amount_cents,
        currency,
        provider,
        return_url,
        paid_at,
        subscriptionPaymentTransactionId: transaction_id
      });
    }

    if (!isSuccessfulPayment) {
      return json(200, { ok: true, skipped: "not a successful payment status", status, type });
    }
    if (!transaction_id || !uid || !credits) {
      return json(400, {
        error: "Missing required fields",
        transaction_id: !!transaction_id,
        uid: !!uid,
        credits
      });
    }

    // ---- Supabase env ----
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { error: "Missing Supabase env (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" });
    }

    // Small helper
    async function sjson(res) { try { return await res.json(); } catch { return null; } }

    // ---- 0) Ensure a payments row exists (status may be null initially) ----
    {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/payments?on_conflict=transaction_id`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          // Never overwrite a succeeded row back to null when Dodo retries a webhook.
          "Prefer": "resolution=ignore-duplicates,return=representation",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "apikey": SUPABASE_SERVICE_ROLE_KEY
        },
        body: JSON.stringify([{
          transaction_id,
          uid,
          credits,
          amount_cents,
          currency,
          status: null,
          provider,
          return_url,
          payload: root,
          paid_at
        }])
      });
      // A duplicate insert returns no row, which is expected.
      if (!res.ok) {
        const text = await sjson(res) || await res.text();
        return json(500, { error: "payments upsert failed", detail: text });
      }
    }

    // ---- 1) CAS: Only 1 request transitions status NULL -> 'succeeded' ----
    let won = false;
    {
      // Only match rows whose status IS NULL (others will return [])
      const res = await fetch(`${SUPABASE_URL}/rest/v1/payments?transaction_id=eq.${encodeURIComponent(transaction_id)}&status=is.null`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Prefer": "return=representation",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "apikey": SUPABASE_SERVICE_ROLE_KEY
        },
        body: JSON.stringify({
          status: "succeeded",
          // update latest values (idempotent fields)
          uid, credits, amount_cents, currency, provider, return_url, payload: root, paid_at
        })
      });
      const updated = await sjson(res) || [];
      won = res.ok && Array.isArray(updated) && updated.length > 0;
    }

    // ---- 2) Add credits only if we won the CAS ----
    let credited = false;
    if (won) {
      // Read current buckets. Pay-as-you-go purchases must never mix into monthly_credits.
      let currentMonthlyCredits = 0;
      let currentPaygCredits = 0;
      {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits,monthly_credits,payg_credits`, {
          headers: {
            "Accept": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "apikey": SUPABASE_SERVICE_ROLE_KEY
          }
        });
        const rows = await sjson(res) || [];
        if (!res.ok || !Array.isArray(rows) || rows.length === 0) {
          return json(500, { error: "profiles fetch failed or 0 rows" });
        }
        currentMonthlyCredits = Number(rows?.[0]?.monthly_credits ?? 0);
        currentPaygCredits = Number(rows?.[0]?.payg_credits ?? rows?.[0]?.credits ?? 0);
      }
      // Update the pay-as-you-go bucket. The DB trigger keeps profiles.credits as one visible total.
      {
        const newPaygCredits = currentPaygCredits + credits;
        const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Prefer": "return=representation",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "apikey": SUPABASE_SERVICE_ROLE_KEY
          },
          body: JSON.stringify({
            monthly_credits: currentMonthlyCredits,
            payg_credits: newPaygCredits,
            credits: currentMonthlyCredits + newPaygCredits
          })
        });
        const updated = await sjson(res) || [];
        if (!res.ok || !Array.isArray(updated) || updated.length === 0) {
          const text = await res.text();
          return json(500, { error: "profiles update failed", detail: text });
        }
        credited = true;
      }
    }

    // Send on every successful Dodo delivery. Meta safely deduplicates retries using event_id.
    const metaPurchase = await sendMetaPurchase({
      root,
      data,
      meta,
      uid,
      transaction_id,
      amount_cents,
      currency,
      return_url
    });

    return json(200, { ok: true, credited, meta_purchase: metaPurchase });
  } catch (e) {
    return json(500, { error: String(e?.message || e) });
  }
}

async function handleSubscriptionWebhook({
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  root,
  data,
  type,
  status,
  uid,
  plan_id,
  planConfig,
  monthly_credits,
  amount_cents,
  currency,
  provider,
  return_url,
  paid_at,
  subscriptionPaymentTransactionId = null
}) {
  if (!uid || !plan_id || !planConfig) {
    return json(400, {
      error: "Missing subscription metadata",
      uid: !!uid,
      plan_id,
      known_plan: !!planConfig
    });
  }

  const rawStatus = String(data.status || status || "").toLowerCase();
  const current_period_start =
    data.previous_billing_date ||
    data.current_period_start ||
    data.created_at ||
    paid_at ||
    null;
  const current_period_end =
    data.next_billing_date ||
    data.current_period_end ||
    data.expires_at ||
    addOneMonthIso(current_period_start || paid_at) ||
    null;
  const cancel_at_period_end = Boolean(data.cancel_at_next_billing_date || data.cancel_at_period_end);
  const canceled_at = data.cancelled_at || data.canceled_at || null;
  const subscription_id =
    data.subscription_id ||
    data.subscription?.subscription_id ||
    data.subscription?.id ||
    data.payment?.subscription_id ||
    data.id ||
    root.subscription_id ||
    root.subscription?.subscription_id ||
    root.subscription?.id ||
    root.payment?.subscription_id ||
    root.id ||
    root.transaction_id ||
    data.transaction_id ||
    subscriptionPaymentTransactionId ||
    null;

  let subscriptionStatus = rawStatus || "inactive";
  if (type === "subscription.active" || type === "subscription.renewed") subscriptionStatus = "active";
  if (type === "subscription.on_hold") subscriptionStatus = "on_hold";
  if (type === "subscription.failed") subscriptionStatus = "failed";
  if (type === "subscription.expired") subscriptionStatus = "expired";
  if (type === "subscription.cancelled" || type === "subscription.canceled") subscriptionStatus = "cancelled";

  // If Dodo marks a scheduled cancellation but the period has not ended, keep access active.
  if (
    subscriptionStatus === "cancelled" &&
    cancel_at_period_end &&
    current_period_end &&
    Date.parse(current_period_end) > Date.now()
  ) {
    subscriptionStatus = "active";
  }

  const provider_customer_id =
    data.customer?.customer_id ||
    data.customer_id ||
    root.customer?.customer_id ||
    root.customer_id ||
    null;

  const subscriptionRow = {
    user_id: uid,
    status: subscriptionStatus,
    plan_id,
    unlimited_models: planConfig.unlimitedModels,
    provider,
    provider_customer_id,
    provider_subscription_id: subscription_id,
    current_period_start,
    current_period_end,
    cancel_at_period_end,
    canceled_at,
    updated_at: new Date().toISOString()
  };

  {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_subscriptions?on_conflict=user_id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "apikey": SUPABASE_SERVICE_ROLE_KEY
      },
      body: JSON.stringify([subscriptionRow])
    });
    if (!res.ok) {
      const detail = await sjson(res) || await res.text();
      return json(500, { error: "user_subscriptions upsert failed", detail });
    }
  }

  let credited = false;
  let creditReason = "not a monthly credit grant event";
  if (subscriptionStatus === "active" && monthly_credits > 0 && (type === "subscription.active" || type === "subscription.renewed" || subscriptionPaymentTransactionId)) {
    const monthlyTransactionId = [
      "subscription-period",
      uid,
      plan_id,
      dateKey(current_period_start || paid_at),
      dateKey(current_period_end || addOneMonthIso(current_period_start || paid_at)),
      "monthly-credits"
    ].join(":");

    const creditResult = await addCreditsOnce({
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      transaction_id: monthlyTransactionId,
      uid,
      credits: monthly_credits,
      amount_cents,
      currency,
      status: "succeeded",
      provider,
      return_url,
      payload: root,
      paid_at,
      creditBucket: "monthly"
    });
    credited = creditResult.credited;
    creditReason = creditResult.reason;
  }

  return json(200, {
    ok: true,
    subscription: true,
    status: subscriptionStatus,
    plan_id,
    credited,
    credit_reason: creditReason
  });
}

// Utils
function toInt(x){ const n = Number(x); return Number.isFinite(n) ? Math.trunc(n) : null; }

function addOneMonthIso(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

function dateKey(value) {
  if (!value) return "unknown";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10) || "unknown";
  return d.toISOString().slice(0, 10);
}

async function sjson(res) { try { return await res.json(); } catch { return null; } }

async function addCreditsOnce({
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  transaction_id,
  uid,
  credits,
  amount_cents,
  currency,
  status,
  provider,
  return_url,
  payload,
  paid_at,
  creditBucket = "payg"
}) {
  {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/payments?on_conflict=transaction_id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "resolution=ignore-duplicates,return=representation",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "apikey": SUPABASE_SERVICE_ROLE_KEY
      },
      body: JSON.stringify([{
        transaction_id,
        uid,
        credits,
        amount_cents,
        currency,
        status: null,
        provider,
        return_url,
        payload,
        paid_at
      }])
    });
    if (!res.ok) {
      const detail = await sjson(res) || await res.text();
      return { credited: false, reason: "payments insert failed", detail };
    }
  }

  let won = false;
  {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/payments?transaction_id=eq.${encodeURIComponent(transaction_id)}&status=is.null`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "return=representation",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "apikey": SUPABASE_SERVICE_ROLE_KEY
      },
      body: JSON.stringify({
        status,
        uid,
        credits,
        amount_cents,
        currency,
        provider,
        return_url,
        payload,
        paid_at
      })
    });
    const updated = await sjson(res) || [];
    won = res.ok && Array.isArray(updated) && updated.length > 0;
  }
  if (!won) return { credited: false, reason: "already credited" };

  let currentMonthlyCredits = 0;
  let currentPaygCredits = 0;
  {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits,monthly_credits,payg_credits`, {
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "apikey": SUPABASE_SERVICE_ROLE_KEY
      }
    });
    const rows = await sjson(res) || [];
    if (!res.ok || !Array.isArray(rows) || rows.length === 0) {
      return { credited: false, reason: "profiles fetch failed or 0 rows" };
    }
    currentMonthlyCredits = Number(rows?.[0]?.monthly_credits ?? 0);
    currentPaygCredits = Number(rows?.[0]?.payg_credits ?? rows?.[0]?.credits ?? 0);
  }

  {
    const newMonthlyCredits = creditBucket === "monthly"
      ? currentMonthlyCredits + credits
      : currentMonthlyCredits;
    const newPaygCredits = creditBucket === "monthly"
      ? currentPaygCredits
      : currentPaygCredits + credits;

    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "return=representation",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "apikey": SUPABASE_SERVICE_ROLE_KEY
      },
      body: JSON.stringify({
        monthly_credits: newMonthlyCredits,
        payg_credits: newPaygCredits,
        credits: newMonthlyCredits + newPaygCredits
      })
    });
    const updated = await sjson(res) || [];
    if (!res.ok || !Array.isArray(updated) || updated.length === 0) {
      return { credited: false, reason: "profiles update failed" };
    }
  }

  return {
    credited: true,
    reason: creditBucket === "monthly" ? "monthly credits added" : "pay-as-you-go credits added"
  };
}

async function sendMetaPurchase({
  root,
  data,
  meta,
  uid,
  transaction_id,
  amount_cents,
  currency,
  return_url
}) {
  const pixelId = process.env.META_PIXEL_ID || "1336278884948294";
  const accessToken = process.env.META_CONVERSIONS_API_TOKEN;
  if (!accessToken) {
    return { sent: false, skipped: "missing META_CONVERSIONS_API_TOKEN" };
  }
  if (amount_cents == null || !currency) {
    return { sent: false, skipped: "missing payment amount or currency" };
  }

  const customer = data.customer || root.customer || {};
  const billing = data.billing || root.billing || {};
  const names = splitName(customer.name || data.card_holder_name || "");

  const user_data = compact({
    em: hashedArray(customer.email),
    ph: hashedArray(customer.phone_number || customer.phone),
    fn: hashedArray(names.first),
    ln: hashedArray(names.last),
    ct: hashedArray(billing.city),
    st: hashedArray(billing.state),
    zp: hashedArray(billing.zipcode || billing.postal_code),
    country: hashedArray(billing.country || data.card_issuing_country),
    external_id: hashedArray(uid),
    // Store these browser values in Dodo metadata when creating checkout for stronger attribution.
    fbp: meta.fbp || null,
    fbc: meta.fbc || null,
    client_ip_address: meta.client_ip_address || null,
    client_user_agent: meta.client_user_agent || null
  });

  const payload = {
    data: [{
      event_name: "Purchase",
      event_time: Math.floor(Date.now() / 1000),
      event_id: transaction_id,
      action_source: "website",
      event_source_url: return_url || process.env.META_EVENT_SOURCE_URL || undefined,
      user_data,
      custom_data: {
        currency: String(currency).toUpperCase(),
        value: currencyAmount(amount_cents, currency),
        order_id: transaction_id
      }
    }]
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/v25.0/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );
    const response = await res.json().catch(() => null);
    if (!res.ok) {
      console.error("Meta Purchase event failed", response);
      return { sent: false, error: response || `Meta HTTP ${res.status}` };
    }
    return { sent: true, events_received: response?.events_received ?? null };
  } catch (error) {
    console.error("Meta Purchase event failed", error);
    return { sent: false, error: String(error?.message || error) };
  }
}

function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value != null));
}

function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || null, last: parts.length > 1 ? parts.slice(1).join(" ") : null };
}

function normalize(value) {
  return String(value).trim().toLowerCase();
}

function hashedArray(value) {
  if (value == null || String(value).trim() === "") return undefined;
  return [sha256(normalize(value))];
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function currencyAmount(amount, currency) {
  const zeroDecimal = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
  return zeroDecimal.has(String(currency).toUpperCase()) ? amount : amount / 100;
}

function json(status, obj) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    },
    body: JSON.stringify(obj)
  };
}
