// netlify/functions/nb-check.js
// Poll KIE for a task's result using "record-detail" style (like your Make.com HTTP module)

const API_KEY = process.env.KIE_API_KEY;
const BASE = process.env.KIE_BASE_URL || "https://api.kie.ai";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: cors(), body: "Use GET" };
  }

  const taskId =
    event.queryStringParameters?.taskId ||
    event.queryStringParameters?.taskID ||
    event.queryStringParameters?.id ||
    "";

  if (!taskId) {
    return json({ done: false, error: "missing_taskId" });
  }
  if (!API_KEY) {
    return json({ done: false, error: "missing_KIE_API_KEY" });
  }

  // Endpoints to try (most likely first)
  const paths = [
    `/api/v1/market/record-detail?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/jobs/record-detail?taskId=${encodeURIComponent(taskId)}`,
  ];

  const attempts = [];
  for (const p of paths) {
    const url = BASE + p;
    try {
      const r = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Accept": "application/json",
        },
      });

      // Save attempt info for debugging if needed
      attempts.push({ url, status: r.status, ok: r.ok });

      // If 404, try next path
      if (r.status === 404) continue;

      const text = await r.text();
      let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }

      // Normalize status/state like KIE UI does
      const state = String(
        j?.data?.state ||
        j?.data?.status ||
        j?.status ||
        j?.state ||
        ""
      ).toLowerCase();

      const done = ["success", "succeeded", "completed", "done"].includes(state);

      // Best-effort URL extraction
      const urlOut =
        firstUrl(
          j?.data?.result?.images
        ) || firstUrl(
          j?.data?.result
        ) || firstUrl(
          j?.data?.output
        ) || j?.url || j?.imageUrl || null;

      return json({
        done,
        status: state || r.status,
        url: urlOut,
        taskId,
        // Uncomment for debugging:
        // raw: j
      });
    } catch (e) {
      attempts.push({ url: BASE + p, error: String(e) });
    }
  }

  // If we got here, nothing matched (likely the wrong API family or too early)
  return json({
    done: false,
    status: 404,
    url: null,
    taskId,
    attempts,
  });
};

// ───────── helpers ─────────

function firstUrl(maybeArrayOrObj) {
  if (!maybeArrayOrObj) return null;
  if (typeof maybeArrayOrObj === "string" && /^https?:\/\//.test(maybeArrayOrObj)) return maybeArrayOrObj;
  if (Array.isArray(maybeArrayOrObj)) {
    for (const item of maybeArrayOrObj) {
      const u =
        (typeof item === "string" && /^https?:\/\//.test(item) && item) ||
        item?.url ||
        item?.imageUrl ||
        null;
      if (u) return u;
    }
  } else if (typeof maybeArrayOrObj === "object") {
    return (
      maybeArrayOrObj.url ||
      maybeArrayOrObj.imageUrl ||
      firstUrl(maybeArrayOrObj.images) ||
      firstUrl(maybeArrayOrObj.outputs) ||
      null
    );
  }
  return null;
}

function json(obj) {
  return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) };
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-USER-ID, x-user-id",
  };
}
