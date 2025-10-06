// netlify/functions/hf-callback.js
// Tolerant Higgsfield webhook receiver (no secret required).
// - Accepts POSTs without signature/secret (dev-friendly).
// - Extracts run_id / job_set_id from body.metadata or body directly.
// - Extracts video/thumb urls from multiple possible shapes.
// - Updates Supabase `user_generations` by meta->>run_id (preferred) or meta->>job_set_id.
// Node 16 compatible.

const https = require("https");
const { URL } = require("url");

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

function cors(){ return {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"POST,OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type, Authorization"
};}
function ok(obj){ return { statusCode:200, headers:cors(), body: JSON.stringify(obj) }; }
function err(code,msg,extra){ return { statusCode:code, headers:cors(), body: JSON.stringify({ ok:false, error:msg, ...(extra||{}) }) }; }
function safeJson(s){ try{ return JSON.parse(s||"{}"); }catch{ return {}; } }

function reqJson(method, rawUrl, headers, bodyObj){
  const u = new URL(rawUrl);
  const payload = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : null;
  const opts = {
    method,
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port || (u.protocol==="https:"?443:80),
    path: u.pathname + (u.search||""),
    headers: {
      "Content-Type": "application/json",
      ...(payload ? { "Content-Length": String(payload.length) } : {}),
      ...(headers||{}),
    }
  };
  return new Promise((resolve,reject)=>{
    const req = https.request(opts, res=>{
      let chunks=[];
      res.on("data",c=>chunks.push(c));
      res.on("end",()=>{
        const text = Buffer.concat(chunks).toString("utf8");
        let json=null; try{ json=JSON.parse(text||"{}"); }catch{}
        resolve({ status:res.statusCode, text, json });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function pick(o, ...keys){ const r={}; for(const k of keys){ if(o && Object.prototype.hasOwnProperty.call(o,k)) r[k]=o[k]; } return r; }

function extractUrls(body){
  // Try common shapes HF might send
  const v = body?.video_url || body?.data?.video_url || body?.output?.video_url || body?.output?.url || body?.result_url || "";
  const t = body?.thumb_url || body?.data?.thumb_url || body?.output?.thumb_url || body?.thumbnail_url || "";
  return { video_url: v || "", thumb_url: t || "" };
}
function extractIds(body){
  let run_id = body?.metadata?.run_id || body?.run_id || "";
  let job_set_id = body?.id || body?.data?.id || body?.job_set_id || "";
  return { run_id: String(run_id||""), job_set_id: String(job_set_id||"") };
}

async function updateByMeta(field, value, patch){
  if (!UG_URL || !SERVICE_KEY || !value) return { status:0, tried:false };
  const url = `${UG_URL}?select=id&meta->>${encodeURIComponent(field)}=eq.${encodeURIComponent(value)}`;
  return await reqJson("PATCH", url, {
    "apikey": SERVICE_KEY,
    "Authorization": `Bearer ${SERVICE_KEY}`,
    "Prefer": "return=minimal"
  }, patch);
}

exports.handler = async (event)=>{
  try{
    if (event.httpMethod === "OPTIONS") return ok({});
    if (event.httpMethod !== "POST") return err(405,"method_not_allowed");

    const body = safeJson(event.body);
    const { video_url, thumb_url } = extractUrls(body);
    let { run_id, job_set_id } = extractIds(body);
    // Fallback to query params if metadata did not include IDs (some submitters append them)
    const qs = event.queryStringParameters || {};
    const qs_run = (qs.run_id || qs.runId || "").trim();
    const qs_job = (qs.job_set_id || qs.jobSetId || "").trim();
    const qs_uid = (qs.uid || qs.user_id || "").trim();
    if (!run_id && qs_run) { run_id = qs_run; }
    if (!job_set_id && qs_job) { job_set_id = qs_job; }

    const status = body?.status || body?.state || body?.data?.status || "succeeded";

    const patch = {
      result_url: video_url || null,
      meta: {
        ...(body?.metadata || {}),
        run_id, job_set_id, video_url, thumb_url, status
      }
    };

    // Prefer updating by run_id, fallback to job_set_id.
    let res = await updateByMeta("run_id", run_id, patch);
    if (res.status && res.status >=200 && res.status<300) return ok({ ok:true, mode:"run_id", run_id });

    res = await updateByMeta("job_set_id", job_set_id, patch);
    if (res.status && res.status >=200 && res.status<300) return ok({ ok:true, mode:"job_set_id", job_set_id });

    return ok({ ok:true, note:"no_row_matched_yet", run_id, job_set_id });
  }catch(e){
    return err(500,"exception",{ message: e?.message || String(e) });
  }
};
