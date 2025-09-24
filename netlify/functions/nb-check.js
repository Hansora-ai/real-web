// netlify/functions/nb-check.js
// Server-side poller for KIE task results (no webhook, no DB).
// POST { taskId: "..." }  or  GET ?taskId=...

const API_KEY = process.env.KIE_API_KEY;

const RESULT_URLS = [
  (id) => `https://api.kie.ai/api/v1/jobs/getTask?taskId=${id}`,
  (id) => `https://api.kie.ai/api/v1/jobs/getTaskResult?taskId=${id}`,
  (id) => `https://api.kie.ai/api/v1/jobs/result?taskId=${id}`,
];

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };

  try {
    if (!API_KEY) return json(500, { ok:false, error: "Missing KIE_API_KEY" });

    // Accept GET ?taskId=... or POST { taskId }
    let taskId = null;
    if (event.httpMethod === "GET") {
      const u = new URL(event.rawUrl || event.headers.referer || "http://x");
      taskId = u.searchParams.get("taskId");
    } else if (event.httpMethod === "POST") {
      try {
        const body = JSON.parse(event.body || "{}");
        taskId = body.taskId || body.id;
      } catch { /* ignore */ }
    }
    if (!taskId) return json(400, { ok:false, error:"taskId_required" });

    // Try multiple result endpoints; return on first decisive status
    for (const makeUrl of RESULT_URLS) {
      const r = await fetch(makeUrl(taskId), {
        headers: { "Authorization": `Bearer ${API_KEY}` }
      });
      const text = await r.text();
      let js; try { js = JSON.parse(text); } catch { js = { raw: text }; }

      const status = String(
        js.status || js.data?.status || js.result?.status || js.state || ""
      ).toLowerCase();

      const imageUrl = extractUrl(js);

      // Success → return URL immediately
      if (["success","succeeded","completed","done"].includes(status)) {
        return json(200, { ok:true, status, imageUrl, taskId });
      }
      // Failure → surface immediately
      if (["failed","error"].includes(status)) {
        return json(200, { ok:false, status, taskId, details: js });
      }
      // Otherwise keep looping to next endpoint
    }

    // Indeterminate yet; tell client to keep polling
    return json(200, { ok:true, status:"pending", taskId });

  } catch (e) {
    return json(500, { ok:false, error:String(e) });
  }
};

// ───────────────────────── helpers
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
function json(code, obj) {
  return { statusCode: code, headers: { ...cors(), "Content-Type":"application/json" }, body: JSON.stringify(obj) };
}
function extractUrl(o) {
  if (!o) return null;
  if (typeof o === "string" && /^https?:\/\//.test(o)) return o;
  if (o.imageUrl) return o.imageUrl;
  if (o.outputUrl) return o.outputUrl;
  if (o.url) return o.url;
  if (o.data) return extractUrl(o.data);
  if (Array.isArray(o.images) && o.images[0]?.url) return o.images[0].url;
  if (Array.isArray(o.output) && o.output[0]?.url) return o.output[0].url;
  return null;
}
