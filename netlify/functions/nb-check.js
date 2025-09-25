// Poll KIE for a task result and return a clean, final image URL.

const KIE_BASE = process.env.KIE_BASE_URL || 'https://api.kie.ai';
const KIE_KEY  = process.env.KIE_API_KEY;

// Only accept real generated-image hosts (avoid user-upload echoes)
const ALLOWED_HOSTS = new Set([
  'tempfile.aiquickdraw.com',
  'tempfile.redpandaai.co',
]);

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const taskId = qs.taskId || qs.task_id || '';

    if (!taskId) return json(400, { ok:false, error:'missing taskId' });
    if (!KIE_KEY) return json(500, { ok:false, error:'missing KIE_API_KEY' });

    const r = await fetch(`${KIE_BASE}/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(taskId)}`, {
      headers: { 'Authorization': `Bearer ${KIE_KEY}`, 'Accept': 'application/json' }
    });
    if (!r.ok) {
      return json(200, { done:false, status:r.status, ok:false });
    }
    const j = await r.json();

    const status = String(j?.data?.status || j?.status || j?.state || '').toLowerCase();
    const url =
      j?.data?.result?.images?.[0]?.url ||
      j?.data?.result_url ||
      j?.image_url ||
      j?.url ||
      null;

    if (!['success','succeeded','completed','done'].includes(status)) {
      return json(200, { done:false, status: status || 'unknown', note:'not ready' });
    }

    if (!url) return json(200, { done:false, status:'success', note:'no url in payload' });

    const host = safeHost(url);
    const looksFinal = host && ALLOWED_HOSTS.has(host) && /\/(workers|m)\/i.test(url);
    if (!looksFinal) {
      return json(200, { done:false, status:'success', note:'final url not allowed', url });
    }

    return json(200, { done:true, status:'success', url });
  } catch (e) {
    return json(200, { done:false, error:String(e) });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(body)
  };
}
function safeHost(u){ try{ return new URL(u).hostname; } catch { return ''; } }
