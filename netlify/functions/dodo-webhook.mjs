// netlify/functions/dodo-webhook.mjs
// FINAL — Idempotent via CAS: credits added exactly once.
// - Matches your `public.payments` schema.
// - Uses `profiles.user_id`.
// - Adds `apikey` header on all Supabase REST calls.
// - First upsert ensures a row exists; then a CAS PATCH updates `status` from NULL → 'succeeded'.
//   Only the request that wins the CAS adds user credits.

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
          "Prefer": "resolution=merge-duplicates,return=representation",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "apikey": SUPABASE_SERVICE_ROLE_KEY
        },
        body: JSON.stringify([{
          transaction_id,
          uid,
          credits,
          amount_cents,
          currency,
          // leave status as-is if row exists; ok to send null on first insert
          status: null,
          provider,
          return_url,
          payload: root,
          paid_at
        }])
      });
      // If this fails, bail out early
      const body = await sjson(res);
      if (!res.ok || !Array.isArray(body) || body.length === 0) {
        const text = body || await res.text();
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

    return json(200, { ok: true, credited });
  } catch (e) {
    return json(500, { error: String(e?.message || e) });
  }
}

// Utils
function toInt(x){ const n = Number(x); return Number.isFinite(n) ? Math.trunc(n) : null; }
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
