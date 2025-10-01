// netlify/functions/run-kling.js
// Creates a Replicate Kling prediction.
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

function first(v){ return Array.isArray(v) ? v[0] : v; }
function getHeader(event, k){
  return event.headers[k] || event.headers[k.toLowerCase()] || event.headers[k.toUpperCase()] || null;
}
function getUID(event, body){
  const qs = new URLSearchParams(event.queryStringParameters || {});
  return (
    (getHeader(event,'x-user-id') || '') ||
    (body && (body.uid || '')) ||
    (qs.get('uid') || '')
  ).trim();
}

// --- Server-side debit (7⚡ for 5s, 13⚡ for 10s) ---
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
      body: JSON.stringify([{ credits: newCredits }])
    });
    if (!r1.ok) return { ok:false, error:'profile_update_failed', status:r1.status };
    return { ok:true, credits:newCredits };
  }catch(e){ return { ok:false, error:'server_exception', details:String(e&&e.message||e) }; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok:false, error:'method_not_allowed' });

  try{
    if (!TOKEN) return json(500, { ok:false, error:'missing_replicate_key' });
    if (!OPENAI_API_KEY) return json(500, { ok:false, error:'missing_openai_key' });

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch(e){ return json(400, { ok:false, error:'bad_json', details: String(e.message || e) }); }

    const uid_hdr = (event.headers['x-user-id'] || event.headers['X-USER-ID'] || '').trim();
    const uid = (uid_hdr || (body.uid || '') || (new URLSearchParams(event.queryStringParameters || {}).get('uid') || '')).trim();
    if (!uid) return json(401, { ok:false, error:'missing_uid' });

    const prompt = String(body.prompt || '').trim();
    const aspect_ratio = (body.aspect_ratio ? String(body.aspect_ratio) : '1:1').trim();
    const image_data_url = body.image_data_url || null;
    const image_data_urls = Array.isArray(body.image_data_urls) ? body.image_data_urls.filter(Boolean) : null;
    const duration = (body && (body.duration === 10 || String(body.duration) === '10')) ? 10 : 5;
    if (!prompt && !(image_data_url || (image_data_urls && image_data_urls.length))) return json(400, { ok:false, error:'missing_input', details:'Provide a prompt or an image.' });

    const cost = duration === 10 ? 13 : 7;

    const run_id = (body.run_id && String(body.run_id).trim()) || `${uid || 'anon'}-${Date.now()}`;

    const proto = (event.headers['x-forwarded-proto'] || 'https').replace(/[^a-z]+/ig,'');
    const host  = (event.headers['x-forwarded-host'] || event.headers['host'] || '').replace(/\/+$/,'');
    if (!host) return json(500, { ok:false, error:'missing_host_header' });

    // --- Insert placeholder row FIRST so we have row_id ---
    let row_id = null;
    try {
      if (SUPABASE_URL && SERVICE_KEY && uid){
        const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
        const meta = { source:'kling', run_id, model:'kling', status:'pending' };
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
            provider: 'Kling',
            kind: 'video', // 1:1 fix: this is a VIDEO flow
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
    let webhook = `${proto}://${host}/.netlify/functions/kling-check?uid=${encodeURIComponent(uid || '')}&run_id=${encodeURIComponent(run_id)}`;
    if (row_id) webhook += `&row_id=${encodeURIComponent(row_id)}`;

    // Replicate input
    const input = { prompt, aspect_ratio, duration };
    if (image_data_urls && image_data_urls.length){
      input.image = image_data_urls[0];
    } else if (image_data_url){
      input.image = image_data_url;
    }
    if (false){
      input.input_image = image_data_urls && image_data_urls[0];
      input.input_images = image_data_urls || null;
      input.reference_images = image_data_urls || null;
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
    // Try model predictions endpoint first
    let endpoint = `${BASE}/models/kwaivgi/kling-v2.5-turbo-pro/predictions`;
    let payload = { input, webhook, webhook_events_filter: ['completed'] };

    let res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // If the model route is not found, fall back to /predictions using the latest version id
    if (res.status === 404) {
      try{
        const metaRes = await fetch(`${BASE}/models/kwaivgi/kling-v2.5-turbo-pro`, {
          headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        if (metaRes.ok){
          const meta = await metaRes.json().catch(()=>null);
          const ver = meta && meta.latest_version && meta.latest_version.id;
          if (ver){
            const p2 = { version: ver, input, webhook, webhook_events_filter: ['completed'] };
            const res2 = await fetch(`${BASE}/predictions`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(p2),
            });
            if (res2.ok){
              res = res2;
            }
          }
        }
      }catch(_e){}
    }
    const data = await res.json().catch(()=>null);
    const id = data && data.id;
    if (!id) return json(502, { ok:false, error:'missing_prediction_id' });

    // --- Debit after creation accepted; cancel if debit fails ---
    const debit = await debitCredits(uid, cost);
    if (!debit.ok){
      try{ await fetch(`${BASE}/predictions/${encodeURIComponent(id)}/cancel`, { method:'POST', headers:{ 'Authorization': `Bearer ${TOKEN}` } }); }catch(_){}
      return json(402, { ok:false, error:'not_enough_credits', details: debit });
    }

    return json(201, { ok:true, id, run_id, row_id, debited: cost, credits: debit.credits });
  }catch(e){
    return json(500, { ok:false, error:'server_error', details: String(e && e.message || e) });
  }
};
