// netlify/functions/run-sora2.js (KIE Market)
const VERSION = "run-sora2-2025-10-06+v4-kie-market";

const KIE_BASE = (process.env.KIE_BASE_URL || "").replace(/\/+$/,"");
const KIE_API_KEY = process.env.KIE_API_KEY || "";

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return err(405, "Use POST");

  const body = safeJson(event.body);
  const uid  = String(body.uid || body.user_id || "").trim();
  if (!uid) return ok({ submitted:false, error:"missing_user_id" });

  const model  = String(body.model || "").trim() || "sora-2-text-to-video";
  const prompt = String(body.prompt || "").trim();
  const image_urls = Array.isArray(body.image_urls) ? body.image_urls.filter(Boolean) : [];
  const ar     = String(body.aspectRatio || "16:9");
  const aspect_ratio = (ar === "9:16") ? "portrait" : "landscape"; // KIE Market expects 'landscape'/'portrait'

  const run_id = (String(body.run_id || "").trim()) || `${uid}-${Date.now()}`;

  // seed placeholder
  if (UG_URL && SERVICE_KEY){
    await seedOrPatch(uid, run_id, {
      user_id: uid, provider:"sora2", kind:"video", prompt,
      result_url: null,
      meta: { run_id, status:"processing", aspect_ratio: ar, orientation: aspect_ratio, quality:"hd", duration:10, model }
    });
  }

  if (!KIE_BASE || !KIE_API_KEY) return ok({ submitted:false, error:"missing_kie_config" });

  const payload = { model, prompt, quality:"hd", aspect_ratio };
  if (image_urls.length) payload.image_urls = image_urls;
  payload.duration = 10;

  const url = `${KIE_BASE}/api/v1/market/generate`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${KIE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await r.json().catch(()=>({}));

  const taskId = pickTaskId(data);
  if (!r.ok || !taskId) {
    return ok({ submitted:false, error:`kie_${r.status||"error"}`, data, version: VERSION });
  }

  try{
    if (UG_URL && SERVICE_KEY) {
      await seedOrPatch(uid, run_id, { meta: { run_id, status:"processing", task_id: taskId, model } }, true);
    }
  }catch{}

  return ok({ submitted:true, run_id, taskId, version: VERSION });
};

function ok(obj){ return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code,msg){ return { statusCode: code, headers: cors(), body: JSON.stringify({ submitted:false, error: msg }) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, X-USER-ID" }; }
function safeJson(s){ try{ return JSON.parse(s||"{}"); } catch { return {}; } }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }

async function seedOrPatch(uid, run_id, payload, patchOnly=false){
  const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
  const chk = await fetch(`${UG_URL}${q}`, { headers: sb() });
  const arr = await chk.json().catch(()=>[]);
  const id = Array.isArray(arr)&&arr.length ? arr[0].id : null;
  if (id){
    await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { ...sb(), "Content-Type":"application/json", "Prefer":"return=minimal" },
      body: JSON.stringify(payload)
    });
  } else if (!patchOnly){
    await fetch(UG_URL, {
      method: "POST", headers: { ...sb(), "Content-Type":"application/json", "Prefer":"return=minimal" },
      body: JSON.stringify(payload)
    });
  }
}

function pickTaskId(data){
  if (!data || typeof data !== "object") return "";
  if (data?.data?.taskId) return String(data.data.taskId);
  if (data?.taskId) return String(data.taskId);
  if (data?.result?.taskId) return String(data.result.taskId);
  if (data?.data?.task_id) return String(data.data.task_id);
  if (data?.task_id) return String(data.task_id);
  if (data?.result?.task_id) return String(data.result.task_id);
  if (data?.data?.requestId) return String(data.data.requestId);
  if (data?.requestId) return String(data.requestId);
  if (data?.result?.requestId) return String(data.result.requestId);
  if (data?.data?.request_id) return String(data.data.request_id);
  if (data?.request_id) return String(data.request_id);
  if (data?.result?.request_id) return String(data.result.request_id);
  if (data?.id && String(data.id).length > 8) return String(data.id);
  const seen = new Set();
  function scan(x){ if(!x || typeof x!=="object" || seen.has(x)) return ""; seen.add(x); for (const [k,v] of Object.entries(x)){ if(/^(task[_-]?id|request[_-]?id)$/i.test(k)){ const s=String(v); if(s.length>3) return s; } const inner=scan(v); if(inner) return inner; } return ""; }
  return scan(data) || "";
}
