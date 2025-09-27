// netlify/functions/rv-check.js
// GET poller for Runway (KIE) tasks. Finds mp4 and backfills Supabase.
// Adds optional debug: add &debug=1 to see patch details (no secrets leaked).

const VERSION_TAG = "rv-check-GET-no-thumb-2025-09-28+debug1";

const KIE_BASE = (process.env.KIE_BASE_URL || "https://api.kie.ai").replace(/\/+$/,'');
const KIE_KEY  = process.env.KIE_API_KEY || "";

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const TABLE_URL     = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/nb_results` : "";

// Only accept result URLs hosted on these domains (tighten if you like)
const ALLOWED = new Set(["tempfile.aiquickdraw.com","tempfile.redpandaai.co"]);

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

    // Query KIE
    const url = `${KIE_BASE}/api/v1/runway/record-detail?taskId=${encodeURIComponent(taskId)}`;
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

    const out = { ok: !!video_url, status: video_url ? "success" : "pending", video_url, version: VERSION_TAG };
    if (!video_url) return json(200, out);

    // Try to backfill Supabase (no thumb_url)
    let idToPatch = null, patched = false, patchError = null;
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
            headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify(payload)
          });
          patched = pr.ok;
          if (!patched) patchError = `PATCH ${pr.status}`;
        } else {
          const ir = await fetch(UG_URL, {
            method: "POST",
            headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({ user_id: uid || "00000000-0000-0000-0000-000000000000", provider:"runway", kind:"video", prompt:null, result_url: video_url, meta: { run_id, task_id: taskId, status: "done" } })
          });
          patched = ir.ok;
          if (!patched) patchError = `POST ${ir.status}`;
        }
      }
    } catch (e) {
      patchError = (e && e.message) ? e.message : String(e);
    }

    // Mirror nb_results (best-effort)
    try {
      if (TABLE_URL) {
        await fetch(TABLE_URL, {
          method: "POST",
          headers: { ...sb(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify([{ user_id: uid || "00000000-0000-0000-0000-000000000000", run_id, task_id: taskId, image_url: video_url }])
        });
      }
    } catch {}

    if (debug) {
      out.debug = {
        supabase_url_host: tryHost(SUPABASE_URL),
        has_service_key: !!SERVICE_KEY,
        idToPatch, patched, patchError
      };
    }

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
function tryHost(u){ try { return new URL(u).hostname; } catch { return ""; } }
function isAllowed(u){ if (!isUrl(u)) return false; const h = host(u); return ALLOWED.has(h); }
function collect(x, out){ if (!x) return; if (typeof x === "string"){ const m=x.match(/https?:\/\/[^\"\'\s]+/ig); if (m) for (const u of m) out.push(u); return; } if (Array.isArray(x)){ for (const v of x) collect(v,out); return; } if (typeof x === "object"){ for (const v of Object.values(x)) collect(v,out); return; } }
function collectUrls(x){ const a=[]; collect(x,a); const seen=new Set(); const out=[]; for (const u of a){ if(!seen.has(u)){ seen.add(u); out.push(u); } } return out; }
