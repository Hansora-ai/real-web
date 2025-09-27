// netlify/functions/rv-check.js
// Poll Runway (KIE) task status for video, and backfill DB when mp4 is ready.
// - Interface preserved: GET params: taskId, uid, run_id
// - Returns: { ok:true, status:'success', video_url }
// - Writes ONLY existing columns in public.user_generations (no thumb_url).

const VERSION_TAG = "rv-check-GET-no-thumb-2025-09-28";

const KIE_BASE = (process.env.KIE_BASE_URL || "https://api.kie.ai").replace(/\/+$/,'');
const KIE_KEY  = process.env.KIE_API_KEY || "";

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const TABLE_URL     = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/nb_results` : "";

// Only accept result URLs hosted on these domains (tighten if you like)
const ALLOWED = new Set(["tempfile.aiquickdraw.com","tempfile.redpandaai.co"]);

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "GET") {
    return json(405, { ok:false, error:"Use GET", version: VERSION_TAG });
  }

  try {
    const qs = event.queryStringParameters || {};
    const taskId = (qs.taskId || qs.taskid || "").toString().trim();
    const uid    = (qs.uid || "").toString().trim();
    const run_id = (qs.run_id || qs.runId || "").toString().trim();

    if (!taskId) return json(400, { ok:false, error:"missing taskId", version: VERSION_TAG });

    // Query KIE for this task
    const url = `${KIE_BASE}/api/v1/runway/record-detail?taskId=${encodeURIComponent(taskId)}`;
    const r   = await fetch(url, { headers: kieHeaders() });
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

    // Collect all URLs from the payload and pick the first allowed mp4
    const urls = collectUrls(data);
    let video_url = "";
    for (const u of urls) {
      if (!isAllowed(u)) continue;
      if (/\.mp4(\?|#|$)/i.test(u)) { video_url = u; break; }
    }

    if (!video_url) {
      return json(200, { ok:false, status:"pending", version: VERSION_TAG });
    }

    // Backfill Supabase (optional; no thumb_url)
    await backfill(uid, run_id, taskId, video_url).catch(()=>{});

    return json(200, { ok:true, status:"success", video_url, version: VERSION_TAG });

  } catch (e) {
    return json(200, { ok:false, error: String(e && e.message ? e.message : e), version: VERSION_TAG });
  }
};

async function backfill(uid, run_id, taskId, video_url){
  if (!(SUPABASE_URL && SERVICE_KEY)) return;

  // user_generations: patch existing row by (user_id + meta->>run_id), else insert a new one
  try {
    const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
    const chk = await fetch(UG_URL + q, { headers: sb() });
    const arr = await chk.json().catch(()=>[]);
    const idToPatch = Array.isArray(arr) && arr.length ? arr[0].id : null;

    const payload = {
      user_id: uid || "00000000-0000-0000-0000-000000000000",
      provider: "runway",
      kind: "video",
      result_url: video_url,
      // keep meta minimal to avoid accidental overwrite explosions
      meta: { run_id, task_id, status: "done" }
    };

    if (idToPatch) {
      await fetch(`${UG_URL}?id=eq.${encodeURIComponent(idToPatch)}`, {
        method: "PATCH",
        headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({ result_url: payload.result_url, meta: payload.meta })
      });
    } else {
      await fetch(UG_URL, {
        method: "POST",
        headers: { ...sb(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(payload)
      });
    }
  } catch {}

  // nb_results (compat; safe to ignore failures)
  try {
    if (!TABLE_URL) return;
    await fetch(TABLE_URL, {
      method: "POST",
      headers: { ...sb(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{
        user_id: uid || "00000000-0000-0000-0000-000000000000",
        run_id,
        task_id: taskId,
        image_url: video_url // legacy table uses image_url field
      }])
    });
  } catch {}
}

// ---- helpers ----
function cors(){
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-USER-ID"
  };
}

function json(code, obj){
  return { statusCode: code, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

function kieHeaders(){
  const h = { "Accept": "application/json" };
  if (KIE_KEY) h["Authorization"] = `Bearer ${KIE_KEY}`;
  return h;
}

function sb(){
  return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` };
}

function isUrl(u){ return typeof u === "string" && /^https?:\/\//i.test(u); }
function host(u){ try { return new URL(u).hostname; } catch { return ""; } }
function isAllowed(u){ if (!isUrl(u)) return false; const h = host(u); return ALLOWED.has(h); }

function collect(x, out){
  if (!x) return;
  if (typeof x === "string"){
    const m = x.match(/https?:\/\/[^"'\s]+/ig);
    if (m) for (const u of m) out.push(u);
    return;
  }
  if (Array.isArray(x)){ for (const v of x) collect(v, out); return; }
  if (typeof x === "object"){ for (const v of Object.values(x)) collect(v, out); return; }
}

function collectUrls(x){
  const a = [];
  collect(x, a);
  // de-dup while preserving order
  const seen = new Set();
  const out = [];
  for (const u of a){ if (!seen.has(u)) { seen.add(u); out.push(u); } }
  return out;
}
