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

// Pricing (must match UI label)
const COST = 4;

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
    if (!uid) return json(401, { ok:false, error:'missing_user_id' });
    const prompt = String(body.prompt || '').trim();
    const aspect_ratio = (body.aspect_ratio ? String(body.aspect_ratio) : '1:1').trim();

    // --- New: accept direct public URLs as the primary image source ---
    const image_urls = Array.isArray(body.image_urls) ? body.image_urls.filter(Boolean) : null;
    const image_url  = body.image_url ? String(body.image_url).trim() : null;

    // Legacy/secondary sources (data URLs)
    const image_data_url = body.image_data_url || null;
    const image_data_urls = Array.isArray(body.image_data_urls) ? body.image_data_urls.filter(Boolean) : null;

    if (!prompt) return json(400, { ok:false, error:'missing_prompt' });

    const run_id = (body.run_id && String(body.run_id).trim()) || `${uid}-${Date.now()}`;

    const proto = (event.headers['x-forwarded-proto'] || 'https').replace(/[^a-z]+/ig,'');
    const host  = (event.headers['x-forwarded-host'] || event.headers['host'] || '').replace(/\/+$/,'');
    if (!host) return json(500, { ok:false, error:'missing_host_header' });


    // --- Supabase REST helpers (Service Role) ---
    const SB_HEADERS = {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    };
    async function sbGet(path, qs){
      const url = `${SUPABASE_URL}/rest/v1/${path}?${qs}`;
      const r = await fetch(url, { method:'GET', headers: { ...SB_HEADERS, 'Accept':'application/json' } });
      return r;
    }
    async function sbPost(path, payload){
      const url = `${SUPABASE_URL}/rest/v1/${path}`;
      const r = await fetch(url, { method:'POST', headers: { ...SB_HEADERS, 'Prefer':'return=representation' }, body: JSON.stringify(payload) });
      return r;
    }
    async function sbPatch(path, qs, payload){
      const url = `${SUPABASE_URL}/rest/v1/${path}?${qs}`;
      const r = await fetch(url, { method:'PATCH', headers: { ...SB_HEADERS, 'Prefer':'return=representation' }, body: JSON.stringify(payload) });
      return r;
    }

    // --- Insert placeholder row FIRST so we have row_id ---
    let row_id = null;
    let existing = null;
    // --- Kling 2.6 style run_id idempotency: reuse existing run if present ---
    try{
      if (SUPABASE_URL && SERVICE_KEY && uid && !row_id){
        const rFind = await sbGet('user_generations', `select=id,meta,charged,provider&user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&limit=1`);
        if (rFind.ok){
          const arr = await rFind.json().catch(()=>null);
          if (Array.isArray(arr) && arr[0]) existing = arr[0];
        }
      }
    }catch(e){}
    if (existing && existing.id){
      row_id = existing.id;
      const prevId = existing?.meta?.prediction_id || existing?.meta?.id || null;
      if (prevId && existing?.charged === true){
        return json(200, { ok:true, id: prevId, run_id, row_id, reused:true });
      }
    }
    try {
      if (SUPABASE_URL && SERVICE_KEY && uid && !row_id){
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

    // --- Choose images by precedence:
    // 1) image_urls (array) or image_url (single)  -> treat as public URLs
    // 2) image_data_urls (array) or image_data_url (single) -> data URLs (legacy)
    let chosenImages = null;
    if (image_urls && image_urls.length){
      chosenImages = image_urls;
    } else if (image_url){
      chosenImages = [image_url];
    } else if (image_data_urls && image_data_urls.length){
      chosenImages = image_data_urls;
    } else if (image_data_url){
      chosenImages = [image_data_url];
    }

    if (chosenImages && chosenImages.length){
      // Map to all commonly-accepted keys for GPT-Image-1 on Replicate
      input.image = chosenImages[0];
      input.images = chosenImages;
      input.input_image = chosenImages[0];
      input.input_images = chosenImages;
      input.reference_images = chosenImages;
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

    // Persist prediction id on the usage row (best-effort)
    try{
      if (SUPABASE_URL && SERVICE_KEY && uid && row_id){
        const metaPatch = { ...(existing?.meta || {}), source:'gpt-image-1', run_id, model:'gpt-image-1', status:'submitted', prediction_id: id };
        await sbPatch('user_generations', `id=eq.${encodeURIComponent(row_id)}`, { meta: metaPatch });
      }
    }catch(e){}

    // --- Server-side deduction (Service Role) + idempotent charge by run_id (Kling 2.6 style) ---
    try{
      if (SUPABASE_URL && SERVICE_KEY && uid){
        // If we already had an existing row marked charged, do not charge again
        const alreadyCharged = (existing && existing.charged === true);
        if (!alreadyCharged){
          const claim = `${run_id}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
          // Claim (best-effort)
          if (row_id){
            try{ await sbPatch('user_generations', `id=eq.${encodeURIComponent(row_id)}`, { charge_claim: claim }); }catch(e){}
          }
          // Read credits
          const rProf = await sbGet('profiles', `select=credits&user_id=eq.${encodeURIComponent(uid)}&limit=1`);
          let cur = null;
          if (rProf.ok){
            const arr = await rProf.json().catch(()=>null);
            cur = (Array.isArray(arr) && arr[0] && typeof arr[0].credits === 'number') ? arr[0].credits : (Array.isArray(arr) && arr[0] ? arr[0].credits : null);
          }
          cur = (cur == null) ? 0 : cur;
          if (cur < COST){
            // Do not cancel the prediction here; client pre-check should prevent this. Mark row as not charged.
            if (row_id){
              try{
                const metaPatch = { ...(existing?.meta || {}), source:'gpt-image-1', run_id, model:'gpt-image-1', status:'submitted', prediction_id: id, charge_error:'insufficient_credits' };
                await sbPatch('user_generations', `id=eq.${encodeURIComponent(row_id)}`, { meta: metaPatch });
              }catch(e){}
            }
            return json(402, { ok:false, error:'not_enough_credits', need:COST, have:cur, id, run_id, row_id });
          }
          const next = Math.round((cur - COST) * 10) / 10; // keep one decimal safety
          const rUp = await sbPatch('profiles', `user_id=eq.${encodeURIComponent(uid)}`, { credits: next });
          if (!rUp.ok){
            // If debit failed, return error (prediction still running)
            return json(500, { ok:false, error:'credits_debit_failed', id, run_id, row_id });
          }
          // Mark charged on generation row (best-effort)
          if (row_id){
            try{
              const metaPatch = { ...(existing?.meta || {}), source:'gpt-image-1', run_id, model:'gpt-image-1', status:'submitted', prediction_id: id, charged_cost: COST, charged_at: new Date().toISOString() };
              await sbPatch('user_generations', `id=eq.${encodeURIComponent(row_id)}`, { charged: true, meta: metaPatch, charge_claim: claim });
            }catch(e){}
          }
        }
      }
    }catch(e){
      // Do not fail run if charging bookkeeping fails; return id so polling can continue.
    }

    return json(201, { ok:true, id, run_id, row_id });
  }catch(e){
    return json(500, { ok:false, error:'server_error', details: String(e && e.message || e) });
  }
};
