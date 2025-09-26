// netlify/functions/kie-callback.js
// Inserts up to 4 image rows (one per URL) for MidJourney results.
// IMPORTANT CHANGE: even if the webhook contains 1 URL, we still verify via KIE
// (/api/v1/mj/* and /api/v1/jobs/*) to collect the full set of images.

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY; // service role key (NOT anon)
const TABLE_URL     = `${SUPABASE_URL}/rest/v1/nb_results`;
const UG_URL        = `${SUPABASE_URL}/rest/v1/user_generations`;

const KIE_BASE = process.env.KIE_BASE_URL || 'https://api.kie.ai';
const KIE_KEY  = process.env.KIE_API_KEY;

const ALLOWED_HOSTS = new Set([ 'tempfile.aiquickdraw.com', 'tempfile.redpandaai.co' ]);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET')
    return { statusCode: 405, headers: cors(), body: 'Use POST or GET' };

  try {
    const qs = event.queryStringParameters || {};
    const headers = lowerKeys(event.headers || {});
    const ctype = headers['content-type'] || '';

    let bodyRaw = event.body || '';
    if (event.isBase64Encoded) bodyRaw = Buffer.from(bodyRaw, 'base64').toString('utf8');

    let data = null;
    if (event.httpMethod === 'POST' && ctype.includes('application/json')) {
      try { data = JSON.parse(bodyRaw); } catch {}
    }
    if (!data && event.httpMethod === 'POST' && (ctype.includes('application/x-www-form-urlencoded') || ctype.includes('text/plain'))) {
      data = parseFormLike(bodyRaw);
      for (const k of ['data','result','payload']) {
        if (typeof data[k] === 'string') {
          try { data[k] = JSON.parse(data[k]); } catch {}
        }
      }
    }
    if (!data && event.httpMethod === 'POST') {
      try { data = JSON.parse(bodyRaw); } catch { data = { raw: bodyRaw }; }
    }

    let uid     = qs.uid     || get(data, 'meta.uid')      || get(data, 'metadata.uid')      || null;
    const run_id= qs.run_id  || get(data, 'meta.run_id')   || get(data, 'metadata.run_id')   || null;
    const taskId= qs.taskId  || qs.task_id || get(data,'taskId') || get(data,'id') ||
                  get(data,'data.taskId') || get(data,'result.taskId') || null;

    // Fallback uid via user_generations placeholder
    if (!uid && (run_id || taskId)) {
      try {
        const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
        // Try by run_id first
        let q = `${ug}?select=user_id&meta->>run_id=eq.${encodeURIComponent(run_id||'')}&limit=1`;
        let r = await fetch(q, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
        let arr = await r.json().catch(()=>[]);
        if (Array.isArray(arr) && arr[0]?.user_id) {
          uid = arr[0].user_id;
        } else if (taskId) {
          q = `${ug}?select=user_id&meta->>task_id=eq.${encodeURIComponent(taskId)}&limit=1`;
          r = await fetch(q, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
          arr = await r.json().catch(()=>[]);
          if (Array.isArray(arr) && arr[0]?.user_id) uid = arr[0].user_id;
        }
      } catch {}
    }

    // 1) Collect from webhook body (maybe 0 or 1 or 4)
    let urls = pickResultUrls(data, 4);

    // 2) ALWAYS verify via KIE if we have a taskId (to try to get the full 4)
    if (taskId && KIE_KEY) {
      try {
        const verified = await fetchMJorJobsAll(taskId, 4);
        if (verified.length) {
          const merged = new Set([...urls, ...verified]);
          urls = Array.from(merged).slice(0,4);
        }
      } catch {}
    }

    // Filter to allowed final URLs
    const finalUrls = urls.filter(isAllowedFinal).slice(0,4);
    if (!finalUrls.length) {
      return reply(200, { ok:true, saved:false, note:'no allowed final image_url; not inserting', debug:{ taskId: !!taskId, gotFromWebhook: urls.length } });
    }

    // Update user_generations placeholder (first URL + done)
    try {
      if (UG_URL && SERVICE_KEY && uid) {
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id || '')}`;
        const bodyJson = { result_url: finalUrls[0], provider: 'MidJourney', kind: 'image', meta: { run_id, task_id: taskId, status: 'done' } };
        const chk = await fetch(UG_URL + q + '&select=id', { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
        const arr = await chk.json();
        const hasRow = Array.isArray(arr) && arr.length > 0;
        await fetch(UG_URL + (hasRow ? q : ''), {
          method: hasRow ? 'PATCH' : 'POST',
          headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify(hasRow ? bodyJson : { user_id: uid, ...bodyJson })
        });
      }
    } catch (e) { console.warn('[callback] usage upsert failed', e); }

    // Insert ALL images (1..4)
    const rows = finalUrls.map(u => ({
      user_id: uid || '00000000-0000-0000-0000-000000000000',
      run_id:  run_id || null,
      task_id: taskId || null,
      image_url: u
    }));

    const resp = await fetch(TABLE_URL, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify(rows)
    });

    return reply(200, { ok: resp.ok, saved:true, count: rows.length });

  } catch (e) {
    return reply(200, { ok:false, error:String(e) });
  }
};

// ───────── helpers

async function fetchMJorJobsAll(id, limit=4){
  const endpoints = [
    `/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(id)}`,
    `/api/v1/jobs/result?taskId=${encodeURIComponent(id)}`,
    `/api/v1/mj/getTaskResult?taskId=${encodeURIComponent(id)}`,
    `/api/v1/mj/result?taskId=${encodeURIComponent(id)}`,
    `/api/v1/mj/getTask?taskId=${encodeURIComponent(id)}`
  ];
  for (const path of endpoints){
    try{
      const r = await fetch(`${KIE_BASE}${path}`, { headers: { 'Authorization': `Bearer ${KIE_KEY}`, 'Accept': 'application/json' } });
      const j = await r.json();
      const s = String(j?.data?.status || j?.status || j?.state || '').toLowerCase();
      const ok = ['success','succeeded','completed','done'].includes(s) || !!j?.data?.result || Array.isArray(j?.data?.images);
      if (!ok) continue;
      const urls = pickResultUrls(j, limit);
      if (urls.length) return urls;
    }catch{}
  }
  return [];
}

function reply(statusCode, body) {
  return { statusCode, headers: { ...cors(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function cors(){ return {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}; }
function lowerKeys(obj){const out={}; for(const k in obj) out[k.toLowerCase()]=obj[k]; return out;}
function parseFormLike(s){const out={}; try{ for(const part of s.split('&')){ const [k,v]=part.split('='); if(!k) continue; out[decodeURIComponent(k)]=decodeURIComponent(v||''); } }catch{} return out;}
function get(o,p){ try{ return p.split('.').reduce((a,k)=> (a && k in a ? a[k] : undefined), o); } catch { return undefined; } }
function isUrl(u){ return typeof u==='string' && /^https?:\/\//i.test(u); }
function host(u){ try{ return new URL(u).hostname; } catch { return ''; } }
function isAllowedFinal(u){
  if (!isUrl(u)) return false;
  const h = host(u);
  if (!ALLOWED_HOSTS.has(h)) return false;
  if (!/\/(workers|f|m)\//i.test(u)) return false;
  return true;
}

// Collect up to N URLs from common MJ shapes or deep scan
function pickResultUrls(obj, limit=4){
  const acc = [];
  const prefer = [
    get(obj,'result.images'),
    get(obj,'data.result.images'),
    get(obj,'data.images'),
    get(obj,'images')
  ];
  for (const a of prefer) if (Array.isArray(a)) acc.push(...a);
  (function walk(x){
    if (!x) return;
    if (typeof x === 'string'){
      const m = x.match(/https?:\/\/[^\s"']+/i);
      if (m) acc.push(m[0]);
    } else if (Array.isArray(x)){
      for (const v of x) walk(v);
    } else if (typeof x === 'object'){
      for (const v of Object.values(x)) walk(v);
    }
  })(obj);

  const out = [];
  const seen = new Set();
  for (const it of acc){
    const u = typeof it === 'string' ? it : (it && it.url);
    if (u && isAllowedFinal(u) && !seen.has(u)){
      seen.add(u);
      out.push(u);
      if (out.length >= limit) break;
    }
  }
  return out;
}
