// netlify/functions/run-gpt-image-1.js (SAFE)
// Uses env OPENAI_API_KEY (no hardcoded secrets).
// Creates Replicate prediction, debits 4⚡, writes placeholder Usage, sets webhook.
//
// Env required:
//   REPLICATE_API_KEY
//   OPENAI_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

const BASE = (process.env.REPLICATE_BASE_URL || 'https://api.replicate.com/v1').replace(/\/+$/,'');
const TOKEN = process.env.REPLICATE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SUPABASE_URL  = process.env.SUPABASE_URL || '';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function cors(){ return {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-USER-ID, x-user-id',
}; }
const json = (c,o)=>({ statusCode:c, headers:{ 'Content-Type':'application/json', ...cors() }, body:JSON.stringify(o) }).then(r=>r.json()).then(j=>{ try{ if(Array.isArray(j)&&j[0]&&j[0].id){ webhook += `&row_id=${encodeURIComponent(j[0].id)}`; } }catch(_){} });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok:false, error:'method_not_allowed' }).then(r=>r.json()).then(j=>{ try{ if(Array.isArray(j)&&j[0]&&j[0].id){ webhook += `&row_id=${encodeURIComponent(j[0].id)}`; } }catch(_){} });

  try{
    if (!TOKEN) return json(500, { ok:false, error:'missing_replicate_key' }).then(r=>r.json()).then(j=>{ try{ if(Array.isArray(j)&&j[0]&&j[0].id){ webhook += `&row_id=${encodeURIComponent(j[0].id)}`; } }catch(_){} });
    if (!OPENAI_API_KEY) return json(500, { ok:false, error:'missing_openai_key' }).then(r=>r.json()).then(j=>{ try{ if(Array.isArray(j)&&j[0]&&j[0].id){ webhook += `&row_id=${encodeURIComponent(j[0].id)}`; } }catch(_){} });

    const uid = event.headers['x-user-id'] || event.headers['X-USER-ID'] || 'anon';
    const body = JSON.parse(event.body || '{}');
    const prompt = String(body.prompt || '').trim();
    const aspect_ratio = (body.aspect_ratio || '1:1').trim();
    const run_id = (body.run_id && String(body.run_id).trim()) || `${uid}-${Date.now()}`;
    const image_data_url = body.image_data_url || null;
    const image_data_urls = Array.isArray(body.image_data_urls) ? body.image_data_urls.filter(Boolean) : null;

    if (!prompt) return json(400, { ok:false, error:'missing_prompt' }).then(r=>r.json()).then(j=>{ try{ if(Array.isArray(j)&&j[0]&&j[0].id){ webhook += `&row_id=${encodeURIComponent(j[0].id)}`; } }catch(_){} });

    const proto = (event.headers['x-forwarded-proto'] || 'https').replace(/[^a-z]+/ig,'');
    const host  = (event.headers['x-forwarded-host'] || event.headers['host'] || '').replace(/\/+$/,'');
    let webhook = `${proto}://${host}/.netlify/functions/gpt-image-1-check?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    const endpoint = `${BASE}/models/openai/gpt-image-1/predictions`;

    const input = {
      openai_api_key: OPENAI_API_KEY,
      prompt,
      aspect_ratio,
      output_format: "png"
    };
    if (image_data_urls && image_data_urls.length){
      // Provide multiple aliases so the Replicate wrapper accepts one of them
      input.image = image_data_urls[0];
      input.images = image_data_urls;
      input.input_image = image_data_urls[0];
      input.input_images = image_data_urls;
      input.reference_images = image_data_urls;
      input.input_fidelity = "high";
    } else if (image_data_url){
      input.image = image_data_url;
      input.images = [image_data_url];
      input.input_image = image_data_url;
      input.input_images = [image_data_url];
      input.reference_images = [image_data_url];
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
    }).then(r=>r.json()).then(j=>{ try{ if(Array.isArray(j)&&j[0]&&j[0].id){ webhook += `&row_id=${encodeURIComponent(j[0].id)}`; } }catch(_){} });
    if (!res.ok){
      const t = await res.text().catch(()=>'');
      return json(res.status, { ok:false, error:'replicate_create_failed', details:t }).then(r=>r.json()).then(j=>{ try{ if(Array.isArray(j)&&j[0]&&j[0].id){ webhook += `&row_id=${encodeURIComponent(j[0].id)}`; } }catch(_){} });
    }

    const data = await res.json();
    const id = data && data.id;
    if (!id) return json(500, { ok:false, error:'missing_prediction_id' }).then(r=>r.json()).then(j=>{ try{ if(Array.isArray(j)&&j[0]&&j[0].id){ webhook += `&row_id=${encodeURIComponent(j[0].id)}`; } }catch(_){} });

    // --- Debit 4⚡ ---
    try{
      if (SUPABASE_URL && SERVICE_KEY && uid && uid !== 'anon') {
        const profGet = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
        const r0 = await fetch(profGet, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }).then(r=>r.json()).then(j=>{ try{ if(Array.isArray(j)&&j[0]&&j[0].id){ webhook += `&row_id=${encodeURIComponent(j[0].id)}`; } }catch(_){} });
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
        }).then(r=>r.json()).then(j=>{ try{ if(Array.isArray(j)&&j[0]&&j[0].id){ webhook += `&row_id=${encodeURIComponent(j[0].id)}`; } }catch(_){} });
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
        }).then(r=>r.json()).then(j=>{ try{ if(Array.isArray(j)&&j[0]&&j[0].id){ webhook += `&row_id=${encodeURIComponent(j[0].id)}`; } }catch(_){} });
      }
    }catch(e){ console.warn('[run-gpt-image-1] placeholder insert failed', e); }

    return json(201, { ok:true, id, run_id });
  }catch(e){
    console.error('[run-gpt-image-1] error', e);
    return json(500, { ok:false, error:'server_error' });
  }
};
