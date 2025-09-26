// netlify/functions/nb-check.js
// Surgical fix: probe both /jobs/* and /mj/*, return ALL images, and backfill ALL rows.
// No interface changes. Adds "images" array while keeping "image_url".

const KIE_BASE = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/+$/,'');
const KIE_KEY  = process.env.KIE_API_KEY;

const SUPABASE_URL  = process.env.SUPABASE_URL || '';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const ALLOWED_HOSTS = new Set([ 'tempfile.aiquickdraw.com', 'tempfile.redpandaai.co' ]);

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
    if (event.httpMethod !== 'GET')     return { statusCode: 405, headers: cors(), body: 'Use GET' };

    const qs = event.queryStringParameters || {};
    const taskId = (qs.taskId || qs.task_id || '').trim();
    if (!taskId) return json(400, { ok:false, error:'missing taskId' });

    const uid    = header(event, 'x-user-id') || qs.uid || null;
    const run_id = (qs.run_id || '').trim() || null;

    // Fetch once across endpoints (the page will poll repeatedly)
    const probe = await fetchAll(taskId);
    if (!probe.ok) {
      return json(200, { ok:false, status: probe.status || 'pending' });
    }

    const images = firstImageUrls(probe.data, 4);
    if (!images.length) {
      return json(200, { ok:false, status:'pending' });
    }

    // Backfill ALL (up to 4) rows so Realtime/subscribe can render each
    await backfillAll({ uid, run_id, taskId, images }).catch(()=>{});

    return json(200, { ok:true, status:'success', image_url: images[0], images });

  } catch (e) {
    return json(200, { ok:false, error: String(e) });
  }
};

// ---------- helpers ----------
function cors(){ return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' }; }
function json(code, obj){ return { statusCode: code, headers: { 'Content-Type': 'application/json', ...cors() }, body: JSON.stringify(obj) }; }
function header(event, name){ const v = event.headers?.[name] || event.headers?.[name.toLowerCase()]; return Array.isArray(v) ? v[0] : v; }
function kieHeaders(){ return { 'Authorization': `Bearer ${KIE_KEY}`, 'Accept': 'application/json' }; }

async function fetchAll(taskId){
  const endpoints = [
    // Prefer MJ endpoints first
    `${KIE_BASE}/api/v1/mj/getTaskResult?taskId=${encodeURIComponent(taskId)}`,
    `${KIE_BASE}/api/v1/mj/result?taskId=${encodeURIComponent(taskId)}`,
    `${KIE_BASE}/api/v1/mj/getTask?taskId=${encodeURIComponent(taskId)}`,
    // Jobs fallbacks
    `${KIE_BASE}/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(taskId)}`,
    `${KIE_BASE}/api/v1/jobs/result?taskId=${encodeURIComponent(taskId)}`
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { headers: kieHeaders() });
      const txt = await r.text();
      let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
      const status = normalizeStatus(data);
      if (status === 'success') return { ok:true, data, status };
      if (status === 'failed' || status === 'error') return { ok:false, status };
    } catch {}
  }
  return { ok:false, status:'pending' };
}

function normalizeStatus(d){
  const s = String(d?.status || d?.state || d?.result?.status || d?.data?.status || '').toLowerCase();
  if (['success','succeeded','completed','done'].includes(s)) return 'success';
  if (['failed','error'].includes(s)) return 'failed';
  return 'pending';
}

function isUrl(x){ try { new URL(x); return true; } catch { return false; } }
function host(u){ try { return new URL(u).hostname; } catch { return ''; } }
function allowed(u){
  if (!isUrl(u)) return false;
  const h = host(u);
  if (!ALLOWED_HOSTS.has(h)) return false;
  if (!/\/(m|f|workers)\//i.test(u)) return false;
  return true;
}

function firstImageUrls(obj, limit=4){
  let acc = [];
  const cand = obj?.data?.result?.images || obj?.result?.images || obj?.data?.images || obj?.images;
  if (Array.isArray(cand)) acc = acc.concat(cand);

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

  const out = [];
  const seen = new Set();
  for (const it of acc){
    const u = typeof it === 'string' ? it : (it && it.url);
    if (u && allowed(u) && !seen.has(u)){
      seen.add(u);
      out.push(u);
      if (out.length >= limit) break;
    }
  }
  return out;
}

async function backfillAll({ uid, run_id, taskId, images }){
  if (!SUPABASE_URL || !SERVICE_KEY || !images?.length) return;
  const rows = images.slice(0,4).map(u => ({
    user_id: uid || '00000000-0000-0000-0000-000000000000',
    run_id:  run_id || null,
    task_id: taskId || null,
    image_url: u
  }));
  await fetch(`${SUPABASE_URL}/rest/v1/nb_results`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(rows)
  });
}
