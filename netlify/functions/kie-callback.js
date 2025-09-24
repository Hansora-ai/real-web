// netlify/functions/kie-callback.js
// Handles KIE -> webhook callback and stores the result in Supabase nb_results
// Expects query params ?uid=...&run_id=...

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY; // service role key (NOT anon)
const TABLE_URL     = `${SUPABASE_URL}/rest/v1/nb_results`;

const KIE_BASE_MAIN = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/+$/,'');
const KIE_KEY       = process.env.KIE_API_KEY;
// Try multiple bases in case an account is served from a different ingress
const KIE_BASES     = Array.from(new Set([KIE_BASE_MAIN, 'https://api.kie.ai', 'https://kieai.redpandaai.co']));

// Accept only these result CDNs (your account uses these)
const ALLOWED_RESULT_HOSTS = [
  'tempfile.aiquickdraw.com',
  'tempfile.redpandaai.co',
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: cors(), body: 'Use POST' };

  try {
    const qs = event.queryStringParameters || {};
    const headers = lowerKeys(event.headers || {});
    const ctype = headers['content-type'] || '';

    let bodyRaw = event.body || '';
    if (event.isBase64Encoded) bodyRaw = Buffer.from(bodyRaw, 'base64').toString('utf8');

    let data = null;
    if (ctype.includes('application/json')) {
      try { data = JSON.parse(bodyRaw); } catch {}
    }
    if (!data && (ctype.includes('application/x-www-form-urlencoded') || ctype.includes('text/plain'))) {
      data = parseFormLike(bodyRaw);
      for (const k of ['data','result','payload']) {
        if (typeof data[k] === 'string') {
          try { data[k] = JSON.parse(data[k]); } catch {}
        }
      }
    }
    if (!data) {
      try { data = JSON.parse(bodyRaw); } catch { data = { raw: bodyRaw }; }
    }

    // ids
    const uid    = qs.uid    || get(data, 'meta.uid')      || get(data, 'metadata.uid')      || null;
    const run_id = qs.run_id || get(data, 'meta.run_id')   || get(data, 'metadata.run_id')   || null;
    const taskId = qs.taskId || qs.task_id || get(data,'taskId') || get(data,'id') ||
                   get(data,'data.taskId') || get(data,'result.taskId') || null;

    // status gate
    const statusStr = String(
      get(data,'status') || get(data,'state') ||
      get(data,'data.status') || get(data,'data.state') || ''
    ).toLowerCase();
    const isSuccess = ['success','succeeded','completed','done'].includes(statusStr);

    // Gather *input* URLs to blacklist (so we never save the user's upload/preview)
    const inputUrls = new Set();
    collectInputUrls(data, inputUrls); // fills from input.* common shapes

    // Prefer result-only fields (do NOT touch generic top-level "images")
    let final_url = pickResultUrlOnly(data);

    // Reject obvious non-results
    if (isLikelyInputOrPreview(final_url, inputUrls)) final_url = null;

    // If unsure OR not success yet, verify via taskId and upgrade to true result URL
    if ((!final_url || !isSuccess) && taskId && KIE_KEY) {
      for (const base of KIE_BASES) {
        try {
          const r = await fetch(
            `${base}/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(taskId)}`,
            { headers: { 'Authorization': `Bearer ${KIE_KEY}`, 'Accept': 'application/json' } }
          );
          if (r.status === 404) continue; // try next base
          const j = await r.json();
          const s = String(j?.data?.status || j?.status || j?.state || '').toLowerCase();
          if (['success','succeeded','completed','done'].includes(s)) {
            const verUrl =
              j?.data?.result?.images?.[0]?.url ||
              j?.data?.result_url ||
              j?.image_url ||
              j?.url ||
              null;
            if (!isLikelyInputOrPreview(verUrl, inputUrls)) final_url = verUrl;
            break;
          }
        } catch { /* try next base */ }
      }
    }

    // Enforce allow-list & non-input
    if (final_url && (!isAllowedHost(final_url) || isLikelyInputOrPreview(final_url, inputUrls))) {
      final_url = null;
    }

    // Don’t insert stub rows (prevents spinner with bad data)
    if (!final_url) {
      return reply(200, { ok: true, saved: false, note: 'no allowed final image_url; not inserting' });
    }

    const row = {
      user_id: uid || '00000000-0000-0000-0000-000000000000',
      run_id:  run_id || 'unknown',
      task_id: taskId || null,
      image_url: final_url
    };

    const resp = await fetch(TABLE_URL, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(row)
    });

    return reply(200, { ok: resp.ok, saved: true, insert_status: resp.status, row });

  } catch (e) {
    return reply(200, { ok:false, error:String(e) });
  }
};

// ───────────── helpers

function reply(statusCode, body) {
  return { statusCode, headers: { ...cors(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function cors(){ return {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}; }
function lowerKeys(obj){const out={}; for(const k in obj) out[k.toLowerCase()]=obj[k]; return out;}
function parseFormLike(s){const out={}; try{ for(const part of s.split('&')){ const [k,v]=part.split('='); if(!k) continue; out[decodeURIComponent(k)]=decodeURIComponent(v||''); } }catch{} return out;}
function get(o,p){ try{ return p.split('.').reduce((a,k)=> (a && k in a ? a[k] : undefined), o); } catch { return undefined; } }
function isUrl(u){ return typeof u==='string' && /^https?:\/\//i.test(u); }
function hostname(u){ try{ return new URL(u).hostname; } catch { return ''; } }
function pathname(u){ try{ return new URL(u).pathname; } catch { return ''; } }

function isAllowedHost(u) {
  const h = hostname(u);
  return ALLOWED_RESULT_HOSTS.some(d => h === d || h.endsWith('.' + d));
}

// Treat as input/preview if: our site, localhost, or "/user-uploads/" path, or appears in inputUrls set
function isLikelyInputOrPreview(u, inputUrls) {
  if (!isUrl(u)) return true;
  const h = hostname(u);
  const p = pathname(u);
  if (/webhansora|netlify|localhost/i.test(h)) return true;
  if (p.includes('/user-uploads/')) return true;       // <- input uploads live here
  if (inputUrls && inputUrls.has(String(u))) return true;
  return false;
}

// Collect input URLs from common shapes so we can blacklist them
function collectInputUrls(obj, outSet) {
  const push = (arr) => { if (Array.isArray(arr)) for (const it of arr) if (isUrl(it)) outSet.add(String(it)); };
  // Arrays like image_urls: [...]
  push(get(obj, 'input.image_urls'));
  push(get(obj, 'data.input.image_urls'));
  push(get(obj, 'meta.image_urls'));
  // Arrays of objects with {url: ...}
  const asObjs = (arr) => Array.isArray(arr) ? arr.map(x => x && x.url).filter(isUrl) : [];
  for (const path of [
    'input.images', 'data.input.images', 'param.images', 'data.param.images',
    'request.images', 'data.request.images'
  ]) push(asObjs(get(obj, path)));

  // Deep scan only under likely input nodes
  for (const key of ['input','inputs','request','param','params']) {
    const node = get(obj, key);
    (function walk(x){
      if (!x) return;
      if (typeof x === 'string') { if (isUrl(x)) outSet.add(String(x)); }
      else if (Array.isArray(x)) { for (const v of x) walk(v); }
      else if (typeof x === 'object') { for (const v of Object.values(x)) walk(v); }
    })(node);
  }
}

// Strictly pick from result-only locations (no generic "images" lookups)
// Array-aware (no "?.[0]?" strings that get() can't handle)
function pickResultUrlOnly(obj){
  // direct fields first
  const direct = [
    get(obj,'result.image_url'),
    get(obj,'result.imageUrl'),
    get(obj,'result.outputUrl'),
    get(obj,'result_url'),
    get(obj,'data.result.image_url'),
    get(obj,'data.result.imageUrl'),
    get(obj,'data.result.outputUrl'),
    get(obj,'data.result_url'),
  ];
  for (const u of direct) if (isUrl(u)) return u;

  // array shapes
  const arrays = [
    get(obj,'data.result.images'),
    get(obj,'result.images'),
    get(obj,'data.output'),
    get(obj,'output'),
  ];
  for (const arr of arrays) {
    if (Array.isArray(arr)) {
      for (const it of arr) {
        const u = it && (it.url || it.image_url || it.imageUrl || it.outputUrl);
        if (isUrl(u)) return u;
      }
    }
  }
  return null;
}
