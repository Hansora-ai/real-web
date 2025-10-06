
// netlify/functions/run-higgsfield.params.js
// Version that matches Higgsfield's documented schema with `params`,
// `motions`, and `input_images` arrays.

const https = require("https");
const { URL } = require("url");
const crypto = require("crypto");

const HF_URL = "https://platform.higgsfield.ai/v1/image2video/dop";
const HF_KEY = process.env.HF_API_KEY || "";
const HF_SECRET = process.env.HF_SECRET || "";

const HF_WEBHOOK_URL    = process.env.HF_WEBHOOK_URL    || "";
const HF_WEBHOOK_SECRET = process.env.HF_WEBHOOK_SECRET || ""; // optional

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

// ---------- utils ----------
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-USER-ID",
  };
}
function ok(obj) { return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code, message, extra) {
  return { statusCode: code, headers: cors(), body: JSON.stringify({ submitted:false, error: message, ...(extra||{}) }) };
}
function safeJson(s){ try { return JSON.parse(s || "{}"); } catch { return {}; } }
function normalizeHttpsUrl(u){
  try {
    const url = new URL(String(u||""));
    if (url.protocol !== "https:") return "";
    return url.href;
  } catch { return ""; }
}
function clamp01(n){
  const x = Number(n);
  if (Number.isFinite(x) === false) return 0.5;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
function reqJson(method, rawUrl, headers, bodyObj){
  const url = new URL(rawUrl);
  const payload = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : null;
  const opts = {
    method,
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: url.pathname + (url.search||""),
    headers: {
      "Content-Type": "application/json",
      ...(payload ? { "Content-Length": String(payload.length) } : {}),
      ...(headers||{}),
    },
  };
  return new Promise((resolve, reject)=>{
    const req = https.request(opts, (res)=>{
      let data = [];
      res.on("data", (c)=>data.push(c));
      res.on("end", ()=>{
        const txt = Buffer.concat(data).toString("utf8");
        let json = null;
        try { json = JSON.parse(txt || "{}"); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text: txt, json });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function randomRunId(){ try { return crypto.randomUUID(); } catch { return "run_" + Date.now(); } }
function extractJobSetId(respJson){
  if (!respJson || typeof respJson !== "object") return "";
  if (respJson.id) return String(respJson.id);
  if (respJson.data && respJson.data.id) return String(respJson.data.id);
  return "";
}
async function seedUserGenerations(uid, run_id, job_set_id, motion_id, image_url, prompt){
  if (!UG_URL || !SERVICE_KEY) return;
  const meta = {
    status: "submitted",
    provider: "higgsfield",
    kind: "image_to_video",
    run_id, job_set_id, motion_id, image_url,
  };
  const row = {
    user_id: uid,
    provider: "higgsfield",
    kind: "image_to_video",
    prompt: prompt || "",
    result_url: null,
    meta
  };
  await reqJson("POST", UG_URL, {
    "apikey": SERVICE_KEY,
    "Authorization": `Bearer ${SERVICE_KEY}`,
    "Prefer": "return=minimal"
  }, row).catch(()=>{});
}

// ---------- handler ----------
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (!HF_KEY || !HF_SECRET) return err(500, "missing_hf_credentials");
  if (!HF_WEBHOOK_URL) return err(500, "missing_webhook_url");

  const body = safeJson(event.body);
  if (!body || typeof body !== "object") return ok({ submitted:false, error:"invalid_json_body" });

  const uid = (body.uid || event.headers["x-user-id"] || "").trim();
  const motion_id = (body.motion_id || "").trim();
  const prompt = (body.prompt || "").toString();
  const imageUrl = normalizeHttpsUrl(body.imageUrl || body.image_url || "");
  const strength = clamp01(body.strength);

  if (!uid)       return ok({ submitted:false, error:"missing_uid" });
  if (!motion_id) return ok({ submitted:false, error:"missing_motion_id" });
  if (!imageUrl)  return ok({ submitted:false, error:"missing_image_url_https" });

  // Build payload exactly like the cURL you pasted
  const run_id = randomRunId();
  const payload = {
    webhook: HF_WEBHOOK_SECRET ? { url: HF_WEBHOOK_URL, secret: HF_WEBHOOK_SECRET } : { url: HF_WEBHOOK_URL },
    params: {
      model: "dop-turbo",
      prompt,
      // seed is optional – include a deterministic default for debug
      seed: 500000,
      motions: [{ id: motion_id, strength }],
      input_images: [{ type: "image_url", image_url: imageUrl }],
      // input_images_end: [] // not needed for single image
      enhance_prompt: true
    },
    // keep your run id in metadata if HF echoes it back in callbacks (some APIs do)
    metadata: { uid, run_id }
  };

  const res = await reqJson("POST", HF_URL, {
    "hf-api-key": HF_KEY,
    "hf-secret": HF_SECRET
  }, payload);

  if (res.status < 200 || res.status >= 300) {
    return ok({
      submitted:false,
      error:"hf_submit_failed",
      status: res.status,
      reason: (res.json && (res.json.message || res.json.error)) || res.text || "unknown",
      sent_shape: "curl_params_schema",
      sent_preview: {
        webhook: { url: HF_WEBHOOK_URL, with_secret: !!HF_WEBHOOK_SECRET },
        params: { model: "dop-turbo", prompt: prompt ? "[non-empty]" : "", motions_len: 1, input_images_len: 1 }
      }
    });
  }

  const job_set_id = extractJobSetId(res.json) || "";
  await seedUserGenerations(uid, run_id, job_set_id, motion_id, imageUrl, prompt).catch(()=>{});
  return ok({ submitted:true, job_set_id, run_id });
};
