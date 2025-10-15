
// netlify/functions/imagen-check.js
// GET: poll Replicate for prediction id; on success backfill Usage; on failure/cancel refund credits + mark failed
// POST: Replicate webhook calls here on completion; success => backfill; failure/cancel => refund + mark failed
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
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', ...cors() }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { ok:false, error:'method_not_allowed' });

  try{
    const qs = event.queryStringParameters || {};
    let id = (qs.id || '').trim();
    const uid = (qs.uid || '').trim();
    const run_id = (qs.run_id || '').trim();

    if (event.httpMethod === 'POST') {
      // Replicate webhook (completed)
      let body = {};
      try { body = JSON.parse(event.body || '{}'); } catch {}
      const status = String(body.status || '').toLowerCase();
      const out = body.output;
      if (!id) id = body.id || (body.prediction && body.prediction.id) || null;

      if (status === 'succeeded') {
        const image_url = extractImageUrl(out);
        await backfillUsage({ uid, run_id, id, image_url, input: body.input || {}, model: body.model || null });
        return json(200, { ok:true, status:'succeeded' });
      }

      if (status === 'failed' || status === 'canceled') {
        await markFailedAndRefund({ uid, run_id, id, model: body.model, input: body.input });
        return json(200, { ok:true, status });
      }

      // acknowledge other statuses
      return json(200, { ok:true, status: status || 'pending' });
    }

    // GET polling branch
    const auth = { 'Authorization': `Bearer ${TOKEN}` };
    if (!id) return json(400, { ok:false, error:'missing_id' });

    const res = await fetch(`${BASE}/predictions/${encodeURIComponent(id)}`, { headers: auth });
    if (!res.ok) {
      const errTxt = await res.text().catch(()=>'');
      return json(res.status, { ok:false, error:'replicate_get_failed', details: errTxt });
    }
    const data = await res.json();
    const status = String(data.status || '').toLowerCase();

    if (status === 'succeeded') {
      const image_url = extractImageUrl(data.output);
      await backfillUsage({ uid, run_id, id, image_url, input: data.input || {}, model: data.model || null });
      return json(200, { ok:true, status:'succeeded', image_url });
    }

    if (status === 'failed' || status === 'canceled') {
      await markFailedAndRefund({ uid, run_id, id, model: data.model, input: data.input });
      return json(200, { ok:true, status });
    }

    return json(200, { ok:true, status });
  }catch(e){
    console.error('[imagen-check] error', e);
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

async function backfillUsage({ uid, run_id, id, image_url, input, model }){
  if (!(SUPABASE_URL && SERVICE_KEY && uid)) return;
  try {
    const ug = `${SUPABASE_URL.replace(/\/+$/,'')}/rest/v1/user_generations`;
    const prompt = input?.prompt || null;
    const providerLabel = (input?.model === 'ultra' || model === 'ultra') ? 'Imagen Ultra' : (input?.model === 'fast' || model === 'fast') ? 'Imagen Fast' : 'Imagen';
    const meta = {
      provider: 'imagen',
      source: 'imagen',
      run_id: run_id || null,
      prediction_id: id || null,
      model: input?.model || model || null,
      aspect_ratio: input?.aspect_ratio || input?.size || null,
      status: 'succeeded',
      refunded: false,
    };

    // Try to update placeholder by run_id
    let updated = false;
    if (run_id) {
      const patch = await fetch(`${ug}?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`, {
        method: 'PATCH',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({ result_url: image_url, provider: providerLabel, kind: 'image', prompt, meta }),
      });
      if (patch.ok){
        const arr = await patch.json().catch(()=>[]);
        updated = Array.isArray(arr) && arr.length > 0;
      }
    }

    // Fallback: update by prediction_id
    if (!updated && id) {
      const patch2 = await fetch(`${ug}?user_id=eq.${encodeURIComponent(uid)}&meta->>prediction_id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({ result_url: image_url, provider: providerLabel, kind: 'image', prompt, meta }),
      });
      if (patch2.ok){
        const arr = await patch2.json().catch(()=>[]);
        updated = Array.isArray(arr) && arr.length > 0;
      }
    }

    // Insert if not found
    if (!updated) {
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
          result_url: image_url,
          meta,
        }),
      });
    }
  } catch (e) {
    console.warn('[imagen-check] backfill failed', e);
  }
}

// Mark failed in user_generations (by run_id/prediction_id) and refund cost exactly once
async function markFailedAndRefund({ uid, run_id, id, model, input }){
  if (!(SUPABASE_URL && SERVICE_KEY && uid)) return;
  try {
    const base = SUPABASE_URL.replace(/\/+$/,'');
    const ug = `${base}/rest/v1/user_generations`;
    // 1) Fetch placeholder row by run_id (preferred) or prediction_id
    let row = null;

    if (run_id) {
      const r = await fetch(`${ug}?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=*,meta`, {
        headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
      });
      if (r.ok) {
        const arr = await r.json();
        if (Array.isArray(arr) && arr.length) row = arr[0];
      }
    }
    if (!row && id) {
      const r2 = await fetch(`${ug}?user_id=eq.${encodeURIComponent(uid)}&meta->>prediction_id=eq.${encodeURIComponent(id)}&select=*,meta`, {
        headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
      });
      if (r2.ok) {
        const arr2 = await r2.json();
        if (Array.isArray(arr2) && arr2.length) row = arr2[0];
      }
    }

    // Determine model/cost
    const meta = (row && row.meta) || {};
    const m = (meta.model || model || input?.model || '').toString();
    const cost = (m === 'ultra') ? 1.0 : 0.5;

    // If already refunded, just ensure status=failed and exit
    if (meta.refunded === true) {
      if (row) {
        const newMeta = { ...meta, status:'failed', refunded:true };
        await fetch(`${ug}?id=eq.${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          headers: {
            'apikey': SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ meta: newMeta }),
        });
      }
      return;
    }

    // 2) Refund credits
    const profUrl = `${base}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
    const g = await fetch(profUrl, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
    const j = await g.json();
    const current = (Array.isArray(j) && j[0] && (j[0].credits ?? 0)) || 0;
    const next = current + cost;

    await fetch(`${base}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`, {
      method: 'PATCH',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ credits: next }),
    });

    // 3) Mark failed + refunded flag on the generation row(s)
    const newMeta = { ...meta, status:'failed', refunded:true };
    if (row && row.id) {
      await fetch(`${ug}?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ meta: newMeta }),
      });
    } else {
      // fallback: patch by run_id/prediction_id filters
      const filter = run_id
        ? `user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`
        : `user_id=eq.${encodeURIComponent(uid)}&meta->>prediction_id=eq.${encodeURIComponent(id)}`;
      await fetch(`${ug}?${filter}`, {
        method: 'PATCH',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ meta: newMeta }),
      });
    }
  } catch (e) {
    console.warn('[imagen-check] markFailedAndRefund error', e);
  }
}
