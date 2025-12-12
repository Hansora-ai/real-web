// netlify/functions/video-kie-callback.js
// Robust KIE webhook handler for Runway results.
// - Works whether the user stays on the page or leaves.
// - Extracts mp4 URL from payload, verifies host, and patches Supabase row.
// - If the mp4 isn't present yet, returns 200 (so KIE retries later).
// - Optional `?debug=1` to inspect behavior (no secrets are leaked).

const VERSION = "video-kie-callback-2025-09-28+robust";

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const TABLE_URL     = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/nb_results` : "";

// Accept these result hosts by default. Expand if your provider changes.
const ALLOWED = new Set(["tempfile.aiquickdraw.com","tempfile.redpandaai.co"]);

exports.handler = async (event) => {
  // KIE will POST JSON to us
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { ok:false, error:"Use POST", version: VERSION });

  const qs = event.queryStringParameters || {};
  const debug = qs.debug === "1" || qs.debug === "true";

  let uid  = (qs.uid || "").toString().trim();
  let run_id = (qs.run_id || "").toString().trim();
  let taskId = "";

  try {
    const body = safeJson(event.body);
    // provider payloads vary; gather all URLs & find mp4
    const urls = collectUrls(body);
    let video_url = "";
    for (const u of urls) {
      if (!isAllowed(u)) continue;
      if (/\.mp4(\?|#|$)/i.test(u)) { video_url = u; break; }
    }

    // Try to read taskId from common places
    taskId = body?.data?.taskId || body?.taskId || body?.result?.taskId || body?.id || "";

    // If URL not ready yet, respond 200 so KIE can retry later
    if (!video_url) {
      return json(200, { ok:false, status:"pending", version: VERSION, taskId: taskId || null });
    }

    // If uid/run_id missing from query, try to get from payload (meta passthroughs)
    if (!uid) uid = (body?.data?.uid || body?.uid || "").toString().trim();
    if (!run_id) run_id = (body?.data?.run_id || body?.run_id || "").toString().trim();

    // Persist to Supabase
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
      } else {
        patchError = "Missing SUPABASE_URL or SERVICE_KEY";
      }
    } catch (e) {
      patchError = (e && e.message) ? e.message : String(e);
    }

    // Mirror to nb_results (best-effort)
    try {
      if (TABLE_URL) {
        await fetch(TABLE_URL, {
          method: "POST",
          headers: { ...sb(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify([{ user_id: uid || "00000000-0000-0000-0000-000000000000", run_id, task_id: taskId, image_url: video_url }])
        });
      }
    } catch {}

    const out = { ok:true, status:"saved", version: VERSION };
    if (debug) out.debug = { idToPatch, patched, patchError, urlHost: host(video_url) };
    return json(200, out);

  } catch (e) {
    return json(200, { ok:false, error: String(e && e.message ? e.message : e), version: VERSION });
  }
};

// ---- helpers ----
function cors(){
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
function json(code, obj){
  return { statusCode: code, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }
function safeJson(s){ try{ return JSON.parse(s||"{}"); } catch { return {}; } }
function isUrl(u){ return typeof u === "string" && /^https?:\/\//i.test(u); }
function host(u){ try { return new URL(u).hostname; } catch { return ""; } }
function isAllowed(u){ if (!isUrl(u)) return false; const h = host(u); return ALLOWED.has(h); }
function collect(x, out){ if (!x) return; if (typeof x === "string"){ const m=x.match(/https?:\/\/[^\"\'\s]+/ig); if (m) for (const u of m) out.push(u); return; } if (Array.isArray(x)){ for (const v of x) collect(v,out); return; } if (typeof x === "object"){ for (const v of Object.values(x)) collect(v,out); return; } }
function collectUrls(x){ const a=[]; collect(x,a); const seen=new Set(); const out=[]; for (const u of a){ if(!seen.has(u)){ seen.add(u); out.push(u); } } return out; }
