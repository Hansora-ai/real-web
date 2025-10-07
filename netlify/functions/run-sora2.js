// netlify/functions/run-sora2.js
// Purpose: Submit a KIE Sora 2 job (text-to-video or image-to-video) and seed/patch a row in user_generations.
// Notes:
// - Mirrors your working Veo 3 logic (endpoint style, callback, Supabase insert/patch) but targets Sora 2.
// - Chooses model automatically:
//     * no image  -> "sora-2-text-to-video"
//     * with image -> "sora-2-image-to-video"
// - Uses KIE endpoint: https://api.kie.ai/api/v1/sora/generate
// - Uses Sora page field style (snake_case): prompt, aspect_ratio, image_urls (array).
// - Includes callBackUrl for status callbacks (same pattern as your Veo flow).
// - Strictly minimal; no unrelated changes.

const KIE_URL = "https://api.kie.ai/api/v1/sora/generate";
const KIE_API_KEY = process.env.KIE_API_KEY || "";

// Supabase (service role for server-side insert/patch)
const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

// Public site base for callback (same style as your Veo callback)
const SITE_BASE = (process.env.SITE_BASE || process.env.URL || "").replace(/\/+$/,"");

// Utility: JSON-safe parse
function safeJson(s){
  try { return JSON.parse(s || "{}"); } catch { return {}; }
}

// Utility: HTTP OK helper
function ok(data, status=200){
  return { statusCode: status, headers: cors(), body: JSON.stringify(data) };
}
function err(status, message, extra={}){
  return { statusCode: status, headers: cors(), body: JSON.stringify({ error: message, ...extra }) };
}
function cors(){
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
// Supabase headers
function sb(){ return {apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`}; }

// Insert or patch user_generations
async function upsertUserGen({ id, user_id, provider, kind, prompt, aspect_ratio, model, result_url, meta, patchOnly=false }){
  const payload = {
    user_id, provider, kind, prompt, result_url: result_url || null,
    meta: { ...(meta || {}), aspect_ratio, model }
  };
  if (id){
    // PATCH existing row (set processing metadata / task id etc.)
    await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...sb(), "Content-Type":"application/json", "Prefer":"return=minimal" },
      body: JSON.stringify(payload)
    });
  } else if (!patchOnly){
    await fetch(UG_URL, {
      method: "POST",
      headers: { ...sb(), "Content-Type":"application/json", "Prefer":"return=representation" },
      body: JSON.stringify(payload)
    });
  }
}

// Extract task id from any response shape
function pickTaskId(data){
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
      if (/^(task[_-]?id|request[_-]?id)$/i.test(k) && (typeof v === "string" || typeof v === "number")){
        const s = String(v); if (s.length > 3) return s;
      }
      const inner = scan(v); if (inner) return inner;
    }
    return "";
  }
  return scan(data) || "";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return err(405, "Use POST");

  // Parse input
  const body = safeJson(event.body);
  const uid  = String(body.uid || body.user_id || "").trim();
  const prompt = (body.prompt ?? "").toString().trim();
  const aspect = (body.aspect_ratio || body.aspect || "16:9").toString().trim(); // expect "16:9" or "9:16"
  const uploadedImageUrl = (body.image_url || "").toString().trim();
  const imageUrls = Array.isArray(body.image_urls) ? body.image_urls
                    : (uploadedImageUrl ? [uploadedImageUrl] : []);

  const run_id = (body.run_id || body.runId || "").toString().trim(); // your client passes this
  const result_url = ""; // filled by callback later

  if (!uid)   return err(400, "missing_user_id");
  if (!prompt && !imageUrls.length) return err(400, "missing_prompt_or_image");
  if (!SUPABASE_URL || !SERVICE_KEY) return err(500, "missing_supabase_config");
  if (!KIE_API_KEY) return err(500, "missing_kie_config");

  // Decide model based on whether an image is provided
  const model = imageUrls.length ? "sora-2-image-to-video" : "sora-2-text-to-video";

  // Seed/patch "processing" row (mirrors your working flow)
  const baseMeta = { status: "processing", run_id, provider: "kie", engine: "sora2" };
  await upsertUserGen({
    id: body.id, user_id: uid, provider: "kie", kind: "video", prompt,
    aspect_ratio: aspect, model, result_url, meta: baseMeta, patchOnly: !!body.id
  });

  // Build callback URL (same style as Veo)
  const cbUrl = SITE_BASE
    ? `${SITE_BASE}/.netlify/functions/video-kie-callback?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}&provider=sora2`
    : "";

  // Build KIE payload — Sora page shows snake_case
  const payload = {
    model,
    prompt,
    aspect_ratio: aspect,
  };
  if (imageUrls.length) payload.image_urls = imageUrls;

  // Include callback if available (KIE accepts callback naming in some providers as callBackUrl)
  if (cbUrl) payload.callBackUrl = cbUrl;

  // Forward any optional knobs from client unchanged (duration, quality, seed etc.)
  for (const k of ["duration","quality","seed"]) {
    if (body[k] !== undefined) payload[k] = body[k];
  }

  // Submit to KIE Sora 2
  let resp, data;
  try {
    resp = await fetch(KIE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${KIE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return err(502, "kie_network_error", { detail: String(e) });
  }

  try { data = await resp.json(); } catch { data = { status: resp.status, text: await resp.text().catch(()=> "") }; }

  if (!resp.ok) {
    // Patch meta with failure
    await upsertUserGen({
      id: body.id, user_id: uid, provider: "kie", kind: "video", prompt,
      aspect_ratio: aspect, model,
      meta: { ...baseMeta, status: "failed", error: data?.error || `kie_${resp.status}` },
      patchOnly: true
    });
    return err(resp.status, "kie_error", { data });
  }

  const taskId = pickTaskId(data);

  // Patch the row with task id
  await upsertUserGen({
    id: body.id, user_id: uid, provider: "kie", kind: "video", prompt,
    aspect_ratio: aspect, model,
    meta: { ...baseMeta, task_id: taskId },
    patchOnly: true
  });

  return ok({ submitted: true, taskId, data });
};
