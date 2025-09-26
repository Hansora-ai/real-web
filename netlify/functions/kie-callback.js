// netlify/functions/kie-callback.js (MJ-aware verification)
// Accepts GET/POST webhooks from KIE, stores final image URL into nb_results.
// PATCH: add MidJourney verification endpoints in addition to /jobs/*

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

    // Fallback uid: resolve from placeholder user_generations
    if (!uid && (run_id || taskId)) {
      try {
        const base = process.env.SUPABASE_URL;
        const svc  = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (base && svc) {
          const ug = `${base}/rest/v1/user_generations`;
          // Try by run_id first
          let q = `${ug}?select=user_id&meta->>run_id=eq.${encodeURIComponent(run_id||'')}&limit=1`;
          let r = await fetch(q, { headers: { 'apikey': svc, 'Authorization': `Bearer ${svc}` } });
          let arr = await r.json().catch(()=>[]);
          if (Array.isArray(arr) && arr[0]?.user_id) {
            uid = arr[0].user_id;
          } else if (taskId) {
            q = `${ug}?select=user_id&meta->>task_id=eq.${encodeURIComponent(taskId)}&limit=1`;
            r = await fetch(q, { headers: { 'apikey': svc, 'Authorization': `Bearer ${svc}` } });
            arr = await r.json().catch(()=>[]);
            if (Array.isArray(arr) && arr[0]?.user_id) uid = arr[0].user_id;
          }
        }
      } catch {}
    }

    const statusStr = String(
      get(data,'status') || get(data,'state') ||
      get(data,'data.status') || get(data,'data.state') || ''
    ).toLowerCase();

    // Prefer final URL from payload
    let url = pickResultUrl(data) || firstUrlFromQuery(qs);

    // If status/URL are unclear, verify with KIE.
    const looksFinal = isAllowedFinal(url);
    let verifiedFinal = false;
    if ((!looksFinal) && taskId && KIE_KEY) {
      try {
        const { url: verifiedUrl, ok } = await fetchMJorJobs(taskId);
        if (ok && verifiedUrl) { url = verifiedUrl; verifiedFinal = true; }
      } catch {}
    }

    if (!(isAllowedFinal(url) || (verifiedFinal && typeof url==='string' && /^https?:\/\//i.test(url)))) {
      return reply(200, { ok:true, saved:false, note:'no allowed final image_url; not inserting', debug:{ taskId: !!taskId, status: statusStr || 'unknown', url } });
    }

    const row = {
      user_id: uid || '00000000-0000-0000-0000-000000000000',
      run_id:  run_id || null,
      task_id: taskId || null,
      image_url: url
    };

    // Update user_generations placeholder
    try {
      if (UG_URL && SERVICE_KEY && uid) {
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id || '')}`;
        const bodyJson = { result_url: url, provider: 'MidJourney', kind: 'image', meta: { run_id, task_id: taskId, status: 'done' } };
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

    const resp = await fetch(TABLE_URL, {
      method: 'POST',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify(row)
    });

    return reply(200, { ok: resp.ok, saved:true, insert_status: resp.status, row });

  } catch (e) {
    return reply(200, { ok:false, error:String(e) });
  }
};

// ───────── helpers

async function fetchMJorJobs(id){
  // Try both jobs/* and mj/* result endpoints for compatibility
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
      const u = pickResultUrl(j) || (Array.isArray(j?.data?.images) ? j.data.images[0] : null);
      if (ok && u) return { ok:true, url:u, path };
    }catch{}
  }
  return { ok:false, url:null };
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

// Prefer result subtree and known result fields; also support arrays
function pickResultUrl(obj){
  const prefer = [
    get(obj,'result.images.0.url'),
    get(obj,'data.result.images.0.url'),
    get(obj,'data.result_url'),
    get(obj,'result_url'),
    get(obj,'image_url'),
    get(obj,'url')
  ];
  for (const u of prefer) { if (isUrl(u) && /\/(workers|f|m)\//i.test(u)) return u; }

  // Common MJ shapes: array of strings under data.images or result.images
  const arrStringCandidates = [
    get(obj, 'data.images'), get(obj, 'result.images'), get(obj, 'images')
  ];
  for (const arr of arrStringCandidates) {
    if (Array.isArray(arr)) {
      for (const s of arr) {
        if (typeof s === 'string' && isUrl(s) && /\/(workers|f|m)\//i.test(s)) return s;
        if (s && typeof s === 'object' && isUrl(s.url) && /\/(workers|f|m)\//i.test(s.url)) return s.url;
      }
    }
  }

  // Deep scan fallback
  let found=null;
  (function walk(x){
    if (found || !x) return;
    if (typeof x === 'string'){
      const m = x.match(/https?:\/\/[^\s"']+/i);
      if (m && isUrl(m[0]) && /\/(workers|f|m)\//i.test(m[0])) { found = m[0]; return; }
    } else if (Array.isArray(x)){
      for (const v of x) walk(v);
    } else if (typeof x === 'object'){
      for (const v of Object.values(x)) walk(v);
    }
  })(obj);
  return found;
}
function firstUrlFromQuery(qs){
  if (!qs) return null;
  for (const v of Object.values(qs)){
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
  }
  return null;
}
