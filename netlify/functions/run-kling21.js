// netlify/functions/run-kling21.js
// Secure Kling v2.1 Pro submit (KIE) with SERVER-SIDE credit deduction (Service Role) + idempotency.
// Browser must NOT deduct credits. Credits update live via Realtime on the page.

const KIE_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const API_KEY = process.env.KIE_API_KEY;

// Supabase
const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY      = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON || "";

// REST endpoints
const UG_URL   = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROF_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";

// Your site base for callback (same style as other video features)
const SITE_BASE = (process.env.SITE_BASE || "https://webhansora.netlify.app").replace(/\/+$/,'');
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/video-kie-callback`;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return err(405, "Use POST");

  try {
    if (!SUPABASE_URL || !SERVICE_KEY || !UG_URL || !PROF_URL) {
      return err(500, "missing_supabase_env");
    }
    if (!API_KEY) return err(500, "missing_kie_api_key");

    const headers = lowerKeys(event.headers || {});
    const isJson = (headers["content-type"] || "").includes("application/json");
    const body = isJson ? safeJson(event.body) : {};

    // --- Auth: require Bearer token and validate it matches uid ---
    const authz = (headers["authorization"] || "").toString();
    const token = (authz.startsWith("Bearer ") ? authz.slice(7).trim() : "");
    if (!token) return err(401, "missing_auth");

    const uid = (body.uid || body.user_id || headers["x-user-id"] || "").toString().trim();
    if (!uid) return ok({ submitted:false, error:"missing_user_id" });

    const authUser = await verifySupabaseJwt(token);
    if (!authUser || !authUser.id) return err(401, "bad_auth");
    if (authUser.id !== uid) return err(403, "uid_mismatch");

    const promptRaw = (body.prompt || "").toString();
    const prompt = promptRaw.trim();
    if (!prompt) return ok({ submitted:false, error:"empty_prompt" });

    const duration = normalizeDuration(body.duration);
    const cost = (duration === 10) ? 8 : 4;

    const firstFrameUrl = normalizeUrl(body.firstFrameUrl || body.imageUrl || "");
    const lastFrameUrl  = normalizeUrl(body.lastFrameUrl  || "");
    if (!firstFrameUrl) return ok({ submitted:false, error:"missing_start_frame" });

    const clientRunId = (body.run_id || "").toString().trim();
    const run_id = clientRunId || `${uid}-${Date.now()}`;

    const callBackUrl = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    // --- Ensure placeholder row exists in user_generations and fetch it ---
    const ug = await ensureUserGenerationRow({ uid, run_id, prompt, duration });
    const ugId = ug?.id || null;
    const ugMeta = ug?.meta || {};

    // If already submitted before, do NOT create a second KIE job
    const existingTaskId = (ugMeta.task_id || ugMeta.taskId || "").toString();
    if (existingTaskId) {
      return ok({ submitted:true, run_id, taskId: existingTaskId, already_submitted:true });
    }

    // --- Idempotent charge (claim once per run_id) ---
    const charged = !!ugMeta.charged;
    let didDebit = false;

    if (!charged) {
      const claimToken = `claim_${Math.random().toString(16).slice(2)}_${Date.now()}`;
      const claimed = await claimChargeOnce(ugId, uid, run_id, ugMeta, claimToken);

      // If not claimed, someone else is processing. Return "already_submitted" if task appears later.
      if (!claimed) {
        const latest = await fetchUgByRunId(uid, run_id);
        const latestMeta = latest?.meta || {};
        const t = (latestMeta.task_id || "").toString();
        if (t) return ok({ submitted:true, run_id, taskId: t, already_submitted:true });
        // No task yet; avoid duplicate submission
        return ok({ submitted:false, error:"already_processing" });
      }

      // Check credits server-side
      const curCredits = await getCredits(uid);
      if (curCredits < cost) {
        await patchUgMeta(ugId, { ...ugMeta, run_id, status: "failed", fail_reason: "insufficient_credits" });
        return { statusCode: 402, headers: cors(), body: JSON.stringify({ submitted:false, error:"insufficient_credits", cost, credits: curCredits }) };
      }

      // Debit server-side
      await setCredits(uid, curCredits - cost);
      didDebit = true;

      // Mark charged
      await patchUgMeta(ugId, { ...ugMeta, run_id, status: "processing", duration, charged: true, debited: cost, charged_at: new Date().toISOString() });
    }

    // --- Call KIE ---
    const kiePayload = {
      model: "kling/v2-1-pro",
      callBackUrl,
      input: {
        prompt,
        duration: String(duration),
        image_url: firstFrameUrl,
        negative_prompt: "blur, distort, and low quality"
      },
      metadata: {
        uid,
        run_id,
        provider: duration === 5 ? "klingv2.1pro5s" : "klingv2.1pro10s"
      }
    };
    if (lastFrameUrl) kiePayload.input.tail_image_url = lastFrameUrl;

    const resp = await fetch(KIE_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(kiePayload)
    });
    const data = await resp.json().catch(()=>({}));
    const taskId = extractTaskId(data);

    if (!resp.ok || !taskId) {
      // Refund if we debited in this request
      if (didDebit) {
        try {
          const cur = await getCredits(uid);
          await setCredits(uid, cur + cost);
          await patchUgMeta(ugId, { ...ugMeta, run_id, status: "failed", refunded: true, refund_reason: "submit_failed", refund_at: new Date().toISOString() });
        } catch {}
      }
      return ok({ submitted:false, error:`kie_${resp.status}`, data });
    }

    // Persist taskId into meta
    try {
      const newMeta = { ...ugMeta, run_id, status: "processing", duration, task_id: taskId, model: "kling/v2-1-pro" };
      await patchUgMeta(ugId, newMeta);
    } catch {}

    return ok({ submitted:true, run_id, taskId, status: resp.status });
  } catch (e) {
    return ok({ submitted:false, error:String(e && e.message ? e.message : e) });
  }
};

// ---------------- helpers ----------------

function ok(obj){ return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code, message){ return { statusCode: code, headers: cors(), body: JSON.stringify({ submitted:false, error: message }) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, X-USER-ID" }; }
function safeJson(s){ try{ return JSON.parse(s||"{}"); } catch { return {}; } }
function lowerKeys(h){ const o={}; for (const k in h) o[k.toLowerCase()] = h[k]; return o; }

function normalizeDuration(d){
  const n = parseInt(d, 10);
  if (n === 10) return 10;
  return 5;
}
function normalizeUrl(u){
  try{ const url=new URL(String(u||"")); return url.href; } catch { return ""; }
}

function sb(){
  return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` };
}

async function verifySupabaseJwt(jwt){
  // Validate JWT and return user (id, email, etc.)
  // Uses Supabase Auth endpoint. ANON_KEY preferred; SERVICE_KEY fallback.
  const apikey = ANON_KEY || SERVICE_KEY;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "GET",
    headers: { "apikey": apikey, "Authorization": `Bearer ${jwt}` }
  });
  if (!r.ok) return null;
  return await r.json().catch(()=>null);
}

async function fetchUgByRunId(uid, run_id){
  const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id,meta`;
  const r = await fetch(UG_URL + q, { headers: sb() });
  const arr = await r.json().catch(()=>[]);
  return (Array.isArray(arr) && arr.length) ? arr[0] : null;
}

async function ensureUserGenerationRow({ uid, run_id, prompt, duration }){
  const existing = await fetchUgByRunId(uid, run_id);
  if (existing && existing.id) return existing;

  const payload = {
    user_id: uid,
    provider: duration === 5 ? "klingv2.1pro5s" : "klingv2.1pro10s",
    kind: "video",
    prompt,
    result_url: null,
    meta: { run_id, status: "processing", duration, model: "kling/v2-1-pro" }
  };
  await fetch(UG_URL, {
    method: "POST",
    headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=representation" },
    body: JSON.stringify(payload)
  }).then(r=>r.json()).catch(()=>null);

  return await fetchUgByRunId(uid, run_id);
}

async function patchUgMeta(id, meta){
  if (!id) return;
  await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
    body: JSON.stringify({ meta })
  });
}

async function claimChargeOnce(id, uid, run_id, meta, claimToken){
  if (!id) return false;
  const newMeta = { ...(meta||{}), run_id, charge_claim: claimToken };
  // Only claim if not already claimed
  const url = `${UG_URL}?id=eq.${encodeURIComponent(id)}&meta->>charge_claim=is.null`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=representation" },
    body: JSON.stringify({ meta: newMeta })
  });
  const arr = await r.json().catch(()=>[]);
  return Array.isArray(arr) && arr.length > 0;
}

async function getCredits(uid){
  const q = `?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
  const r = await fetch(PROF_URL + q, { headers: sb() });
  const arr = await r.json().catch(()=>[]);
  const c = (Array.isArray(arr) && arr.length) ? arr[0].credits : 0;
  return (typeof c === "number") ? c : (parseFloat(c) || 0);
}

async function setCredits(uid, newCredits){
  // Note: RLS bypass (service role)
  const url = `${PROF_URL}?user_id=eq.${encodeURIComponent(uid)}`;
  await fetch(url, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
    body: JSON.stringify({ credits: newCredits })
  });
}

// Try common taskId / requestId locations from KIE responses
function extractTaskId(data){
  if (!data || typeof data !== "object") return "";
  if (data?.data?.taskId)    return String(data.data.taskId);
  if (data?.taskId)          return String(data.taskId);
  if (data?.result?.taskId)  return String(data.result.taskId);
  if (data?.data?.task_id)   return String(data.data.task_id);
  if (data?.task_id)         return String(data.task_id);
  if (data?.result?.task_id) return String(data.result.task_id);
  if (data?.data?.requestId)    return String(data.data.requestId);
  if (data?.requestId)          return String(data.requestId);
  if (data?.result?.requestId)  return String(data.result.requestId);
  if (data?.data?.request_id)   return String(data.data.request_id);
  if (data?.request_id)         return String(data.request_id);
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
