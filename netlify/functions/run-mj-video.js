// netlify/functions/run-mj-video.js
// Submit a Midjourney image→video task via KIE and seed a placeholder in user_generations.
// Mirrors run-veo3.js style with minimal changes; fixed videoBatchSize: 1 and duration ≈5s.

const API_KEY = process.env.KIE_API_KEY;

// KIE Jobs endpoint (Midjourney uses taskType-based createTask)
const KIE_URL = "https://api.kie.ai/api/v1/mj/generate";

// Supabase (service role) for server-side insert/patch
const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

// Credits (server-side only)
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";
const COST_CREDITS = 2;

// Public site base for callback (same style as other flows)
const SITE_BASE = (process.env.SITE_BASE || "https://webhansora.netlify.app").replace(/\/+$/,'');
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/video-kie-callback`;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return err(405, "Use POST");

  try {
    const headers = lowerKeys(event.headers || {});
    const isJson = (headers["content-type"] || "").includes("application/json");
    const body = isJson ? safeJson(event.body) : {};

    const uid = (body.uid || body.user_id || "").toString().trim();
    if (!uid) return ok({ submitted:false, error:"missing_user_id" });
    // Require a valid Supabase session token and prevent UID spoofing
    const authz = (headers["authorization"] || "").toString();
    const accessToken = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
    if (!accessToken) return ok({ submitted:false, error:"missing_auth" });
    const authedUserId = await verifySupabaseUser(accessToken);
    if (!authedUserId) return ok({ submitted:false, error:"invalid_auth" });
    if (authedUserId !== uid) return ok({ submitted:false, error:"uid_mismatch" });


    // For MJ image→video, BOTH image and prompt are required
    const prompt = (body.prompt || "").toString().trim();
    const imageUrl = normalizeUrl(body.imageUrl || body.fileUrl || "");
    if (!prompt || !imageUrl) return ok({ submitted:false, error:"need_image_and_prompt" });

    const aspectRatio = normalizeAspect(body.aspectRatio || "1:1");
    const run_id = (body.run_id || `${uid}-${Date.now()}`);

    // Idempotency: if this run_id already has a task_id and was charged, return it and do not charge again
    try {
      if (UG_URL && SERVICE_KEY) {
        const q0 = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id,meta`;
        const chk0 = await fetch(UG_URL + q0, { headers: sb() });
        const arr0 = await chk0.json().catch(()=>[]);
        if (Array.isArray(arr0) && arr0.length) {
          const meta0 = arr0[0].meta || {};
          const existingTask = meta0.task_id || meta0.taskId || "";
          const alreadyCharged = meta0.charged === true || meta0.charged === "true";
          if (existingTask && alreadyCharged) {
            return ok({ submitted:true, run_id, taskId: existingTask, status: 200, data: { reused:true } });
          }
        }
      }
    } catch {}


    const callBackUrl = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    // Seed placeholder row in user_generations (provider: midjourney)
    if (UG_URL && SERVICE_KEY) {
      try {
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
        const chk = await fetch(UG_URL + q, { headers: sb() });
        const arr = await chk.json().catch(()=>[]);
        const idToPatch = Array.isArray(arr) && arr.length ? arr[0].id : null;

        const payload = {
          user_id: uid,
          provider: "midjourney",
          kind: "video",
          prompt,
          result_url: null,
          meta: { run_id, status: "processing", aspect_ratio: aspectRatio, duration: 5, task_type: "mj_video", version: 7 }
        };

        if (idToPatch) {
          await fetch(`${UG_URL}?id=eq.${encodeURIComponent(idToPatch)}`, {
            method: "PATCH",
            headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({ result_url: null, meta: payload.meta })
          });
        } else {
          await fetch(UG_URL, {
            method: "POST",
            headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify(payload)
          });
        }
      } catch (e) {
        console.warn("[run-mj-video] placeholder write failed:", e);
      }
    }


    // Server-side credit precheck (do not submit if insufficient)
    const bal = await getCredits(uid);
    if (bal < COST_CREDITS) {
      return ok({ submitted:false, error:"insufficient_credits", need: COST_CREDITS, have: bal });
    }
    // Build KIE payload for Midjourney image→video
    const kiePayload = {
      taskType: "mj_video",
      version: 7,
      prompt,
      fileUrl: imageUrl,
      aspectRatio,
      speed: "fast",
      motion: "high",
      stylization: 100,
      enableTranslation: false,
      videoBatchSize: 1, // <= your requirement
      callBackUrl
    };

    const resp = await fetch(KIE_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(kiePayload)
    });
    const RAW_KIE_TEXT = await resp.text();
    let data; try { data = JSON.parse(RAW_KIE_TEXT); } catch { data = { _raw: RAW_KIE_TEXT }; }

    let taskId = extractTaskId(data);
    if (!taskId && data && typeof data._raw === "string") {
      const m = data._raw.match(/[0-9a-f]{20,}/i);
      if (m) taskId = m[0];
    }
    if (!resp.ok) return ok({ submitted:false, error:`kie_${resp.status}`, data });
    if (!taskId)  return ok({ submitted:false, error:"missing_taskId", data });

    // Server-side debit AFTER successful submission (idempotent per run_id)
    try {
      // Mark charged in user_generations meta; charge only once
      const already = await isAlreadyCharged(uid, run_id);
      if (!already) {
        const charged = await debitCredits(uid, COST_CREDITS);
        if (!charged) {
          // If we cannot debit after submit (race), still avoid giving free runs.
          return ok({ submitted:false, error:"debit_failed", taskId, run_id });
        }
        await markCharged(uid, run_id, taskId, aspectRatio);
      }
    } catch (e) {
      return ok({ submitted:false, error:"debit_exception", message:String(e), taskId, run_id });
    }

    // Persist taskId into meta (optional)
    try {
      if (UG_URL && SERVICE_KEY && taskId) {
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
        const chk = await fetch(UG_URL + q, { headers: sb() });
        const arr = await chk.json().catch(()=>[]);
        if (Array.isArray(arr) && arr.length) {
          await fetch(`${UG_URL}?id=eq.${encodeURIComponent(arr[0].id)}`, {
            method: "PATCH",
            headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({ meta: { run_id, status: "processing", aspect_ratio: aspectRatio, duration: 5, task_id: taskId, task_type: "mj_video", version: 7 } })
          });
        }
      }
    } catch {}

    return ok({ submitted:true, run_id, taskId, status: resp.status, data });
  } catch (e) {
    return ok({ submitted:false, error:String(e) });
  }
};

function ok(obj){ return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code, message){ return { statusCode: code, headers: cors(), body: JSON.stringify({ submitted:false, error: message }) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, X-USER-ID" }; }
function safeJson(s){ try{ return JSON.parse(s||"{}"); } catch { return {}; } }
function lowerKeys(h){ const o={}; for (const k in h) o[k.toLowerCase()] = h[k]; return o; }
function normalizeAspect(a){ a=String(a||"").trim(); return /^(1:1|2:3|3:2|9:16|16:9)$/.test(a)?a:"1:1"; }
function normalizeUrl(u){ try{ const url=new URL(String(u||"")); return url.href; } catch { return ""; } }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }

// Extract a plausible taskId / requestId from KIE response
function extractTaskId(data){
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
  function scan(x){
    if (!x || typeof x !== "object" || seen.has(x)) return "";
    seen.add(x);
    for (const [k,v] of Object.entries(x)){
      if (/^(task[_-]?id|request[_-]?id)$/i.test(k) && (typeof v === "string" || typeof v === "number")) {
        const s = String(v); if (s.length > 3) return s;
      }
      const inner = scan(v);
      if (inner) return inner;
    }
    return "";
  }
  return scan(data) || "";
}


async function verifySupabaseUser(accessToken){
  if (!SUPABASE_URL || !SERVICE_KEY) return "";
  try{
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${accessToken}` }
    });
    if (!r.ok) return "";
    const j = await r.json().catch(()=>null);
    return (j && (j.id || j.user?.id)) ? String(j.id || j.user.id) : "";
  }catch{ return ""; }
}

async function getCredits(uid){
  if (!PROFILES_URL || !SERVICE_KEY) return 0;
  const q = `?select=credits&user_id=eq.${encodeURIComponent(uid)}&limit=1`;
  const r = await fetch(PROFILES_URL + q, { headers: sb() });
  const arr = await r.json().catch(()=>[]);
  return (Array.isArray(arr) && arr.length) ? (arr[0].credits ?? 0) : 0;
}

async function debitCredits(uid, cost){
  if (!PROFILES_URL || !SERVICE_KEY) return false;
  for (let i=0;i<3;i++){
    const cur = await getCredits(uid);
    if (cur < cost) return false;
    const q = `?user_id=eq.${encodeURIComponent(uid)}&credits=eq.${encodeURIComponent(cur)}`;
    const r = await fetch(PROFILES_URL + q, {
      method: "PATCH",
      headers: { ...sb(), "Content-Type":"application/json", "Prefer":"return=representation" },
      body: JSON.stringify({ credits: Number(cur) - Number(cost) })
    });
    const arr = await r.json().catch(()=>[]);
    if (Array.isArray(arr) && arr.length) return true;
  }
  return false;
}

async function isAlreadyCharged(uid, run_id){
  if (!UG_URL || !SERVICE_KEY) return false;
  const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=meta&limit=1`;
  const r = await fetch(UG_URL + q, { headers: sb() });
  const arr = await r.json().catch(()=>[]);
  if (Array.isArray(arr) && arr.length){
    const meta = arr[0].meta || {};
    return meta.charged === true || meta.charged === "true";
  }
  return false;
}

async function markCharged(uid, run_id, taskId, aspectRatio){
  if (!UG_URL || !SERVICE_KEY) return;
  const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id&limit=1`;
  const r = await fetch(UG_URL + q, { headers: sb() });
  const arr = await r.json().catch(()=>[]);
  if (!Array.isArray(arr) || !arr.length) return;
  const id = arr[0].id;
  await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type":"application/json", "Prefer":"return=minimal" },
    body: JSON.stringify({ meta: { run_id, status:"processing", aspect_ratio: aspectRatio, duration: 5, task_id: taskId, task_type:"mj_video", version:7, charged:true, charged_cost:COST_CREDITS } })
  });
}
