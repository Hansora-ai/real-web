// netlify/functions/poll-nb-result.js
// Robust poller for KIE job results. Tries multiple endpoints & shapes.

const BASE = process.env.KIE_BASE_URL || "https://api.kie.ai";
const API_KEY = process.env.KIE_API_KEY;

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-USER-ID, x-user-id",
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors(), body: "" };
  }

  try {
    const q = event.queryStringParameters || {};
    const body = event.body ? JSON.parse(event.body) : {};
    const taskId =
      q.taskId || q.taskID || q.id || body.taskId || body.id || q.jobId || body.jobId;

    if (!taskId) {
      return json(400, { error: "taskId required" });
    }
    if (!API_KEY) {
      return json(500, { error: "Missing KIE_API_KEY env" });
    }

    // Try a set of plausible endpoints (paths + methods).
    const endpoints = [
      { m: "POST", p: "/api/v1/jobs/status",        b: { taskId } },
      { m: "GET",  p: `/api/v1/jobs/status?taskId=${encodeURIComponent(taskId)}` },
      { m: "GET",  p: `/api/v1/jobs/result?taskId=${encodeURIComponent(taskId)}` },
      { m: "POST", p: "/api/v1/jobs/result",        b: { taskId } },
      { m: "GET",  p: `/api/v1/jobs/getResult?taskId=${encodeURIComponent(taskId)}` },
      { m: "GET",  p: `/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(taskId)}` },
      { m: "GET",  p: `/api/v1/jobs/taskStatus?taskId=${encodeURIComponent(taskId)}` },
    ];

    const attempts = [];
    for (const e of endpoints) {
      const url = BASE.replace(/\/$/, "") + e.p;
      try {
        const r = await fetch(url, {
          method: e.m,
          headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Accept": "application/json",
            ...(e.m === "POST" ? { "Content-Type": "application/json" } : {}),
          },
          body: e.m === "POST" ? JSON.stringify(e.b || {}) : undefined,
        });

        const text = await r.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { raw: text }; }

        attempts.push({ url, method: e.m, status: r.status, ok: r.ok, data: preview(data) });

        // Parse status from any known shape
        const status =
          (data.status || data.state || data.jobStatus || data.data?.status || data.result?.status || "").toString().toLowerCase();

        // Try to extract an image URL if it looks done
        if (["success", "succeeded", "completed", "done", "ok"].includes(status) || r.ok && maybeHasUrl(data)) {
          const imageUrl = await extractUrl(data);
          if (imageUrl) {
            return json(200, {
              done: true,
              status: status || "success",
              url: imageUrl,
              taskId,
              via: { url, method: e.m, status: r.status },
            });
          }
        }

        // If explicitly failed
        if (["failed", "error"].includes(status)) {
          return json(200, { done: true, status, url: null, taskId, raw: preview(data) });
        }

        // Otherwise keep trying next endpoint
      } catch (err) {
        attempts.push({ url, method: e.m, error: String(err) });
      }
    }

    // Nothing worked yet; report last attempt briefly
    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        done: false,
        status: 404,
        url: null,
        taskId,
        attempts,
      }),
    };

  } catch (e) {
    return json(500, { error: String(e) });
  }
};

// ───────── helpers

function json(code, obj) {
  return { statusCode: code, headers: cors(), body: JSON.stringify(obj) };
}

function preview(obj) {
  try {
    const s = JSON.stringify(obj);
    return s.length > 200 ? s.slice(0, 200) + "…" : s;
  } catch { return String(obj); }
}

function maybeHasUrl(o) {
  return !!(
    (typeof o === "string" && /^https?:\/\//.test(o)) ||
    o?.imageUrl || o?.outputUrl || o?.url ||
    o?.data?.imageUrl || o?.data?.outputUrl || o?.data?.url ||
    (Array.isArray(o?.images) && o.images[0]?.url) ||
    (Array.isArray(o?.output) && o.output[0]?.url) ||
    o?.result?.imageUrl || (Array.isArray(o?.result?.output) && o.result.output[0]?.url)
  );
}

async function extractUrl(o) {
  if (!o) return null;
  if (typeof o === "string" && /^https?:\/\//.test(o)) return o;
  const paths = [
    "imageUrl", "outputUrl", "url",
    "data.imageUrl", "data.outputUrl", "data.url",
    "result.imageUrl",
  ];
  for (const p of paths) {
    const v = get(o, p);
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  const arrays = [
    "images", "output", "data.images", "data.output", "result.images", "result.output",
  ];
  for (const p of arrays) {
    const a = get(o, p);
    if (Array.isArray(a) && a[0]?.url && /^https?:\/\//.test(a[0].url)) return a[0].url;
  }
  return null;
}

function get(obj, path) {
  return path.split(".").reduce((a,k)=> (a && a[k] != null ? a[k] : undefined), obj);
}
