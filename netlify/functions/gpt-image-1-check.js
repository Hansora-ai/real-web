// netlify/functions/gpt-image-1-check.js
// GET: poll Replicate for prediction id and backfill Usage on success
// POST: Replicate webhook calls here on completion; backfill immediately
//
// Env required: REPLICATE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional: SUPABASE_BUCKET (defaults to 'downloads'), REPLICATE_BASE_URL

const BASE = (process.env.REPLICATE_BASE_URL || 'https://api.replicate.com/v1').replace(/\/+$/,'');
const TOKEN = process.env.REPLICATE_API_KEY || '';
const SUPABASE_URL  = (process.env.SUPABASE_URL || '').replace(/\/+$/,'');
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// ---------- CORS / helpers ----------
function cors(){ return {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
}; }
const json = (c,o)=>({ statusCode:c, headers:{ 'Content-Type':'application/json', ...cors() }, body:JSON.stringify(o) });

function getParam(searchParams, name){
  const v = searchParams.get(name);
  return (v === null || v === undefined || v === '') ? null : v;
}

// ---------- URL extraction (string | {url} | string[] | {url}[]) ----------
function extractImageUrl(out){
  if (!out) return null;
  if (typeof out === 'string') return out;
  if (Array.isArray(out)){
    if (out.length === 0) return null;
    const first = out[0];
    return (typeof first === 'string') ? first : (first && first.url) || null;
  }
  if (typeof out === 'object'){
    return out.url || null;
  }
  return null;
}

// ---------- Supabase caching (moved to top-level scope) ----------
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'downloads';

/**
 * Fetches the sourceUrl image and stores it into Supabase Storage public bucket.
 * Returns the permanent public URL, or null if caching failed or envs missing.
 */
async function __cacheToSupabase(sourceUrl, nameHint, stableKey){
  try{
    if (!(SUPABASE_URL && SERVICE_KEY && sourceUrl)) return null;

    const getRes = await fetch(sourceUrl);
    if (!getRes.ok) return null;

    const ct = getRes.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await getRes.arrayBuffer());

    const path = __buildPath(nameHint, stableKey);
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${path}`;

    const up = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': ct,
        'x-upsert': 'true',
      },
      body: buf,
    });
    if (!up.ok) {
      // console.warn('[gpt-image-1-check] upload failed', await up.text());
      return null;
    }
    return `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(SUPABASE_BUCKET)}/${path}`;
  }catch(e){
    // console.warn('[gpt-image-1-check] cache error', e);
    return null;
  }
}

function __buildPath(nameHint, stableKey){
  const d = new Date();
  const y = String(d.getUTCFullYear());
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  const day = String(d.getUTCDate()).padStart(2,'0');
  const safe = String(nameHint || 'gpt-image-1.png')
    .replace(/[^\w.\- ]+/g,'_')
    .slice(0,150);
  if (stableKey) return `${y}/${m}/${day}/${String(stableKey).replace(/[^\w.\-]+/g,'_').slice(0,48)}-${safe}`;
  const rand = Math.random().toString(36).slice(2,10);
  return `${y}/${m}/${day}/${rand}-${safe}`;
}

// ---------- DB backfill ----------
async function backfillUsage({ uid, run_id, id, row_id, image_url, input }){
  // If no DB envs or no image URL, nothing to patch.
  if (!(SUPABASE_URL && SERVICE_KEY)) return;

  let finalUrl = image_url;
  // Try to cache to Supabase; if it works, prefer the cached URL.
  try{
    const hint = (input && (input.filename || input.name)) || `gpt-image-1-${id||run_id||Date.now()}.png`;
    const stableKey = row_id || id || run_id || Date.now().toString(36);
    const cached = await __cacheToSupabase(image_url, hint, stableKey);
    if (cached) finalUrl = cached;
  }catch{/* ignore */}

  // Minimal metadata we already have
  const prompt = (input && (input.prompt || input.caption)) || null;
  const meta = {
    run_id: run_id || null,
    prediction_id: id || null,
    provider: 'replicate',
    input: input || {}
  };

  // PATCH by row_id if we have it; otherwise try run_id; finally, insert as fallback
  try{
    const headers = {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': 'return=representation'
    };

    // Prefer updating existing row when we can
    if (row_id){
      const url = `${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(row_id)}`;
      const r = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ result_url: finalUrl, prompt, meta })
      });
      if (r.ok){
        try { const rows = await r.json(); if (Array.isArray(rows) && rows.length > 0) return; } catch {}
      }
    }
    if (run_id){
      const url = `${SUPABASE_URL}/rest/v1/user_generations?${encodeURIComponent('meta->>run_id')}=eq.${encodeURIComponent(run_id)}`;
      const r = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ result_url: finalUrl, prompt, meta })
      });
      if (r.ok){
        try { const rows = await r.json(); if (Array.isArray(rows) && rows.length > 0) return; } catch {}
      }
    }

    // Fallback: insert a new row so we never lose the result (only if we know uid)
    if (!uid) return; // cannot insert without user_id (NOT NULL)
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/user_generations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: uid,
        provider: 'GPT-Image-1',
        kind: 'image',
        prompt,
        result_url: finalUrl,
        meta
      })
    });
    // ignore insert failures silently
  }catch(e){
    // swallow errors to avoid breaking the HTTP response
  }
    // Final fallback: if we still didn't update anything but we know uid,
    // patch the most recent NULL-result row for this user (created_at desc limit 1).
    try{
      if (uid){
        const urlSel = `${SUPABASE_URL}/rest/v1/user_generations?user_id=eq.${encodeURIComponent(uid)}&result_url=is.null&order=created_at.desc&limit=1`;
        const s = await fetch(urlSel, {
          headers: {
            'apikey': SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Accept': 'application/json'
          }
        });
        if (s.ok){
          const rows = await s.json().catch(()=>[]);
          if (Array.isArray(rows) && rows.length > 0){
            const targetId = rows[0].id;
            const urlUpd = `${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(targetId)}`;
            await fetch(urlUpd, {
              method: 'PATCH',
              headers: {
                'apikey': SERVICE_KEY,
                'Authorization': `Bearer ${SERVICE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({ result_url: finalUrl, prompt, meta })
            });
          }
        }
      }
    }catch{/* ignore */}

}

// ---------- Handler ----------
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };

  try{
    if (event.httpMethod === 'POST'){
      // Webhook path
      const body = JSON.parse(event.body || '{}');

      // The UI usually appends uid/run_id/row_id to the webhook URL query
      const sp = new URLSearchParams(event.queryStringParameters || {});
      const uid = getParam(sp, 'uid');
      const run_id = getParam(sp, 'run_id') || getParam(sp, 'rid');
      const row_id = getParam(sp, 'row_id');

      const status = String(body.status || '').toLowerCase();
      let id = body.id || (body.prediction && body.prediction.id) || null;

      if (status === 'succeeded'){
        const image_url = extractImageUrl(body.output);
        await backfillUsage({ uid, run_id, id, row_id, image_url, input: body.input || {} });
        return json(200, { ok:true, status:'succeeded' });
      }
      return json(200, { ok:true, status: status || 'pending' });
    }

    // GET polling path
    const sp = new URLSearchParams(event.queryStringParameters || {});
    const id = getParam(sp, 'id') || getParam(sp, 'prediction_id');
    const uid = getParam(sp, 'uid');
    const run_id = getParam(sp, 'run_id') || getParam(sp, 'rid');
    const row_id = getParam(sp, 'row_id');
    if (!id) return json(400, { ok:false, error:'missing_id' });

    if (!TOKEN) return json(500, { ok:false, error:'missing_replicate_token' });

    const res = await fetch(`${BASE}/predictions/${encodeURIComponent(id)}`, {
      headers: { 'Authorization': `Token ${TOKEN}`, 'Content-Type': 'application/json' }
    });
    if (!res.ok){
      const txt = await res.text();
      return json(502, { ok:false, error:'replicate_error', details: txt });
    }
    const data = await res.json();
    const status = String(data.status || '').toLowerCase();

    if (status === 'succeeded'){
      const image_url = extractImageUrl(data.output);
      await backfillUsage({ uid, run_id, id, row_id, image_url, input: data.input || {} });
      return json(200, { ok:true, status:'succeeded', image_url });
    }
    return json(200, { ok:true, status: status || 'pending' });
  }catch(e){
    return json(500, { ok:false, error:'server_error', details: String(e && e.message || e) });
  }
};
