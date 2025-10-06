// netlify/functions/run-higgsfield.js
// Single-responsibility function to submit an Image→Video job to Higgsfield DoP.
// Minimal, targeted change: ensure `params.prompt` and `params.motions[*].strength` are ALWAYS present.
// No other app logic is touched here.
//
// Env vars required:
//   HF_API_KEY, HF_SECRET
//
// Client POST body (JSON):
// {
//   "imageUrl": "https://public.example/img.jpg",   // REQUIRED (public HTTPS URL)
//   "motion_id": "ea035f68-b350-40f1-b7f4-7dff999fdd67", // REQUIRED
//   "prompt": "optional text",                      // OPTIONAL
//   "motion_strength": 0.7,                         // OPTIONAL (0..1)
//   "seed": 500000,                                 // OPTIONAL
//   "enhance_prompt": true,                         // OPTIONAL
//   "webhook_url": "https://.../callback",         // OPTIONAL
//   "webhook_secret": "abc"                        // OPTIONAL
// }
//
// Response mirrors provider data and echoes the payload we sent for debugging.

const HF_URL = "https://platform.higgsfield.ai/v1/image2video/dop";

const HF_KEY = process.env.HF_API_KEY || "";
const HF_SECRET = process.env.HF_SECRET || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: CORS, body: "" };
    }
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };
    }

    if (!HF_KEY || !HF_SECRET) {
      return json(500, { ok: false, reason: "Missing HF_API_KEY or HF_SECRET" });
    }

    const body = safeJson(event.body);
    const imageUrl = String(body.imageUrl || body.image_url || "");
    const motionId = String(body.motion_id || body.motionId || "");
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    const strength =
      typeof body.motion_strength === "number" && body.motion_strength >= 0 && body.motion_strength <= 1
        ? body.motion_strength
        : 0.7;
    const seed = typeof body.seed === "number" ? body.seed : undefined;
    const enhance_prompt = typeof body.enhance_prompt === "boolean" ? body.enhance_prompt : true;
    const webhook_url = typeof body.webhook_url === "string" && body.webhook_url ? body.webhook_url : undefined;
    const webhook_secret = typeof body.webhook_secret === "string" && body.webhook_secret ? body.webhook_secret : undefined;
    const model = typeof body.model === "string" && body.model ? body.model : "dop-turbo";

    if (!/^https?:\/\//i.test(imageUrl)) {
      return json(400, { ok: false, reason: "imageUrl must be a public https URL" });
    }
    if (!motionId) {
      return json(400, { ok: false, reason: "motion_id is required" });
    }

    const payload = {
      ...(webhook_url ? { webhook: { url: webhook_url, ...(webhook_secret ? { secret: webhook_secret } : {}) } } : {}),
      params: {
        model,
        prompt, // REQUIRED by API
        ...(seed !== undefined ? { seed } : {}),
        motions: [{ id: motionId, strength }], // strength REQUIRED by API
        input_images: [{ type: "image_url", image_url: imageUrl }],
        input_images_end: [],
        enhance_prompt,
      },
    };

    const res = await fetch(HF_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "hf-api-key": HF_KEY,
        "hf-secret": HF_SECRET,
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
      return json(res.status, { ok: false, provider_status: res.status, reason: data?.detail || data, sent: payload });
    }

    return json(200, { ok: true, data, sent: payload });
  } catch (e) {
    return json(500, { ok: false, reason: String(e && e.message ? e.message : e) });
  }
};

function json(code, obj) {
  return { statusCode: code, headers: CORS, body: JSON.stringify(obj) };
}
function safeJson(s) {
  try { return JSON.parse(s || "{}"); } catch { return {}; }
}
