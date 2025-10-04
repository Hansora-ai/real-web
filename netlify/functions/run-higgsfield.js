// netlify/functions/run-higgsfield.js
// Payload aligned to Higgsfield Playground example:
// {
//   "params": {
//     "model": "dop-turbo",
//     "motions": [{ "id": "<MOTION_ID>" }],
//     "input_images": [{ "type": "image_url", "image_url": "<PUBLIC_URL>" }],
//     "enhance_prompt": true,
//     "input_images_end": []
//   }
// }

const HF_URL = "https://platform.higgsfield.ai/v1/image2video/dop";
const HF_KEY = process.env.HF_API_KEY || "";
const HF_SECRET = process.env.HF_SECRET || "";

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST")   return err(405, "Use POST");

  try {
    const body = safeJson(event.body);
    const uid       = (body.uid || body.user_id || "").toString().trim();
    const motion_id = (body.motion_id || "").toString().trim();
    const imageUrl  = normalizeUrl(body.imageUrl || body.fileUrl || "");
    const prompt    = (body.prompt || "").toString().trim();

    if (!uid)       return ok({ submitted:false, error:"missing_user_id" });
    if (!motion_id) return ok({ submitted:false, error:"missing_motion_id" });
    if (!imageUrl)  return ok({ submitted:false, error:"missing_image_url" });

    const run_id = (body.run_id || `${uid}-${Date.now()}`).toString();

    // seed/patch user_generations (processing)
    await upsertGen(uid, { run_id, status:"processing", provider:"higgsfield", model:"dop-turbo", motion_id });

    const hfPayload = {
      params: {
        model: "dop-turbo",
        prompt,
        motions: [{ id: motion_id }],
        input_images: [{ type: "image_url", image_url: imageUrl }],
        input_images_end: [],
        enhance_prompt: true
      }
    };

    const resp = await fetch(HF_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "hf-api-key": HF_KEY,
        "hf-secret": HF_SECRET
      },
      body: JSON.stringify(hfPayload)
    });

    const text = await resp.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!resp.ok) {
      const reason = data?.message || data?.error || data?.detail || text || `hf_${resp.status}`;
      return ok({ submitted:false, error:`hf_${resp.status}`, reason, data, sent: hfPayload });
    }

    const jobSetId = extractJobSetId(data);
    if (!jobSetId) {
      return ok({ submitted:false, error:"missing_job_set_id", data, sent: hfPayload });
    }

    await upsertGen(uid, { run_id, status:"processing", provider:"higgsfield", model:"dop-turbo", motion_id, job_set_id: jobSetId });
    return ok({ submitted:true, run_id, job_set_id: jobSetId, data });
  } catch (e) {
    return ok({ submitted:false, error:String(e) });
  }
};

async function upsertGen(uid, meta){
  try{
    if (!UG_URL || !SERVICE_KEY) return;
    const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(meta.run_id)}&select=id`;
    const chk = await fetch(UG_URL + q, { headers: sb() });
    const arr = await chk.json().catch(()=>[]);
    if (Array.isArray(arr) && arr.length){
      await fetch(`${UG_URL}?id=eq.${encodeURIComponent(arr[0].id)}`, {
        method: "PATCH",
        headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({ meta })
      });
    } else {
      await fetch(UG_URL, {
        method: "POST",
        headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({ user_id: uid, provider:"higgsfield", kind:"video", prompt:null, result_url:null, meta })
      });
    }
  }catch{}
}

function ok(obj){ return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code, message){ return { statusCode: code, headers: cors(), body: JSON.stringify({ submitted:false, error: message }) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, X-USER-ID" }; }
function safeJson(s){ try{ return JSON.parse(s||"{}"); } catch { return {}; } }
function normalizeUrl(u){ try{ const url=new URL(String(u||"")); return url.href; } catch { return ""; } }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }

function extractJobSetId(data){
  if (!data || typeof data !== "object") return "";
  if (data.id) return String(data.id);
  if (data.data?.id) return String(data.data.id);
  return "";
}
