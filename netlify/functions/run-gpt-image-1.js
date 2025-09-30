// netlify/functions/run-gpt-image-1.js
// Creates a GPT-Image-1 prediction on Replicate, writes a placeholder Usage row,
// sets a webhook so completion backfills even if the page is closed, and debits 4⚡.
//
// Inputs (JSON): { prompt, aspect_ratio, run_id?, image_data_url? }
// Header: X-USER-ID
//
// Env:
//   REPLICATE_API_KEY (required)
//   OPENAI_API_KEY (preferred)  -- OpenAI key used by Replicate model
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (for Usage + debit)
//
const BASE = (process.env.REPLICATE_BASE_URL || 'https://api.replicate.com/v1').replace(/\/+$/,'');
const TOKEN = process.env.REPLICATE_API_KEY;
// Use env OPENAI_API_KEY if present; otherwise fall back to the key the user provided.
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "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";

const SUPABASE_URL  = process.env.SUPABASE_URL || '';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function cors(){ return {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-USER-ID, x-user-id',
}; }
const json = (c,o)=>({ statusCode:c, headers:{ 'Content-Type':'application/json', ...cors() }, body:JSON.stringify(o) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok:false, error:'method_not_allowed' });

  try{
    if (!TOKEN) return json(500, { ok:false, error:'missing_replicate_key' });

    const uid = event.headers['x-user-id'] || event.headers['X-USER-ID'] || 'anon';
    const body = JSON.parse(event.body || '{}');
    const prompt = String(body.prompt || '').trim();
    const aspect_ratio = (body.aspect_ratio || '1:1').trim();
    const run_id = (body.run_id && String(body.run_id).trim()) || `${uid}-${Date.now()}`;
    const image_data_url = body.image_data_url || null;

    if (!prompt) return json(400, { ok:false, error:'missing_prompt' });

    const proto = (event.headers['x-forwarded-proto'] || 'https').replace(/[^a-z]+/ig,'');
    const host  = (event.headers['x-forwarded-host'] || event.headers['host'] || '').replace(/\/+$/,'');
    const webhook = `${proto}://${host}/.netlify/functions/gpt-image-1-check?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    const endpoint = `${BASE}/models/openai/gpt-image-1/predictions`;

    const input = {
      openai_api_key: OPENAI_API_KEY,
      prompt,
      aspect_ratio,
      output_format: "png"
    };
    if (image_data_url) {
      input.input_images = [ image_data_url ];
      input.input_fidelity = "high";
    }

    const payload = { input, webhook, webhook_events_filter: ['completed'] };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok){
      const t = await res.text().catch(()=>''); 
      return json(res.status, { ok:false, error:'replicate_create_failed', details:t });
    }

    const data = await res.json();
    const id = data && data.id;
    if (!id) return json(500, { ok:false, error:'missing_prediction_id' });

    // --- Debit 4⚡ ---
    try{
      if (SUPABASE_URL && SERVICE_KEY && uid && uid !== 'anon') {
        const profGet = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
        const r0 = await fetch(profGet, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
        const j0 = await r0.json();
        const c0 = (Array.isArray(j0) && j0[0] && j0[0].credits) || 0;
        const next = Math.max(0, c0 - 4);
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
    }catch(e){ console.warn('[run-gpt-image-1] debit failed', e); }

    // --- Placeholder Usage row ---
    try{
      if (SUPABASE_URL && SERVICE_KEY && uid && uid !== 'anon') {
        const ug = `${SUPABASE_URL.replace(/\/+$/,'')}/rest/v1/user_generations`;
        const meta = { source:'gpt-image-1', run_id, prediction_id: id, model:'gpt-image-1', status:'pending' };
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
            provider: 'GPT-Image-1',
            kind: 'image',
            prompt,
            result_url: null,
            meta,
          }),
        });
      }
    }catch(e){ console.warn('[run-gpt-image-1] placeholder insert failed', e); }

    return json(201, { ok:true, id, run_id });
  }catch(e){
    console.error('[run-gpt-image-1] error', e);
    return json(500, { ok:false, error:'server_error' });
  }
};
