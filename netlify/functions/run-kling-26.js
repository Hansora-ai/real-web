// netlify/functions/run-kling.js
// KIE Kling 2.6 job launcher (text→video or image→video with sound) using URL-only image input.
// Minimal, surgical: accepts only imageUrl/image_url, ignores any data URLs.
// Preserves seeding user_generations and server-side credit debit.
//
// Env: KIE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Opt: KIE_BASE_URL, SUPABASE_BUCKET, SITE_BASE
//
const KIE_BASE = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/+$/, '');
const KIE_KEY  = process.env.KIE_API_KEY || '';
const SUPABASE_URL  = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'downloads';
const SITE_BASE = (process.env.SITE_BASE || 'https://hansora.co').replace(/\/+$/,'');
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/kie-check`;

function cors(){ return {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
}; }
const json = (c,o)=>({ statusCode:c, headers:{ 'Content-Type':'application/json', ...cors() }, body:JSON.stringify(o) });

function getHeader(event, k){ return event.headers?.[k] || event.headers?.[k.toLowerCase()] || event.headers?.[k.toUpperCase()] || null; }
function getUID(event, body){
  const qs = new URLSearchParams(event.queryStringParameters || {});
  return ((getHeader(event,'x-user-id')||'') || (body && (body.uid||'')) || (qs.get('uid')||'')).trim();
}


async function getUidFromBearer(event){
  const auth = (getHeader(event,'authorization')||'').trim();
  if (!auth) return '';
  const m = auth.match(/Bearer\s+(.+)/i);
  if (!m) return '';
  const token = (m[1]||'').trim();
  if (!token || !SUPABASE_URL || !SERVICE_KEY) return '';
  try{
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) return '';
    const u = await r.json().catch(()=>null);
    return (u && (u.id || u.user?.id) ? String(u.id || u.user.id) : '').trim();
  }catch(_e){ return ''; }
}

// ---- server-side debit (5s -> 4⚡, 10s -> 8⚡) ----
async function debitCredits(uid, cost){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return { ok:false, error:'missing_env_or_uid' };
  try{
    const profUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
    const r0 = await fetch(profUrl, { headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
    if (!r0.ok) return { ok:false, error:'profile_fetch_failed', status:r0.status };
    const arr = await r0.json().catch(()=>null);
    const cur = (Array.isArray(arr) && arr[0] && typeof arr[0].credits==='number') ? arr[0].credits : 0;
    if (cur < cost) return { ok:false, error:'insufficient_credits', credits: cur };
    const newCredits = Math.max(0, cur - cost);
    const updUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`;
    const r1 = await fetch(updUrl, {
      method:'PATCH',
      headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer':'return=representation' },
      body: JSON.stringify({ credits: newCredits })
    });
    if (!r1.ok) return { ok:false, error:'profile_update_failed', status:r1.status };
    return { ok:true, credits:newCredits };
  }catch(e){ return { ok:false, error:'server_exception', details:String(e&&e.message||e) }; }
}


async function fetchUserGenByRunId(uid, run_id){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid || !run_id) return null;
  try{
    const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
    const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id,meta,provider,kind,prompt,result_url,created_at`;
    const r = await fetch(ug + q, { headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
    if (!r.ok) return null;
    const arr = await r.json().catch(()=>null);
    return (Array.isArray(arr) && arr[0]) ? arr[0] : null;
  }catch(_e){ return null; }
}

async function seedUserGeneration(uid, run_id, duration, sound, prompt){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return { row_id:null };
  try{
    const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
    const meta = { source:'kling', run_id, model:'kling2.6', status:'pending', refund_amount: (duration === 10 ? 8 : 4) };
    const rIns = await fetch(ug, {
      method: 'POST',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({ user_id: uid, provider: (sound ? (duration === 10 ? 'kling2.6-10s' : 'kling2.6-5s') : (duration === 10 ? 'Kling 2.6 no sound10s' : 'Kling 2.6 no sound5s')), kind: 'video', prompt, result_url: null, meta }),
    });
    if (!rIns.ok) return { row_id:null };
    const arr = await rIns.json().catch(()=>null);
    return { row_id: (Array.isArray(arr) && arr[0] && arr[0].id) ? arr[0].id : null };
  }catch(_e){ return { row_id:null }; }
}

async function patchUserGenerationMetaById(id, meta){
  if (!SUPABASE_URL || !SERVICE_KEY || !id) return false;
  try{
    const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
    const r = await fetch(`${ug}?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ meta }),
    });
    return !!r.ok;
  }catch(_e){ return false; }
}

// Exactly-once charging per (uid, run_id) via meta charge_claim + charged
async function chargeOnceForRun(uid, run_id, cost, row_id, baseMeta){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid || !run_id) {
    // Fallback: still debit server-side (but cannot persist idempotency)
    const debit = await debitCredits(uid, cost);
    return { ok: !!debit.ok, debit, idempotent: false, already: false };
  }

  // If already charged, do nothing
  try{
    const existing = await fetchUserGenByRunId(uid, run_id);
    const meta0 = existing?.meta || baseMeta || {};
    if (String(meta0?.charged || '').toLowerCase() === 'true'){
      return { ok:true, debit:{ ok:true, credits: null }, idempotent:true, already:true };
    }

    // Claim
    const claim = `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const mergedForClaim = { ...(meta0||{}), ...(baseMeta||{}), charge_claim: claim };

    // Only one request can set charge_claim when it's null and charged is null
    const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
    const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&meta->>charged=is.null&meta->>charge_claim=is.null&select=id`;
    const rClaim = await fetch(ug + q, {
      method: 'PATCH',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type':'application/json', 'Prefer':'return=representation' },
      body: JSON.stringify({ meta: mergedForClaim }),
    });

    const claimedArr = await rClaim.json().catch(()=>[]);
    const claimed = (rClaim.ok && Array.isArray(claimedArr) && claimedArr.length > 0);

    if (!claimed){
      // Someone else claimed/charged already. Re-read and treat as already charged.
      const after = await fetchUserGenByRunId(uid, run_id);
      const metaAfter = after?.meta || {};
      if (String(metaAfter?.charged || '').toLowerCase() === 'true'){
        return { ok:true, debit:{ ok:true, credits: null }, idempotent:true, already:true };
      }
      // If it's claimed but not charged yet, do not double-debit; ask client to wait/retry
      return { ok:false, error:'charge_in_progress', idempotent:true, already:false };
    }

    // Debit now (after provider task is created)
    const debit = await debitCredits(uid, cost);
    if (!debit.ok){
      // Rollback claim so user can retry later
      const rollbackMeta = { ...(mergedForClaim||{}) };
      delete rollbackMeta.charge_claim;
      await patchUserGenerationMetaById(row_id || (Array.isArray(claimedArr)&&claimedArr[0]?.id) || (existing?.id), rollbackMeta);
      return { ok:false, debit, idempotent:true, already:false };
    }

    // Mark charged
    const chargedMeta = { ...(mergedForClaim||{}), charged:'true', charged_cost: cost, charged_at: (new Date()).toISOString(), refund_amount: cost };
    await patchUserGenerationMetaById(row_id || (Array.isArray(claimedArr)&&claimedArr[0]?.id) || (existing?.id), chargedMeta);

    return { ok:true, debit, idempotent:true, already:false };
  }catch(e){
    const debit = await debitCredits(uid, cost);
    return { ok: !!debit.ok, debit, idempotent:false, already:false, error: String(e && e.message || e) };
  }
}

// Extract a taskId from various KIE response shapes
function extractTaskId(data){
  if (!data || typeof data !== 'object') return '';
  const cands = [
    data?.data?.taskId, data?.taskId, data?.result?.taskId,
    data?.data?.task_id, data?.task_id, data?.result?.task_id,
    data?.id
  ].map(v => (v==null?'':String(v))).filter(s => s && s.length>3);
  if (cands.length) return cands[0];
  // deep scan fallback
  const seen = new Set();
  const scan = (x)=>{
    if (!x || typeof x!=='object' || seen.has(x)) return '';
    seen.add(x);
    for (const [k,v] of Object.entries(x)){
      if (/^(task[_-]?id|request[_-]?id|id)$/i.test(k) && (typeof v==='string'||typeof v==='number')) {
        const s = String(v); if (s.length>3) return s;
      }
      const inner = scan(v); if (inner) return inner;
    }
    return '';
  };
  return scan(data) || '';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok:false, error:'method_not_allowed' });

  try{
    if (!KIE_KEY) return json(500, { ok:false, error:'missing_kie_key' });

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch(e){ return json(400, { ok:false, error:'bad_json', details: String(e.message || e) }); }

    const uid = (await getUidFromBearer(event)) || getUID(event, body);
    if (!uid) return json(401, { ok:false, error:'missing_uid' });

    const prompt = String(body.prompt || '').trim();
    const aspect_ratio = (body.aspect_ratio ? String(body.aspect_ratio) : '1:1').trim();
    const duration = (body && (body.duration === 10 || String(body.duration) === '10')) ? 10 : 5;
    const sound = (body && Object.prototype.hasOwnProperty.call(body, 'sound')) ? (body.sound === true || body.sound === 'true' || body.sound === 1 || body.sound === '1') : false;

    // URL-only image intake (accept body.image_url OR body.imageUrl)
    const imageUrl = (body && (body.image_url || body.imageUrl)) ? String(body.image_url || body.imageUrl).trim() : '';
    if (!prompt && !imageUrl) {
      return json(400, { ok:false, error:'missing_input', details:'Provide a prompt or an image_url.' });
    }

    // Costs: 5s -> 4⚡, 10s -> 8⚡
    const cost = (duration === 10) ? 8 : 4;
    const run_id = (body.run_id && String(body.run_id).trim()) || `${uid || 'anon'}-${Date.now()}`;

    // If this run_id was already submitted before, return the same taskId (no re-debit)
    const existing = await fetchUserGenByRunId(uid, run_id);
    const existingTask = existing?.meta?.task_id || existing?.meta?.taskId || '';
    if (existingTask){
      return json(201, { ok:true, submitted:true, taskId: String(existingTask), id: String(existingTask), run_id, row_id: existing?.id || null, already:true });
    }

    // Seed placeholder row early (used for idempotent charging)
    const seed = await seedUserGeneration(uid, run_id, duration, sound, prompt);
    let row_id = seed.row_id;

    // Choose model per mode
    const image_url = imageUrl || ''; // normalize to snake_case key for KIE
    const model = image_url ? "kling-2.6/image-to-video" : "kling-2.6/text-to-video";

    // Build KIE createTask payload
    const payload = {
      model,
      input: image_url ? {
        prompt,
        aspect_ratio,
        duration: (duration === 10 ? '10' : '5'),
        sound: sound,
        image_urls: [image_url],
      } : {
        prompt,
        aspect_ratio,
        duration: (duration === 10 ? '10' : '5'),
        sound: sound,
      },
      callBackUrl: `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`,
    };

    const resp = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(()=>({}));
    if (!resp.ok) return json(resp.status || 502, { ok:false, error:'kie_create_failed', details:data });

    const taskId = extractTaskId(data);
    if (!taskId) return json(502, { ok:false, error:'missing_task_id', details:data });

    // Persist taskId into meta for tracing (status: processing)
    try {
      if (SUPABASE_URL && SERVICE_KEY && taskId) {
        const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
        const chk = await fetch(ug + q, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
        const arr = await chk.json().catch(()=>[]);
        if (Array.isArray(arr) && arr.length) {
          await fetch(`${ug}?id=eq.${encodeURIComponent(arr[0].id)}`, {
            method: 'PATCH',
            headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ meta: { source:'kling', run_id, model, status:'processing', task_id: taskId, refund_amount: cost } }),
          });
        }
      }
    } catch {}

            // Debit credits AFTER provider accepted the task (after 'submitted') and exactly once per (uid, run_id)
    const baseMeta = { source:'kling', run_id, model, status:'processing', task_id: taskId, sound: sound, refund_amount: cost };
    const charge = await chargeOnceForRun(uid, run_id, cost, row_id, baseMeta);
    if (!charge.ok){
      if (charge.debit && !charge.debit.ok && (charge.debit.error === 'insufficient_credits' || charge.debit.error === 'insufficient')){
        return json(402, { ok:false, error:'not_enough_credits', details: charge.debit });
      }
      if (charge.error === 'charge_in_progress'){
        return json(409, { ok:false, error:'charge_in_progress' });
      }
      return json(500, { ok:false, error:'charge_failed', details: charge.debit || charge.error || charge });
    }

    return json(201, { ok:true, submitted:true, taskId, id: taskId, run_id, row_id, debited: cost, credits: (charge.debit && charge.debit.credits != null ? charge.debit.credits : undefined), already_charged: !!charge.already });
  }catch(e){
    return json(500, { ok:false, error:'server_error', details: String(e && e.message || e) });
  }
};
