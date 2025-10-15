// netlify/functions/nb-check.js
// Console-accurate version: queries ONLY the primary KIE endpoint exactly like your console test.
// If KIE says success -> success; if KIE says failed / failure / code >= 400 -> failed; else pending.
// Minimal, surgical; removes legacy multi-endpoint heuristics that could mislabel 'pending' as 'failed'.

const KIE_BASE = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/+$/,'');
const KIE_KEY  = process.env.KIE_API_KEY;

exports.handler = async (event) => {
  try {
    // CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: cors(), body: '' };
    }
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, headers: cors(), body: 'Use GET' };
    }

    const qs = event.queryStringParameters || {};
    const taskId = (qs.taskId || qs.task_id || '').trim();
    if (!taskId) return json(400, { ok:false, error:'missing taskId' });

    const url = `${KIE_BASE}/api/task/${encodeURIComponent(taskId)}`;
    const r = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${KIE_KEY}`,
        'Accept': 'application/json'
      }
    });

    // If KIE responds with non-JSON, don't guess -> treat as pending
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const text = await r.text().catch(()=>''); // discard HTML body
      return json(200, { ok:false, status:'pending', note:'non-json', http:r.status });
    }

    const data = await r.json();

    // Normalize status exactly to 3 states
    const status = normalizeStatus(data, r.status);

    if (status === 'success') {
      const images = extractResultUrls(data, 4);
      return json(200, { ok:true, status:'success', images, image_url: images[0] || null, raw:data });
    }

    if (status === 'failed') {
      const code = data?.code ?? r.status ?? null;
      const err  = data?.error || data?.message || data?.msg || null;
      return json(200, { ok:false, status:'failed', code, error: err, raw:data });
    }

    // default pending
    return json(200, { ok:false, status:'pending', raw:data, http:r.status });

  } catch (e) {
    // Network or unexpected errors => don't mark failed; keep pending to avoid false negatives
    return json(200, { ok:false, status:'pending', error:String(e) });
  }
};

// ----- helpers -----
function cors(){
  return {
    'Access-Control-Allow-Origin': '*',              // or set to 'https://hansora.co' if you want it restricted
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };
}
function json(code, obj){
  return { statusCode: code, headers: { 'Content-Type': 'application/json', ...cors() }, body: JSON.stringify(obj) };
}

// Map KIE responses into: 'success' | 'failed' | 'pending'
function normalizeStatus(d, httpStatus){
  // honor explicit status fields first
  const s = String(
    d?.status || d?.state ||
    d?.data?.status || d?.data?.state ||
    d?.result?.status || d?.result?.state || ''
  ).toLowerCase();

  if (['success','succeeded','completed','done'].includes(s)) return 'success';
  if (['failed','failure','error'].includes(s)) return 'failed';

  // If KIE provides a numeric code >= 400, consider it failed (e.g., 422 sensitive)
  if (typeof d?.code !== 'undefined' && Number(d.code) >= 400) return 'failed';

  // Otherwise, only treat as failed when HTTP code itself is hard error (>=500 unlikely here)
  if (httpStatus >= 500) return 'failed'; // server-side KIE error

  return 'pending';
}

// Extract result URLs (KIE often returns { resultUrls: [...] })
function extractResultUrls(d, limit=4){
  const from = Array.isArray(d?.resultUrls) ? d.resultUrls
             : Array.isArray(d?.result?.urls) ? d.result.urls
             : Array.isArray(d?.data?.resultUrls) ? d.data.resultUrls
             : [];

  // Return unique list without guessing/rewriting
  const out = [];
  const seen = new Set();
  for (const u of from){
    if (typeof u === 'string' && !seen.has(u)){
      seen.add(u);
      out.push(u);
      if (out.length >= limit) break;
    }
  }
  return out;
}
