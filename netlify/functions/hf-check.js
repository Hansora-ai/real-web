// netlify/functions/hf-check.js
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
  const job_set_id = String(qs.job_set_id || qs.jobSetId || "").trim();
  const uid    = String(qs.uid || "").trim();
  const run_id = String(qs.run_id || qs.runId || "").trim();
  if (!job_set_id) return json(400, { ok:false, error:"missing job_set_id" });

  const url = `${HF_BASE}/v1/job-sets/${encodeURIComponent(job_set_id)}`;
  const r = await fetch(url, { headers: { "hf-api-key": HF_KEY, "hf-secret": HF_SECRET } });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }

  const job = Array.isArray(data?.jobs) && data.jobs.length ? data.jobs[0] : null;
  const rawUrl = job?.results?.raw?.url || "";
  const minUrl = job?.results?.min?.url || "";
  const status = (job?.status || "").toLowerCase();
  const video_url = rawUrl || minUrl || "";

  if (!video_url) return json(200, { ok:false, status: status || "pending", data });

  try{
    if (UG_URL && SERVICE_KEY){
      const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
      const chk = await fetch(UG_URL + q, { headers: sb() });
      const arr = await chk.json().catch(()=>[]);
      const id = Array.isArray(arr) && arr.length ? arr[0].id : null;
      const payload = { result_url: video_url, meta: { run_id, job_set_id, status: "done" } };
      if (id){
        await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
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
  }catch{}

  return json(200, { ok:true, status:"success", video_url, job_set_id });
};

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
