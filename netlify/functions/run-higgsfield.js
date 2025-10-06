
// netlify/functions/run-higgsfield.js
// Node16-safe submitter with WEBHOOK (1:1 style to Veo flow).
// Minimal, targeted changes only: add webhook block and keep required params.
// Uses https helpers (no global fetch).

const https = require("https");
const { URL } = require("url");

const HF_URL = "https://platform.higgsfield.ai/v1/image2video/dop";
const HF_KEY = process.env.HF_API_KEY || "";
const HF_SECRET = process.env.HF_SECRET || "";

// Webhook config (mirror of Veo style)
const HF_WEBHOOK_URL    = process.env.HF_WEBHOOK_URL    || ""; // e.g. https://webhansora.netlify.app/.netlify/functions/hf-callback
const HF_WEBHOOK_SECRET = process.env.HF_WEBHOOK_SECRET || "";

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return ok({});
    if (event.httpMethod !== "POST")   return err(405, "Method Not Allowed");

    if (!HF_KEY || !HF_SECRET) {
      return ok({ submitted:false, error:"missing_env", reason:"Missing HF_API_KEY or HF_SECRET" });
    }

    const body = safeJson(event.body);
    const uid       = String(body.uid || body.user_id || "").trim();
    const motion_id = String(body.motion_id || "").trim();
    const imageUrl  = normalizeUrl(body.imageUrl || body.fileUrl || "");
    const prompt    = typeof body.prompt === "string" ? body.prompt : "";

    const strength  = typeof body.motion_strength === "number"
      ? Math.max(0, Math.min(1, body.motion_strength))
      : 0.7;

    if (!uid)       return ok({ submitted:false, error:"missing_user_id" });
    if (!motion_id) return ok({ submitted:false, error:"missing_motion_id" });
    if (!imageUrl)  return ok({ submitted:false, error:"missing_image_url" });

    const run_id = String(body.run_id || `${uid}-${Date.now()}`);

    // seed user_generations (processing)
    await upsertGen(uid, { run_id, status:"processing", provider:"higgsfield", model:"dop-turbo", motion_id });

    const payload = {
      ...(HF_WEBHOOK_URL ? { webhook: { url: HF_WEBHOOK_URL, ...(HF_WEBHOOK_SECRET ? { secret: HF_WEBHOOK_SECRET } : {}) } } : {}),
      params: {
        model: "dop-turbo",
        prompt,
        motions: [{ id: motion_id, strength }],
        input_images: [{ type: "image_url", image_url: imageUrl }],
        input_images_end: [],
        enhance_prompt: true
      }
    };

    const hfResp = await postJson(HF_URL, payload, {
      "Content-Type": "application/json",
      "hf-api-key": HF_KEY,
      "hf-secret": HF_SECRET
    });

    if (hfResp.statusCode < 200 || hfResp.statusCode >= 300) {
      return ok({ submitted:false, error:`hf_${hfResp.statusCode}`, reason: hfResp.json?.detail || hfResp.text || hfResp.json, sent: payload });
    }

    const data = hfResp.json || safeJson(hfResp.text);
    const jobSetId = extractJobSetId(data);
    // store job_set_id into meta so callback/check can link it
    await upsertGen(uid, { run_id, status:"processing", provider:"higgsfield", model:"dop-turbo", motion_id, job_set_id: jobSetId || "" });

    return ok({ submitted:true, run_id, job_set_id: jobSetId || "", data });
  } catch (e) {
    return ok({ submitted:false, error:"exception", reason: String(e && e.message ? e.message : e) });
  }
};

async function upsertGen(uid, meta){
  try{
    if (!UG_URL || !SERVICE_KEY) return;
    const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(meta.run_id)}&select=id`;
    const chk = await getJson(UG_URL + q, { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` });
    if (Array.isArray(chk.json) && chk.json.length){
      await patchJson(`${UG_URL}?id=eq.${encodeURIComponent(chk.json[0].id)}`, { meta }, {
        "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}`, "Prefer": "return=minimal"
      });
    } else {
      await postJson(UG_URL, { user_id: uid, provider:"higgsfield", kind:"video", prompt:null, result_url:null, meta }, {
        "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}`, "Prefer": "return=minimal"
      });
    }
  }catch{}
}

// tiny https helpers
function httpRequest(method, urlStr, headers, body){
  const url = new URL(urlStr);
  const opts = {
    method,
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: url.pathname + (url.search || ""),
    headers: headers || {}
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, text: data, json: safeJson(data) }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
function postJson(url, obj, headers){
  return httpRequest("POST", url, { ...(headers||{}), "Content-Type": "application/json" }, JSON.stringify(obj));
}
function patchJson(url, obj, headers){
  return httpRequest("PATCH", url, { ...(headers||{}), "Content-Type": "application/json" }, JSON.stringify(obj));
}
function getJson(url, headers){
  return httpRequest("GET", url, headers || {});
}

// utils
function ok(obj){ return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code, message){ return { statusCode: code, headers: cors(), body: JSON.stringify({ submitted:false, error: message }) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, X-USER-ID" }; }
function safeJson(s){ try{ return JSON.parse(s || "{}"); } catch { return null; } }
function normalizeUrl(u){ try{ const url = new URL(String(u||"")); return url.href; } catch { return ""; } }
function extractJobSetId(data){
  if (!data || typeof data !== "object") return "";
  if (data.id) return String(data.id);
  if (data.data?.id) return String(data.data.id);
  return "";
}
