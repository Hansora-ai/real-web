// netlify/functions/run-gpt-image-1.js
// KIE GPT Image 1.5 (text-to-image and image-to-image) via /api/v1/jobs/createTask
//
// Requested changes:
// - Use KIE createTask endpoint
// - model: gpt-image/1.5-text-to-image OR gpt-image/1.5-image-to-image
// - quality: high
// - credits deduction: 2
//
// Env required:
// - KIE_API_KEY
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// Optional:
// - KIE_CREATE_URL (defaults to https://api.kie.ai/api/v1/jobs/createTask)

const CREATE_URL = (process.env.KIE_CREATE_URL || 'https://api.kie.ai/api/v1/jobs/createTask').replace(/\/+$/,'');
const API_KEY    = process.env.KIE_API_KEY || '';
const SUPABASE_URL  = (process.env.SUPABASE_URL || '').replace(/\/+$/,'');
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SITE_URL      = (process.env.URL || 'https://hansora.co').replace(/\/+$/,'');

const VERSION_TAG = "gpt_image_1_fn_kie_v1";

function json(statusCode, obj){
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}

async function debitCredits(uid, cost){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return { ok:false, error:'missing_env_or_uid' };
  try{
    const profUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
    const r0 = await fetch(profUrl, { headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
    if (!r0.ok) return { ok:false, error:'profile_fetch_failed', status:r0.status };
    const arr = await r0.json().catch(()=>null);
    const cur = (Array.isArray(arr) && arr[0] && typeof arr[0].credits==='number') ? arr[0].credits : 0;

    if (cur < cost) return { ok:false, error:'insufficient_credits', credits:cur, cost };

    const newCredits = Math.round((cur - cost) * 10) / 10;
    const updUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`;
    const r1 = await fetch(updUrl, {
      method:'PATCH',
      headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type':'application/json', 'Prefer':'return=representation' },
      body: JSON.stringify({ credits: newCredits })
    });
    if (!r1.ok) return { ok:false, error:'profile_update_failed', status:r1.status };

    // Best-effort ledger entry (if table exists). Do not fail the job if it doesn't.
    try{
      const ledUrl = `${SUPABASE_URL}/rest/v1/credits_ledger`;
      await fetch(ledUrl, {
        method:'POST',
        headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type':'application/json' },
        body: JSON.stringify({
          user_id: uid,
          delta: -cost,
          reason: 'gpt-image-1',
          meta: { version: VERSION_TAG }
        })
      });
    } catch(_e){}

    return { ok:true, credits_before:cur, credits_after:newCredits };
  } catch(e){
    return { ok:false, error:'debit_exception', message:String(e?.message || e) };
  }
}

async function insertPlaceholder({ uid, run_id, prompt, provider, extra }){
  if (!SUPABASE_URL || !SERVICE_KEY) return { ok:false, error:'missing_env' };
  const url = `${SUPABASE_URL}/rest/v1/user_generations`;
  const payload = {
    user_id: uid,
    run_id,
    provider,
    model: 'gpt-image-1',
    status: 'processing',
    prompt: prompt || '',
    meta: Object.assign({ version: VERSION_TAG }, (extra || {}))
  };
  const r = await fetch(url, {
    method:'POST',
    headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type':'application/json', 'Prefer':'return=representation' },
    body: JSON.stringify(payload)
  });
  if (!r.ok){
    const t = await r.text().catch(()=> '');
    return { ok:false, error:'insert_failed', status:r.status, raw:t };
  }
  const j = await r.json().catch(()=>null);
  const row = Array.isArray(j) ? j[0] : j;
  return { ok:true, row };
}

async function patchRow(row_id, patch){
  if (!SUPABASE_URL || !SERVICE_KEY || !row_id) return;
  const url = `${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(row_id)}`;
  await fetch(url, {
    method:'PATCH',
    headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify(patch)
  }).catch(()=>{});
}

function safeParse(body){
  try{ return JSON.parse(body || '{}'); } catch { return {}; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-USER-ID',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') return json(405, { error:'method_not_allowed' });

  if (!API_KEY) return json(500, { error:'missing_kie_api_key' });
  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error:'missing_supabase_env' });

  const body = safeParse(event.body);
  const uid = (event.headers && (event.headers['x-user-id'] || event.headers['X-USER-ID'])) || body.uid || body.user_id;
  const run_id = body.run_id || body.runId || body.runID;
  const prompt = (body.prompt || '').toString();
  const aspect_ratio = (body.aspect_ratio || body.aspect || '1:1').toString();
  const image_urls = Array.isArray(body.image_urls) ? body.image_urls : (Array.isArray(body.urls) ? body.urls : null);

  if (!uid) return json(400, { error:'missing_uid' });
  if (!run_id) return json(400, { error:'missing_run_id' });
  if (!prompt) return json(400, { error:'missing_prompt' });

  // Debit 2 credits (requested)
  const COST = 2;
  const debit = await debitCredits(uid, COST);
  if (!debit.ok) {
    if (debit.error === 'insufficient_credits') {
      return json(402, { error:'insufficient_credits', credits: debit.credits, cost: debit.cost });
    }
    return json(500, { error:'credit_debit_failed', detail: debit });
  }

  // Insert placeholder row first so callback can patch it later
  const ins = await insertPlaceholder({
    uid,
    run_id,
    prompt,
    provider: 'GPT-Image-1',
    extra: { aspect_ratio, has_images: !!(image_urls && image_urls.length), cost: COST }
  });
  if (!ins.ok) {
    return json(500, { error:'supabase_insert_failed', detail: ins });
  }
  const row_id = ins.row && ins.row.id ? ins.row.id : undefined;

  const cb = `${SITE_URL}/.netlify/functions/kie-callback`;

  const useImageToImage = !!(image_urls && image_urls.length);

  // KIE expects: { model, callBackUrl, input: { prompt, aspect_ratio, quality, ...(input_urls) } }
  const payload = {
    model: useImageToImage ? 'gpt-image/1.5-image-to-image' : 'gpt-image/1.5-text-to-image',
    callBackUrl: cb,
    input: Object.assign(
      {},
      useImageToImage ? { input_urls: image_urls } : {},
      { prompt, aspect_ratio, quality: 'high' }
    ),

    // meta for callback correlation (best-effort)
    meta:     { uid, run_id, row_id, version: VERSION_TAG },
    metadata: { uid, run_id, row_id, version: VERSION_TAG }
  };

  let text = '';
  let js = null;
  try{
    const r = await fetch(CREATE_URL, {
      method:'POST',
      headers:{
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    text = await r.text().catch(()=> '');
    try{ js = JSON.parse(text); } catch { js = { raw:text }; }

    if (!r.ok) {
      await patchRow(row_id, { status:'create_failed', raw: js });
      return json(502, { error:'kie_create_failed', status:r.status, raw: js });
    }
  } catch(e){
    await patchRow(row_id, { status:'create_failed', raw: { message:String(e?.message || e) } });
    return json(502, { error:'kie_create_exception', message:String(e?.message || e) });
  }

  // taskId might be in multiple shapes
  const taskId =
    (js && js.data && js.data.taskId) ||
    (js && js.taskId) ||
    (js && js.data && js.data.id) ||
    (js && js.id) ||
    null;

  if (taskId) {
    await patchRow(row_id, { task_id: taskId, status:'processing' });
  } else {
    await patchRow(row_id, { status:'processing', raw: js });
  }

  return json(200, { taskId, run_id, row_id, cost: COST });
};
