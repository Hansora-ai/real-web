// Poll KIE for a task's result (record-detail family first, then jobs/getTask* fallbacks)

const API_KEY = process.env.KIE_API_KEY;
const BASE = process.env.KIE_BASE_URL || "https://api.kie.ai";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  if (event.httpMethod !== "GET")     return { statusCode: 405, headers: cors(), body: "Use GET" };

  const qs = event.queryStringParameters || {};
  const taskId = qs.taskId || qs.task_id || qs.taskID || qs.id || "";

  if (!taskId)  return json({ done:false, error:"missing_taskId" });
  if (!API_KEY) return json({ done:false, error:"missing_KIE_API_KEY" });

  // Try multiple endpoint families (prevents 404 when APIs differ)
  const paths = [
    `/api/v1/market/record-detail?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/jobs/record-detail?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/jobs/getTask?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/jobs/result?taskId=${encodeURIComponent(taskId)}`
  ];

  const attempts = [];
  for (const p of paths) {
    const url = BASE + p;
    try {
      const r = await fetch(url, { method:"GET", headers:{ "Authorization":`Bearer ${API_KEY}`, "Accept":"application/json" }});
      attempts.push({ url, status:r.status, ok:r.ok });

      if (r.status === 404) continue;

      const text = await r.text();
      let j; try { j = JSON.parse(text); } catch { j = { raw:text }; }

      const state = String(
        j?.data?.state || j?.data?.status || j?.status || j?.state || ""
      ).toLowerCase();

      const done = ["success","succeeded","completed","done"].includes(state);

      const urlOut =
        firstUrl(j?.data?.result?.images) ||
        firstUrl(j?.data?.result) ||
        firstUrl(j?.data?.output) ||
        j?.url || j?.imageUrl || null;

      return json({ done, status: state || r.status, url: urlOut, taskId });
    } catch (e) {
      attempts.push({ url, error:String(e) });
    }
  }

  return json({ done:false, status:404, url:null, taskId, attempts });
};

// ───────── helpers ─────────
function firstUrl(m){ if(!m) return null;
  if (typeof m==='string' && /^https?:\/\//.test(m)) return m;
  if (Array.isArray(m)){ for (const it of m){ const u=(typeof it==='string'&&/^https?:\/\//.test(it)&&it)||it?.url||it?.imageUrl||null; if(u) return u; } }
  else if (typeof m==='object'){ return m.url||m.imageUrl||firstUrl(m.images)||firstUrl(m.outputs)||null; }
  return null;
}
function json(o){ return { statusCode:200, headers:cors(), body:JSON.stringify(o) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"GET, OPTIONS", "Access-Control-Allow-Headers":"Authorization, Content-Type, X-USER-ID, x-user-id" }; }
