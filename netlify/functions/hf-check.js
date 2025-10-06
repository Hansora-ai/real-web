// netlify/functions/hf-check.js
// Returns the stored video_url/thumb_url from Supabase for a given run_id or job_set_id + uid.
// Simple status probe used by the frontend polling loop.

const https = require("https");
const { URL } = require("url");

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

function cors(){ return {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET,OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type, Authorization"
};}
function ok(obj){ return { statusCode:200, headers:cors(), body: JSON.stringify(obj) }; }
function err(code,msg,extra){ return { statusCode:code, headers:cors(), body: JSON.stringify({ ok:false, error:msg, ...(extra||{}) }) }; }

function req(method, rawUrl){
  const u = new URL(rawUrl);
  const opts = {
    method,
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port || (u.protocol==="https:"?443:80),
    path: u.pathname + (u.search||""),
    headers: {
      "Accept": "application/json",
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`
    }
  };
  return new Promise((resolve,reject)=>{
    const r = https.request(opts,res=>{
      let chunks=[];
      res.on("data",c=>chunks.push(c));
      res.on("end",()=>{
        const t = Buffer.concat(chunks).toString("utf8");
        let j=null; try{ j=JSON.parse(t||"[]"); }catch{}
        resolve({ status:res.statusCode, json:j, text:t });
      });
    });
    r.on("error", reject);
    r.end();
  });
}

exports.handler = async (event)=>{
  try{
    if (event.httpMethod === "OPTIONS") return ok({});
    if (event.httpMethod !== "GET") return err(405,"method_not_allowed");

    const qs = event.queryStringParameters || {};
    const run_id = (qs.run_id || "").trim();
    const job_set_id = (qs.job_set_id || "").trim();
    const uid = (qs.uid || "").trim();

    if (!UG_URL || !SERVICE_KEY) return err(500,"server_not_configured");

    // Prefer run_id
    let url = "";
    if (run_id){
      url = `${UG_URL}?select=created_at,result_url,meta&meta->>run_id=eq.${encodeURIComponent(run_id)}&user_id=eq.${encodeURIComponent(uid)}&order=created_at.desc&limit=1`;
    } else if (job_set_id) {
      url = `${UG_URL}?select=created_at,result_url,meta&meta->>job_set_id=eq.${encodeURIComponent(job_set_id)}&user_id=eq.${encodeURIComponent(uid)}&order=created_at.desc&limit=1`;
    } else {
      return ok({ ok:true, video_url:null });
    }

    const res = await req("GET", url);
    const row = Array.isArray(res.json) && res.json.length ? res.json[0] : null;
    const meta = row?.meta || {};
    const video_url = row?.result_url || meta?.video_url || null;
    const thumb_url = meta?.thumb_url || null;
    const status = meta?.status || (video_url ? "succeeded" : "processing");

    return ok({ ok:true, video_url, thumb_url, status });
  }catch(e){
    return err(500,"exception",{ message: e?.message || String(e) });
  }
};
