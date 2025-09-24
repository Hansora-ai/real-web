// netlify/functions/poll-nb-result.js
// Poll KIE for a task result (works for Market + non-Market). Returns {done, url?, status, attempts[]}

const API_BASE = process.env.KIE_BASE || "https://api.kie.ai/api/v1";
const API_KEY  = process.env.KIE_API_KEY;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: cors(), body: "Use GET" };
  }

  const taskId = (event.queryStringParameters.taskId || event.queryStringParameters.id || "").trim();
  if (!taskId) {
    return json({ done: false, status: 400, error: "Missing taskId" });
  }

  const headers = {
    "Accept": "application/json",
    ...(API_KEY ? { "Authorization": `Bearer ${API_KEY}` } : {})
  };

  // Try the endpoints KIE uses for Market first, then generic Jobs
  const urls = [
    `${API_BASE}/market/result?taskId=${encodeURIComponent(taskId)}`,
    `${API_BASE}/market/getTaskResult?taskId=${encodeURIComponent(taskId)}`,
    `${API_BASE}/market/status?taskId=${encodeURIComponent(taskId)}`,
    `${API_BASE}/market/getResult?taskId=${encodeURIComponent(taskId)}`,
    `${API_BASE}/jobs/result?taskId=${encodeURIComponent(taskId)}`,
    `${API_BASE}/jobs/getTaskResult?taskId=${encodeURIComponent(taskId)}`,
    `${API_BASE}/jobs/status?taskId=${encodeURIComponent(taskId)}`,
    `${API_BASE}/jobs/getResult?taskId=${encodeURIComponent(taskId)}`,
    `${API_BASE}/jobs/taskStatus?taskId=${encodeURIComponent(taskId)}`
  ];

  const attempts = [];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers, method: "GET" });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }

      attempts.push({ url, status: r.status, ok: r.ok });

      // Normalize status
      const status =
        String(
          data.status ||
          data.state ||
          data.result?.status ||
          data.data?.status ||
          ""
        ).toLowerCase();

      // If there’s a URL, grab it
      const outUrl = await extractUrl(data);
      if (outUrl) return json({ done: true, status: r.status, url: outUrl, taskId, source: url });

      // If endpoint says it’s finished/success, but URL wasn’t in a common field, still return
      if (["success","succeeded","completed","done"].includes(status)) {
        return json({ done: true, status: r.status, url: null, data, taskId, source: url });
      }

      // Keep looping on pending-ish states
      if (["queued","pending","processing","running","inprogress","in_progress"].includes(status)) {
        continue;
      }

      // Unknown but 2xx: keep trying other variants
      if (r.ok) continue;

    } catch (e) {
      attempts.push({ url, error: String(e) });
      continue;
    }
  }

  return json({ done: false, status: 404, url: null, taskId, attempts });
};

// ───────── helpers

async function extractUrl(o) {
  if (!o) return null;
  // Common KIE shapes across providers
  if (typeof o === "string" && /^https?:\/\//i.test(o)) return o;

  const cands = [
    o.url, o.imageUrl, o.outputUrl, o.resultUrl,
    o.data?.url, o.data?.imageUrl, o.data?.outputUrl, o.data?.resultUrl,
    o.result?.url, o.result?.imageUrl, o.result?.outputUrl, o.result?.resultUrl,
  ].filter(Boolean);

  if (cands.find(u => /^https?:\/\//i.test(u))) return cands.find(u => /^https?:\/\//i.test(u));

  const arrs = [
    o.images, o.image_urls, o.outputs, o.output, o.data?.images, o.result?.images
  ].filter(Boolean);

  for (const arr of arrs) {
    if (Array.isArray(arr)) {
      const hit = arr.find(it => it && (it.url || it.imageUrl || it.outputUrl));
      const u = hit?.url || hit?.imageUrl || hit?.outputUrl;
      if (u && /^https?:\/\//i.test(u)) return u;
    }
  }
  return null;
}

function json(obj) {
  return {
    statusCode: 200,
    headers: {
      ...cors(),
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0"
    },
    body: JSON.stringify(obj)
  };
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
