// netlify/functions/video-kie-callback.js
// Callback for KIE Runway video jobs.
// - Expects KIE to POST a JSON body where result is an array containing the mp4 and (optionally) a jpg.
// - Only accepts the FIRST URL that ends with .mp4 (ignores others except poster .jpg).
// - Updates user_generations row for the (uid, run_id) pair with result_url = mp4 and meta.status = 'done'.
// - Avoids duplicates by patching existing row by id when found.
//
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional: ALLOWED_RESULT_HOSTS (comma-separated), e.g. "tempfile.aiquickdraw.com,tempfile.redpandaai.co"

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

const VERSION_TAG = "runway_video_callback_v2";

// Default allowed hosts to protect from malicious URLs
const DEFAULT_HOSTS = ["tempfile.aiquickdraw.com","tempfile.redpandaai.co"];
const ALLOWED = new Set(
  (process.env.ALLOWED_RESULT_HOSTS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .concat(DEFAULT_HOSTS)
);

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
    if (event.httpMethod !== "POST")   return { statusCode: 405, headers: cors(), body: "Use POST" };

    const qs  = parseQuery(event.queryStringParameters || {});
    const uid = (qs.uid || "").trim();            // required
    const run_id = (qs.run_id || "").trim();      // required

    const data = safeJson(event.body);
    // result might be under data.result OR data.data.result
    const result = (Array.isArray(data) ? data : (data.result || (data.data && data.data.result) || [])) || [];

    const urls = Array.isArray(result) ? result.filter(isUrl) : [];
    // pick first .mp4, optionally first .jpg as poster
    let video_url = "";
    let thumb_url = "";
    for (const u of urls) {
      if (!isAllowed(u)) continue;
      if (!video_url && /\.mp4(\?|#|$)/i.test(u)) video_url = u;
      else if (!thumb_url && /\.(jpg|jpeg|png)(\?|#|$)/i.test(u)) thumb_url = u;
    }

    if (!uid || !run_id) return reply(400, { ok:false, error:"missing_uid_or_run_id", version: VERSION_TAG });
    if (!video_url)      return reply(200, { ok:false, status:"no_mp4_in_result", version: VERSION_TAG, received: result });

    if (!(UG_URL && SERVICE_KEY)) return reply(200, { ok:true, saved:false, version: VERSION_TAG, video_url });

    // Patch existing row for (uid, run_id); if found, patch by id to avoid duplicates.
    let idToPatch = null;
    try {
      const chk = await fetch(UG_URL + `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`, { headers: sb() });
      const arr = await chk.json().catch(()=>[]);
      if (Array.isArray(arr) && arr.length) idToPatch = arr[0].id;
    } catch {}

    const bodyJson = {
      user_id: uid,
      provider: "runway",
      kind: "video",
      result_url: video_url,
      thumb_url: thumb_url || null,
      meta: { run_id, status: "done" }
    };

    await fetch(UG_URL + (idToPatch ? `?id=eq.${idToPatch}` : ""), {
      method: idToPatch ? "PATCH" : "POST",
      headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify(idToPatch ? { result_url: video_url, thumb_url: bodyJson.thumb_url, meta: bodyJson.meta } : bodyJson)
    });

    return reply(200, { ok:true, saved:true, version: VERSION_TAG, video_url });

  } catch (e) {
    return reply(200, { ok:false, error:String(e), version: VERSION_TAG });
  }
};

// ───────── helpers
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization" }; }
function reply(statusCode, body){ return { statusCode, headers: { ...cors(), "Content-Type":"application/json" }, body: JSON.stringify(body) }; }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }
function safeJson(s){ try{ return JSON.parse(s||"{}"); } catch { return {}; } }
function parseQuery(obj){ const out={}; for (const k in obj) out[k] = String(obj[k]||""); return out; }
function isUrl(u){ return typeof u === "string" && /^https?:\/\//i.test(u); }
function host(u){ try{ return new URL(u).hostname; } catch { return ""; } }
function isAllowed(u){ if (!isUrl(u)) return false; const h = host(u); return ALLOWED.has(h); }
