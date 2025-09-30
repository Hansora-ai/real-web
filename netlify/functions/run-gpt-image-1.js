// netlify/functions/run-gpt-image-1.js
// Creates a Replicate GPT-Image-1 prediction.
// Inserts a placeholder Usage row FIRST so webhook carries row_id.
// Returns { id, run_id, row_id } to the client.
//
// Required env: REPLICATE_API_KEY, OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional: REPLICATE_BASE_URL

const BASE = (process.env.REPLICATE_BASE_URL || 'https://api.replicate.com/v1').replace(/\/+$/,'');
const TOKEN = process.env.REPLICATE_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const SUPABASE_URL  = (process.env.SUPABASE_URL || '').replace(/\/+$/,'');
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function cors(){ return {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
}; }
const json = (c,o)=>({ statusCode:c, headers:{ 'Content-Type':'application/json', ...cors() }, body:JSON.stringify(o) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok:false, error:'method_not_allowed' });

  try{
    if (!TOKEN) return json(500, { ok:false, error:'missing_replicate_key' });
    if (!OPENAI_API_KEY) return json(500, { ok:false, error:'missing_openai_key' });

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch(e){ return json(400, { ok:false, error:'bad_json', details: String(e.message || e) }); }

    const uid = (event.headers['x-user-id'] || event.headers['X-USER-ID'] || '').trim() || null;
    const prompt = String(body.prompt || '').trim();
    const aspect_ratio = (body.aspect_ratio ? String(body.aspect_ratio) : '1:1').trim();
    const image_data_url = body.image_data_url || null;
    const image_data_urls = Array.isArray(body.image_data_urls) ? body.image_data_urls.filter(Boolean) : null;
    if (!prompt) return json(400, { ok:false, error:'missing_prompt' });

    const run_id = (body.run_id && String(body.run_id).trim()) || `${uid || 'anon'}-${Date.now()}`;

    const proto = (event.headers['x-forwarded-proto'] || 'https').replace(/[^a-z]+/ig,'');
    const host  = (event.headers['x-forwarded-host'] || event.headers['host'] || '').replace(/\/+$/,'');
    if (!host) return json(500, { ok:false, error:'missing_host_header' });

    // --- Insert placeholder row FIRST so we have row_id ---
    let row_id = null;
    try {
      if (SUPABASE_URL && SERVICE_KEY && uid){
        const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
        const meta = { source:'gpt-image-1', run_id, model:'gpt-image-1', status:'pending' };
        const rIns = await fetch(ug, {
          method: 'POST',
          headers: {
            'apikey': SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
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
        if (rIns.ok){
          const arr = await rIns.json().catch(()=>null);
          if (Array.isArray(arr) && arr[0] && arr[0].id) row_id = arr[0].id;
        }
      }
    } catch(e){
      // Do not fail the run if usage pre-insert fails
    }

    // Build webhook WITH row_id (if available)
    let webhook = `${proto}://${host}/.netlify/functions/gpt-image-1-check?uid=${encodeURIComponent(uid || '')}&run_id=${encodeURIComponent(run_id)}`;
    if (row_id) webhook += `&row_id=${encodeURIComponent(row_id)}`;

    // Replicate input
    const input = { openai_api_key: OPENAI_API_KEY, prompt, aspect_ratio, output_format: "png" };
    if (image_data_urls && image_data_urls.length){
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

    // Create prediction
    const endpoint = `${BASE}/models/openai/gpt-image-1/predictions`;
    const payload = { input, webhook, webhook_events_filter: ['completed'] };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok){
      const t = await res.text().catch(()=>'');
      return json(res.status, { ok:false, error:'replicate_create_failed', details:t });
    }

    const data = await res.json().catch(()=>null);
    const id = data && data.id;
    if (!id) return json(502, { ok:false, error:'missing_prediction_id' });

    return json(201, { ok:true, id, run_id, row_id });
  }catch(e){
    return json(500, { ok:false, error:'server_error', details: String(e && e.message || e) });
  }
};
