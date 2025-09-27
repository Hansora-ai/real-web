// netlify/functions/run-runway.js
// Submit a KIE Runway job and seed a placeholder row in user_generations.
// Only writes columns that exist: user_id, provider, kind, prompt, result_url, meta.
const KIE_URL = "https://api.kie.ai/api/v1/runway/generate";
const API_KEY = process.env.KIE_API_KEY;

// Supabase (service role for server-side insert/patch)
const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

// Your site base for callback (keep your current casing used by your working flow)
const SITE_BASE = (process.env.SITE_BASE || "https://webhansora.netlify.app").replace(/\/+$/,'');
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/video-kie-callback`;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  if (event.httpMethod !== "POST")   return { statusCode: 405, headers: cors(), body: "Use POST" };

  try {
    const body = safeJson(event.body);
    const headers = lowerKeys(event.headers || {});

    const uid = (body.uid || headers["x-user-id"] || headers["x-userid"] || "").trim();
    if (!uid) return ok({ submitted:false, error:"missing_user_id" });

    const promptRaw = (body.prompt || "").toString();
    const prompt = promptRaw.trim();
    if (!prompt) return ok({ submitted:false, error:"empty_prompt" });

    const aspectRatio = normalizeAspect(body.aspectRatio || body.size || "3:4");
    const imageUrl = normalizeUrl(body.imageUrl || body.image_url || "");

    const clientRunId = (body.run_id || "").toString().trim();
    const run_id = clientRunId || `${uid}-${Date.now()}`;

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

        await fetch(UG_URL + (idToPatch ? `?id=eq.${idToPatch}` : ""), {
          method: idToPatch ? "PATCH" : "POST",
          headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
          body: JSON.stringify(idToPatch ? { result_url: null, meta: payload.meta, prompt } : payload)
        });
      } catch (e) {
        console.warn("[run-runway] placeholder write failed:", e);
      }
    }

    // Build KIE payload
    const kiePayload = {
      prompt,
      aspectRatio,
      duration: 5,
      quality: "1080p",
      callBackUrl
    };
    if (imageUrl) kiePayload.imageUrl = imageUrl;

    const resp = await fetch(KIE_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(kiePayload)
    });
    const data = await resp.json().catch(()=>({}));

    return ok({ submitted: true, run_id, status: resp.status, data });

  } catch (e) {
    return ok({ submitted:false, error:String(e) });
  }
};

function ok(obj){ return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, X-USER-ID" }; }
function safeJson(s){ try{ return JSON.parse(s||"{}"); } catch { return {}; } }
function lowerKeys(h){ const o={}; for (const k in h) o[k.toLowerCase()] = h[k]; return o; }
function normalizeAspect(a){ a=String(a||"").trim(); return /^(16:9|9:16|1:1|4:3|3:4)$/.test(a)?a:"3:4"; }
function normalizeUrl(u){ try{ const url=new URL(String(u||"")); return url.href; } catch { return ""; } }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }
