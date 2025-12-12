// netlify/functions/run-veo3.js
// Submit a KIE Veo 3 job and seed a placeholder row in user_generations.
// Server-side credit debit (SERVICE ROLE) and idempotent charging per (uid + run_id).
//
// Env: KIE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Opt: SITE_BASE (default https://webhansora.netlify.app)

const KIE_URL = "https://api.kie.ai/api/v1/veo/generate";
const API_KEY = process.env.KIE_API_KEY || "";

// Supabase (service role for server-side insert/patch)
const SUPABASE_URL  = (process.env.SUPABASE_URL || "").replace(/\/+$/,"");
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL  = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";
const AUTH_USER_URL = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1/user` : "";

// Your site base for callback
const SITE_BASE = (process.env.SITE_BASE || "https://webhansora.netlify.app").replace(/\/+$/,"");
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/video-kie-callback`;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return err(405, "Use POST");

  try {
    const headers = lowerKeys(event.headers || {});
    const isJson = (headers["content-type"] || "").includes("application/json");
    const body = isJson ? safeJson(event.body) : {};

    const uid = (body.uid || body.user_id || "").toString().trim();
    if (!uid) return ok({ submitted:false, error:"missing_uid" });

    const authz = (headers["authorization"] || "").toString();
    const token = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
    if (!token) return ok({ submitted:false, error:"missing_auth" });

    const authedUid = await verifyUser(token);
    if (!authedUid || authedUid !== uid) return ok({ submitted:false, error:"auth_mismatch" });

    const promptRaw = (body.prompt || "").toString();
    const prompt = promptRaw.trim();

    const model = normalizeModel(body.model || "veo3_fast");
    const cost = (model === "veo3" ? 20 : 7);
    const aspectRatio = normalizeAspect(body.aspectRatio || body.asp || body.ratio || "16:9");

    // Accept a single URL, convert to array as imageUrls
    const imageUrl = normalizeUrl(body.imageUrl || body.fileUrl || "");
    const imageUrls = imageUrl ? [ imageUrl ] : [];

    if (!prompt && imageUrls.length === 0) {
      return ok({ submitted:false, error:"empty_prompt" });
    }

    const clientRunId = (body.run_id || body.runId || "").toString().trim();
    const run_id = clientRunId || `${uid}-${Date.now()}`;

    const callBackUrl = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    // Idempotency: if same (uid + run_id) already has task_id, return it (no re-submit)
    const existing = await getExistingTask(uid, run_id);
    if (existing && existing.taskId) {
      return ok({ submitted: true, run_id, taskId: existing.taskId, status: 200, already: true });
    }

    // Seed placeholder row in user_generations (best-effort, non-blocking)
    await seedPlaceholder(uid, run_id, { prompt, aspectRatio, model });

    const kiePayload = {
      model,
      prompt,
      aspectRatio,
      callBackUrl,
      ...(imageUrls.length ? { imageUrls } : {})
    };

    const resp = await fetch(KIE_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(kiePayload)
    });

    const data = await resp.json().catch(()=>({}));
    const taskId = extractTaskId(data);

    if (!resp.ok) {
      return ok({ submitted:false, error:`kie_${resp.status}`, data, run_id });
    }
    if (!taskId) {
      return ok({ submitted:false, error:"missing_taskId", data, run_id });
    }

    // Deduct credits ONLY after KIE accepted and ensure it happens exactly once per (uid + run_id)
    const charged = await isCharged(uid, run_id);
    if (!charged) {
      const okDebit = await debitCredits(uid, cost);
      if (!okDebit) {
        return ok({ submitted:false, error:"debit_failed", run_id, taskId });
      }
      await markCharged(uid, run_id, cost, taskId);
    }

    // Persist taskId into meta for easier tracing (best-effort)
    await patchTaskMeta(uid, run_id, { task_id: taskId, model, aspect_ratio: aspectRatio });

    return ok({ submitted: true, run_id, taskId, status: resp.status, data });
  } catch (e) {
    return ok({ submitted:false, error:String(e) });
  }
};

function ok(obj){ return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code, message){ return { statusCode: code, headers: cors(), body: JSON.stringify({ submitted:false, error: message }) }; }
function cors(){
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-USER-ID"
  };
}
function safeJson(s){ try{ return JSON.parse(s||"{}"); } catch { return {}; } }
function lowerKeys(h){ const o={}; for (const k in h) o[k.toLowerCase()] = h[k]; return o; }

function normalizeModel(m){
  const raw = String(m||"");
  const s = raw.toLowerCase().replace(/\s+/g,"").replace(/-/g,"");
  if (s === "veo3" || s === "veo3standard") return "veo3";
  if (s === "veo3fast" || s === "veo3_fast") return "veo3_fast";
  return "veo3_fast";
}
function normalizeAspect(a){
  a = String(a||"").trim();
  return /^(16:9|9:16)$/.test(a) ? a : "16:9";
}
function normalizeUrl(u){
  try{ const url = new URL(String(u||"")); return url.href; } catch { return ""; }
}
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }

async function verifyUser(token){
  try{
    if (!AUTH_USER_URL || !SERVICE_KEY) return "";
    const r = await fetch(AUTH_USER_URL, {
      headers: { "apikey": SERVICE_KEY, "Authorization": "Bearer " + token }
    });
    if (!r.ok) return "";
    const j = await r.json().catch(()=>null);
    return (j && j.id) ? String(j.id) : "";
  }catch{ return ""; }
}

async function seedPlaceholder(uid, run_id, { prompt, aspectRatio, model }){
  try{
    if (!UG_URL || !SERVICE_KEY) return;

    // If a row already exists for this run_id, don't spam
    const q = `?select=id,meta&user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&limit=1`;
    const chk = await fetch(UG_URL + q, { headers: sb() });
    if (chk.ok) {
      const arr = await chk.json().catch(()=>[]);
      if (Array.isArray(arr) && arr.length) return;
    }

    const payload = {
      user_id: uid,
      provider: (String(model||"").includes("fast") ? "veo3fast" : "veo3"),
      kind: "video",
      prompt,
      result_url: null,
      meta: { run_id, status: "processing", aspect_ratio: aspectRatio, quality: "1080p", duration: 5, model }
    };

    await fetch(UG_URL, {
      method: "POST",
      headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify(payload)
    });
  }catch(e){
    console.warn("[run-veo3] placeholder write failed:", e);
  }
}

async function patchTaskMeta(uid, run_id, extraMeta){
  try{
    if (!UG_URL || !SERVICE_KEY) return;
    const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`;
    // Merge-ish: we overwrite meta with a minimal object that includes run_id + new keys.
    // This mirrors your existing pattern where meta is treated as the run-scoped state.
    const patchMeta = { run_id, status: "processing", ...extraMeta };
    await fetch(UG_URL + q, {
      method: "PATCH",
      headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({ meta: patchMeta })
    });
  }catch{}
}

async function getCredits(uid){
  try{
    if (!PROFILES_URL) return 0;
    const q = `?select=credits&user_id=eq.${encodeURIComponent(uid)}`;
    const r = await fetch(PROFILES_URL + q, { headers: sb() });
    const arr = await r.json().catch(()=>[]);
    const c = Array.isArray(arr) && arr.length ? Number(arr[0].credits || 0) : 0;
    return Number.isFinite(c) ? c : 0;
  }catch{ return 0; }
}

async function debitCredits(uid, cost){
  try{
    if (!PROFILES_URL) return false;
    const cur = await getCredits(uid);
    if (cur < cost) return false;
    const next = Math.round((cur - cost) * 10) / 10;
    const r = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(uid)}`, {
      method: "PATCH",
      headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({ credits: next })
    });
    return r.ok;
  }catch{ return false; }
}

async function getExistingTask(uid, run_id){
  try{
    if (!UG_URL) return null;
    const q = `?select=id,meta&user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&limit=1`;
    const r = await fetch(UG_URL + q, { headers: sb() });
    if (!r.ok) return null;
    const arr = await r.json().catch(()=>[]);
    if (Array.isArray(arr) && arr.length) {
      const meta = arr[0].meta || {};
      const taskId = meta.task_id || meta.taskId || "";
      return { id: arr[0].id, taskId: taskId ? String(taskId) : "" };
    }
    return null;
  }catch{ return null; }
}

async function isCharged(uid, run_id){
  try{
    if (!UG_URL) return false;
    const q = `?select=meta&user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&limit=1`;
    const r = await fetch(UG_URL + q, { headers: sb() });
    if (!r.ok) return false;
    const arr = await r.json().catch(()=>[]);
    if (Array.isArray(arr) && arr.length) {
      const meta = arr[0].meta || {};
      return meta.charged === true || meta.charged === "true";
    }
    return false;
  }catch{ return false; }
}

async function markCharged(uid, run_id, cost, taskId){
  try{
    if (!UG_URL) return;
    const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`;
    const patchMeta = { charged: true, charged_cost: cost, task_id: taskId, run_id };
    await fetch(UG_URL + q, {
      method: "PATCH",
      headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({ meta: patchMeta })
    });
  }catch{}
}

// Searches the JSON object for common taskId locations or any property named "taskId".
function extractTaskId(data){
  if (!data || typeof data !== "object") return "";
  if (data?.data?.taskId)    return String(data.data.taskId);
  if (data?.taskId)          return String(data.taskId);
  if (data?.result?.taskId)  return String(data.result.taskId);
  if (data?.data?.task_id)   return String(data.data.task_id);
  if (data?.task_id)         return String(data.task_id);

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
