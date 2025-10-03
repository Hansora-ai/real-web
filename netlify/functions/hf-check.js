// netlify/functions/hf-check.js
// GET poller for Higgsfield DoP jobs. Returns video URL when available
// and backfills Supabase user_generations (result_url + meta).
//
// Env needed:
//  - HF_API_KEY
//  - HF_SECRET
//  - SUPABASE_URL
//  - SUPABASE_SERVICE_ROLE_KEY

const HF_BASE = "https://platform.higgsfield.ai";
const HF_KEY = process.env.HF_API_KEY || "";
const HF_SECRET = process.env.HF_SECRET || "";

const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "GET") return json(405, { ok:false, error:"Use GET" });

  const qs = event.queryStringParameters || {};
  try {
    const job_set_id = (qs.job_set_id || qs.jobSetId || "").toString().trim();
    const uid    = (qs.uid || "").toString().trim();
    const run_id = (qs.run_id || qs.runId || "").toString().trim();

    if (!job_set_id) return json(400, { ok:false, error:"missing job_set_id" });

    const url = `${HF_BASE}/v1/job-sets/${encodeURIComponent(job_set_id)}`;
    const r   = await fetch(url, { headers: { "hf-api-key": HF_KEY, "hf-secret": HF_SECRET } });
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

    // Try to pick results.raw.url first, then results.min.url
    const job = Array.isArray(data?.jobs) && data.jobs.length ? data.jobs[0] : null;
    const rawUrl = job?.results?.raw?.url || "";
    const minUrl = job?.results?.min?.url || "";
    const status = (job?.status || "").toLowerCase(); // queued | processing | completed | failed ?

    const video_url = rawUrl || minUrl || "";

    const out = { ok: !!video_url, status: video_url ? "success" : (status || "pending"), video_url, job_set_id };
    if (!video_url) return json(200, out);

    // Backfill Supabase
    try {
      if (SUPABASE_URL && SERVICE_KEY) {
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
        const chk = await fetch(UG_URL + q, { headers: sb() });
        const arr = await chk.json().catch(()=>[]);
        const idToPatch = Array.isArray(arr) && arr.length ? arr[0].id : null;

        const payload = { result_url: video_url, meta: { run_id, job_set_id, status: "done" } };

        if (idToPatch) {
          await fetch(`${UG_URL}?id=eq.${encodeURIComponent(idToPatch)}`, {
            method: "PATCH",
            headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify(payload)
          });
        } else {
          await fetch(UG_URL, {
            method: "POST",
            headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({ user_id: uid || "00000000-0000-0000-0000-000000000000", provider:"higgsfield", kind:"video", prompt:null, result_url: video_url, meta: { run_id, job_set_id, status: "done" } })
          });
        }
      }
    } catch {}

    return json(200, out);
  } catch (e) {
    return json(200, { ok:false, error: String(e && e.message ? e.message : e) });
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
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }
