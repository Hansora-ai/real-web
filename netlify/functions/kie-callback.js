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
const PROFILES_URL  = `${SUPABASE_URL}/rest/v1/profiles`;

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

	    if (normalizeStatus(data) === 'failed') {
	      const refunded = await markFailedAndRefundOnce({ uid, run_id, taskId, reason: failureReason(data) }).catch(e => ({ ok:false, error:String(e) }));
	      return reply(200, { ok:true, saved:false, status:'failed', refunded });
	    }

	    // 2) Verify via KIE to get full set when taskId is known
	    if (taskId && KIE_KEY) {
	      try {
	        const verified = await fetchMJorJobsAll(taskId, 4);
	        if (verified.status === 'failed') {
	          const refunded = await markFailedAndRefundOnce({ uid, run_id, taskId, reason: verified.error || 'kie_failed' }).catch(e => ({ ok:false, error:String(e) }));
	          return reply(200, { ok:true, saved:false, status:'failed', refunded });
	        }
	        if (verified.urls.length) urls = Array.from(new Set([...urls, ...verified.urls])).slice(0,4);
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
	      return reply(200, { ok:true, saved:false, note:'no allowed final image_url; not inserting' });
	    }

    // Update user_generations with the first URL
    try {
      if (UG_URL && SERVICE_KEY && (uid || run_id)) {
        const q = (uid && run_id)
          ? `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`
          : `?meta->>run_id=eq.${encodeURIComponent(run_id||'')}`;
	        let existingMeta = {};
	        const chk = await fetch(UG_URL + q + '&select=id,meta', { headers: sb() });
	        let hasRow = false;
	        try {
	          const arr = await chk.json();
	          hasRow = Array.isArray(arr) && arr.length > 0;
	          existingMeta = hasRow && arr[0] && arr[0].meta ? arr[0].meta : {};
	        } catch {}
	        const bodyJson = { result_url: finalUrls[0], kind: 'image', meta: { ...existingMeta, run_id, task_id: taskId, status: 'done', completed_at: new Date().toISOString() } };
        await fetch(UG_URL + (hasRow ? q : ''), {
          method: hasRow ? 'PATCH' : 'POST',
          headers: { ...sb(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify(hasRow ? bodyJson : { user_id: uid, ...bodyJson })
        });
      }
    } catch {}

    // Insert ALL image rows (merge-duplicates avoids dup rows)
    const rows = finalUrls.map(u => ({
      user_id: uid || '00000000-0000-0000-0000-000000000000',
      run_id:  run_id || null,
      task_id: taskId || null,
      image_url: u
    }));

    const resp = await fetch(TABLE_URL, {
      method: 'POST',
      headers: { ...sb(), 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows)
    });

    return reply(200, { ok: resp.ok, saved:true, count: rows.length, urls: finalUrls });

  } catch (e) {
    return reply(200, { ok:false, error:String(e) });
  }
};

// ───────── helpers

async function fetchMJorJobsAll(id, limit=4){
  const endpoints = [
    `/api/v1/mj/getTaskResult?taskId=${encodeURIComponent(id)}`,
    `/api/v1/mj/result?taskId=${encodeURIComponent(id)}`,
    `/api/v1/mj/getTask?taskId=${encodeURIComponent(id)}`,
    `/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(id)}`,
    `/api/v1/jobs/result?taskId=${encodeURIComponent(id)}`
  ];
  for (const path of endpoints){
    try{
      const r = await fetch(`${KIE_BASE}${path}`, { headers: { 'Authorization': `Bearer ${KIE_KEY}`, 'Accept': 'application/json' } });
      const j = await r.json();
      const s = normalizeStatus(j);
      if (s === 'failed') return { status:'failed', urls: [], error: failureReason(j) };
      const ok = s === 'success' || !!j?.data?.result || Array.isArray(j?.data?.images);
      if (!ok) continue;
      const urls = pickResultUrls(j, limit);
      if (urls.length) return { status:'success', urls };
    }catch{}
  }
  return { status:'pending', urls: [] };
}

function normalizeStatus(d){
  const s = String(d?.status || d?.state || d?.result?.status || d?.data?.status || d?.data?.state || d?.data?.result?.status || '').toLowerCase();
  if (['success','succeeded','completed','done'].includes(s) || /(success|succeeded|completed|done)/i.test(s)) return 'success';
  if (['failed','fail','error','errored','cancelled','canceled','rejected'].includes(s) || /(fail|error|cancel|reject|moderation|blocked)/i.test(s)) return 'failed';
  if (d?.failed === true || d?.data?.failed === true) return 'failed';
  const err = String(d?.error || d?.message || d?.data?.error || d?.data?.message || '').toLowerCase();
  if (err && /(fail|error|cancel|reject|policy|moderation|unsafe|forbidden|blocked)/i.test(err)) return 'failed';
  return 'pending';
}

function failureReason(d){
  return String(
    d?.error ||
    d?.message ||
    d?.data?.error ||
    d?.data?.message ||
    d?.data?.reason ||
    d?.result?.error ||
    'kie_failed'
  );
}

function deduceMJ4(u){
  if (typeof u !== 'string') return [u].filter(Boolean);
  // ..._0_0.jpeg|png|webp → derive siblings
  const m = u.match(/^(.*_0_)(0)(\.(?:jpe?g|png|webp))$/i);
  if (m) return [0,1,2,3].map(i => `${m[1]}${i}${m[3]}`);
  return [u]; // fallback
}

function sb(){ return { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }; }

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
  if (!/\.(?:png|jpe?g|webp)(?:[?#].*)?$/i.test(u)) return false;
  return true;
}

async function findGeneration({ uid, run_id, taskId }){
  if (!UG_URL || !SERVICE_KEY) return null;
  const filters = [];
  if (uid) filters.push(`user_id=eq.${encodeURIComponent(uid)}`);
  if (run_id) filters.push(`meta->>run_id=eq.${encodeURIComponent(run_id)}`);
  else if (taskId) filters.push(`meta->>task_id=eq.${encodeURIComponent(taskId)}`);
  if (!filters.length) return null;
  const r = await fetch(`${UG_URL}?select=id,user_id,meta,created_at&${filters.join('&')}&limit=1`, { headers: sb() });
  if (!r.ok) return null;
  const arr = await r.json().catch(()=>[]);
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}

async function patchGenerationMeta(id, meta){
  if (!UG_URL || !SERVICE_KEY || !id) return false;
  const r = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...sb(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ result_url: null, meta })
  });
  return r.ok;
}

async function markFailedAndRefundOnce({ uid, run_id, taskId, reason }){
  const row = await findGeneration({ uid, run_id, taskId });
  if (!row) return { ok:false, error:'generation_not_found' };
  const meta = row.meta || {};
  const nextMetaBase = {
    ...meta,
    run_id: meta.run_id || run_id || null,
    task_id: meta.task_id || taskId || null,
    status: 'failed',
    failed_at: meta.failed_at || new Date().toISOString(),
    fail_reason: reason || meta.fail_reason || 'kie_failed'
  };

  if (String(meta.refunded || '').toLowerCase() === 'true') {
    await patchGenerationMeta(row.id, nextMetaBase);
    return { ok:true, already_refunded:true };
  }

  const charged = String(meta.charged || '').toLowerCase() === 'true';
  const cost = Number(meta.charged_cost || meta.cost || 0);
  if (!charged || !Number.isFinite(cost) || cost <= 0) {
    await patchGenerationMeta(row.id, nextMetaBase);
    return { ok:true, refunded:false, reason:'not_charged' };
  }

  const claim = `r_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const claimMeta = { ...nextMetaBase, refund_claim: claim };
  const claimRes = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}&meta->>refunded=is.null&meta->>refund_claim=is.null&select=id`, {
    method: 'PATCH',
    headers: { ...sb(), 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({ result_url: null, meta: claimMeta })
  });
  const claimArr = await claimRes.json().catch(()=>[]);
  if (!claimRes.ok || !Array.isArray(claimArr) || !claimArr.length) return { ok:true, already_claimed:true };

  const userId = row.user_id || uid;
  const p0 = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(userId)}&select=credits`, { headers: sb() });
  const parr = await p0.json().catch(()=>[]);
  const current = Number(Array.isArray(parr) && parr[0] ? parr[0].credits : 0);
  const nextCredits = current + cost;
  const p1 = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { ...sb(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ credits: nextCredits })
  });
  if (!p1.ok) return { ok:false, error:'profile_refund_failed' };

  await patchGenerationMeta(row.id, {
    ...claimMeta,
    refunded: 'true',
    refunded_cost: cost,
    refunded_at: new Date().toISOString()
  });
  return { ok:true, refunded:true, credits: nextCredits };
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
