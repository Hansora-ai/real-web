// netlify/functions/nb-check.js
// Poll KIE for a task result and, on success, return a canonical payload.
// Also backfills Supabase nb_results so the UI's realtime listener fires.
// This version is LIMITED-SCOPE: only touches polling + optional backfill.
// No other logic is changed.

const KIE_BASE = process.env.KIE_BASE_URL || 'https://api.kie.ai';
const KIE_KEY  = process.env.KIE_API_KEY;

const SUPABASE_URL  = process.env.SUPABASE_URL || '';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const ALLOWED_HOSTS = new Set([
  'tempfile.aiquickdraw.com',
  'tempfile.redpandaai.co',
]);

const RESULT_URLS = (id) => ([
  `${KIE_BASE}/api/v1/jobs/getTask?taskId=${encodeURIComponent(id)}`,
  `${KIE_BASE}/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(id)}`,
  `${KIE_BASE}/api/v1/jobs/result?taskId=${encodeURIComponent(id)}`
]);

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
    if (event.httpMethod !== 'GET')     return { statusCode: 405, headers: cors(), body: 'Use GET' };

    const qs = event.queryStringParameters || {};
    const taskId = (qs.taskId || qs.task_id || '').trim();
    if (!taskId) return json(400, { ok:false, error:'missing taskId' });

    const uid    = header(event, 'x-user-id') || qs.uid || null;
    const run_id = (qs.run_id || '').trim() || null;

    let last = null;
    for (const u of RESULT_URLS(taskId)) {
      try {
        const r = await fetch(u, { headers: kieHeaders() });
        const txt = await r.text();
        let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
        last = { url: u, status: r.status, ok: r.ok, data };

        const status = normalizeStatus(data);
        if (status === 'success') {
          const url = firstImageUrl(data);
          if (url && isAllowed(url)) {
            // Fire-and-forget backfill so UI can see it in nb_results via realtime.
            backfillNbResults({ uid, run_id, taskId, image_url: url }).catch(()=>{});
            return json(200, { ok:true, status, url, image_url: url });
          }
          // success but no allowed URL yet -> continue probing other endpoints
        } else if (status === 'failed' || status === 'error') {
          return json(200, { ok:false, status });
        }
      } catch (e) {
        last = { url: u, error: String(e) };
      }
      // small pause between attempts
      await sleep(300);
    }
    return json(200, { ok:false, status:'pending', last });

  } catch (e) {
    return json(500, { ok:false, error: String(e) });
  }
};

// ---------- helpers ----------
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS'
  };
}
function json(code, obj){ return { statusCode: code, headers: { 'Content-Type': 'application/json', ...cors() }, body: JSON.stringify(obj) }; }
function header(event, name){ const v = event.headers?.[name] || event.headers?.[name.toLowerCase()]; return Array.isArray(v) ? v[0] : v; }
function kieHeaders(){ return { 'Authorization': `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' }; }
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
function isUrl(x){ try { new URL(x); return true; } catch { return false; } }
function safeHost(u){ try { return new URL(u).hostname; } catch { return ''; } }
function isAllowed(u){
  if (!isUrl(u)) return false;
  const h = safeHost(u);
  if (!ALLOWED_HOSTS.has(h)) return false;
  // Keep a minimal path gate to avoid user-upload echoes; MJ/NB use "/m/".
  if (!/\/(m|f|workers)\//i.test(u)) return false;
  return true;
}
function normalizeStatus(d){
  const s = String(d?.status || d?.state || d?.result?.status || d?.data?.status || '').toLowerCase();
  if (['success','succeeded','completed','done'].includes(s)) return 'success';
  if (['failed','error'].includes(s)) return 'failed';
  return 'pending';
}
function firstImageUrl(obj){
  // Walk recursively and return the first http(s) URL we find
  let found = null;
  (function walk(x){
    if (found || !x) return;
    if (typeof x === 'string'){
      const m = x.match(/https?:\/\/[^\s"']+/i);
      if (m && isUrl(m[0])) { found = m[0]; return; }
    } else if (Array.isArray(x)) {
      for (const v of x) walk(v);
    } else if (typeof x === 'object') {
      for (const v of Object.values(x)) walk(v);
    }
  })(obj);
  return found;
}
async function backfillNbResults({ uid, run_id, taskId, image_url }){
  if (!uid || !image_url || !SUPABASE_URL || !SERVICE_KEY) return;
  const url = `${SUPABASE_URL}/rest/v1/nb_results`;
  const row = {
    user_id: uid,
    run_id:  run_id || null,
    task_id: taskId || null,
    image_url
  };
  await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(row)
  });
}
