// Handles KIE -> webhook callback and stores the result in Supabase nb_results
// Expects query params ?uid=...&run_id=...

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY; // service role key (NOT anon)
const TABLE_URL     = `${SUPABASE_URL}/rest/v1/nb_results`;
const UG_URL        = `${SUPABASE_URL}/rest/v1/user_generations`;

const KIE_BASE = process.env.KIE_BASE_URL || 'https://api.kie.ai';
const KIE_KEY  = process.env.KIE_API_KEY;

const ALLOWED_HOSTS = new Set([
  'tempfile.aiquickdraw.com',
  'tempfile.redpandaai.co',
]);

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

    let uid    = qs.uid    || get(data, 'meta.uid')      || get(data, 'metadata.uid')      || null;
    const run_id = qs.run_id || get(data, 'meta.run_id')   || get(data, 'metadata.run_id')   || null;
    const taskId = qs.taskId || qs.task_id || get(data,'taskId') || get(data,'id') ||
                   get(data,'data.taskId') || get(data,'result.taskId') || null;

    // --- uid fallback: resolve from placeholder if missing ---
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
            // Fallback by taskId if run_id lookup failed
            q = `${ug}?select=user_id&meta->>task_id=eq.${encodeURIComponent(taskId)}&limit=1`;
            r = await fetch(q, { headers: { 'apikey': svc, 'Authorization': `Bearer ${svc}` } });
            arr = await r.json().catch(()=>[]);
            if (Array.isArray(arr) && arr[0]?.user_id) {
              uid = arr[0].user_id;
            }
          }
        }
      } catch (_) { /* keep uid as-is if lookup fails */ }
    }
    // --- end uid fallback ---

    const statusStr = String(
      get(data,'status') || get(data,'state') ||
      get(data,'data.status') || get(data,'data.state') || ''
    ).toLowerCase();

    // Prefer URLs inside result fields to avoid user-upload echoes
    let url = pickResultUrl(data);

    // If status isn't clearly success or URL doesn't look final, verify with KIE
    const looksFinal = isAllowedFinal(url);
    let verifiedFinal = false;
    const isSuccess = ['success','succeeded','completed','done'].includes(statusStr);

    if ((!isSuccess || !looksFinal) && taskId && KIE_KEY) {
      try {
        const r = await fetch(
          `${KIE_BASE}/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(taskId)}`,
          { headers: { 'Authorization': `Bearer ${KIE_KEY}`, 'Accept': 'application/json' } }
        );
        const j = await r.json();
        const s = String(j?.data?.status || j?.status || j?.state || '').toLowerCase();
        if (['success','succeeded','completed','done'].includes(s)) { verifiedFinal = true;
          url =
            j?.data?.result?.images?.[0]?.url ||
            j?.data?.result_url ||
            j?.image_url ||
            j?.url ||
            url;
        } else {
          url = null;
        }
      } catch {}
    }

    if (!(isAllowedFinal(url) || (verifiedFinal && typeof url==='string' && /^https?:\/\//i.test(url)))) {
      return reply(200, {
        ok:true, saved:false,
        note:'no allowed final image_url; not inserting',
        debug:{ taskId: !!taskId, status: statusStr || 'unknown', url }
      });
    }

    const row = {
      user_id: uid || '00000000-0000-0000-0000-000000000000',
      // 🔧 FIX #1: DO NOT write 'unknown' here; keep null if missing so the UI filter by run_id is not broken
      run_id:  run_id || null,
      task_id: taskId || null,
      image_url: url
    };

    // --- update existing placeholder in user_generations (by user_id + meta->>run_id) ---
    try {
      if (UG_URL && SERVICE_KEY && uid) {
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id || '')}`;
        try {
          const chk = await fetch(UG_URL + q + '&select=id', {
            headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
          });
          const arr = await chk.json();
          const hasRow = Array.isArray(arr) && arr.length > 0;
          const bodyJson = {
            result_url: url,
            // 🔧 FIX #2: label as MidJourney (this does NOT affect your page logic; it’s just for usage labeling)
            provider: 'MidJourney',
            kind: 'image',
            meta: { run_id, task_id: taskId, status: 'done' }
          };
          if (hasRow) {
            await fetch(UG_URL + q, {
              method: 'PATCH',
              headers: {
                'apikey': SERVICE_KEY,
                'Authorization': `Bearer ${SERVICE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify(bodyJson)
            });
          } else {
            await fetch(UG_URL, {
              method: 'POST',
              headers: {
                'apikey': SERVICE_KEY,
                'Authorization': `Bearer ${SERVICE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({ user_id: uid, ...bodyJson })
            });
          }
        } catch (e) {
          console.warn('[callback] usage upsert failed', e);
        }
      }
    } catch (e) {
      console.warn('[callback] usage patch failed', e);
    }

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

    return reply(200, { ok: resp.ok, saved:true, insert_status: resp.status, row });

  } catch (e) {
    return reply(200, { ok:false, error:String(e) });
  }
};

// ───────── helpers

function reply(statusCode, body) {
  return { statusCode, headers: { ...cors(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function cors(){ return {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}; }
function lowerKeys(obj){const out={}; for(const k in obj) out[k.toLowerCase()]=obj[k]; return out;}
function parseFormLike(s){const out={}; try{ for(const part of s.split('&')){ const [k,v]=part.split('='); if(!k) continue; out[decodeURIComponent(k)]=decodeURIComponent(v||''); } }catch{} return out;}
function get(o,p){ try{ return p.split('.').reduce((a,k)=> (a && k in a ? a[k] : undefined), o); } catch { return undefined; } }
function isUrl(u){ return typeof u==='string' && /^https?:\/\//i.test(u); }
function host(u){ try{ return new URL(u).hostname; } catch { return ''; } }
function isAllowedFinal(u){
  if (!isUrl(u)) return false;
  const h = host(u);
  if (!ALLOWED_HOSTS.has(h)) return false;
  // Generated images come from workers (avoid user-uploads echoes)
  if (!/\/(workers|f|m)\//i.test(u)) return false;
  return true;
}

// Prefer result subtree and known result fields; avoid user-upload echoes.
function pickResultUrl(obj){
  const prefer = [
    get(obj,'result.images.0.url'),
    get(obj,'data.result.images.0.url'),
    get(obj,'data.result_url'),
    get(obj,'result_url'),
    get(obj,'image_url'),
    get(obj,'url')
  ];

  for (const u of prefer) {
    if (isUrl(u) && /\/(workers|f|m)\//i.test(u)) return u; // only accept worker paths here
  }

  // Also handle arrays of plain strings (e.g., MidJourney returns [ "https://...0.jpeg", ... ])
  const arrStrings = Array.isArray(get(obj,'result.images')) ? get(obj,'result.images')
                    : Array.isArray(get(obj,'data.result.images')) ? get(obj,'data.result.images')
                    : null;
  if (arrStrings && arrStrings.length) {
    for (const s of arrStrings) {
      if (typeof s === 'string' && isUrl(s) && /\/(workers|f|m)\//i.test(s)) return s;
      if (s && typeof s === 'object' && isUrl(s.url) && /\/(workers|f|m)\//i.test(s.url)) return s.url;
    }
  }

  // Deep scan last, but still require workers in path
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
