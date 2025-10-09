// netlify/functions/kling-check.js
// Robust poller for KIE/Kling jobs using record-info (matches Sora2 behavior).
// GET ?id=<taskId>&uid=<uid>&run_id=<run_id>[&debug=1]
// Returns: { ok, status:"succeeded"|"pending", state, video_url, result_url, ... }

const VERSION_TAG = "kling-check-record-info-2025-10-09+v1";
const KIE_BASE = (process.env.KIE_BASE_URL || "https://api.kie.ai").replace(/\/+$/,'');
const KIE_KEY  = process.env.KIE_API_KEY || "";

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const TABLE_URL     = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/nb_results` : "";

// ---------- helpers ----------
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
function kieHeaders(){ const h = { "Accept": "application/json" }; if (KIE_KEY) h["Authorization"] = `Bearer ${KIE_KEY}`; return h; }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }

function isUrl(u){ return typeof u === "string" && /^https?:\/\//i.test(u); }
function host(u){ try { return new URL(u).hostname; } catch { return ""; } }
// accept any https host (Sora/Kling can use different CDNs)
function isAllowed(u){ return isUrl(u); }

function collect(x, out){
  if (x == null) return;
  if (typeof x === "string"){
    const m = x.match(/https?:\/\/[^\s"'<>]+/ig);
    if (m) for (const u of m) out.push(u);
    return;
  }
  if (Array.isArray(x)){ for (const v of x) collect(v,out); return; }
  if (typeof x === "object"){ for (const v of Object.values(x)) collect(v,out); return; }
}
function collectUrls(x){
  const a=[]; collect(x,a);
  const seen=new Set(), out=[];
  for (const u of a){ if(!seen.has(u)){ seen.add(u); out.push(u); } }
  return out;
}

// Parse json-ish strings/objects for first .mp4
function firstMp4FromJsonish(x){
  try{
    if (typeof x === "string"){
      const s = x.trim();
      if (/^https?:\/\//i.test(s) && /\.mp4(\?|#|$)/i.test(s)) return s;
      try { x = JSON.parse(s); } catch(e){}
    }
    if (Array.isArray(x)){
      for (const u of x){ if (typeof u === "string" && /^https?:\/\//i.test(u) && /\.mp4(\?|#|$)/i.test(u)) return u; }
    } else if (x && typeof x === "object"){
      const keys = [x.resultUrls, x.result_urls, x.urls, x.url, x.output, x.outputs];
      for (const v of keys){ const hit = firstMp4FromJsonish(v); if (hit) return hit; }
      for (const v of Object.values(x)){ const hit = firstMp4FromJsonish(v); if (hit) return hit; }
    }
  }catch(_){}
  return "";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "GET") return json(405, { ok:false, error:"Use GET", version: VERSION_TAG });

  const qs = event.queryStringParameters || {};
  const debug = qs.debug === "1" || qs.debug === "true";

  try {
    const taskId = (qs.id || qs.taskId || qs.taskid || "").toString().trim();
    const uid    = (qs.uid || "").toString().trim();
    const run_id = (qs.run_id || qs.runId || "").toString().trim();

    if (!taskId) return json(400, { ok:false, error:"missing taskId", version: VERSION_TAG });

    // *** IMPORTANT: use record-info (same as sora2-check) ***
    const url = `${KIE_BASE}/api/v1/jobs/record-info?taskId=${encodeURIComponent(taskId)}`;
    const r   = await fetch(url, { headers: kieHeaders() });
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

    // Grab URLs
    const urls = collectUrls(data);
    let video_url = "";
    for (const u of urls) {
      if (!isAllowed(u)) continue;
      if (/\.mp4(\?|#|$)/i.test(u)) { video_url = u; break; }
    }

    // Fallbacks: jsonurl / resultJson / nested arrays
    if (!video_url) {
      const k1 = (data && (data.jsonurl || data.jsonUrl || data.json_url || (data.data && (data.data.jsonurl || data.data.jsonUrl)) || (data.result && (data.result.jsonurl || data.result.jsonUrl)))) || null;
      const hit1 = firstMp4FromJsonish(k1);
      if (hit1) video_url = hit1;
    }
    if (!video_url) {
      const k2 = (data && (data.resultJson || (data.data && data.data.resultJson) || (data.result && data.result.resultJson))) || null;
      const hit2 = firstMp4FromJsonish(k2);
      if (hit2) video_url = hit2;
    }

    const out = {
      ok: !!video_url,
      status: video_url ? "succeeded" : "pending",
      state:  video_url ? "succeeded" : "pending",
      video_url,
      result_url: video_url || "",
      version: VERSION_TAG
    };

    if (!video_url) {
      if (debug) out.debug = { rawState: (data && (data.state || data.status)) || null, sample: urls.slice(0,6) };
      return json(200, out);
    }

    // Supabase backfill (best-effort)
    let patched = false, patchError = null, idToPatch = null;
    try {
      if (SUPABASE_URL && SERVICE_KEY) {
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
        const chk = await fetch(UG_URL + q, { headers: sb() });
        const arr = await chk.json().catch(()=>[]);
        idToPatch = Array.isArray(arr) && arr.length ? arr[0].id : null;

        const payload = { result_url: video_url, meta: { run_id, task_id: taskId, status: "done" } };
        if (idToPatch) {
          const pr = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(idToPatch)}`, {
            method: "PATCH",
            headers: { ...sb(), "Content-Type": "application/json", "Prefer":"return=minimal" },
            body: JSON.stringify(payload)
          });
          patched = pr.ok; if (!patched) patchError = `PATCH ${pr.status}`;
        } else {
          const ir = await fetch(UG_URL, {
            method: "POST",
            headers: { ...sb(), "Content-Type": "application/json", "Prefer":"return=minimal" },
            body: JSON.stringify({
              user_id: uid || "00000000-0000-0000-0000-000000000000",
              provider:"kling",
              kind:"video",
              prompt:null,
              result_url: video_url,
              meta: { run_id, task_id: taskId, status: "done" }
            })
          });
          patched = ir.ok; if (!patched) patchError = `POST ${ir.status}`;
        }
      }
    } catch (e) {
      patchError = (e && e.message) ? e.message : String(e);
    }

    // Mirror table (best-effort)
    try {
      if (TABLE_URL) {
        await fetch(TABLE_URL, {
          method: "POST",
          headers: { ...sb(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify([{ user_id: uid || "00000000-0000-0000-0000-000000000000", run_id, task_id: taskId, image_url: video_url }])
        });
      }
    } catch {}

    if (debug) out.debug = { patched, patchError, supabase_host: tryHost(SUPABASE_URL) };
    return json(200, out);

  } catch (e) {
    return json(200, { ok:false, error: String(e && e.message ? e.message : e), version: VERSION_TAG });
  }
};

function tryHost(u){ try { return new URL(u).hostname; } catch { return ""; } }
