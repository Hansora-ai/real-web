// netlify/functions/aleph-check.js
// GET poller for Aleph (KIE) tasks. Finds mp4 URL and backfills Supabase.
// IMPORTANT (Hansora rule): browser never uses service role; this function uses SERVICE ROLE only.
// Works with either:
//  - ?taskId=...&uid=...&run_id=...
//  - ?uid=...&run_id=...   (taskId is resolved from Supabase meta like video-kie-callback.js)

const VERSION = "aleph-check-2025-12-13+runid-compatible";

const KIE_BASE = (process.env.KIE_BASE_URL || "https://api.kie.ai").replace(/\/+$/,"");
const KIE_KEY  = process.env.KIE_API_KEY || "";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL       = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const TABLE_URL    = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/nb_results` : "";

// Accept these result hosts by default. Expand if provider changes.
const ALLOWED = new Set([$1]);
const EXTRA_ALLOWED = (process.env.ALEPH_ALLOWED_RESULT_HOSTS || process.env.ALLOWED_RESULT_HOSTS || "").split(",").map(s=>s.trim()).filter(Boolean);
for (const h of EXTRA_ALLOWED){ ALLOWED.add(h); }

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "GET") return json(405, { ok:false, error:"Use GET", version: VERSION });

  const qs = event.queryStringParameters || {};
  const debug = qs.debug === "1" || qs.debug === "true";

  const uid    = (qs.uid || qs.user_id || "").toString().trim();
  const run_id = (qs.run_id || qs.runId || "").toString().trim();

  // Accept taskId from query when present
  let taskId = (qs.taskId || qs.taskid || qs.task_id || "").toString().trim();

  // If missing taskId, resolve from Supabase row using (uid + run_id), like video-kie-callback
  let idToPatch = null;
  let metaExisting = null;
  try {
    if (!taskId && uid && run_id && SUPABASE_URL && SERVICE_KEY) {
      const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id,meta,result_url,video_url&limit=1`;
      const chk = await fetch(UG_URL + q, { headers: sb() });
      const arr = await chk.json().catch(()=>[]);
      if (Array.isArray(arr) && arr.length) {
        const row = arr[0];
        idToPatch = row.id || null;
        const meta = (row.meta && typeof row.meta === "object") ? row.meta : {};
        metaExisting = meta;
        taskId = (meta.task_id || meta.taskId || meta.taskid || "").toString().trim();

        // If already has a valid stored URL, return it immediately (fast / idempotent)
        const existing = (row.result_url || "").toString();
        // Only treat as cached if it is a finalized result_url (avoid returning the uploaded input video_url)
        if (existing && isAllowed(existing)) {
          const out = { ok:true, status:"done", version: VERSION, uid, run_id, taskId: taskId || null, video_url: existing, cached:true };
          if (debug) out.debug = { idToPatch, from:"supabase_cache", urlHost: host(existing) };
          return json(200, out);
        }
      }
    }
  } catch (e) {
    // If resolution fails, we continue; debug will show it
    if (debug) {
      return json(200, { ok:false, status:"resolve_failed", version: VERSION, error: String(e && e.message ? e.message : e) });
    }
  }

  if (!taskId) {
    return json(400, { ok:false, error:"missing taskId (and could not resolve from Supabase by run_id)", version: VERSION, uid: uid || null, run_id: run_id || null });
  }

  // Query KIE record-info (Aleph)
  const endpoint = `${KIE_BASE}/api/v1/record-info?taskId=${encodeURIComponent(taskId)}`;
  const kr = await fetch(endpoint, { method:"GET", headers: kieHeaders() });

  const raw = await kr.text();
  const body = safeJson(raw);

  // Gather all URLs & pick allowed mp4 first
  const urls = collectUrls(body);
  let video_url = "";
  for (const u of urls) {
    if (!isAllowed(u)) continue;
    if (/\.mp4(\?|#|$)/i.test(u)) { video_url = u; break; }
  }
  if (!video_url) {
    // If there is an allowed URL but no .mp4 extension, accept the first allowed URL
    for (const u of urls) { if (isAllowed(u)) { video_url = u; break; } }
  }

  // If URL not ready yet, return 200 so caller can poll again
  if (!video_url) {
    const out = { ok:false, status:"pending", version: VERSION, taskId: taskId || null };
    if (debug) out.debug = { kie_http: kr.status, urls_found: urls.slice(0, 30) };
    return json(200, out);
  }

  // Persist to Supabase (service role)
  let patched = false, patchError = null;

  try {
    if (SUPABASE_URL && SERVICE_KEY) {
      // If we still don't know id, try finding it now (same query as callback)
      if (!idToPatch && uid && run_id) {
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id&limit=1`;
        const chk = await fetch(UG_URL + q, { headers: sb() });
        const arr = await chk.json().catch(()=>[]);
        idToPatch = Array.isArray(arr) && arr.length ? arr[0].id : null;
      }

      const payload = { result_url: video_url, meta: { ...(metaExisting && typeof metaExisting === "object" ? metaExisting : {}), source:"aleph", run_id, task_id: taskId, status: "done" } };

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
          body: JSON.stringify({
            user_id: uid || "00000000-0000-0000-0000-000000000000",
            provider: "aleph",
            kind: "video",
            prompt: null,
            result_url: video_url,
            meta: { run_id, task_id: taskId, status: "done" }
          })
        });
        patched = ir.ok;
        if (!patched) patchError = `POST ${ir.status}`;
      }
    } else {
      patchError = "Missing SUPABASE_URL or SERVICE_KEY";
    }
  } catch (e) {
    patchError = (e && e.message) ? e.message : String(e);
  }

  // Mirror to nb_results (best-effort, like video-kie-callback)
  try {
    if (TABLE_URL && SERVICE_KEY) {
      await fetch(TABLE_URL, {
        method: "POST",
        headers: { ...sb(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ user_id: uid || "00000000-0000-0000-0000-000000000000", run_id, task_id: taskId, image_url: video_url }])
      });
    }
  } catch {}

  const out = { ok:true, status:"saved", version: VERSION, video_url };
  if (debug) out.debug = { idToPatch, patched, patchError, urlHost: host(video_url), kie_http: kr.status };
  return json(200, out);
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
function kieHeaders(){
  const h = { "Accept": "application/json" };
  if (KIE_KEY) h["Authorization"] = `Bearer ${KIE_KEY}`;
  return h;
}
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }
function safeJson(s){ try{ return JSON.parse(s||"{}"); } catch { return {}; } }
function isUrl(u){ return typeof u === "string" && /^https?:\/\//i.test(u); }
function host(u){ try { return new URL(u).hostname; } catch { return ""; } }
function isAllowed(u){
  if (!isUrl(u)) return false;
  try{
    const uu = new URL(u);
    const h = (uu.hostname || "").toLowerCase();
    const isHttps = uu.protocol === "https:";
    const isMp4 = /\.mp4(\?|#|$)/i.test(uu.pathname || "");
    // Primary allow: known safe hosts
    if (ALLOWED.has(h)) return true;
    // Fallback allow: any HTTPS direct mp4
    if (isHttps && isMp4) return true;
  }catch{}
  return false;
}
function collect(x, out){
  if (!x) return;
  if (typeof x === "string"){
    const m = x.match(/https?:\/\/[^\"\'\s]+/ig);
    if (m) for (const u of m) out.push(u);
    return;
  }
  if (Array.isArray(x)){ for (const v of x) collect(v,out); return; }
  if (typeof x === "object"){ for (const v of Object.values(x)) collect(v,out); return; }
}
function collectUrls(x){
  const a=[]; collect(x,a);
  const seen=new Set(); const out=[];
  for (const u of a){ if(!seen.has(u)){ seen.add(u); out.push(u); } }
  return out;
}
