// netlify/functions/hf-callback.js
// Webhook receiver for Higgsfield (Veo-style): robust query parsing + Supabase update.
// Only targeted change from your current file: properly read ?run_id=&uid= from Netlify's event.
// Everything else is preserved.

const { URL } = require("url");
const https = require("https");

const HF_WEBHOOK_SECRET = process.env.HF_WEBHOOK_SECRET || ""; // optional; if empty, no secret check
const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

exports.handler = async (event) => {
  try{
    if (event.httpMethod === "OPTIONS") return ok({});
    if (event.httpMethod !== "POST")   return err(405, "Method Not Allowed");

    // optional signature/secret check
    if (HF_WEBHOOK_SECRET) {
      const sent = event.headers["x-hf-signature"] || event.headers["x-hf-secret"];
      if (!sent || String(sent).trim() !== HF_WEBHOOK_SECRET) {
        return err(401, "Invalid webhook secret");
      }
    }

    const body = safeJson(event.body);

    // --- Robust query parsing on Netlify ---
    // Prefer queryStringParameters; fallback to rawUrl; then to rawQuery/rawQueryString.
    let qp_run_id = "", qp_uid = "";
    try {
      if (event.queryStringParameters && typeof event.queryStringParameters === "object") {
        qp_run_id = (event.queryStringParameters.run_id || "").trim();
        qp_uid    = (event.queryStringParameters.uid || "").trim();
      } else if (event.rawUrl) {
        const u = new URL(event.rawUrl);
        qp_run_id = (u.searchParams.get("run_id") || "").trim();
        qp_uid    = (u.searchParams.get("uid") || "").trim();
      } else {
        const rawQS = event.rawQuery || event.rawQueryString || "";
        const qs = new URLSearchParams(rawQS);
        qp_run_id = (qs.get("run_id") || "").trim();
        qp_uid    = (qs.get("uid") || "").trim();
      }
    } catch {}

    // Provider payload (tolerant)
    const job_id     = String(body?.id || body?.job_id || body?.data?.id || "").trim();
    const run_id     = String((qp_run_id || body?.metadata?.run_id || body?.run_id || "")).trim(); // query takes precedence
    const job_set_id = String(body?.job_set_id || body?.data?.job_set_id || "").trim();

    // Resolve URLs from common fields
    const video_url  = findFirstUrl(body, ["video_url","result_url","url","data.url","data.video_url"]);
    const thumb_url  = findFirstUrl(body, ["thumb_url","thumbnail","poster","data.thumb_url","data.thumbnail"]);

    if (!UG_URL || !SERVICE_KEY) return ok({ ok:false, reason:"missing_supabase_env" });

    // Update row by run_id, fallback to job_set_id
    let updated = false;
    if (run_id) {
      const r = await getJson(`${UG_URL}?select=id&meta->>run_id=eq.${encodeURIComponent(run_id)}`, sb());
      const arr = Array.isArray(r.json) ? r.json : [];
      if (arr.length){
        await patchJson(`${UG_URL}?id=eq.${encodeURIComponent(arr[0].id)}`, {
          result_url: video_url || null,
          meta: { run_id, job_set_id, job_id, status: "succeeded", video_url, thumb_url }
        }, { ...sb(), "Prefer":"return=minimal", "Content-Type":"application/json" });
        updated = true;
      }
    }
    if (!updated && job_set_id){
      const r = await getJson(`${UG_URL}?select=id&meta->>job_set_id=eq.${encodeURIComponent(job_set_id)}`, sb());
      const arr = Array.isArray(r.json) ? r.json : [];
      if (arr.length){
        await patchJson(`${UG_URL}?id=eq.${encodeURIComponent(arr[0].id)}`, {
          result_url: video_url || null,
          meta: { run_id, job_set_id, job_id, status: "succeeded", video_url, thumb_url }
        }, { ...sb(), "Prefer":"return=minimal", "Content-Type":"application/json" });
        updated = true;
      }
    }

    return ok({ ok:true, updated, job_set_id, run_id, video_url, thumb_url });
  }catch(e){
    return ok({ ok:false, reason: String(e && e.message ? e.message : e) });
  }
};

function findFirstUrl(obj, keys){
  try{
    for (const k of keys){
      const val = path(obj, k);
      if (val && /^https?:\/\//i.test(String(val))) return String(val);
    }
  }catch{}
  return "";
}
function path(o, p){
  return p.split(".").reduce((a,c)=> (a && typeof a === "object" ? a[c] : undefined), o);
}

// tiny https/json helpers
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
function patchJson(url, obj, headers){
  return httpRequest("PATCH", url, { ...(headers||{}), "Content-Type": "application/json" }, JSON.stringify(obj));
}
function getJson(url, headers){
  return httpRequest("GET", url, headers || {});
}

function ok(obj){ return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code, message){ return { statusCode: code, headers: cors(), body: JSON.stringify({ ok:false, error: message }) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, X-USER-ID, x-hf-signature, x-hf-secret" }; }
function safeJson(s){ try{ return JSON.parse(s || "{}"); } catch { return {}; } }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }
