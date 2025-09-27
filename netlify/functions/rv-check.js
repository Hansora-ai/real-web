// netlify/functions/rv-check.js
// Backfill when polling finds the mp4: write user_generations (and nb_results image_url).
const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const NB_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/nb_results` : "";

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
    if (event.httpMethod !== "POST")   return { statusCode: 405, headers: cors(), body: "Use POST" };

    const body = safeJson(event.body);
    const { uid, run_id, video_url } = body || {};
    if (!(uid && run_id && video_url)) return reply(400, { ok:false, error:"missing_fields" });

    // (A) user_generations
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
          result_url: video_url,
          meta: { run_id, status: "done" }
        };
        await fetch(UG_URL + (idToPatch ? `?id=eq.${idToPatch}` : ""), {
          method: idToPatch ? "PATCH" : "POST",
          headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
          body: JSON.stringify(idToPatch ? { result_url: video_url, meta: payload.meta } : payload)
        });
      } catch {}
    }

    // (B) nb_results mirror (optional)
    if (NB_URL && SERVICE_KEY) {
      try {
        await fetch(NB_URL, {
          method: "POST",
          headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
          body: JSON.stringify({ user_id: uid, run_id, task_id: run_id, image_url: video_url })
        });
      } catch {}
    }

    return reply(200, { ok:true });
  } catch (e) {
    return reply(200, { ok:false, error:String(e) });
  }
};

function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization" }; }
function reply(statusCode, body){ return { statusCode, headers: cors(), body: JSON.stringify(body) }; }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }
function safeJson(s){ try{ return JSON.parse(s||"{}"); } catch { return {}; } }
