// Poll KIE for task result (NO webhook).
// GET /.netlify/functions/poll-nb-result?taskId=...  -> { done, status, url? }

const API_KEY = process.env.KIE_API_KEY;
// If KIE uses a different path, set KIE_STATUS_URL in Netlify env.
const STATUS_URL = process.env.KIE_STATUS_URL || "https://api.kie.ai/api/v1/jobs/status";

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return resp(204, "");
    if (event.httpMethod !== "GET") return resp(405, "Use GET");

    const q = event.queryStringParameters || {};
    const taskId = q.taskId || q.id;
    if (!taskId) return json({ done:false, error:"taskId_required" });

    const r = await fetch(`${STATUS_URL}?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${API_KEY}` }
    });
    const text = await r.text();
    let js; try { js = JSON.parse(text); } catch { js = { raw:text }; }

    const status =
      js.status ||
      js.data?.status ||
      js.data?.task?.status ||
      js.result?.status ||
      js.state ||
      null;

    const url = findImageUrl(js);
    const done = hasSucceeded(status) || !!url;

    return json({ done, status, url, taskId, // raw only when not done (for debugging in Network tab)
                  raw: done ? undefined : js });
  } catch (e) {
    return json({ done:false, error:String(e) });
  }
};

// ——— helpers ———
function resp(code, body, extra={}) {
  return {
    statusCode: code,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      ...extra
    },
    body
  };
}
function json(obj, code=200) { return resp(code, JSON.stringify(obj), {"Content-Type":"application/json"}); }

function hasSucceeded(s) {
  const v = String(s || "").toLowerCase();
  return ["succeeded","success","completed","finished","done"].includes(v);
}

// Try hard to locate an image URL regardless of KIE’s shape
function findImageUrl(o) {
  if (!o) return null;
  // common shapes
  if (typeof o === "string" && /^https?:\/\//.test(o)) return o;
  if (o.url && /^https?:\/\//.test(o.url)) return o.url;
  if (o.image_url && /^https?:\/\//.test(o.image_url)) return o.image_url;
  if (o.outputUrl && /^https?:\/\//.test(o.outputUrl)) return o.outputUrl;
  if (o.imageUrl && /^https?:\/\//.test(o.imageUrl)) return o.imageUrl;
  if (Array.isArray(o.output) && o.output[0]) return findImageUrl(o.output[0]);
  if (Array.isArray(o.images) && o.images[0]) return findImageUrl(o.images[0]);
  if (o.data) return findImageUrl(o.data);
  if (o.result) return findImageUrl(o.result);
  // deep scan for first http(s) image-ish URL
  const s = JSON.stringify(o);
  const m = s.match(/https?:\/\/[^\s"']+\.(?:png|jpg|jpeg|webp)/i);
  return m ? m[0] : null;
}
