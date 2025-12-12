// netlify/functions/run-runway.js
// Submit a KIE Runway job and seed a placeholder row in user_generations.
// Only writes columns that exist: user_id, provider, kind, prompt, result_url, meta.
// Adds `taskId` in the response (extracted from KIE JSON).

const KIE_URL = "https://api.kie.ai/api/v1/runway/generate";
const API_KEY = process.env.KIE_API_KEY;

// Supabase (service role for server-side insert/patch)
const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

// Your site base for callback (keep your current casing used by your working flow)
const SITE_BASE = (process.env.SITE_BASE || "https://webhansora.netlify.app").replace(/\/+$/,'');
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/video-kie-callback`;
// Credits (server-side only)
const COST = 4;

// Profiles REST endpoint
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";

// Verify the caller is the same user as `uid` using the Supabase access token.
// This blocks calling the function outside Hansora with a spoofed uid.
async function requireAuthUser(eventHeaders, uid){
  const auth = (eventHeaders["authorization"] || eventHeaders["Authorization"] || "").toString();
  if (!auth.startsWith("Bearer ")) return { ok:false, error:"auth_required" };
  if (!SUPABASE_URL || !SERVICE_KEY) return { ok:false, error:"server_misconfig" };
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "GET",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": auth
    }
  });
  if (!resp.ok) return { ok:false, error:"auth_invalid" };
  const user = await resp.json().catch(()=>null);
  const tokenUid = user?.id || user?.user?.id;
  if (!tokenUid || String(tokenUid) !== String(uid)) return { ok:false, error:"auth_uid_mismatch" };
  return { ok:true, user };
}

async function getCredits(uid){
  if (!PROFILES_URL) return { ok:false, error:"server_misconfig" };
  const q = `?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
  const r = await fetch(PROFILES_URL + q, { headers: sb() });
  const arr = await r.json().catch(()=>[]);
  const credits = Array.isArray(arr) && arr.length ? Number(arr[0].credits ?? 0) : 0;
  return { ok:true, credits: isFinite(credits) ? credits : 0 };
}

// Best-effort atomic debit: retry a few times; update only when credits match the observed value.
// This prevents common double-submit races without requiring DB-side RPC.
async function debitCredits(uid, cost){
  for (let attempt=0; attempt<3; attempt++){
    const g = await getCredits(uid);
    if (!g.ok) return { ok:false, error:g.error || "credits_read_failed" };
    const cur = Number(g.credits || 0);
    if (!isFinite(cur) || cur < cost) return { ok:false, error:"insufficient_credits", credits: cur };
    const next = Number((cur - cost).toFixed(1));
    const q = `?user_id=eq.${encodeURIComponent(uid)}&credits=eq.${encodeURIComponent(cur)}`;
    const resp = await fetch(PROFILES_URL + q, {
      method: "PATCH",
      headers: { ...sb(), "Content-Type":"application/json", "Prefer":"return=representation" },
      body: JSON.stringify({ credits: next })
    });
    const rows = await resp.json().catch(()=>[]);
    if (resp.ok && Array.isArray(rows) && rows.length){
      return { ok:true, prev: cur, next };
    }
  }
  return { ok:false, error:"debit_race_retry_failed" };
}

async function findUG(uid, run_id){
  if (!UG_URL) return { ok:false, error:"server_misconfig" };
  const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id,meta`;
  const r = await fetch(UG_URL + q, { headers: sb() });
  const arr = await r.json().catch(()=>[]);
  if (Array.isArray(arr) && arr.length) return { ok:true, row: arr[0] };
  return { ok:true, row: null };
}

async function patchUGMeta(id, meta){
  if (!UG_URL) return { ok:false, error:"server_misconfig" };
  await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type":"application/json", "Prefer":"return=minimal" },
    body: JSON.stringify({ meta })
  });
  return { ok:true };
}


exports.handler = async (event) => {
  // CORS + method guard
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return err(405, "Use POST");

  try {
    const headers = lowerKeys(event.headers || {});
    const isJson = (headers["content-type"] || "").includes("application/json");
    const body = isJson ? safeJson(event.body) : {};

    const uid = (body.uid || body.user_id || "").toString().trim();
    if (!uid) return ok({ submitted:false, error:"missing_user_id" });

    // Require a valid Supabase session token that matches uid
    const authz = await requireAuthUser(headers, uid);
    if (!authz.ok) return ok({ submitted:false, error: authz.error });

    const promptRaw = (body.prompt || "").toString();
    const prompt = promptRaw.trim();
    if (!prompt && !body.fileUrl && !body.imageUrl && !body.image_url) {
      return ok({ submitted:false, error:"empty_prompt" });
    }

    const aspectRatio = normalizeAspect(body.aspectRatio || body.size || "3:4");
    const imageUrl = normalizeUrl(body.imageUrl || body.image_url || body.fileUrl || "");

    const clientRunId = (body.run_id || "").toString().trim();
    const run_id = clientRunId || `${uid}-${Date.now()}`;

    // Idempotency: if this run_id already exists and is charged, return existing task info without charging again.
    const existing = await findUG(uid, run_id);
    if (existing.ok && existing.row && existing.row.meta && existing.row.meta.charged && existing.row.meta.task_id) {
      return ok({ submitted: true, run_id, taskId: String(existing.row.meta.task_id), status: 200, idempotent: true });
    }

    // Authoritative server-side precheck (do NOT submit if insufficient)
    const bal = await getCredits(uid);
    if (!bal.ok) return ok({ submitted:false, error: bal.error || "credits_read_failed" });
    if ((bal.credits ?? 0) < COST) return ok({ submitted:false, error:"insufficient_credits", needed:COST, credits: bal.credits ?? 0 });

    // Keep the same key casing you were already using in your working flow
    const callBackUrl = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    // Seed placeholder row in user_generations (no thumb_url)
    if (UG_URL && SERVICE_KEY) {
      try {
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
        const chk = await fetch(UG_URL + q, { headers: sb() });
        const arr = await chk.json().catch(()=>[]);
        const idToPatch = Array.isArray(arr) && arr.length ? arr[0].id : null;

        const payload = {
          user_id: uid,
          provider: "runway",
          kind: "video",
          prompt,
          result_url: null,
          meta: { run_id, status: "processing", aspect_ratio: aspectRatio, quality: "1080p", duration: 5 }
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
        console.warn("[run-runway] placeholder write failed:", e);
      }
    }

    // Build KIE payload. Keep user's fields but enforce callback/aspectRatio + normalize fileUrl.
    const kiePayload = {
      ...body,
      aspectRatio,
      callBackUrl,
    };
    if (kiePayload.duration === undefined) kiePayload.duration = 5;
    if (kiePayload.quality === undefined)  kiePayload.quality  = "1080p";

    // Image handling: send imageUrl only when a file is chosen; otherwise send no image fields.
if (imageUrl) {
  kiePayload.imageUrl = imageUrl;
  // do NOT send fileUrl to avoid API confusion
} else {
  // remove any empty image fields that might have come from the client
  delete kiePayload.imageUrl;
  delete kiePayload.fileUrl;
  delete kiePayload.image_url;
  delete kiePayload.frameImage;
}

    // Call KIE
    const resp = await fetch(KIE_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(kiePayload)
    });
    const data = await resp.json().catch(()=>({}));

    // Extract taskId robustly from KIE response
    const taskId = extractTaskId(data);
  // Immediately store taskId into the placeholder meta so downstream tools can re-poll later
  try {
    if (UG_URL && SERVICE_KEY && taskId) {
      const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
      const chk = await fetch(UG_URL + q, { headers: sb() });
      const arr = await chk.json().catch(()=>[]);
      if (Array.isArray(arr) && arr.length) {
        await fetch(`${UG_URL}?id=eq.${encodeURIComponent(arr[0].id)}`, {
          method: "PATCH",
          headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
          body: JSON.stringify({
            meta: { run_id, status: "processing", aspect_ratio: aspectRatio, quality: "1080p", duration: 5, task_id: taskId }
          })
        });
      }
    }
  } catch {}


    
    // Charge credits AFTER the job is successfully submitted to KIE.
    // Idempotent: if already charged for this run_id, skip.
    try {
      const row = await findUG(uid, run_id);
      const meta0 = (row.ok && row.row && typeof row.row.meta === "object" && row.row.meta) ? row.row.meta : {};
      const already = !!meta0.charged;
      if (!already) {
        const deb = await debitCredits(uid, COST);
        if (!deb.ok) {
          // If debit fails here, do NOT pretend it was charged. The precheck above should prevent most cases.
          return ok({ submitted:false, error: deb.error || "debit_failed", run_id, taskId });
        }
        // Mark charged in meta for replay protection
        if (row.ok && row.row && row.row.id) {
          const merged = { ...meta0, charged: true, charged_cost: COST, charged_at: new Date().toISOString(), task_id: taskId };
          await patchUGMeta(row.row.id, merged);
        }
      }
    } catch (e) {
      // If meta patch fails, we still don't want to double-charge later; placeholder row should exist.
      console.warn("[run-runway] charge/meta error:", e);
    }

    return ok({ submitted: true, run_id, taskId, status: resp.status, data });

  } catch (e) {
    return ok({ submitted:false, error:String(e) });
  }
};

function ok(obj){ return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code, message){ return { statusCode: code, headers: cors(), body: JSON.stringify({ submitted:false, error: message }) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, X-USER-ID" }; }
function safeJson(s){ try{ return JSON.parse(s||"{}"); } catch { return {}; } }
function lowerKeys(h){ const o={}; for (const k in h) o[k.toLowerCase()] = h[k]; return o; }
function normalizeAspect(a){ a=String(a||"").trim(); return /^(16:9|9:16|1:1|4:3|3:4)$/.test(a)?a:"3:4"; }
function normalizeUrl(u){ try{ const url=new URL(String(u||"")); return url.href; } catch { return ""; } }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }

// Searches the JSON object for common taskId locations or any property named "taskId".
function extractTaskId(data){
  if (!data || typeof data !== "object") return "";
  if (data?.data?.taskId) return String(data.data.taskId);
  if (data?.taskId) return String(data.taskId);
  if (data?.result?.taskId) return String(data.result.taskId);
  if (data?.id && String(data.id).length > 8) return String(data.id);
  // recursive search for a key named taskId
  const seen = new Set();
  function scan(x){
    if (!x || typeof x !== "object" || seen.has(x)) return "";
    seen.add(x);
    for (const [k,v] of Object.entries(x)){
      if (k === "taskId" && (typeof v === "string" || typeof v === "number")) return String(v);
      const inner = scan(v);
      if (inner) return inner;
    }
    return "";
  }
  return scan(data) || "";
}
