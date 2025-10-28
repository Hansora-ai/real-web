// netlify/functions/create-dodo-session.mjs
// ESM Netlify Function (Node 18). No external deps.
// PURPOSE: Create a Dodo Payments checkout session with per-user metadata (uid, credits, return_url).
// ENV VARS required in Netlify:
//   DODO_API_KEY                = <your Dodo Payments API key>
//   DODO_PRODUCT_ID_50          = pdt_EfHDUnsXi3GqJwOS3qaPw   (example from your screenshot; set correct one)
//   DODO_CURRENCY               = USD                         (or AMD if you prefer server-side currency)
//   DODO_MODE                   = test | live                 (optional; default test)
//   DODO_RETURN_URL             = https://hansora.co/pricing.html?paid=1
//
// REQUEST (POST JSON):
//   { "uid": "<supabase-user-id>", "credits": 50 }
// RESPONSE (200):
//   { "url": "https://test.checkout.dodopayments.com/buy/..." }
//
// NOTES:
// - We pass metadata.uid and metadata.credits so the webhook can credit the user on success.
// - Currency for display can be auto-selected by Dodo UI; server currency stays USD by default.
// - Do not expose your API key on the client; this runs server-side on Netlify.
//
// Place at: netlify/functions/create-dodo-session.mjs

export const handler = async (event) => {
  // Allow only POST
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method Not Allowed" });
  }
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  try {
    const { uid, credits = 50 } = JSON.parse(event.body || "{}");
    if (!uid || !Number(credits)) {
      return json(400, { error: "Missing uid or credits" });
    }

    const API_KEY = process.env.DODO_API_KEY;
    const PRODUCT_ID = process.env.DODO_PRODUCT_ID_50;
    const CURRENCY = process.env.DODO_CURRENCY || "USD";
    const MODE = (process.env.DODO_MODE || "test").toLowerCase(); // "test" or "live"
    const RETURN_URL = process.env.DODO_RETURN_URL || "https://hansora.co/pricing.html?paid=1";

    if (!API_KEY || !PRODUCT_ID) {
      return json(500, { error: "Missing Dodo env (API key or product id)" });
    }

    // Dodo Payments session create (generic REST shape).
    // If your workspace uses a different path/body shape, update here only.
    const endpoint = "https://api.dodopayments.com/v1/checkout/sessions";

    const body = {
      product_id: PRODUCT_ID,
      currency: CURRENCY,
      mode: MODE,                 // ensure test vs live workspace
      metadata: {
        uid,
        credits: Number(credits),
        return_url: RETURN_URL
      },
      // Optional: override return url if supported at session-level
      success_url: RETURN_URL,
      cancel_url: RETURN_URL.replace("paid=1", "paid=0"),
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errTxt = await res.text();
      return json(502, { error: "Dodo session create failed", details: errTxt });
    }

    const data = await res.json();
    // Expect { id, url, ... }
    if (!data?.url) {
      return json(502, { error: "No checkout URL returned", data });
    }

    return json(200, { url: data.url });
  } catch (e) {
    return json(500, { error: e.message || String(e) });
  }
};

function json(status, obj) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(obj)
  };
}
