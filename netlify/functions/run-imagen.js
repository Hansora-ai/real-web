// netlify/functions/run-imagen.js
// Submit Replicate Imagen prediction (fast or ultra) and ensure Usage is populated.
// SECURITY: Credits are deducted ONLY here (SERVICE ROLE). Browser must never update credits.
//
// Inputs: JSON { prompt, model: 'fast'|'ultra', aspect_ratio, run_id? }
// Headers: X-USER-ID: <uuid>
//
// Env: REPLICATE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const BASE  = (process.env.REPLICATE_BASE_URL || 'https://api.replicate.com/v1').replace(/\/+$/,'');
const TOKEN = process.env.REPLICATE_API_KEY;

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/,'');
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function cors(){ return {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-USER-ID, x-user-id',
}; }
const json = (code, obj) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json', ...cors() },
  body: JSON.stringify(obj),
});

async function sbGet(path){
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
  });
  const t = await r.text().catch(()=> '');
  let j = null;
  try{ j = t ? JSON.parse(t) : null; }catch{ j = null; }
  return { ok: r.ok, status: r.status, text: t, json: j };
}

async function sbPatch(path, bodyObj){
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'PATCH',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(bodyObj),
  });
  const t = await r.text().catch(()=> '');
  let j = null;
  try{ j = t ? JSON.parse(t) : null; }catch{ j = null; }
  return { ok: r.ok, status: r.status, text: t, json: j };
}

async function sbPost(path, bodyObj){
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(bodyObj),
  });
  return { ok: r.ok, status: r.status, text: await r.text().catch(()=> '') };
}

// Idempotency: if the same uid+run_id is retried/spammed, reuse the already-created prediction_id (and do NOT double-charge).
async function findExistingRun(uid, run_id){
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  // Supabase PostgREST supports JSON path filters like meta->>run_id
  const q = `/rest/v1/user_generations?user_id=eq.${encodeURIComponent(uid)}&meta->>source=eq.imagen&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=meta&limit=1`;
  const r = await sbGet(q);
  const row = (r.ok && Array.isArray(r.json) && r.json[0]) ? r.json[0] : null;
  const meta = row?.meta || null;
  const prediction_id = meta?.prediction_id || null;
  const charged = meta?.charged === true;
  return prediction_id ? { prediction_id, charged } : null;
}

async function cancelPrediction(predictionId){
  try{
    if (!predictionId || !TOKEN) return false;
    const url = `${BASE}/predictions/${encodeURIComponent(predictionId)}/cancel`;
    const r = await fetch(url, { method:'POST', headers:{ 'Authorization': `Bearer ${TOKEN}` } });
    return r.ok;
  }catch{ return false; }
}

// Debit credits with optimistic concurrency (prevents double-spend races).
async function debitCredits(uid, cost){
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('missing_supabase_service');
  // Read
  const profGet = `/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
  const r0 = await sbGet(profGet);
  let c0 = (Array.isArray(r0.json) && r0.json[0] && typeof r0.json[0].credits === 'number')
    ? r0.json[0].credits
    : 0;

  if (c0 < cost) return { ok:false, error:'insufficient_credits', credits:c0 };

  // Try to write with "credits must still be == c0" condition (optimistic lock). Retry a couple times if raced.
  for (let i=0;i<3;i++){
    const next = Math.max(0, Number((c0 - cost).toFixed(1)));
    const patchPath = `/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&credits=eq.${encodeURIComponent(String(c0))}`;
    const r1 = await sbPatch(patchPath, { credits: next });

    if (r1.ok && Array.isArray(r1.json) && r1.json.length === 1){
      return { ok:true, before:c0, after: next };
    }

    // Race: re-read and retry
    const rr = await sbGet(profGet);
    const cN = (Array.isArray(rr.json) && rr.json[0] && typeof rr.json[0].credits === 'number')
      ? rr.json[0].credits
      : 0;
    if (cN < cost) return { ok:false, error:'insufficient_credits', credits:cN };
    // update local c0 for next loop
    // eslint-disable-next-line no-unused-vars
    c0 = cN;
  }
  return { ok:false, error:'debit_race' };
}

async function insertUsageRow(uid, providerLabel, prompt, run_id, prediction_id, model, cost){
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  const ug = `/rest/v1/user_generations`;
  const meta = { source:'imagen', run_id, prediction_id, model, status:'pending', charged:true, cost };
  await sbPost(ug, {
    user_id: uid,
    provider: providerLabel,
    kind: 'image',
    prompt,
    result_url: null,
    meta,
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok:false, error:'method_not_allowed' });

  try{
    if (!TOKEN) return json(500, { ok:false, error:'missing_replicate_key' });

    const body = JSON.parse(event.body || '{}');
    const prompt = (body.prompt || '').trim();
    const model  = (body.model === 'ultra') ? 'ultra' : 'fast';
    const aspect_ratio = (body.aspect_ratio || '1:1').trim();

    const uid = event.headers['x-user-id'] || event.headers['X-USER-ID'] || 'anon';
    const run_id = (body.run_id && String(body.run_id).trim()) || `${uid}-${Date.now()}`;

    if (!prompt) return json(400, { ok:false, error:'missing_prompt' });
    if (!uid || uid === 'anon') return json(401, { ok:false, error:'unauthorized' });

    const cost = (model === 'ultra') ? 1.0 : 0.5;

    // Idempotency: if already created for this run_id, reuse it.
    try{
      const existing = await findExistingRun(uid, run_id);
      if (existing?.prediction_id){
        return json(200, { ok:true, id: existing.prediction_id, run_id, reused:true });
      }
    }catch(e){
      console.warn('[run-imagen] idempotency lookup failed', e);
      // continue (do not block generation)
    }

    const proto = (event.headers['x-forwarded-proto'] || 'https').replace(/[^a-z]+/ig,'');
    const host  = (event.headers['x-forwarded-host'] || event.headers['host'] || '').replace(/\/+$/,'');
    const webhook = `${proto}://${host}/.netlify/functions/imagen-check?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    const endpoint = (model === 'ultra')
      ? `${BASE}/models/google/imagen-4-ultra/predictions`
      : `${BASE}/models/google/imagen-4-fast/predictions`;

    const payload = {
      input: { prompt, aspect_ratio },
      webhook,
      webhook_events_filter: ['completed'],
    };

    // 1) Submit prediction to provider (this is what your UI calls "Submitted")
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errTxt = await res.text().catch(()=>'');
      return json(res.status, { ok:false, error:'replicate_create_failed', details: errTxt });
    }

    const data = await res.json();
    const id = data?.id;
    if (!id) return json(500, { ok:false, error:'missing_prediction_id' });

    // 2) Debit credits server-side exactly once.
    //    If debit fails due to insufficient credits (race), attempt to cancel the submitted prediction.
    let debited = null;
    try{
      debited = await debitCredits(uid, cost);
      if (!debited.ok){
        const cancelled = await cancelPrediction(id);
        return json(402, { ok:false, error: debited.error || 'debit_failed', cancelled, id, run_id });
      }
    }catch(e){
      console.warn('[run-imagen] debit failed', e);
      const cancelled = await cancelPrediction(id);
      return json(500, { ok:false, error:'debit_failed', cancelled, id, run_id });
    }

    // 3) Insert placeholder Usage row (charged=true) so it appears even if page is closed.
    try{
      const providerLabel = (model === 'ultra') ? 'Imagen Ultra' : 'Imagen Fast';
      await insertUsageRow(uid, providerLabel, prompt, run_id, id, model, cost);
    }catch(e){
      console.warn('[run-imagen] placeholder insert failed', e);
      // Do not fail the request: prediction is already running and credits were debited.
    }

    return json(201, { ok:true, id, run_id });
  }catch(e){
    console.error('[run-imagen] error', e);
    return json(500, { ok:false, error:'server_error' });
  }
};
