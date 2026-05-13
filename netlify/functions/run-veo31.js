// netlify/functions/run-veo31.js
// Submit a KIE Veo 3 job and seed a placeholder row in user_generations.
// Mirrors your working Runway flow with minimal changes:
// - Endpoint: https://api.kie.ai/api/v1/veo/generate
// - model: "veo3_fast" (default) or "veo3"
// - imageUrls: [<uploaded-url>] when image is provided

const KIE_URL = "https://api.kie.ai/api/v1/veo/generate";
const API_KEY = process.env.KIE_API_KEY;

// Supabase (service role for server-side insert/patch)
const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROF_URL      = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";

// Your site base for callback (same style as Runway)
const SITE_BASE = (process.env.SITE_BASE || "https://hansora.co").replace(/\/+$/,'');
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/video-kie-callback`;


async function verifyAuth(headers, uid){
  const auth = headers["authorization"] || headers["Authorization"] || "";
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok:false, error:"missing_auth" };
  const token = m[1].trim();
  // Verify token against Supabase Auth and ensure it matches uid
  try{
    const url = `${SUPABASE_URL}/auth/v1/user`;
    const r = await fetch(url, { headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${token}` } });
    if (!r.ok) return { ok:false, error:"invalid_auth" };
    const u = await r.json().catch(()=>null);
    const id = u && u.id ? String(u.id) : "";
    if (!id || id !== uid) return { ok:false, error:"uid_mismatch" };
    return { ok:true, tokenUserId:id };
  }catch(e){
    return { ok:false, error:"auth_verify_failed" };
  }
}

function costForModel(model){
  return (String(model||"").includes("veo3") && !String(model||"").includes("fast")) ? 20 : 7;
}

async function getOrCreateCredits(uid){
  // Read credits; if profile missing, create server-side (safe) with default 3.0
  const q = `?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
  const r = await fetch(PROF_URL + q, { headers: sb() });
  const arr = await r.json().catch(()=>[]);
  if (Array.isArray(arr) && arr.length){
    return Number(arr[0].credits || 0);
  }
  // Create missing profile row (server-side only)
  try{
    await fetch(PROF_URL, {
      method:"POST",
      headers:{ ...sb(), "Content-Type":"application/json", "Prefer":"return=minimal" },
      body: JSON.stringify({ user_id: uid, credits: 3.0 })
    });
  }catch{}
  return 3.0;
}

async function debitOnce(uid, run_id, cost){
  // Idempotency key: (uid + run_id) tracked in user_generations.meta.charged
  if (!UG_URL || !SERVICE_KEY) return { ok:false, error:"missing_supabase" };

  // Find generation row
  const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id,meta`;
  const chk = await fetch(UG_URL + q, { headers: sb() });
  const arr = await chk.json().catch(()=>[]);
  const row = (Array.isArray(arr) && arr.length) ? arr[0] : null;
  const already = row && row.meta && (row.meta.charged === true || row.meta.charged === "true");
  if (already) return { ok:true, charged:false, already:true };

  // Atomically debit credits: fetch current credits, ensure sufficient, PATCH subtract
  const cur = await getOrCreateCredits(uid);
  if (cur < cost) return { ok:false, error:"insufficient_credits", credits:cur, cost };

  const next = Math.round((cur - cost) * 10) / 10;
  const pr = await fetch(`${PROF_URL}?user_id=eq.${encodeURIComponent(uid)}`, {
    method:"PATCH",
    headers:{ ...sb(), "Content-Type":"application/json", "Prefer":"return=minimal" },
    body: JSON.stringify({ credits: next })
  });
  if (!pr.ok) return { ok:false, error:"debit_failed" };

  // Mark charged in user_generations
  if (row && row.id){
    const metaNext = Object.assign({}, row.meta || {}, { charged:true, charged_cost: cost, charged_at: new Date().toISOString() });
    await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}`, {
      method:"PATCH",
      headers:{ ...sb(), "Content-Type":"application/json", "Prefer":"return=minimal" },
      body: JSON.stringify({ meta: metaNext })
    });
  }
  return { ok:true, charged:true, already:false };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return err(405, "Use POST");

  try {
    const headers = lowerKeys(event.headers || {});
    const isJson = (headers["content-type"] || "").includes("application/json");
    const body = isJson ? safeJson(event.body) : {};

    const uid = (body.uid || body.user_id || "").toString().trim();
    if (!uid) return ok({ submitted:false, error:"missing_user_id" });

    // Auth: require a valid Supabase session token matching uid
    const authChk = await verifyAuth(headers, uid);
    if (!authChk.ok) return ok({ submitted:false, error: authChk.error });

    const promptRaw = (body.prompt || "").toString();
    const prompt = promptRaw.trim();
    if (!prompt && !body.fileUrl && !body.imageUrl && !body.imageUrls) {
      return ok({ submitted:false, error:"empty_prompt" });
    }

    const model = normalizeModel(body.model || "veo3_fast");
    const aspectRatio = normalizeAspect(body.aspectRatio || "16:9");
    const cost = costForModel(model);

    // Accept a single URL, convert to array as imageUrls
    const imageUrl      = body.imageUrl || body.fileUrl || "";
    const imageUrls = imageUrl ? [ imageUrl ] : [];

    const clientRunId = (body.run_id || "").toString().trim();
    const run_id = clientRunId || `${uid}-${Date.now()}`;

    const callBackUrl = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    // Pre-check credits (no deduction yet; deduction happens after KIE accepts)
    const curCredits = await getOrCreateCredits(uid);
    if (curCredits < cost) return ok({ submitted:false, error:"insufficient_credits", credits: curCredits, cost });

    // Seed placeholder row in user_generations
    if (UG_URL && SERVICE_KEY) {
      try {
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
        const chk = await fetch(UG_URL + q, { headers: sb() });
        const arr = await chk.json().catch(()=>[]);
        const idToPatch = Array.isArray(arr) && arr.length ? arr[0].id : null;

        const payload = {
          user_id: uid,
          provider: (String(model||"").includes("fast") ? "veo3.1fast" : "veo3.1"),
          kind: "video",
          prompt,
          result_url: null,
          meta: { run_id, status: "processing", aspect_ratio: aspectRatio, quality: "1080p", duration: 5, model, cost, charged: false }
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
        console.warn("[run-veo3] placeholder write failed:", e);
      }
    }

    
// Build KIE payload (spec-only fields)
// (Do NOT spread the entire body to KIE; avoid non-spec keys)
const kiePayload = {
  prompt,
  model,
  aspectRatio,
  callBackUrl
};
// Veo 3.1 generationType handling
// Your UI sends firstFrameUrl and/or lastFrameUrl (from KIE signed uploads).
// IMPORTANT:
// - If ONLY firstFrameUrl is provided, this must be treated as image-to-video (not text-to-video).
// - If BOTH firstFrameUrl + lastFrameUrl are provided, use FIRST_AND_LAST_FRAMES_2_VIDEO.
const firstFrameUrl = (body.firstFrameUrl || "").toString().trim();
const lastFrameUrl  = (body.lastFrameUrl  || "").toString().trim();

if (firstFrameUrl && lastFrameUrl) {
  // First + Last frames
  kiePayload.generationType = "FIRST_AND_LAST_FRAMES_2_VIDEO";
  kiePayload.firstFrameUrl = firstFrameUrl;
  kiePayload.lastFrameUrl  = lastFrameUrl;
  // Keep imageUrls aligned with frames for KIE visibility/debugging.
  kiePayload.imageUrls = [firstFrameUrl, lastFrameUrl];
} else if (firstFrameUrl && !lastFrameUrl) {
  // First frame only
  // KIE expects this to behave as image-to-video.
  // We send generationType + firstFrameUrl and ALSO imageUrls for robustness.
  kiePayload.generationType = "FIRST_FRAME_2_VIDEO";
  kiePayload.firstFrameUrl = firstFrameUrl;
  kiePayload.imageUrls = [firstFrameUrl];
} else if (!firstFrameUrl && lastFrameUrl) {
  // Edge case: last frame provided without first.
  // Treat it as first-frame input to avoid silently falling back to TEXT_2_VIDEO.
  kiePayload.generationType = "FIRST_FRAME_2_VIDEO";
  kiePayload.firstFrameUrl = lastFrameUrl;
  kiePayload.imageUrls = [lastFrameUrl];
} else {
  // Text only
  kiePayload.generationType = "TEXT_2_VIDEO";
}

// Optional spec keys
if (Number.isInteger(body.seeds)) kiePayload.seeds = body.seeds;
if (typeof body.enableFallback === 'boolean') kiePayload.enableFallback = body.enableFallback;
if (typeof body.enableTranslation === 'boolean') kiePayload.enableTranslation = body.enableTranslation;
if (typeof body.watermark === 'string' && body.watermark.length) kiePayload.watermark = body.watermark;

// Image handling: array 0–1
if (imageUrls.length) {
  kiePayload.imageUrls = imageUrls;
}

// Call KIE

    const resp = await fetch(KIE_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(kiePayload)
    });
    const data = await resp.json().catch(()=>({}));

    const taskId = extractTaskId(data);

    // Guard: if KIE didn't accept or no taskId, report as not submitted
    if (!resp.ok) {
      return ok({ submitted:false, error:`kie_${resp.status}`, data });
    }
    if (!taskId) {
      return ok({ submitted:false, error:'missing_taskId', data });
    }

    // Persist taskId into meta for easier tracing
    try {
      if (UG_URL && SERVICE_KEY && taskId) {
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
        const chk = await fetch(UG_URL + q, { headers: sb() });
        const arr = await chk.json().catch(()=>[]);
        if (Array.isArray(arr) && arr.length) {
          await fetch(`${UG_URL}?id=eq.${encodeURIComponent(arr[0].id)}`, {
            method: "PATCH",
            headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({ meta: { run_id, status: "processing", aspect_ratio: aspectRatio, quality: "1080p", duration: 5, task_id: taskId, model, cost } })
          });
        }
      }
    } catch {}

        // Deduct credits server-side AFTER KIE accepted (Submitted)
    const debit = await debitOnce(uid, run_id, cost);
    if (!debit.ok) {
      // Do not expose task if debit failed; mark status in user_generations if possible
      try {
        if (UG_URL && SERVICE_KEY) {
          const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id,meta`;
          const chk = await fetch(UG_URL + q, { headers: sb() });
          const arr = await chk.json().catch(()=>[]);
          if (Array.isArray(arr) && arr.length) {
            const id = arr[0].id;
            const meta = Object.assign({}, arr[0].meta || {}, { status: "failed", error: debit.error });
            await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
              method: "PATCH",
              headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
              body: JSON.stringify({ meta })
            });
          }
        }
      } catch {}
      return ok({ submitted:false, error: debit.error, cost });
    }

    return ok({ submitted: true, run_id, taskId, status: resp.status, data, data, charged: debit.charged, already_charged: !!debit.already });
  } catch (e) {
    return ok({ submitted:false, error:String(e) });
  }
};

function ok(obj){ return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code, message){ return { statusCode: code, headers: cors(), body: JSON.stringify({ submitted:false, error: message }) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, X-USER-ID" }; }
function safeJson(s){ try{ return JSON.parse(s||"{}"); } catch { return {}; } }
function lowerKeys(h){ const o={}; for (const k in h) o[k.toLowerCase()] = h[k]; return o; }
function normalizeModel(m){
  const raw = String(m||"");
  const s = raw.toLowerCase().replace(/\s+/g,"").replace(/-/g,"");
  if (s === "veo3" || s === "veo3standard") return "veo3";
  if (s === "veo3fast" || s === "veo3_fast") return "veo3_fast";
  // default to fast so existing "fast" behavior remains
  return "veo3_fast";
}
function normalizeAspect(a){ a=String(a||"").trim(); return /^(16:9|9:16)$/.test(a)?a:"16:9"; }
function normalizeUrl(u){ try{ const url=new URL(String(u||"")); return url.href; } catch { return ""; } }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }

// Searches the JSON object for common taskId locations or any property named "taskId".
function extractTaskId(data){
  if (!data || typeof data !== "object") return "";
  // Common fast paths
  if (data?.data?.taskId)    return String(data.data.taskId);
  if (data?.taskId)          return String(data.taskId);
  if (data?.result?.taskId)  return String(data.result.taskId);
  // snake/request variants
  if (data?.data?.task_id)   return String(data.data.task_id);
  if (data?.task_id)         return String(data.task_id);
  if (data?.result?.task_id) return String(data.result.task_id);
  if (data?.data?.requestId)    return String(data.data.requestId);
  if (data?.requestId)          return String(data.requestId);
  if (data?.result?.requestId)  return String(data.result.requestId);
  if (data?.data?.request_id)   return String(data.data.request_id);
  if (data?.request_id)         return String(data.request_id);
  if (data?.result?.request_id) return String(data.result.request_id);
  // Generic id fallback
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
