// netlify/functions/run-runway.js
// Create a Runway (KIE) video job: Text→Video OR Image→Video.
// - Forces quality=1080p and duration=5s
// - Aspect ratios allowed: 16:9, 9:16, 1:1, 4:3, 3:4 (default 3:4)
// - Inserts/updates a placeholder row in user_generations so Usage shows "processing"
// - Uses a separate callback: /.netlify/functions/video-kie-callback
//
// Env required: KIE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional: SITE_BASE (defaults to https://webhansora.netlify.app)

const KIE_URL = "https://api.kie.ai/api/v1/runway/generate";
const API_KEY = process.env.KIE_API_KEY;

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

const SITE_BASE = (process.env.SITE_BASE || "https://webhansora.netlify.app").replace(/\/+$/,''); // no trailing slash
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/video-kie-callback`;

const VERSION_TAG  = "runway_video_v2";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  if (event.httpMethod !== "POST")   return { statusCode: 405, headers: cors(), body: "Use POST" };

  try {
    const body = safeJson(event.body);
    const headers = lowerKeys(event.headers || {});

    // Identify user (mirror your pattern: allow header or body)
    const uid = (body.uid || headers["x-user-id"] || headers["x-userid"] || "").trim();
    if (!uid) {
      return ok({ submitted:false, error:"missing_user_id", note:"Pass uid in body or X-USER-ID header." });
    }

    // Inputs
    const promptRaw = (body.prompt || "").toString();
    const prompt = promptRaw.trim();
    if (!prompt) return ok({ submitted:false, error:"empty_prompt" });

    const aspectRatio = normalizeAspect(body.aspectRatio || body.size || "3:4");
    const imageUrl = normalizeUrl(body.imageUrl || body.image_url || "");

    // Use client-provided run_id if present to avoid mismatch; otherwise generate
    const clientRunId = (body.run_id || "").toString().trim();
    const run_id = clientRunId || `${uid}-${Date.now()}`;

    // Build callback with uid + run_id
    const callBackUrl = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    // Prepare payload (force duration/quality)
    const payload = {
      prompt,
      aspectRatio,
      duration: 5,
      quality: "1080p",
      callBackUrl
    };
    if (imageUrl) payload.imageUrl = imageUrl; // presence => image→video

    // Optional: insert/patch placeholder Usage row so the page can show "processing"
    if (UG_URL && SERVICE_KEY) {
      try {
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`;
        const chk = await fetch(UG_URL + q + "&select=id", { headers: sb() });
        let idToPatch = null;
        try { const arr = await chk.json(); if (Array.isArray(arr) && arr.length) idToPatch = arr[0].id; } catch {}
        const bodyJson = {
          user_id: uid,
          provider: "runway",
          kind: "video",
          result_url: null,
          thumb_url: null,
          meta: { run_id, status: "processing", aspect_ratio: aspectRatio, quality: "1080p", duration: 5 }
        };
        await fetch(UG_URL + (idToPatch ? `?id=eq.${idToPatch}` : ""), {
          method: idToPatch ? "PATCH" : "POST",
          headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
          body: JSON.stringify(idToPatch ? { result_url: null, thumb_url: null, meta: bodyJson.meta } : bodyJson)
        });
      } catch (e) {
        console.warn("[run-runway] placeholder write failed:", e);
      }
    }

    // Call KIE
    const resp = await fetch(KIE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json().catch(()=> ({}));
    // Be tolerant to shapes: taskId may be at data.taskId / result.taskId / id
    const taskId = get(data, "taskId") || get(data, "data.taskId") || get(data, "result.taskId") || get(data, "id") || null;

    return ok({
      submitted: true,
      run_id,
      taskId,
      version: VERSION_TAG,
      sent: { ...payload, imageUrl: imageUrl || undefined },
      used_callback: !!callBackUrl
    });

  } catch (e) {
    return ok({ submitted:false, error:String(e), version: VERSION_TAG });
  }
};

// ───────── helpers
function normalizeAspect(v){
  if (!v) return "3:4";
  const s = String(v).trim().toLowerCase().replace(/(\d)[_\-x](\d)/g,"$1:$2");
  const allowed = new Set(["16:9","9:16","1:1","4:3","3:4"]);
  return allowed.has(s) ? s : "3:4";
}
function normalizeUrl(u){ try{ return new URL(u).href; }catch{ return ""; } }
function ok(json){ return { statusCode: 200, headers: { ...cors(), "X-Runway-Version": VERSION_TAG }, body: JSON.stringify(json) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, X-USER-ID, x-user-id" }; }
function get(o,p){ try{ return p.split(".").reduce((a,k)=> (a && k in a ? a[k] : undefined), o); } catch { return undefined; } }
function lowerKeys(obj){ const out={}; for (const k in obj) out[k.toLowerCase()] = obj[k]; return out; }
function safeJson(s){ try{ return JSON.parse(s||"{}"); } catch { return {}; } }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }
