// netlify/functions/nb-check.js
// Returns final image when KIE is done OR when the webhook row exists in Supabase.

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE_URL     = `${SUPABASE_URL}/rest/v1/nb_results`;

const KIE_KEY       = process.env.KIE_API_KEY;
const KIE_BASE_MAIN = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/+$/,'');
const KIE_BASES     = Array.from(new Set([KIE_BASE_MAIN, 'https://api.kie.ai', 'https://kieai.redpandaai.co']));

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'GET')     return { statusCode: 405, headers: cors(), body: 'Use GET' };

  const qs     = event.queryStringParameters || {};
  const taskId = qs.taskId || qs.task_id || null;
  const run_id = qs.run_id || null;
  const uid    = qs.uid    || null;

  let status = 'unknown';
  let final  = null;

  // 1) Ask KIE if we have a taskId
  if (taskId && KIE_KEY) {
    for (const base of KIE_BASES) {
      try {
        const r = await fetch(`${base}/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(taskId)}`, {
          headers: { 'Authorization': `Bearer ${KIE_KEY}`, 'Accept': 'application/json' }
        });
        if (r.status === 404) continue;
        const j = await r.json();
        status = String(j?.data?.status || j?.status || j?.state || '').toLowerCase();
        if (['success','succeeded','completed','done'].includes(status)) {
          final = j?.data?.result?.images?.[0]?.url || j?.data?.result_url || j?.image_url || j?.url || null;
          break;
        }
      } catch {}
    }
  }

  // 2) Fallback: look for the webhook row (run_id / task_id / user_id)
  if (!final && (run_id || taskId)) {
    const params = new URLSearchParams();
    if (uid)    params.append('user_id', `eq.${uid}`);
    if (run_id) params.append('run_id',  `eq.${run_id}`);
    if (taskId) params.append('task_id', `eq.${taskId}`);
    params.append('select', 'image_url,created_at');
    params.append('order',  'created_at.desc');
    params.append('limit',  '1');

    try {
      const rr = await fetch(`${TABLE_URL}?${params.toString()}`, {
        headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
      });
      const rows = await rr.json().catch(() => []);
      if (Array.isArray(rows) && rows[0]?.image_url) {
        final = rows[0].image_url;
        status = 'success';
      }
    } catch {}
  }

  if (final) return reply(200, { done: true, status: 'success', url: final });
  return reply(200, { done: false, status, note: 'not ready' });
};

function reply(code, body){ return { statusCode: code, headers: { ...cors(), 'Content-Type':'application/json' }, body: JSON.stringify(body) }; }
function cors(){ return { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization' }; }
