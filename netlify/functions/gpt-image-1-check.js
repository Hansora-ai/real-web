// netlify/functions/gpt-image-1-check.js
// GET: poll Replicate for prediction id and backfill Usage on success
// POST: Replicate webhook calls here on completion; backfill immediately
//
// Env: REPLICATE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
const BASE = (process.env.REPLICATE_BASE_URL || 'https://api.replicate.com/v1').replace(/\/+$/,'');
const TOKEN = process.env.REPLICATE_API_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL || '';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function cors(){ return {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
}; }
const json = (c,o)=>({ statusCode:c, headers:{ 'Content-Type':'application/json', ...cors() }, body:JSON.stringify(o) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { ok:false, error:'method_not_allowed' });

  try{
    const qs = event.queryStringParameters || {};
    let id = (qs.id || '').trim();
    const uid = (qs.uid || '').trim();
    const run_id = (qs.run_id || '').trim();

    if (event.httpMethod === 'POST'){
      let body = {};
      try { body = JSON.parse(event.body || '{}'); } catch {}
      const status = String(body.status || '').toLowerCase();
      const out = body.output;
      if (!id) id = body.id || (body.prediction && body.prediction.id) || null;

      if (status === 'succeeded'){
        const image_url = extractImageUrl(out);
        await backfillUsage({ uid, run_id, id, image_url, input: body.input || {} });
        return json(200, { ok:true, status:'succeeded' });
      }
      return json(200, { ok:true, status: status || 'pending' });
    }

    // GET polling
    if (!id) return json(400, { ok:false, error:'missing_id' });
    const res = await fetch(`${BASE}/predictions/${encodeURIComponent(id)}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    if(!res.ok){
      const t = await res.text().catch(()=>'');
      return json(res.status, { ok:false, error:'replicate_get_failed', details:t });
    }
    const data = await res.json();
    const status = String(data.status || '').toLowerCase();
    if (status === 'succeeded'){
      const image_url = extractImageUrl(data.output);
      await backfillUsage({ uid, run_id, id, image_url, input: data.input || {} });
      return json(200, { ok:true, status:'succeeded', image_url });
    }
    return json(200, { ok:true, status });
  }catch(e){
    console.error('[gpt-image-1-check] error', e);
    return json(500, { ok:false, error:'server_error' });
  }
};

function extractImageUrl(out){
  if (!out) return null;
  if (Array.isArray(out)) {
    const first = out[0];
    return (typeof first === 'string') ? first : (first && first.url) || null;
  }
  return (typeof out === 'string') ? out : (out && out.url) || null;
}

async function backfillUsage({ uid, run_id, id, image_url, input }){
  if (!(SUPABASE_URL && SERVICE_KEY && uid)) return;
  try{
    const ug = `${SUPABASE_URL.replace(/\/+$/,'')}/rest/v1/user_generations`;
    const prompt = input?.prompt || null;
    const meta = {
      provider: 'gpt-image-1',
      source: 'gpt-image-1',
      run_id: run_id || null,
      prediction_id: id || null,
      model: 'gpt-image-1',
      aspect_ratio: input?.aspect_ratio || null,
      status: 'succeeded',
      input_fidelity: input?.input_fidelity || null
    };

    let updated = false;
    if (run_id){
      const patch = await fetch(`${ug}?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`, {
        method: 'PATCH',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ result_url: image_url, provider: 'GPT-Image-1', kind: 'image', prompt, meta })
      });
      if (patch.ok){
        const arr = await patch.json().catch(()=>[]);
        updated = Array.isArray(arr) && arr.length > 0;
      }
    }
    if (!updated && id){
      const patch2 = await fetch(`${ug}?user_id=eq.${encodeURIComponent(uid)}&meta->>prediction_id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ result_url: image_url, provider: 'GPT-Image-1', kind: 'image', prompt, meta })
      });
      if (patch2.ok){
        const arr = await patch2.json().catch(()=>[]);
        updated = Array.isArray(arr) && arr.length > 0;
      }
    }
    if (!updated){
      await fetch(ug, {
        method: 'POST',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          user_id: uid,
          provider: 'GPT-Image-1',
          kind: 'image',
          prompt,
          result_url: image_url,
          meta
        })
      });
    }
  }catch(e){
    console.warn('[gpt-image-1-check] backfill failed', e);
  }
}
