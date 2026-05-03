// netlify/functions/kie-callback.js
// FINAL drop-in: always inserts up to 4 MidJourney image URLs.
// - Verifies via KIE when taskId is known
// - If verification/webhook only yields one URL ending with _0_0, deduce _0_1/_0_2/_0_3
// - Inserts ALL urls into nb_results with merge-duplicates
// - Updates user_generations with the first URL
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, KIE_API_KEY, (optional) KIE_BASE_URL

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE_URL     = `${SUPABASE_URL}/rest/v1/nb_results`;
const UG_URL        = `${SUPABASE_URL}/rest/v1/user_generations`;

const KIE_BASE = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/+$/,''); // no trailing slash
const KIE_KEY  = process.env.KIE_API_KEY;

const ALLOWED_HOSTS = new Set([ 'tempfile.aiquickdraw.com', 'tempfile.redpandaai.co' ]);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: cors(), body: 'Use POST or GET' };
  }

  try {
    const qs = event.queryStringParameters || {};
    const headers = lowerKeys(event.headers || {});
    const ctype = headers['content-type'] || '';

    let bodyRaw = event.body || '';
    if (event.isBase64Encoded) bodyRaw = Buffer.from(bodyRaw, 'base64').toString('utf8');

    let data = null;
    // JSON
    if (event.httpMethod === 'POST' && ctype.includes('application/json')) {
      try { data = JSON.parse(bodyRaw); } catch {}
    }
    // Form / text
    if (!data && event.httpMethod === 'POST' && (ctype.includes('application/x-www-form-urlencoded') || ctype.includes('text/plain'))) {
      data = parseFormLike(bodyRaw);
      for (const k of ['data','result','payload']) {
        if (typeof data[k] === 'string') {
          try { data[k] = JSON.parse(data[k]); } catch {}
        }
      }
    }
    // Fallback raw → JSON
    if (!data && event.httpMethod === 'POST') {
      try { data = JSON.parse(bodyRaw); } catch { data = { raw: bodyRaw }; }
    }

    // Identify user/run/task
    let uid     = qs.uid     || get(data, 'meta.uid')      || get(data, 'metadata.uid')      || null;
    let run_id  = qs.run_id  || get(data, 'meta.run_id')   || get(data, 'metadata.run_id')   || null;
    let taskId  = qs.taskId  || qs.task_id || get(data,'taskId') || get(data,'id') ||
                  get(data,'data.taskId') || get(data,'result.taskId') || null;

    // Fallbacks from Supabase (ensure we can verify and write rows visible to user)
    if ((!uid || !taskId) && (run_id || taskId)) {
      try {
        const q = run_id
          ? `${UG_URL}?select=user_id,meta&meta->>run_id=eq.${encodeURIComponent(run_id)}&limit=1`
          : `${UG_URL}?select=user_id,meta&meta->>task_id=eq.${encodeURIComponent(taskId)}&limit=1`;
        const r = await fetch(q, { headers: sb() });
        const arr = await r.json().catch(()=>[]);
        if (Array.isArray(arr) && arr[0]) {
          if (!uid && arr[0].user_id) uid = arr[0].user_id;
          if (!taskId && arr[0]?.meta?.task_id) taskId = arr[0].meta.task_id;
          if (!run_id && arr[0]?.meta?.run_id) run_id = arr[0].meta.run_id;
        }
      } catch {}
    }

    // 1) Collect URLs from webhook body
    let urls = pickResultUrls(data, 4);

    // 2) Verify via KIE to get full set when taskId is known
    if (taskId && KIE_KEY) {
      try {
        const verified = await fetchMJorJobsAll(taskId, 4);
        if (verified.length) urls = Array.from(new Set([...urls, ...verified])).slice(0,4);
      } catch {}
    }

    // 3) Filter allowed
    let finalUrls = urls.filter(isAllowedFinal).slice(0,4);

    // 4) Fallback: if only one allowed URL and it ends with _0_0, deduce _1/_2/_3
    if (finalUrls.length === 1) {
      const derived = deduceMJ4(finalUrls[0]);
      if (derived.length > 1) finalUrls = derived;
    }

    if (!finalUrls.length) {
      const failed = isFailureStatus(data) || (taskId && KIE_KEY ? await fetchKieFailure(taskId).catch(()=>null) : null);
      if (failed) {
        const fail = await markFailedAndRefund({ uid, run_id, taskId, reason: extractError(failed === true ? data : failed) }).catch((e)=>({ error:String(e) }));
        return reply(200, {
          ok:true,
