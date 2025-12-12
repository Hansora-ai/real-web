// netlify/functions/run-aleph.js
// Secure Aleph submit:
// - Credits are checked/deducted ONLY here (service role)
// - Deduct AFTER "Submitted" (after KIE returns taskId), but pre-check prevents free jobs
// - Idempotent charging per (uid + run_id)
// - Requires Supabase session token (prevents calling outside Hansora / uid spoofing)

const KIE_URL = "https://api.kie.ai/api/v1/aleph/generate";
const API_KEY = process.env.KIE_API_KEY;

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// REST endpoints (service role)
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL  = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";

// Your site base for callback (same style as Veo 3)
const SITE_BASE = (process.env.SITE_BASE || "https://webhansora.netlify.app").replace(/\/+$/,'');
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/aleph-check`;

const COST = 9; // Aleph cost in credits

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return err(405, "Use POST");

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return ok({ submitted:false, error:"server_misconfigured" });

    const headers = lowerKeys(event.headers || {});
    const isJson = (headers["content-type"] || "").includes("application/json");
    const body = isJson ? safeJson(event.body) : {};

    const uid = (body.uid || body.user_id || "").toString().trim();
    if (!uid) return ok({ submitted:false, error:"missing_user_id" });

    // Require Supabase session token and verify it matches uid (blocks external calls / uid spoofing)
    const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
    const token = extractBearer(authHeader);
    if (!token) return ok({ submitted:false, error:"auth_required" });

    const authUser = await getUserFromToken(token).catch(()=>null);
    if (!authUser || !authUser.id) return ok({ submitted:false, error:"invalid_auth" });
    if (String(authUser.id) !== String(uid)) return ok({ submitted:false, error:"uid_mismatch" });

    const promptRaw = (body.prompt || "").toString();
    const prompt = promptRaw.trim();
    const videoUrl = normalizeUrl(body.videoUrl || body.video_url || "");
    const imageUrl = normalizeUrl(body.imageUrl || body.referenceImageUrl || body.fileUrl || "");

    if (!prompt)  return ok({ submitted:false, error:"empty_prompt" });
    if (!videoUrl) return ok({ submitted:false, error:"missing_videoUrl" });

    const aspectRatio = normalizeAspect(body.aspectRatio || "16:9");

    const clientRunId = (body.run_id || "").toString().trim();
    const run_id = clientRunId || `${uid}-${Date.now()}`;

    // Idempotency: if this run_id already has a task_id, return it (and ensure charged once)
    const existing = await findUG(uid, run_id);
    if (existing && existing.meta && existing.meta.task_id) {
      // Ensure charged (exactly once)
      const alreadyCharged = isCharged(existing.meta);
      if (!alreadyCharged) {
        const debit = await debitCreditsOnce(uid, COST, existing.id, existing.meta);
        if (!debit.ok) return ok({ submitted:false, error: debit.error || "debit_failed" });
      }
      return ok({ submitted:true, run_id, taskId: existing.meta.task_id, reused:true });
    }

    // Pre-check credits (authoritative) to prevent free provider submissions
    const curCredits = await getCredits(uid);
    if (curCredits < COST) return ok({ submitted:false, error:"insufficient_credits", need:COST, have:curCredits });

    // For Aleph we poll via GET /aleph-check (no server-side callback push)
    const callBackUrl = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    // Seed / update placeholder row in user_generations (charged is false until after submit+debit)
    let ugId = existing ? existing.id : null;
    const baseMeta = {
      run_id,
      status: "processing",
      aspect_ratio: aspectRatio,
      duration: 5,
      video_url: videoUrl,
      charged: false,
      charge_cost: COST
    };
    ugId = await upsertPlaceholder(uid, prompt, baseMeta, ugId);

    // Build KIE payload
    const kiePayload = { prompt, aspectRatio, videoUrl, callBackUrl };
    if (imageUrl) {
      kiePayload.imageUrl = imageUrl;
      kiePayload.referenceImageUrl = imageUrl;
      kiePayload.referenceImage = imageUrl; // KIE playground key
    }

    const resp = await fetch(KIE_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(kiePayload)
    });
    const data = await resp.json().catch(()=>({}));

    const taskId = extractTaskId(data);

    if (!resp.ok)    return ok({ submitted:false, error:`kie_${resp.status}`, data });
    if (!taskId)     return ok({ submitted:false, error:"missing_taskId", data });

    // Persist taskId
    try {
      if (ugId) {
        await patchUG(ugId, { meta: { ...baseMeta, task_id: taskId } });
      } else {
        // last resort: patch by query
        const found = await findUG(uid, run_id);
        if (found && found.id) await patchUG(found.id, { meta: { ...baseMeta, task_id: taskId } });
      }
    } catch {}

    // Deduct credits AFTER Submitted (after we have taskId), but idempotent
    const foundForDebit = ugId ? { id: ugId, meta: { ...baseMeta, task_id: taskId } } : await findUG(uid, run_id);
    const debit = await debitCreditsOnce(uid, COST, foundForDebit?.id || null, foundForDebit?.meta || baseMeta);
    if (!debit.ok) {
      // We cannot safely grant a free job. Mark row for support/diagnostics.
      try {
        const idToPatch = foundForDebit?.id || ugId;
        if (idToPatch) await patchUG(idToPatch, { meta: { ...(foundForDebit?.meta || baseMeta), task_id: taskId, status: "payment_failed" } });
      } catch {}
      return ok({ submitted:false, error: debit.error || "payment_failed_after_submit", taskId, run_id });
    }

    return ok({ submitted:true, run_id, taskId, status: resp.status, data });
  } catch (e) {
    return ok({ submitted:false, error:String(e) });
  }
};

// ---------- helpers ----------
function ok(obj){ return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code, message){ return { statusCode: code, headers: cors(), body: JSON.stringify({ submitted:false, error: message }) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, X-USER-ID" }; }
function safeJson(s){ try{ return JSON.parse(s||"{}"); } catch { return {}; } }
function lowerKeys(h){ const o={}; for (const k in h) o[k.toLowerCase()] = h[k]; return o; }
function normalizeAspect(a){
  a=String(a||"").trim();
  const ok = /^(16:9|9:16|4:3|3:4|1:1|21:9)$/;
  return ok.test(a) ? a : "16:9";
}
function normalizeUrl(u){ try{ const url=new URL(String(u||"")); return url.href; } catch { return ""; } }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }

function extractBearer(h){
  const s = String(h||"").trim();
  const m = s.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

async function getUserFromToken(token){
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "GET",
    headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${token}` }
  });
  if (!r.ok) return null;
  return await r.json().catch(()=>null);
}

async function getCredits(uid){
  const q = `?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
  const r = await fetch(PROFILES_URL + q, { headers: sb() });
  const arr = await r.json().catch(()=>[]);
  const credits = Array.isArray(arr) && arr.length ? Number(arr[0].credits || 0) : 0;
  return Number.isFinite(credits) ? credits : 0;
}

async function findUG(uid, run_id){
  if (!UG_URL) return null;
  const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id,meta`;
  const r = await fetch(UG_URL + q, { headers: sb() });
  const arr = await r.json().catch(()=>[]);
  if (Array.isArray(arr) && arr.length) return arr[0];
  return null;
}

function isCharged(meta){
  if (!meta || typeof meta !== "object") return false;
  return meta.charged === true || String(meta.charged) === "true";
}

async function patchUG(id, body){
  await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
    body: JSON.stringify(body)
  });
}

async function upsertPlaceholder(uid, prompt, meta, existingId){
  if (!UG_URL) return null;
  try {
    const payload = {
      user_id: uid,
      provider: "aleph",
      kind: "video",
      prompt,
      result_url: null,
      meta
    };

    if (existingId) {
      await patchUG(existingId, { result_url: null, meta });
      return existingId;
    }

    // Check again for existing to avoid duplicates
    const ex = await findUG(uid, meta.run_id);
    if (ex && ex.id) {
      await patchUG(ex.id, { result_url: null, meta });
      return ex.id;
    }

    const r = await fetch(UG_URL, {
      method: "POST",
      headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=representation" },
      body: JSON.stringify(payload)
    });
    const arr = await r.json().catch(()=>[]);
    if (Array.isArray(arr) && arr.length && arr[0].id) return arr[0].id;

    // If return=representation is disabled, fallback lookup
    const found = await findUG(uid, meta.run_id);
    return found ? found.id : null;
  } catch {
    return null;
  }
}

async function debitCreditsOnce(uid, cost, ugId, ugMeta){
  try {
    // If already charged, do nothing
    const existing = ugId ? { id: ugId, meta: ugMeta } : await findUG(uid, ugMeta?.run_id || "");
    if (existing && isCharged(existing.meta)) return { ok:true, already:true };

    // Read current credits
    const q = `?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
    const r = await fetch(PROFILES_URL + q, { headers: sb() });
    const arr = await r.json().catch(()=>[]);
    const cur = Array.isArray(arr) && arr.length ? Number(arr[0].credits || 0) : 0;
    if (!Number.isFinite(cur) || cur < cost) return { ok:false, error:"insufficient_credits" };

    // Atomic-ish debit: update only if credits still equal 'cur'
    const patchUrl = `${PROFILES_URL}?user_id=eq.${encodeURIComponent(uid)}&credits=eq.${encodeURIComponent(String(cur))}`;
    const pr = await fetch(patchUrl, {
      method: "PATCH",
      headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=representation" },
      body: JSON.stringify({ credits: Number((cur - cost).toFixed(1)) })
    });
    const updated = await pr.json().catch(()=>[]);
    if (!Array.isArray(updated) || updated.length === 0) return { ok:false, error:"debit_race" };

    // Mark charged in user_generations meta
    const idToPatch = existing?.id || ugId;
    if (idToPatch) {
      const now = new Date().toISOString();
      const nextMeta = { ...(existing?.meta || ugMeta || {}), charged: true, charge_cost: cost, charged_at: now };
      await patchUG(idToPatch, { meta: nextMeta });
    }

    return { ok:true };
  } catch (e) {
    return { ok:false, error:String(e) };
  }
}

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
