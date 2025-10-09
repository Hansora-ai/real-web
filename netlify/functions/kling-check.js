// netlify/functions/sora2-check.js
// GET poller for Sora 2 (KIE) tasks created via /api/v1/jobs/createTask.
// 1) Allow ALL HTTPS hosts for result URLs (Sora can return different CDNs).
// 2) Supabase fallback: if KIE JSON doesn't expose the MP4 yet, return result_url from your row.
//
// Mirrors vv-check.js behavior otherwise (status JSON, patching same row by user_id + run_id).

const VERSION_TAG = "sora2-check-GET-2025-10-07+v2-jobs-allowAll+sbFallback";

const KIE_BASE = (process.env.KIE_BASE_URL || "https://api.kie.ai").replace(/\/+$/,'');
const KIE_KEY  = process.env.KIE_API_KEY || "";

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const TABLE_URL     = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/nb_results` : "";

// Allow ALL hosts
const ALLOWED = null;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "GET") return json(405, { ok:false, error:"Use GET", version: VERSION_TAG });

  const qs = event.queryStringParameters || {};
  const debug = qs.debug === "1" || qs.debug === "true";

  try {
    const taskId = (qs.taskId || qs.taskid || "").toString().trim();
    const uid    = (qs.uid || "").toString().trim();
    const run_id = (qs.run_id || qs.runId || "").toString().trim();

    if (!taskId) return json(400, { ok:false, error:"missing taskId", version: VERSION_TAG });

    // Query KIE (jobs record info)
    const url = `${KIE_BASE}/api/v1/jobs/record-info?taskId=${encodeURIComponent(taskId)}`;
    const r   = await fetch(url, { headers: kieHeaders() });
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

    // Collect URLs and choose mp4
    const urls = collectUrls(data);
    let video_url = "";
    for (const u of urls) {
      if (!isAllowed(u)) continue;
      if (/\.mp4(\?|#|$)/i.test(u)) { video_url = u; break; }
    }

    // Supabase fallback if no mp4 yet
    if (!video_url && SUPABASE_URL && SERVICE_KEY && uid && run_id) {
      try {
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=result_url`;
        const chk = await fetch(UG_URL + q, { headers: sb() });
        const arr = await chk.json().catch(()=>[]);
        const row = Array.isArray(arr) && arr.length ? arr[0] : null;
        if (row && row.result_url && isUrl(row.result_url)) video_url = row.result_url;
      } catch {}
    }

    const out = { ok: !!video_url, status: video_url ? "success" : "pending", video_url, version: VERSION_TAG };
    if (!video_url) {
      if (debug) out.debug = { urls, response_status: r.status };
      return json(200, out);
    }

    // Backfill Supabase with mp4 + done
    let patched = false, patchError = null;
    try {
      if (SUPABASE_URL && SERVICE_KEY && uid && run_id) {
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
        const chk = await fetch(UG_URL + q, { headers: sb() });
        const arr = await chk.json().catch(()=>[]);
        const idToPatch = Array.isArray(arr) && arr.length ? arr[0].id : null;

        const payload = { result_url: video_url, meta: { run_id, task_id: taskId, status: "done", engine: "sora2" } };

        if (idToPatch) {
          const pr = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(idToPatch)}`, {
            method: "PATCH",
            headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify(payload)
          });
          patched = pr.ok;
          if (!patched) patchError = `PATCH ${pr.status}`;
        } else {
          const ir = await fetch(UG_URL, {
            method: "POST",
            headers: { ...sb(), "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: uid,
              provider: "kie",
              kind: "video",
              prompt: "",
              result_url: video_url,
              meta: { run_id, task_id: taskId, status: "done", engine: "sora2" }
            })
          });
          patched = ir.ok;
          if (!patched) patchError = `INSERT ${ir.status}`;
        }
      }
    } catch (e) {
      patchError = String(e && e.message ? e.message : e);
    }

    out.patched = patched;
    if (patchError) out.patchError = patchError;
    return json(200, out);

  } catch (e) {
    const res = { ok:false, error: String(e && e.message ? e.message : e), version: VERSION_TAG };
    if (qs.debug) res.debug = { supabase_url_host: tryHost(SUPABASE_URL), has_service_key: !!SERVICE_KEY };
    return json(200, res);
  }
};

// ---- helpers ----
function cors(){
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
function json(code, obj){
  return { statusCode: code, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
function kieHeaders(){ const h = { "Accept": "application/json" }; if (KIE_KEY) h["Authorization"] = `Bearer ${KIE_KEY}`; return h; }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }
function isUrl(u){ return typeof u === "string" && /^https?:\/\//i.test(u); }
function host(u){ try { return new URL(u).hostname; } catch { return ""; } }
function tryHost(u){ try { return new URL(u).hostname; } catch { return ""; } }
function isAllowed(u){ if (!isUrl(u)) return false; if (!ALLOWED) return true; const h = host(u); return ALLOWED.has(h); }

function collect(x, out){
  if (!x) return;
  if (typeof x === "string"){
      if (isUrl(x)) out.push(x);
      return;
  }
  if (Array.isArray(x)){ for (const v of x) collect(v, out); return; }
  if (typeof x === "object"){ for (const v of Object.values(x)) collect(v,out); return; }
}
function collectUrls(x){
  const a=[]; collect(x,a);
  const seen=new Set(), out=[];
  for (const u of a){ if(isUrl(u)){ if(!seen.has(u)){ seen.add(u); out.push(u); } } }
  return out;
}
