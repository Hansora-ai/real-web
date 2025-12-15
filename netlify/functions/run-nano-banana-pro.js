// netlify/functions/run-nano-banana.js
// Nano Banana (KIE) job launcher with Kling 2.6-style server-side credit debit (idempotent per run_id).
// Client must NOT debit credits. Credits are charged only here using SUPABASE_SERVICE_ROLE_KEY.
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
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/kie-callback`; // your existing callback

const VERSION_TAG  = "nb_fn_kling26_style_v1";

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


function normalizeImageSize(v) {
  if (!v) return "auto";
  const s = String(v).trim().toLowerCase();

  // Pass through if already valid ratio or auto
  const direct = new Set(["auto", "1:1", "3:4", "4:3", "9:16", "16:9"]);
  if (direct.has(s)) return s;

  // Map named tokens to ratio strings (KIE-accepted)
  if (s === "square") return "1:1";
  if (s === "portrait_3_4") return "3:4";
  if (s === "portrait_9_16") return "9:16";
  if (s === "landscape_4_3") return "4:3";
  if (s === "landscape_16_9") return "16:9";

  // Coerce variants like "16_9", "16-9" → "16:9"
  const coerced = s.replace(/(\d)[_\-:](\d)/g, "$1:$2");
  if (direct.has(coerced)) return coerced;

  return "auto";
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

async function seedUserGeneration(uid, run_id, prompt){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return { row_id:null };
  try{
    const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
    const meta = { source:'nano-banana', run_id, model:'nano-banana', status:'pending' };
    const rIns = await fetch(ug, {
      method: 'POST',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({ user_id: uid, provider: 'nano-banana', kind: 'image', prompt, result_url: null, meta }),
    });
    if (!rIns.ok) return { row_id:null };
    const arr = await rIns.json().catch(()=>null);
    return { row_id: (Array.isArray(arr) && arr[0] && arr[0].id) ? arr[0].id : null };
  }catch(_e){ return { row_id:null }; }
}

async function patchUserGenerationMetaById(id, meta){
  if (!SUPABASE_URL || !SERVICE_KEY || !id) return { ok:false, error:'missing_env_or_id' };
  try{
    const url = `${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(id)}`;
    const r = await fetch(url, {
      method:'PATCH',
      headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type':'application/json', 'Prefer':'return=minimal' },
      body: JSON.stringify({ meta })
    });
    return { ok: !!r.ok, status: r.status };
  }catch(e){
    return { ok:false, error:'patch_failed', details:String(e && e.message || e) };
  }
}

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
    const chargedMeta = { ...(mergedForClaim||{}), charged:'true', charged_cost: cost, charged_at: (new Date()).toISOString() };
    await patchUserGenerationMetaById(row_id || (Array.isArray(claimedArr)&&claimedArr[0]?.id) || (existing?.id), chargedMeta);

    return { ok:true, debit, idempotent:true, already:false };
  }catch(e){
    // IMPORTANT: do NOT debit here. Any exception in the idempotent flow must not trigger a second charge.
    return { ok:false, error:'charge_exception', idempotent:false, already:false, details: String(e && (e.message||e) || e) };
  }
}



exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: { ...cors() } };
  if (event.httpMethod !== 'POST') return json(405, { ok:false, error:'method_not_allowed', version: VERSION_TAG });

  try{
    const body = JSON.parse(event.body || '{}');

    // Identify user (X-USER-ID OR uid OR querystring) and fallback to bearer token
    let uid = getUID(event, body);
    if (!uid || uid === 'anon'){
      const uidFromBearer = await getUidFromBearer(event);
      if (uidFromBearer) uid = uidFromBearer;
    }
    if (!uid) uid = 'anon';

    const run_id = (body.run_id || body.runId || `${uid}-${Date.now()}`).toString();

    // Required inputs
    const rawUrls = Array.isArray(body.urls) ? body.urls : [];
    if (!rawUrls.length) {
      return json(400, { ok:false, submitted:false, error:'urls_required', version: VERSION_TAG });
    }

    // Normalize/encode URLs
    const image_urls = rawUrls.map(u => encodeURI(String(u)));

    const prompt  = (body.prompt || '').toString();
    const format  = (body.format || 'png').toString().toLowerCase();
    const size    = normalizeImageSize(body.size);

    // Cost (must match UI)
    const cost = 0.5;

    // Seed user_generations (pending)
    const seeded = await seedUserGeneration(uid, run_id, prompt);
    const row_id = seeded?.row_id || null;

    // Provider callback includes uid + run_id (for Make/subscenario and for DB match)
    const cb = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    // Create task at KIE (Nano Banana edit)
    const payload = {
      model: 'google/nano-banana-edit',
      input: {
        prompt,
        image_urls,
        output_format: format,
        image_size: size
      },

      // callbacks (KIE is inconsistent across models; include all common keys)
      webhook_url: cb,
      webhookUrl:  cb,
      callbackUrl: cb,
      callBackUrl: cb,
      notify_url:  cb,

      // meta for callback (some KIE routes only forward metadata)
      meta:     { uid, run_id, version: VERSION_TAG, cb },
      metadata: { uid, run_id, version: VERSION_TAG, cb }
    };

    const create = await fetch(CREATE_URL, {(`${KIE_BASE}/api/v1/jobs/createTask`, {
      method:'POST',
      headers: { 'Authorization': `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await create.text();
    let js; try { js = JSON.parse(text); } catch { js = { raw: text }; }
    const taskId = js.taskId || js.id || js.data?.taskId || js.data?.id || null;

    if (!create.ok){
      // update meta status = failed_create (best effort)
      try{
        if (SUPABASE_URL && SERVICE_KEY && row_id){
          await fetch(`${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(row_id)}`, {
            method:'PATCH',
            headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type':'application/json', 'Prefer':'return=minimal' },
            body: JSON.stringify({ meta: { source:'nano-banana', run_id, model:'nano-banana', status:'create_failed', task_id: taskId, raw: js } }),
          });
        }
      }catch{}
      return json(create.status || 500, { ok:false, submitted:false, error:'create_failed', status:create.status, response: js, version: VERSION_TAG });
    }

    // Update meta status=processing + task_id (best effort)
    try{
      if (SUPABASE_URL && SERVICE_KEY && row_id){
        await fetch(`${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(row_id)}`, {
          method:'PATCH',
          headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type':'application/json', 'Prefer':'return=minimal' },
          body: JSON.stringify({ meta: { source:'nano-banana', run_id, model:'nano-banana', status:'processing', task_id: taskId } }),
        });
      }
    }catch{}

    // Debit credits AFTER provider accepted the task and exactly once per (uid, run_id)
    const baseMeta = { source:'nano-banana', run_id, model:'nano-banana', status:'processing', task_id: taskId };
    const charge = await chargeOnceForRun(uid, run_id, cost, row_id, baseMeta);

    if (!charge.ok){
      if (charge.debit && !charge.debit.ok && (charge.debit.error === 'insufficient_credits' || charge.debit.error === 'insufficient')){
        return json(402, { ok:false, submitted:false, error:'not_enough_credits', details: charge.debit, version: VERSION_TAG });
      }
      if (charge.error === 'charge_in_progress'){
        return json(409, { ok:false, submitted:false, error:'charge_in_progress', version: VERSION_TAG });
      }
      return json(500, { ok:false, submitted:false, error:'charge_failed', details: charge.debit || charge.error || charge, version: VERSION_TAG });
    }

    return json(201, {
      ok:true,
      submitted:true,
      taskId,
      run_id,
      cost,
      credits_after: (charge.debit && charge.debit.credits !== null ? charge.debit.credits : undefined),
      already_charged: !!charge.already,
      version: VERSION_TAG,
      callback: cb
    });

  }catch(e){
    return json(500, { ok:false, submitted:false, error:'exception', message:String(e), version: VERSION_TAG });
  }
};
