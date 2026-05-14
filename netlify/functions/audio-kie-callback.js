// netlify/functions/audio-kie-callback.js
// Callback receiver for Hansora audio jobs from KIE / Suno.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SUPABASE_URL  = (process.env.SUPABASE_URL || "").replace(/\/+$/,"");
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return ok({ received:false, error:"Use POST" });

  try {
    const qs = event.queryStringParameters || {};
    const uid = String(qs.uid || "").trim();
    const run_id = String(qs.run_id || qs.runId || "").trim();
    const kind = String(qs.kind || "audio").trim();
    const body = safeJson(event.body);
    if (!uid || !run_id) return ok({ received:false, error:"missing_uid_or_run_id" });

    const failed = isFailure(body);
    const taskId = extractTaskId(body);
    const urls = extractAudioUrls(body);
    const imageUrls = extractImageUrls(body);
    const title = extractTitle(body) || providerTitle(kind);
    const firstUrl = urls[0] || "";
    const status = failed ? "failed" : (firstUrl ? "ready" : "processing");

    const oldMeta = await readGenerationMeta(uid, run_id);
    const meta = {
      ...(oldMeta || {}),
      run_id,
      status,
      task_id: taskId || (oldMeta && oldMeta.task_id) || "",
      audio_kind: kind,
      title,
      audio_url: firstUrl,
      audio_urls: urls,
      image_urls: imageUrls,
      callback: body
    };

    await patchGeneration(uid, run_id, { result_url:firstUrl || null, meta });
    return ok({ received:true, status, run_id, taskId, audioCount:urls.length });
  } catch (e) {
    return ok({ received:false, error:String(e && e.message ? e.message : e) });
  }
};

function ok(obj){ return { statusCode:200, headers:cors(), body:JSON.stringify(obj) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"GET,POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization" }; }
function safeJson(s){ try { return JSON.parse(s || "{}"); } catch { return {}; } }
function sb(){ return { "apikey":SERVICE_KEY, "Authorization":`Bearer ${SERVICE_KEY}` }; }
function providerTitle(kind){ return kind === "music" ? "Suno Music" : kind === "isolation" ? "Voice Isolation" : "Text to Voice"; }
function isFailure(body){ const txt = JSON.stringify(body || {}).toLowerCase(); return /failed|error|exception|sensitive_word/.test(txt) && !/success|complete/.test(String(body && body.msg || '').toLowerCase()); }
async function readGenerationMeta(uid, run_id){
  try{
    if (!UG_URL || !SERVICE_KEY) return null;
    const q = `?select=meta&user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&limit=1`;
    const r = await fetch(UG_URL + q, { headers:sb() });
    const arr = await r.json().catch(()=>[]);
    return Array.isArray(arr) && arr[0] ? (arr[0].meta || {}) : null;
  } catch { return null; }
}
async function patchGeneration(uid, run_id, patch){
  if (!UG_URL || !SERVICE_KEY) return;
  const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`;
  await fetch(UG_URL + q, { method:"PATCH", headers:{ ...sb(), "Content-Type":"application/json", "Prefer":"return=minimal" }, body:JSON.stringify(patch) });
}
function extractTaskId(data){
  if (!data || typeof data !== "object") return "";
  if (data?.data?.task_id) return String(data.data.task_id);
  if (data?.data?.taskId) return String(data.data.taskId);
  if (data?.task_id) return String(data.task_id);
  if (data?.taskId) return String(data.taskId);
  const seen = new Set();
  function scan(x){
    if (!x || typeof x !== "object" || seen.has(x)) return "";
    seen.add(x);
    for (const [k,v] of Object.entries(x)){
      if (/^(task[_-]?id|request[_-]?id|record[_-]?id)$/i.test(k) && (typeof v === "string" || typeof v === "number")) {
        const s=String(v); if (s.length > 3) return s;
      }
      const inner=scan(v); if (inner) return inner;
    }
    return "";
  }
  return scan(data) || "";
}
function extractAudioUrls(data){
  const urls = [];
  const seen = new Set();
  function add(url){
    if (!url || typeof url !== "string") return;
    if (!/^https?:\/\//i.test(url)) return;
    if (!/\.(mp3|wav|m4a|aac|ogg|flac)(\?|#|$)/i.test(url) && !/audio/i.test(url)) return;
    if (!seen.has(url)) { seen.add(url); urls.push(url); }
  }
  function scan(x){
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) { x.forEach(scan); return; }
    for (const [k,v] of Object.entries(x)){
      if (typeof v === "string" && /(audio|url|download)/i.test(k)) add(v);
      else if (v && typeof v === "object") scan(v);
    }
  }
  scan(data);
  return urls;
}
function extractImageUrls(data){
  const urls = [];
  const seen = new Set();
  function add(url){
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    if (!/\.(png|jpe?g|webp)(\?|#|$)/i.test(url) && !/image/i.test(url)) return;
    if (!seen.has(url)) { seen.add(url); urls.push(url); }
  }
  function scan(x){
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) { x.forEach(scan); return; }
    for (const [k,v] of Object.entries(x)){
      if (typeof v === "string" && /image/i.test(k)) add(v);
      else if (v && typeof v === "object") scan(v);
    }
  }
  scan(data);
  return urls;
}
function extractTitle(data){
  if (!data || typeof data !== "object") return "";
  const direct = data?.data?.title || data?.title;
  if (direct) return String(direct).slice(0,120);
  if (Array.isArray(data?.data?.data) && data.data.data[0] && data.data.data[0].title) return String(data.data.data[0].title).slice(0,120);
  return "";
}
