// netlify/functions/video-kie-callback.js
// KIE posts back result URLs. We store only columns that exist in user_generations.
const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

const DEFAULT_HOSTS = ["tempfile.aiquickdraw.com","tempfile.redpandaai.co"];
const ALLOWED = new Set(DEFAULT_HOSTS);

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
    if (event.httpMethod !== "POST")   return { statusCode: 405, headers: cors(), body: "Use POST" };

    const qs  = parseQuery(event.queryStringParameters || {});
    const uid = (qs.uid || "").trim();
    const run_id = (qs.run_id || "").trim();

    const body = safeJson(event.body);
    const result = body?.result || body?.data?.result || [];
    const urls = Array.isArray(result) ? result : [];

    let video_url = "";
    for (const u of urls) {
      if (/^https?:\/\//i.test(u) && isAllowed(u) && /\.mp4(\?|#|$)/i.test(u)) { video_url = u; break; }
    }

    if (!(UG_URL && SERVICE_KEY)) return reply(200, { ok:true, saved:false, reason:"no_supabase_env" });
    if (!(uid && run_id && video_url)) return reply(200, { ok:false, reason:"missing_fields_or_no_mp4", received: result });

    // Patch existing runway row for this run_id (or insert if missing)
    const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
    let idToPatch = null;
    try {
      const chk = await fetch(UG_URL + q, { headers: sb() });
      const arr = await chk.json().catch(()=>[]);
      if (Array.isArray(arr) && arr.length) idToPatch = arr[0].id;
    } catch {}

    const payload = {
      user_id: uid,
      provider: "runway",
      kind: "video",
      result_url: video_url,
      meta: { run_id, status: "done" }
    };

    await fetch(UG_URL + (idToPatch ? `?id=eq.${idToPatch}` : ""), {
      method: idToPatch ? "PATCH" : "POST",
      headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify(idToPatch ? { result_url: video_url, meta: payload.meta } : payload)
    });

    return reply(200, { ok:true, saved:true, video_url });
  } catch (e) {
    return reply(200, { ok:false, error:String(e) });
  }
};

function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization" }; }
function reply(statusCode, body){ return { statusCode, headers: { ...cors(), "Content-Type":"application/json" }, body: JSON.stringify(body) }; }
function safeJson(s){ try{ return JSON.parse(s||"{}"); } catch { return {}; } }
function parseQuery(obj){ const out={}; for (const k in obj) out[k] = String(obj[k]||""); return out; }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }
function host(u){ try{ return new URL(u).hostname; } catch { return ""; } }
function isAllowed(u){ const h = host(u); return ALLOWED.has(h); }
