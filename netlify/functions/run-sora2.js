// netlify/functions/run-sora2.js
// Submit a KIE Sora 2 job (text->video or image->video) using the jobs/createTask schema
// Mirrors your Veo 3 flow for Supabase + callback; ONLY the KIE request shape/endpoint changed
//
// Behavior:
//   - No image  -> model "sora-2-text-to-video" (or pro variant)
//   - With image -> model "sora-2-image-to-video" (or pro variant)

const KIE_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const API_KEY = process.env.KIE_API_KEY;

// Supabase (service role for server-side insert/patch)
const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

// Your site base for callback (same style as Veo)
const SITE_BASE = (process.env.SITE_BASE || process.env.URL || "").replace(/\/+$/,'');
const CALLBACK_BASE = SITE_BASE ? `${SITE_BASE}/.netlify/functions/video-kie-callback` : "";

// ------------------------------
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return err(405, "Use POST");

  try {
    const headers = lowerKeys(event.headers || {});
    const isJson = (headers["content-type"] || "").includes("application/json");
    const body = isJson ? safeJson(event.body) : {};

    const uid  = String(body.uid || body.user_id || "").trim();
    const runId = String(body.run_id || body.runId || "").trim();
    const prompt = (body.prompt ?? "").toString().trim();

    // aspect ratio normalization (accept various keys)
    const aspectRaw = String(
      body.aspectRatio ?? body.aspect_ratio ?? body.aspect ?? "16:9"
    ).trim();
    const aspect_ratio = mapAspect(aspectRaw);

    // image url(s)
    const oneImage = (body.image_url || "").toString().trim();
    const image_urls = Array.isArray(body.imageUrls) ? body.imageUrls
                      : Array.isArray(body.image_urls) ? body.image_urls
                      : (oneImage ? [oneImage] : []);

    if (!uid)   return err(400, "missing_user_id");
    if (!prompt && !image_urls.length) return err(400, "missing_prompt_or_image");
    if (!SUPABASE_URL || !SERVICE_KEY) return err(500, "missing_supabase_config");
    if (!API_KEY) return err(500, "missing_kie_api_key");

    const tier = String(body.tier || body.model_tier || "").toLowerCase();
    const model = image_urls.length
      ? (tier === "pro" ? "sora-2-pro-image-to-video" : "sora-2-image-to-video")
      : (tier === "pro" ? "sora-2-pro-text-to-video"  : "sora-2-text-to-video");

    // seed/patch "processing" row
    const metaBase = { status: "processing", run_id: runId, provider: "kie", engine: "sora2" };
    await patchUserGen({
      id: body.id,
      payload: {
        user_id: uid,
        provider: "Sora 2",
        kind: "video",
        prompt,
        result_url: null,
        meta: { ...metaBase, aspect_ratio, model, tier }
      }
    });

    // build callback url like Veo
    const callBackUrl = CALLBACK_BASE
      ? `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(runId)}&provider=sora2`
      : "";

    // Build KIE payload per screenshot docs
    const kiePayload = {
      model,
      callBackUrl,
      input: {
        prompt,
        aspect_ratio
      }
    };
    if (image_urls.length) kiePayload.input.image_urls = image_urls;

    // Optional passthroughs placed under input if KIE expects them there (safe no-op otherwise)
    // Explicit KIE fields
    if (body.size !== undefined) kiePayload.input.size = body.size; // "standard" | "high"
    if (body.n_frames !== undefined) kiePayload.input.n_frames = String(body.n_frames); // '10' | '15'
    // Back-compat mapping if callers still send legacy keys
    if (body.quality && !kiePayload.input.size) {
      kiePayload.input.size = /^(hd|high)$/i.test(String(body.quality)) ? "high" : "standard";
    }
    if (body.duration && !kiePayload.input.n_frames) {
      const d = parseInt(body.duration, 10); kiePayload.input.n_frames = String(d === 15 ? 15 : 10);
    }
    if (body.seed !== undefined) kiePayload.input.seed = body.seed;

    // Call KIE
    const resp = await fetch(KIE_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(kiePayload)
    });

    const data = await resp.json().catch(async () => ({ status: resp.status, text: await resp.text().catch(()=> "") }));
    const taskId = extractTaskId(data);

    if (!resp.ok) {
      // mark failed
      await patchUserGen({
        id: body.id,
        payload: { meta: { ...metaBase, status: "failed", error: data?.error || `kie_${resp.status}` } }
      });
      return ok({ submitted:false, error: "kie_error", status: resp.status, data });
    }

    // patch task id
    await patchUserGen({
      id: body.id,
      payload: { meta: { ...metaBase, task_id: taskId } }
    });

    return ok({ submitted:true, taskId, data });
  } catch (e) {
    return err(500, "server_error", { detail: String(e && e.stack || e) });
  }
};
// ------------------------------

// Helpers
function lowerKeys(h){ const o={}; for(const k in h) o[k.toLowerCase()] = h[k]; return o; }
function safeJson(s){ try{ return JSON.parse(s || "{}"); } catch{ return {}; } }
function ok(data, status=200){ return { statusCode: status, headers: cors(), body: JSON.stringify(data) }; }
function err(status, message, extra={}){ return { statusCode: status, headers: cors(), body: JSON.stringify({ error: message, ...extra }) }; }
function cors(){
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// Patch existing row in user_generations (same as Veo style)
async function patchUserGen({ id, payload }){
  if (!UG_URL || !id) return;
  await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type":"application/json", "Prefer":"return=minimal" },
    body: JSON.stringify(payload)
  });
}

// Flexible task id extractor
function extractTaskId(data){
  if (!data || typeof data !== "object") return "";
  if (data?.data?.taskId) return String(data.data.taskId);
  if (data?.taskId) return String(data.taskId);
  if (data?.id) return String(data.id);
  // deep scan
  const seen = new WeakSet();
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

// Map "16:9"/"9:16" to words expected by docs; pass through other values
function mapAspect(v){
  const s = String(v || "").trim();
  if (s === "16:9" || /^landscape$/i.test(s)) return "landscape";
  if (s === "9:16"  || /^portrait$/i.test(s))  return "portrait";
  return s || "landscape";
}
