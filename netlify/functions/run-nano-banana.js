// netlify/functions/run-nano-banana.js
const CREATE_URL = process.env.KIE_CREATE_URL || "https://api.kie.ai/api/v1/jobs/createTask";
const API_KEY = process.env.KIE_API_KEY;

if (!API_KEY) console.warn("[run-nano-banana] Missing KIE_API_KEY env!");

const RESULT_URLS = [
  (id) => `https://api.kie.ai/api/v1/jobs/getTask?taskId=${id}`,
  (id) => `https://api.kie.ai/api/v1/jobs/getTaskResult?taskId=${id}`,
  (id) => `https://api.kie.ai/api/v1/jobs/result?taskId=${id}`,
];

// Base callback (WITH DOT path)
const CALLBACK_BASE = "https://webhansora.netlify.app/.netlify/functions/kie-callback";
const VERSION_TAG   = "nb_fn_submit_qs_cb";

function normalizeImageSize(v) {
  if (!v) return "auto";
  const raw = String(v).trim().toLowerCase().replace(/\s+/g, "").replace(/_/g, ":").replace(/-/g, ":");
  const ok = new Set(["auto","1:1","3:4","9:16","4:3","16:9"]);
  if (ok.has(raw)) return raw;
  const map = { square: "1:1", portrait: "3:4", landscape: "16:9" };
  return map[raw] || "auto";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return {"statusCode": 204, "headers": cors(), "body": ""};
  if (event.httpMethod !== "POST") return {"statusCode": 405, "headers": cors(), "body": "Use POST"};

  try {
    const body = JSON.parse(event.body || "{}");
    const urls = Array.isArray(body.urls) ? body.urls : [];
    const prompt = body.prompt || "";
    const format = (body.format || "png").toLowerCase();
    const size = normalizeImageSize(body.size);

    const uid = event.headers["x-user-id"] || event.headers["X-USER-ID"] || "anon";
    const rid = body.run_id || `${uid}-${Date.now()}`;

    if (!API_KEY) return {"statusCode": 500, "headers": cors(), "body": "Missing: KIE_API_KEY"};
    if (!urls.length) return {"statusCode": 200, "headers": cors(), "body": JSON.stringify({submitted:false, reason:"urls_required"})};

    // Build callback with identifiers in the query string (robust if body isn't JSON)
    const cb = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(rid)}`;

    const payload = {
      model: "google/nano-banana-edit",
      input: { prompt, image_urls: urls, output_format: format, image_size: size },

      webhook_url: cb,
      callbackUrl: cb,
      callBackUrl: cb,
      notify_url:  cb,

      meta:     { uid, run_id: rid, version: VERSION_TAG, cb },
      metadata: { uid, run_id: rid, version: VERSION_TAG, cb }
    };

    const create = await fetch(CREATE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await create.text();
    let js; try { js = JSON.parse(text); } catch { js = { raw: text }; }
    const taskId = js.taskId || js.id || js.data?.taskId || js.data?.id || null;

    // Always tell the UI it was submitted; callback will deliver the row
    return {
      statusCode: 200,
      headers: { ...cors(), "X-NB-Version": VERSION_TAG, "X-NB-Callback": cb },
      body: JSON.stringify({ submitted: true, taskId, run_id: rid })
    };

  } catch (e) {
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ submitted:true, note:"exception", message:String(e) }) };
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-USER-ID, x-user-id"
  };
}
