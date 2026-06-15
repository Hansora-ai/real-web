// netlify/functions/dodo-webhook.mjs
// Idempotent via CAS: credits added exactly once.
// - Matches your `public.payments` schema.
// - Uses `profiles.user_id`.
// - Adds `apikey` header on all Supabase REST calls.
// - First insert ensures a row exists; then a CAS PATCH updates `status` from NULL → 'succeeded'.
//   Only the request that wins the CAS adds user credits.
// - Sends a server-side Meta Purchase event. Meta deduplicates retries by transaction ID.

import { createHash } from "node:crypto";

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
    let status = root.status || data.status || null;
    if (!status && type === "payment.succeeded") status = "succeeded";

    const meta = (root.metadata || data.metadata || (data.payment && data.payment.metadata)) || {};

    const transaction_id =
      root.transaction_id || data.transaction_id || data.payment_id || root.payment_id || null;
    const uid = meta.uid || null;
    const credits = Number(meta.credits || 0);

    const amount_cents = toInt(data.total_amount ?? data.settlement_amount ?? null);
    const currency = data.currency || data.settlement_currency || null;
    const provider = "dodopayments";
    const return_url = meta.return_url || null;
    const paid_at = data.created_at || data.updated_at || new Date().toISOString();

    if (!(status === "paid" || status === "succeeded")) {
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
      // Read current credits
      let currentCredits = 0;
      {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`, {
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
        currentCredits = Number(rows?.[0]?.credits ?? 0);
      }
      // Update credits
      {
        const newCredits = currentCredits + credits;
        const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Prefer": "return=representation",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "apikey": SUPABASE_SERVICE_ROLE_KEY
          },
          body: JSON.stringify({ credits: newCredits })
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

// Utils
function toInt(x){ const n = Number(x); return Number.isFinite(n) ? Math.trunc(n) : null; }

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
