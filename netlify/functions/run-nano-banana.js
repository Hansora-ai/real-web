// netlify/functions/run-nano-banana.js
// Hardened Nano Banana launcher (server-side credits + JWT UID verification + idempotent charge per run_id)
// - No browser-side credit deduction
// - UID derived from Supabase JWT (service role verification); rejects spoofed uid
// - Server-side credit check + debit only here
// - Idempotent charge claim per (uid, run_id) using user_generations.meta
//
// Env: KIE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Opt: KIE_BASE_URL, SITE_BASE
//
const KIE_BASE = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/+$/, '');
const CREATE_URL = process.env.KIE_CREATE_URL || `${KIE_BASE}/api/v1/jobs/createTask`;
const KIE_KEY  = process.env.KIE_API_KEY || '';

const SUPABASE_URL  = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const SITE_BASE = (process.env.SITE_BASE || 'https://webhansora.netlify.app').replace(/\/+$/,'');
const CALLBACK_URL = `${SITE_BASE}/.netlify/functions/kie-callback`;

const VERSION_TAG = "nb_hardened_v1";
const COST = 0.5;

function cors(){
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
}
const json = (c,o)=>({
  statusCode:c,
  headers:{ 'Content-Type':'application/json', ...cors() },
  body:JSON.stringify(o)
});

function getHeader(event, k){
  return event.headers?.[k] || event.headers?.[k.toLowerCase()] || event.headers?.[k.toUpperCase()] || null;
}

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

async function fetchProfileCredits(uid){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return null;
  try{
    const profUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
    const r0 = await fetch(profUrl, { headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
    if (!r0.ok) return null;
    const arr = await r0.json().catch(()=>null);
    const cur = (Array.isArray(arr) && arr[0] && typeof arr[0].credits === 'number') ? arr[0].credits : 0;
    return cur;
  }catch(_e){ return null; }
}

async function debitCredits(uid, cost){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return { ok:false, error:'missing_env_or_uid' };
  try{
    const cur = await fetchProfileCredits(uid);
    if (typeof cur !== 'number') return { ok:false, error:'profile_fetch_failed' };
    if (cur < cost) return { ok:false, error:'insufficient_credits', credits: cur };
    const newCredits = Math.max(0, Number((cur - cost).toFixed(1)));
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

async function seedUserGeneration(uid, run_id, prompt, size){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return { row_id:null };
  try{
    const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
    const meta = { source:'nano-banana', run_id, model:'google/nano-banana-edit', status:'pending', size };
    const rIns = await fetch(ug, {
      method: 'POST',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({ user_id: uid, provider: 'Nano Banana', kind: 'image', prompt, result_url: null, meta }),
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
    const debit = await debitCredits(uid, cost);
    return { ok: !!debit.ok, debit, idempotent: false, already: false };
  }

  try{
    const existing = await fetchUserGenByRunId(uid, run_id);
    const meta0 = existing?.meta || baseMeta || {};
    if (String(meta0?.charged || '').toLowerCase() === 'true'){
      return { ok:true, debit:{ ok:true, credits: null }, idempotent:true, already:true };
    }

    const claim = `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const mergedForClaim = { ...(meta0||{}), ...(baseMeta||{}), charge_claim: claim };

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
      const after = await fetchUserGenByRunId(uid, run_id);
      const metaAfter = after?.meta || {};
      if (String(metaAfter?.charged || '').toLowerCase() === 'true'){
        return { ok:true, debit:{ ok:true, credits: null }, idempotent:true, already:true };
      }
      return { ok:false, error:'charge_in_progress', idempotent:true, already:false };
    }

    const debit = await debitCredits(uid, cost);
    if (!debit.ok){
      const rollbackMeta = { ...(mergedForClaim||{}) };
      delete rollbackMeta.charge_claim;
      await patchUserGenerationMetaById(row_id || (Array.isArray(claimedArr)&&claimedArr[0]?.id) || (existing?.id), rollbackMeta);
      return { ok:false, debit, idempotent:true, already:false };
    }

    const chargedMeta = { ...(mergedForClaim||{}), charged:'true', charged_cost: cost, charged_at: (new Date()).toISOString() };
    await patchUserGenerationMetaById(row_id || (Array.isArray(claimedArr)&&claimedArr[0]?.id) || (existing?.id), chargedMeta);

    return { ok:true, debit, idempotent:true, already:false };
  }catch(e){
    const debit = await debitCredits(uid, cost);
    return { ok: !!debit.ok, debit, idempotent:false, already:false, error: String(e && e.message || e) };
  }
}

function normalizeImageSize(v){
  if (!v) return "auto";
  const s = String(v).trim().toLowerCase();
  const direct = new Set(["auto", "1:1", "3:4", "4:3", "9:16", "16:9"]);
  if (direct.has(s)) return s;
  if (s === "square") return "1:1";
  if (s === "portrait_3_4") return "3:4";
  if (s === "portrait_9_16") return "9:16";
  if (s === "landscape_4_3") return "4:3";
  if (s === "landscape_16_9") return "16:9";
  const coerced = s.replace(/(\d)[_\-:](\d)/g, "$1:$2");
  if (direct.has(coerced)) return coerced;
  return "auto";
}

function extractTaskId(data){
  if (!data || typeof data !== 'object') return '';
  const cands = [
    data?.data?.taskId, data?.taskId, data?.result?.taskId,
    data?.data?.task_id, data?.task_id, data?.result?.task_id,
    data?.id
  ].map(v => (v==null?'':String(v))).filter(s => s && s.length>3);
  if (cands.length) return cands[0];
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
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { ok:false, error:'missing_supabase_env' });

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch(e){ return json(400, { ok:false, error:'bad_json', details: String(e.message || e) }); }

    const uid = (await getUidFromBearer(event)) || getUID(event, body);
    if (!uid) return json(401, { ok:false, error:'missing_uid' });

    const rawUrls = Array.isArray(body.urls) ? body.urls : [];
    if (!rawUrls.length) return json(400, { ok:false, error:'urls_required' });

    const prompt  = String(body.prompt || '').trim();
    const format  = String(body.format || 'png').toLowerCase();
    const size    = normalizeImageSize(body.size);

    const run_id = (body.run_id && String(body.run_id).trim()) || `${uid}-${Date.now()}`;

    // If already submitted, return same taskId
    const existing = await fetchUserGenByRunId(uid, run_id);
    const existingTask = existing?.meta?.task_id || existing?.meta?.taskId || '';
    if (existingTask){
      return json(200, { ok:true, submitted:true, taskId: String(existingTask), run_id, already:true, version: VERSION_TAG });
    }

    // Pre-check credits (server-side)
    const cur = await fetchProfileCredits(uid);
    if (typeof cur === 'number' && cur < COST){
      return json(402, { ok:false, error:'not_enough_credits', credits: cur, need: COST, version: VERSION_TAG });
    }

    const seed = await seedUserGeneration(uid, run_id, prompt, size);
    const row_id = seed.row_id;

    const image_urls = rawUrls.map(u => encodeURI(String(u)));
    const cb = `${CALLBACK_URL}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    const payload = {
      model: "google/nano-banana-edit",
      input: { prompt: prompt || ".", image_urls, output_format: format, image_size: size },

      webhook_url: cb,
      webhookUrl:  cb,
      callbackUrl: cb,
      callBackUrl: cb,
      notify_url:  cb,

      meta: { uid, run_id, version: VERSION_TAG, cb },
      metadata: { uid, run_id, version: VERSION_TAG, cb }
    };

    const create = await fetch(CREATE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${KIE_KEY}`,
        "Content-Type":  "application/json",
        "Accept":        "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await create.text();
    let js; try { js = JSON.parse(text); } catch { js = { raw: text }; }

    if (!create.ok){
      return json(create.status || 502, { ok:false, error:'kie_create_failed', details: js, version: VERSION_TAG });
    }

    const taskId = extractTaskId(js);
    if (!taskId) return json(502, { ok:false, error:'missing_task_id', details: js, version: VERSION_TAG });

    const baseMeta = { source:'nano-banana', run_id, model:'google/nano-banana-edit', status:'processing', task_id: taskId, size };
    if (row_id) { await patchUserGenerationMetaById(row_id, baseMeta); }

    const charge = await chargeOnceForRun(uid, run_id, COST, row_id, baseMeta);
    if (!charge.ok){
      if (charge.debit && !charge.debit.ok && (charge.debit.error === 'insufficient_credits' || charge.debit.error === 'insufficient')){
        return json(402, { ok:false, error:'not_enough_credits', details: charge.debit, version: VERSION_TAG });
      }
      if (charge.error === 'charge_in_progress'){
        return json(409, { ok:false, error:'charge_in_progress', version: VERSION_TAG });
      }
      return json(500, { ok:false, error:'charge_failed', details: charge.debit || charge.error || charge, version: VERSION_TAG });
    }

    return json(200, {
      ok:true,
      submitted:true,
      taskId,
      run_id,
      debited: COST,
      credits: (charge.debit && charge.debit.credits != null ? charge.debit.credits : undefined),
      already_charged: !!charge.already,
      version: VERSION_TAG
    });

  }catch(e){
    return json(500, { ok:false, error:'server_error', details: String(e && e.message || e), version: VERSION_TAG });
  }
};
