// netlify/functions/run-nano-banana.js
// Create Nano Banana job and immediately return "submitted".
// KIE will POST the final result to our callback; UI should watch Supabase by run_id.

const CREATE_URL = process.env.KIE_CREATE_URL || "https://api.kie.ai/api/v1/jobs/createTask";
const API_KEY = process.env.KIE_API_KEY;

if (!API_KEY) console.warn("[run-nano-banana] Missing KIE_API_KEY env!");

// Base Netlify Functions callback (WITH DOT)
const CALLBACK_URL = "https://webhansora.netlify.app/.netlify/functions/kie-callback";
const VERSION_TAG  = "nb_fn_final_submit_only_qs";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Use POST" };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    // Required inputs
    const rawUrls = Array.isArray(body.urls) ? body.urls : [];
    if (!rawUrls.length) {
      return ok({ submitted: false, note: "urls_required", version: VERSION_TAG });
    }

    // Normalize/encode URLs (handles spaces/commas)
    const image_urls = rawUrls.map(u => encodeURI(String(u)));

    const prompt  = body.prompt || "";
    const format  = (body.format || "png").toLowerCase();
    const size    = normalizeImageSize(body.size);

    // Identify the user/run to bind result
    const uid    = event.headers["x-user-id"] || event.headers["X-USER-ID"] || "anon";
    const run_id = body.run_id || `${uid}-${Date.now()}`;

    // include uid & run_id in the callback URL (works even if KIE posts non-JSON)
    const cb = `${CALLBACK_URL}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    // Build KIE payload
    const payload = {
      model: "google/nano-banana-edit",
      input: { prompt, image_urls, output_format: format, image_size: size },

      // Callbacks (add all variants)
      webhook_url: cb,
      webhookUrl:  cb, // ← added line (minimal change)
      callbackUrl: cb,
      callBackUrl: cb,
      notify_url:  cb,

      // meta used by kie-callback.js
      meta:      { uid, run_id, version: VERSION_TAG, cb },
      metadata:  { uid, run_id, version: VERSION_TAG, cb }
    };

    // Create the job
    const create = await fetch(CREATE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type":  "application/json",
        "Accept":        "application/json"
      },
      body: JSON.stringify(payload)
    });

    // Parse response (even if not 200)
    const text = await create.text();
    let js; try { js = JSON.parse(text); } catch { js = { raw: text }; }

    // Best-effort taskId extraction
    const taskId =
      js.taskId || js.id || js.data?.taskId || js.data?.id || null;

    // Always return 200 submitted (let callback deliver final result)
    return ok({
      submitted: true,
      taskId,
      run_id,
      version: VERSION_TAG,
      used_callback: cb
    });

  } catch (e) {
    // Still 200 so the UI stays in "submitted" and waits for callback
    return ok({ submitted: true, note: "exception", message: String(e), version: VERSION_TAG });
  }
};

// ───────────────────────────────── helpers

function normalizeImageSize(v) {
  if (!v) return "auto";
  const s = String(v).trim().toLowerCase();
  const allowedNamed = new Set([
    "auto",
    "square",
    "portrait_3_4",
    "portrait_9_16",
    "landscape_4_3",
    "landscape_16_9"
  ]);
  if (allowedNamed.has(s)) return s;
  const ratios = new Map([
    ["1:1", "square"],
    ["3:4", "portrait_3_4"],
    ["9:16", "portrait_9_16"],
    ["4:3", "landscape_4_3"],
    ["16:9", "landscape_16_9"]
  ]);
  if (ratios.has(s)) return ratios.get(s);
  const digitsOnly = s.replace(/(\d)[_\-:](\d)/g, "$1:$2");
  if (ratios.has(digitsOnly)) return ratios.get(digitsOnly);
  return "auto";
}

function ok(json) {
  return {
    statusCode: 200,
    headers: { ...cors(), "X-NB-Version": VERSION_TAG },
    body: JSON.stringify(json)
  };
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-USER-ID, x-user-id"
  };
}
