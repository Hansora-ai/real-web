// netlify/functions/hf-callback.js
// Tolerant Higgsfield webhook receiver (PING-friendly)
// - Returns 200 OK for GET/HEAD/OPTIONS health checks (some providers ping the URL)
// - Processes POSTs to update Supabase rows by meta->>run_id (fallback job_set_id)
// - No secret required

const https = require("https");
const { URL } = require("url");

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

function cors(){ return {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET,HEAD,POST,OPTIONS",
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

function extractUrls(body){
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
    // Accept health-checks without error (prevents submit-time 422s if provider pings webhook)
    if (event.httpMethod === "OPTIONS" || event.httpMethod === "GET" || event.httpMethod === "HEAD") {
      return ok({ ok:true, ping:true });
    }
    if (event.httpMethod !== "POST") return err(405,"method_not_allowed");

    const body = safeJson(event.body);
    const { video_url, thumb_url } = extractUrls(body);
    const { run_id, job_set_id } = extractIds(body);
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
