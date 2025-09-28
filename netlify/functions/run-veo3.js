// netlify/functions/run-veo3.js
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

// Your site base for callback (same style as Runway)
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

    const promptRaw = (body.prompt || "").toString();
    const prompt = promptRaw.trim();
    if (!prompt && !body.fileUrl && !body.imageUrl && !body.imageUrls) {
      return ok({ submitted:false, error:"empty_prompt" });
    }

    const model = normalizeModel(body.model || "veo3_fast");
    const aspectRatio = normalizeAspect(body.aspectRatio || "16:9");

    // Accept a single URL, convert to array as imageUrls
    const imageUrl = normalizeUrl(body.imageUrl || body.fileUrl || "");
    const imageUrls = imageUrl ? [ imageUrl ] : [];

    const clientRunId = (body.run_id || "").toString().trim();
    const run_id = clientRunId || `${uid}-${Date.now()}`;

    const callBackUrl = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    // Seed placeholder row in user_generations
    if (UG_URL && SERVICE_KEY) {
      try {
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
        const chk = await fetch(UG_URL + q, { headers: sb() });
        const arr = await chk.json().catch(()=>[]);
        const idToPatch = Array.isArray(arr) && arr.length ? arr[0].id : null;

        const payload = {
          user_id: uid,
          provider: "veo3",
          kind: "video",
          prompt,
          result_url: null,
          meta: { run_id, status: "processing", aspect_ratio: aspectRatio, quality: "1080p", duration: 8, model }
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

    // Build KIE payload
    const kiePayload = {
      ...body,
      model,
      aspectRatio,
      callBackUrl
    };

    // Ensure only imageUrls is sent (remove other variants)
    if (imageUrls.length) {
      kiePayload.imageUrls = imageUrls;
      delete kiePayload.imageUrl;
      delete kiePayload.fileUrl;
      delete kiePayload.image_url;
      delete kiePayload.frameImage;
    } else {
      delete kiePayload.imageUrls;
      delete kiePayload.imageUrl;
      delete kiePayload.fileUrl;
      delete kiePayload.image_url;
      delete kiePayload.frameImage;
    }

    if (kiePayload.duration === undefined) kiePayload.duration = 8;
    if (kiePayload.quality  === undefined) kiePayload.quality  = "1080p";

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
            body: JSON.stringify({ meta: { run_id, status: "processing", aspect_ratio: aspectRatio, quality: "1080p", duration: 8, task_id: taskId, model } })
          });
        }
      }
    } catch {}

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
function normalizeModel(m){ m=String(m||"").toLowerCase(); return (m==="veo3"||m==="veo3_fast")?m:"veo3_fast"; }
function normalizeAspect(a){ a=String(a||"").trim(); return /^(16:9|9:16)$/.test(a)?a:"16:9"; }
function normalizeUrl(u){ try{ const url=new URL(String(u||"")); return url.href; } catch { return ""; } }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }

// Searches the JSON object for common taskId locations or any property named "taskId".
function extractTaskId(data){
  if (!data || typeof data !== "object") return "";
  // Fast paths (common shapes)
  if (data?.data?.taskId)    return String(data.data.taskId);
  if (data?.taskId)          return String(data.taskId);
  if (data?.result?.taskId)  return String(data.result.taskId);
  if (data?.data?.task_id)   return String(data.data.task_id);
  if (data?.task_id)         return String(data.task_id);
  if (data?.result?.task_id) return String(data.result.task_id);
  // Sometimes requestId is used
  if (data?.data?.requestId)    return String(data.data.requestId);
  if (data?.requestId)          return String(data.requestId);
  if (data?.result?.requestId)  return String(data.result.requestId);
  if (data?.data?.request_id)   return String(data.data.request_id);
  if (data?.request_id)         return String(data.request_id);
  if (data?.result?.request_id) return String(data.result.request_id);
  // Generic id fallback (len > 8 to avoid tiny numbers)
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
    return "";
  }
  return scan(data) || "";
}
