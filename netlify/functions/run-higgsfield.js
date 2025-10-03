// netlify/functions/run-higgsfield.js
// Submit a Higgsfield DoP (image2video) job and seed a placeholder row in user_generations.
// Mirrors your working Veo flow but targets Higgsfield endpoints.
//
// Env needed:
//  - HF_API_KEY
//  - HF_SECRET
//  - SUPABASE_URL
//  - SUPABASE_SERVICE_ROLE_KEY
// Optional:
//  - SITE_BASE (used only to form a webhook URL if you want to enable it later)

const HF_URL = "https://platform.higgsfield.ai/v1/image2video/dop";
const HF_KEY = process.env.HF_API_KEY || "";
const HF_SECRET = process.env.HF_SECRET || "";

// Supabase (service role for server-side insert/patch)
const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return err(405, "Use POST");

  try {
    const headers = lowerKeys(event.headers || {});
    const isJson = (headers["content-type"] || "").includes("application/json");
    const body = isJson ? safeJson(event.body) : {};

    const uid = (body.uid || body.user_id || "").toString().trim();
    if (!uid) return ok({ submitted:false, error:"missing_user_id" });

    const motion_id = (body.motion_id || "").toString().trim();
    if (!motion_id) return ok({ submitted:false, error:"missing_motion_id" });

    const imageUrl = normalizeUrl(body.imageUrl || body.fileUrl || "");
    if (!imageUrl) return ok({ submitted:false, error:"missing_image_url" });

    const prompt = (body.prompt || "").toString().trim() || "";

    const clientRunId = (body.run_id || "").toString().trim();
    const run_id = clientRunId || `${uid}-${Date.now()}`;

    // Seed placeholder row in user_generations (processing)
    if (UG_URL && SERVICE_KEY) {
      try {
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
        const chk = await fetch(UG_URL + q, { headers: sb() });
        const arr = await chk.json().catch(()=>[]);
        const idToPatch = Array.isArray(arr) && arr.length ? arr[0].id : null;

        const payload = {
          user_id: uid,
          provider: "higgsfield",
          kind: "video",
          prompt,
          result_url: null,
          meta: { run_id, status: "processing", model: "dop-turbo", motion_id }
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
        console.warn("[run-higgsfield] placeholder write failed:", e);
      }
    }

    // Build HF payload. Webhook is optional — we rely on polling via hf-check.
    const hfPayload = {
      params: {
        model: "dop-turbo",
        prompt,
        motions: [{ id: motion_id, strength: typeof body.strength === "number" ? body.strength : 0.5 }],
        input_images: [{ type: "image", image_url: imageUrl }],
        enhance_prompt: true
      }
    };

    const resp = await fetch(HF_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "hf-api-key": HF_KEY, "hf-secret": HF_SECRET },
      body: JSON.stringify(hfPayload)
    });

    const data = await resp.json().catch(()=>({}));

    // The docs return a JobSet with id. Use that id to poll later.
    const jobSetId = extractJobSetId(data);

    if (!resp.ok) {
      return ok({ submitted:false, error:`hf_${resp.status}`, data });
    }
    if (!jobSetId) {
      return ok({ submitted:false, error:"missing_job_set_id", data });
    }

    // Persist job_set_id to user_generations meta
    try {
      if (UG_URL && SERVICE_KEY && jobSetId) {
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
        const chk = await fetch(UG_URL + q, { headers: sb() });
        const arr = await chk.json().catch(()=>[]);
        if (Array.isArray(arr) && arr.length) {
          await fetch(`${UG_URL}?id=eq.${encodeURIComponent(arr[0].id)}`, {
            method: "PATCH",
            headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({ meta: { run_id, status: "processing", model: "dop-turbo", motion_id, job_set_id: jobSetId } })
          });
        }
      }
    } catch {}

    return ok({ submitted:true, run_id, job_set_id: jobSetId, data });
  } catch (e) {
    return ok({ submitted:false, error:String(e) });
  }
};

function ok(obj){ return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code, message){ return { statusCode: code, headers: cors(), body: JSON.stringify({ submitted:false, error: message }) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, X-USER-ID" }; }
function safeJson(s){ try{ return JSON.parse(s||"{}"); } catch { return {}; } }
function lowerKeys(h){ const o={}; for (const k in h) o[k.toLowerCase()] = h[k]; return o; }
function normalizeUrl(u){ try{ const url=new URL(String(u||"")); return url.href; } catch { return ""; } }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }

// Higgsfield responses echo a JobSet with "id"
function extractJobSetId(data){
  if (!data || typeof data !== "object") return "";
  if (data?.id) return String(data.id);
  if (data?.data?.id) return String(data.data.id);
  return "";
}
