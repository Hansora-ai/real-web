// netlify/functions/dodo-webhook.mjs
// ESM Netlify Function (Node 18). No external deps.
// Place this file at: netlify/functions/dodo-webhook.mjs
// Set environment variables in Netlify dashboard:
//   SUPABASE_URL = https://<PROJECT-REF>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY = <your service role key>
// Optional (if DodoPayments signing is available):
//   DODO_WEBHOOK_SECRET = <test/production signing secret>
//
// DodoPayments expected JSON example:
// {
//   "status": "paid",
//   "transaction_id": "tx_123",
//   "amount": 990,
//   "currency": "USD",
//   "metadata": {
//     "uid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
//     "credits": 220,
//     "return_url": "https://your-site/pricing.html?paid=1"
//   }
// }
//
// This handler is idempotent thanks to an UPSERT on payments(transaction_id).
// It then increments the user's credits (read + write).
// Make sure you've created the `payments` table with a unique transaction_id column.

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method Not Allowed" });
    }

    // Safety: basic JSON parse
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Bad JSON" });
    }

    const {
      status,
      transaction_id,
      amount,
      currency,
      metadata = {}
    } = body || {};

    const uid = metadata.uid;
    const credits = Number(metadata.credits);

    if (status !== "paid" || !transaction_id || !uid || !credits) {
      return json(400, { error: "Invalid payload" });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { error: "Missing Supabase env" });
    }

    // 1) UPSERT into payments (idempotent by transaction_id)
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
          amount_cents: amount ?? null,
          currency: currency ?? null,
          status: "paid",
          provider: "dodopayments",
          return_url: metadata.return_url ?? null,
          payload: body,
          paid_at: new Date().toISOString()
        }])
      });

      if (!res.ok) {
        const text = await res.text();
        return json(500, { error: "payments upsert failed", detail: text });
      }
    }

    // 2) Read current credits
    let currentCredits = 0;
    {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=credits`, {
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      });
      if (!res.ok) {
        const text = await res.text();
        return json(500, { error: "profiles fetch failed", detail: text });
      }
      const rows = await res.json();
      currentCredits = Number(rows?.[0]?.credits ?? 0);
    }

    // 3) Update credits (simple add). For heavy concurrency you can switch to a SQL RPC.
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

// Utility: JSON response with CORS
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
