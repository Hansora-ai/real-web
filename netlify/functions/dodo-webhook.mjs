// netlify/functions/dodo-webhook.mjs
// Updated: tolerant to Dodo payloads like { type: "payment.succeeded", status: "succeeded", data: {...} }
// - Accepts transaction id under payment_id or transaction_id
// - Accepts status "paid" or "succeeded"
// - Accepts metadata at body.metadata, body.data.metadata, or body.data.payment.metadata
// - FALLBACKS when metadata.uid missing:
//     * Map product_id -> credits (PRODUCT_CREDIT_MAP env or internal default)
//     * Try to resolve uid by customer.email against Supabase profiles.email
//       (requires profiles.email column to exist; otherwise skip)
// - Still idempotent UPSERT on payments(transaction_id)
// - Only minimal, surgical changes; core logic preserved.

const PRODUCT_CREDIT_MAP = (() => {
  try {
    // JSON like: {"pdt_EfHDUnsXi3GqJwOS3qaPw":50}
    return JSON.parse(process.env.PRODUCT_CREDIT_MAP || "{}");
  } catch { return {}; }
})();

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method Not Allowed" });
    }

    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return json(400, { error: "Bad JSON" }); }

    // Unify shape
    const root = body || {};
    const data = root.data || root;
    const type = root.type || data.type || null;
    const payloadType = root.payload_type || data.payload_type || null;
    let status = root.status || data.status || null;
    if (!status && type === "payment.succeeded") status = "succeeded";

    // transaction id
    const transaction_id = root.transaction_id || data.transaction_id || data.payment_id || root.payment_id || null;

    // money
    const amount_cents = data.total_amount ?? data.settlement_amount ?? root.amount ?? null;
    const currency = data.currency || data.settlement_currency || root.currency || null;

    // metadata (multiple places)
    const meta =
      root.metadata ||
      data.metadata ||
      (data.payment && data.payment.metadata) ||
      {};

    // product id (to map credits when metadata missing)
    const product_id = (Array.isArray(data.product_cart) && data.product_cart[0]?.product_id) || null;
    const quantity = (Array.isArray(data.product_cart) && Number(data.product_cart[0]?.quantity || 1)) || 1;

    // extract uid/credits
    let uid = meta.uid || null;
    let credits = Number(meta.credits || 0);

    // normalize success status
    const okStatus = (status === "paid" || status === "succeeded");

    // Fallback credits from product id
    if (!credits && product_id && PRODUCT_CREDIT_MAP[product_id]) {
      credits = Number(PRODUCT_CREDIT_MAP[product_id]) * quantity;
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { error: "Missing Supabase env" });
    }

    // Fallback uid from customer.email (if available), by looking up profiles table
    if (!uid) {
      const email = (data.customer && data.customer.email) || root.email || null;
      if (email) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id`, {
          headers: { "Accept": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
        });
        if (r.ok) {
          const rows = await r.json();
          uid = rows?.[0]?.id || null;
        }
      }
    }

    // Validate minimum
    if (!okStatus || !transaction_id || !uid || !credits) {
      return json(400, { error: "Invalid payload", debug: { okStatus, transaction_id, uid: !!uid, credits } });
    }

    // 1) UPSERT into payments
    {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/payments?on_conflict=transaction_id`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Prefer": "resolution=merge-duplicates,return=representation",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify([{
          transaction_id,
          uid,
          credits,
          amount_cents,
          currency,
          status: "paid",
          provider: "dodopayments",
          return_url: meta.return_url ?? null,
          payload: root,
          paid_at: new Date().toISOString()
        }])
      });
      if (!res.ok) {
        const text = await res.text();
        return json(500, { error: "payments upsert failed", detail: text });
      }
    }

    // 2) Fetch current credits
    let currentCredits = 0;
    {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=credits`, {
        headers: { "Accept": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
      });
      if (!res.ok) {
        const text = await res.text();
        return json(500, { error: "profiles fetch failed", detail: text });
      }
      const rows = await res.json();
      currentCredits = Number(rows?.[0]?.credits ?? 0);
    }

    // 3) Update credits
    {
      const newCredits = currentCredits + credits;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Prefer": "return=representation",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({ credits: newCredits })
      });
      if (!res.ok) {
        const text = await res.text();
        return json(500, { error: "profiles update failed", detail: text });
      }
    }

    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: String(e?.message || e) });
  }
}

// Utility
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
