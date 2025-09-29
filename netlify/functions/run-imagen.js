// netlify/functions/run-imagen.js
// Submit Replicate Imagen prediction (fast or ultra) and ensure Usage is populated
// even if the user closes the page: we (1) create with a webhook, (2) insert a placeholder row.
//
// Inputs: JSON { prompt, model: 'fast'|'ultra', aspect_ratio, run_id? }
// Headers: X-USER-ID: <uuid>
//
// Env: REPLICATE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const BASE = (process.env.REPLICATE_BASE_URL || 'https://api.replicate.com/v1').replace(/\/+$/,'');
const TOKEN = process.env.REPLICATE_API_KEY;

const SUPABASE_URL  = process.env.SUPABASE_URL || '';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function cors(){ return {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-USER-ID, x-user-id',
}; }
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', ...cors() }, body: JSON.stringify(obj) });

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

    // --- Server-side credit debit (0.5 fast, 1.0 ultra) ---
    try{
      if (SUPABASE_URL && SERVICE_KEY && uid && uid !== 'anon') {
        const cost = (model === 'ultra') ? 1.0 : 0.5;
        // read
        const profGet = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
        const r0 = await fetch(profGet, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
        const j0 = await r0.json();
        const c0 = (Array.isArray(j0) && j0[0] && j0[0].credits) || 0;
        // write
        const next = Math.max(0, c0 - cost);
        await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`, {
          method: 'PATCH',
          headers: {
            'apikey': SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ credits: next }),
        });
      }
    } catch (e) {
      console.warn('[run-imagen] debit failed', e);
    }

    // --- Insert placeholder Usage row so it appears even if page is closed ---
    try{
      if (SUPABASE_URL && SERVICE_KEY && uid && uid !== 'anon') {
        const ug = `${SUPABASE_URL.replace(/\/+$/,'')}/rest/v1/user_generations`;
        const providerLabel = (model === 'ultra') ? 'Imagen Ultra' : 'Imagen Fast';
        const meta = { source:'imagen', run_id, prediction_id: id, model, status:'pending' };
        await fetch(ug, {
          method: 'POST',
          headers: {
            'apikey': SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({
            user_id: uid,
            provider: providerLabel,
            kind: 'image',
            prompt,
            result_url: null,
            meta,
          }),
        });
      }
    } catch (e) {
      console.warn('[run-imagen] placeholder insert failed', e);
    }

    return json(201, { ok:true, id, run_id });
  }catch(e){
    console.error('[run-imagen] error', e);
    return json(500, { ok:false, error:'server_error' });
  }
};
