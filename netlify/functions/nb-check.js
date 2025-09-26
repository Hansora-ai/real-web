
// netlify/functions/nb-check.js
// Backward‑compatible: returns { ok, status, image_url } AND, when possible, { images: [...] } (up to 4).

const KIE_BASE = process.env.KIE_BASE_URL || 'https://api.kie.ai';
const KIE_KEY  = process.env.KIE_API_KEY;

const SUPABASE_URL  = process.env.SUPABASE_URL || '';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const ALLOWED_HOSTS = new Set([ 'tempfile.aiquickdraw.com', 'tempfile.redpandaai.co' ]);

const RESULT_URLS = (id) => ([
  // generic jobs endpoints
  `${KIE_BASE}/api/v1/jobs/getTask?taskId=${encodeURIComponent(id)}`,
  `${KIE_BASE}/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(id)}`,
  `${KIE_BASE}/api/v1/jobs/result?taskId=${encodeURIComponent(id)}`,
  // MidJourney-specific mirrors
  `${KIE_BASE}/api/v1/mj/getTask?taskId=${encodeURIComponent(id)}`,
  `${KIE_BASE}/api/v1/mj/getTaskResult?taskId=${encodeURIComponent(id)}`,
  `${KIE_BASE}/api/v1/mj/result?taskId=${encodeURIComponent(id)}`
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
        last = { url: u, status: r.status, ok: r.ok };

        const status = normalizeStatus(data);
        if (status === 'success') {
          const all = firstImageUrls(data, 4);
          if (all.length) {
            // backfill at least one row so realtime fires
            backfillNbResults({ uid, run_id, taskId, image_url: all[0] }).catch(()=>{});
            return json(200, { ok:true, status, image_url: all[0], images: all });
          }
          return json(200, { ok:true, status, image_url: null, images: [] });
        } else if (status === 'failed' || status === 'error') {
          return json(200, { ok:false, status });
        }
      } catch (e) {
        last = { url: u, error: String(e) };
      }
      await sleep(250);
    }
    return json(200, { ok:false, status:'pending', last });

  } catch (e) {
    return json(500, { ok:false, error: String(e) });
  }
};

// ---------- helpers ----------
function cors(){ return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' }; }
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
  if (!/\/(m|f|workers)\//i.test(u)) return false;
  return true;
}
function normalizeStatus(d){
  const s = String(d?.status || d?.state || d?.result?.status || d?.data?.status || '').toLowerCase();
  if (['success','succeeded','completed','done'].includes(s)) return 'success';
  if (['failed','error'].includes(s)) return 'failed';
  return 'pending';
}
function firstImageUrls(obj, limit=4){
  // Prefer typical shapes, else deep scan arrays too
  let acc = [];
  const cand = obj?.data?.result?.images || obj?.result?.images || obj?.data?.images || obj?.images;
  if (Array.isArray(cand)) acc = acc.concat(cand);

  // Deep scan fallbacks
  (function walk(x){
    if (!x) return;
    if (typeof x === 'string'){
      const m = x.match(/https?:\/\/[^\s"']+/i);
      if (m) acc.push(m[0]);
    } else if (Array.isArray(x)) {
      for (const v of x) walk(v);
    } else if (typeof x === 'object') {
      for (const v of Object.values(x)) walk(v);
    }
  })(obj);

  // Dedup, filter, cap
  const seen = new Set();
  const out = [];
  for (const u of acc){
    if (typeof u === 'string' && isAllowed(u) && !seen.has(u)){
      seen.add(u);
      out.push(u);
      if (out.length >= limit) break;
    } else if (u && typeof u === 'object' && isAllowed(u.url) && !seen.has(u.url)){
      seen.add(u.url);
      out.push(u.url);
      if (out.length >= limit) break;
    }
  }
  return out;
}
async function backfillNbResults({ uid, run_id, taskId, image_url }){
  if (!image_url || !SUPABASE_URL || !SERVICE_KEY) return;
  const url = `${SUPABASE_URL}/rest/v1/nb_results`;
  const row = {
    user_id: uid || '00000000-0000-0000-0000-000000000000',
    run_id:  run_id || null,
    task_id: taskId || null,
    image_url
  };
  await fetch(url, {
    method: 'POST',
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(row)
  });
}
