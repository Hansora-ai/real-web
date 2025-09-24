// Handles KIE -> webhook callback and stores the result in Supabase nb_results
// Expects query params ?uid=...&run_id=...

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY; // service role key (NOT anon)
const TABLE_URL     = `${SUPABASE_URL}/rest/v1/nb_results`;

// Use your configured base, plus safe fallbacks (host mismatch is your 404)
const KIE_BASE_MAIN = process.env.KIE_BASE_URL || 'https://api.kie.ai';
const KIE_KEY       = process.env.KIE_API_KEY;
const KIE_BASES     = Array.from(new Set([
  KIE_BASE_MAIN.replace(/\/+$/,''),
  'https://api.kie.ai',
  'https://kieai.redpandaai.co'
]));

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

    // status gate: only insert when job is really done
    const statusStr = String(
      get(data,'status') || get(data,'state') ||
      get(data,'data.status') || get(data,'data.state') || ''
    ).toLowerCase();
    const isSuccess = ['success','succeeded','completed','done'].includes(statusStr);

    // Pick a result URL from payload (prefer result fields, ignore input URLs)
    const payloadUrl = pickUrl(data);

    // If payload looks wrong OR status not success, verify with KIE by taskId across bases
    let final_url = payloadUrl;
    const looksWrong =
      !final_url ||
      /webhansora|netlify|localhost/i.test(hostname(final_url)) ||
      !/(kie\.ai|redpandaai\.co)/i.test(hostname(final_url));

    if ((looksWrong || !isSuccess) && taskId && KIE_KEY) {
      for (const base of KIE_BASES) {
        try {
          const r = await fetch(
            `${base}/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(taskId)}`,
            { headers: { 'Authorization': `Bearer ${KIE_KEY}`, 'Accept': 'application/json' } }
          );
          if (r.status === 404) continue; // try next host
          const j = await r.json();
          const s = String(j?.data?.status || j?.status || j?.state || '').toLowerCase();
          if (['success','succeeded','completed','done'].includes(s)) {
            final_url =
              j?.data?.result?.images?.[0]?.url ||
              j?.data?.result_url ||
              j?.image_url ||
              j?.url ||
              final_url;
            break;
          }
        } catch (_) { /* try next base */ }
      }
    }

    // Don’t insert stub rows
    if (!final_url) {
      return reply(200, { ok: true, saved: false, note: 'no final image_url yet; not inserting' });
    }

    // Insert only when we have a real, final URL
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

// ───────────────── helpers
function reply(statusCode, body) {
  return { statusCode, headers: { ...cors(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function cors(){ return {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}; }
function lowerKeys(obj){const out={}; for(const k in obj) out[k.toLowerCase()]=obj[k]; return out;}
function parseFormLike(s){const out={}; try{ for(const part of s.split('&')){ const [k,v]=part.split('='); if(!k) continue; out[decodeURIComponent(k)]=decodeURIComponent(v||''); } }catch{} return out;}
function get(o,p){ try{ return p.split('.').reduce((a,k)=> (a && k in a ? a[k] : undefined), o); } catch { return undefined; } }
function isUrl(u){ return typeof u==='string' && /^https?:\/\//i.test(u); }
function hostname(u){ try{ return new URL(u).hostname; } catch { return ''; } }

// Prefer real result fields; explicitly ignore input image URLs
function pickUrl(obj){
  const inputUrls = []
    .concat(get(obj,'input.image_urls') || [])
    .concat(get(obj,'data.input.image_urls') || [])
    .concat(get(obj,'meta.image_urls') || [])
    .map(String);

  const prefer = [
    // explicit result shapes
    get(obj,'result.image_url'), get(obj,'result.imageUrl'), get(obj,'result.outputUrl'),
    get(obj,'result_url'),
    get(obj,'data.result.image_url'), get(obj,'data.result.imageUrl'), get(obj,'data.result.outputUrl'),
    get(obj,'data.result_url'),
    // structured outputs
    get(obj,'data.result.images?.[0]?.url'),
    get(obj,'data.output?.[0]?.url'),
    // last resort (still filtered)
    get(obj,'image_url'), get(obj,'imageUrl'), get(obj,'url')
  ];

  for (const u of prefer) {
    if (isUrl(u) && !inputUrls.includes(String(u))) return u;
  }

  // deep scan last (avoid input URLs)
  let found = null;
  (function walk(x){
    if (found || !x) return;
    if (typeof x === 'string'){
      const m = x.match(/https?:\/\/[^\s"']+/i);
      const cand = m && m[0];
      if (cand && isUrl(cand) && !inputUrls.includes(String(cand))) { found = cand; return; }
    } else if (Array.isArray(x)){
      for (const v of x) walk(v);
    } else if (typeof x === 'object'){
      for (const v of Object.values(x)) walk(v);
    }
  })(obj);
  return found;
}
