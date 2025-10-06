/**
 * netlify/functions/run-sora2.js
 * Submit a Sora 2 task and seed user_generations.
 * 1:1 with run-veo3, adapted to:
 *  - endpoint: POST {KIE_BASE}/api/v1/jobs/createTask
 *  - models: "sora-2-text-to-video" or "sora-2-image-to-video"
 *  - duration: 10, quality: "hd"
 *  - image_urls: [url]
 *  - orientation: "landscape"/"portrait" mapped from aspect ratio
 *  - live debit handled on client (3⚡)
 */
const VERSION = "run-sora2-2025-10-06+v3-kie-envfix";

const KIE_BASE = (process.env.KIE_BASE_URL || "").replace(/\/+$/,"");
const KIE_API_KEY  = process.env.KIE_API_KEY || "";

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return err(405, "Use POST");

  try {
    const body = safeJson(event.body);
    const uid  = String(body.uid || body.user_id || "").trim();
    if (!uid) return ok({ submitted:false, error:"missing_user_id" });

    const model = String(body.model || "").trim() || "sora-2-text-to-video";
    const prompt = String(body.prompt || "").trim();
    const image_urls = Array.isArray(body.image_urls) ? body.image_urls.filter(Boolean) : [];
    const aspect = String(body.aspectRatio || "16:9");
    const orientation = (String(body.orientation || "") || (aspect === "9:16" ? "portrait" : "landscape"));

    const run_id = (String(body.run_id || "").trim()) || `${uid}-${Date.now()}`;

    // Seed placeholder
    if (UG_URL && SERVICE_KEY) {
      await seedOrPatch(uid, run_id, {
        user_id: uid, provider: "sora2", kind: "video", prompt,
        result_url: null,
        meta: { run_id, status: "processing", aspect_ratio: aspect, orientation, quality: "hd", duration: 10, model }
      });
    }

    if (!KIE_BASE || !KIE_API_KEY) {
      return ok({ submitted:false, error:"missing_kie_config" });
    }

    // Build payload for Sora
    const payload = {
      model,
      prompt,
      duration: 10,
      quality: "hd",
      orientation,
    };
    if (image_urls.length) payload.image_urls = image_urls;

    const url = `${KIE_BASE}/api/v1/jobs/createTask`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${KIE_API_KEY}` },
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(()=>({}));

    const taskId = pickTaskId(data);
    if (!r.ok || !taskId) {
      return ok({ submitted:false, error: `kie_${r.status||"error"}`, data, version: VERSION });
    }

    // Persist task id
    try{
      if (UG_URL && SERVICE_KEY) {
        await seedOrPatch(uid, run_id, {
          meta: { run_id, status: "processing", aspect_ratio: aspect, orientation, quality: "hd", duration: 10, model, task_id: taskId }
        }, true);
      }
    }catch{}

    return ok({ submitted:true, run_id, taskId, version: VERSION });
  } catch (e) {
    return ok({ submitted:false, error:String(e), version: VERSION });
  }
};

// helpers
function ok(obj){ return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code, message){ return { statusCode: code, headers: cors(), body: JSON.stringify({ submitted:false, error: message }) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, X-USER-ID" }; }
function safeJson(s){ try{ return JSON.parse(s||"{}"); } catch { return {}; } }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }

async function seedOrPatch(uid, run_id, payload, patchOnly=false){
  const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
  const chk = await fetch(`${UG_URL}${q}`, { headers: sb() });
  const arr = await chk.json().catch(()=>[]);
  const id = Array.isArray(arr)&&arr.length ? arr[0].id : null;
  if (id) {
    await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { ...sb(), "Content-Type":"application/json", "Prefer":"return=minimal" },
      body: JSON.stringify(payload)
    });
  } else if (!patchOnly) {
    await fetch(UG_URL, {
      method: "POST", headers: { ...sb(), "Content-Type":"application/json", "Prefer":"return=minimal" },
      body: JSON.stringify(payload)
    });
  }
}

// very tolerant task id extractor
function pickTaskId(x){
  if (!x || typeof x !== "object") return "";
  const cands = ["taskId","task_id","requestId","request_id","id"];
  for (const k of cands){ if (x[k]) return String(x[k]); if (x.data && x.data[k]) return String(x.data[k]); if (x.result && x.result[k]) return String(x.result[k]); }
  const seen=new Set();
  function scan(o){ if(!o||typeof o!=='object'||seen.has(o)) return ""; seen.add(o); for(const [k,v] of Object.entries(o)){ if(/task[_-]?id|request[_-]?id/i.test(k)) return String(v); const s=scan(v); if(s) return s; } return ""; }
  return scan(x);
}
