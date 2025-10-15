// netlify/functions/nb-check.js
// Console-accurate with explicit HTTP mapping: success | failed | pending.
// Calls ONLY KIE /api/task/{taskId}. Marks any HTTP >= 400 as failed (e.g., 404/422).

const KIE_BASE = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/+$/,'');
const KIE_KEY  = process.env.KIE_API_KEY;

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: cors(), body: '' };
    }
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, headers: cors(), body: 'Use GET' };
    }

    const qs = event.queryStringParameters || {};
    const taskId = (qs.taskId || qs.task_id || '').trim();
    if (!taskId) return json(400, { ok:false, status:'failed', error:'missing taskId' });

    const url = `${KIE_BASE}/api/task/${encodeURIComponent(taskId)}`;
    const r = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${KIE_KEY}`,
        'Accept': 'application/json'
      }
    });

    const http = r.status;
    const ct = r.headers.get('content-type') || '';

    // If we get any 4xx/5xx from KIE, treat it as terminal failure
    if (http >= 400) {
      let body = null;
      if (ct.includes('application/json')) {
        body = await r.json().catch(() => null);
      } else {
        body = { error: await r.text().catch(()=>'') };
      }
      const code = body?.code ?? http;
      const err  = body?.error || body?.message || body?.msg || `HTTP ${http}`;
      return json(200, { ok:false, status:'failed', code, error: err, raw: body });
    }

    if (!ct.includes('application/json')) {
      // Non-JSON but HTTP < 400 -> keep pending
      return json(200, { ok:false, status:'pending', http });
    }

    const data = await r.json();
    const s = normalizeStatus(data);

    if (s === 'success') {
      const images = extractResultUrls(data, 4);
      return json(200, { ok:true, status:'success', images, image_url: images[0] || null, raw:data });
    }
    if (s === 'failed') {
      const code = data?.code ?? null;
      const err  = data?.error || data?.message || data?.msg || null;
      return json(200, { ok:false, status:'failed', code, error: err, raw:data });
    }

    return json(200, { ok:false, status:'pending', raw:data });

  } catch (e) {
    return json(200, { ok:false, status:'pending', error:String(e) });
  }
};

function cors(){
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };
}
function json(code, obj){
  return { statusCode: code, headers: { 'Content-Type': 'application/json', ...cors() }, body: JSON.stringify(obj) };
}

function normalizeStatus(d){
  const s = String(
    d?.status || d?.state ||
    d?.data?.status || d?.data?.state ||
    d?.result?.status || d?.result?.state || ''
  ).toLowerCase();

  if (['success','succeeded','completed','done'].includes(s)) return 'success';
  if (['failed','failure','error'].includes(s)) return 'failed';

  // numeric error code from KIE payload
  if (typeof d?.code !== 'undefined' && Number(d.code) >= 400) return 'failed';

  return 'pending';
}

function extractResultUrls(d, limit=4){
  const from = Array.isArray(d?.resultUrls) ? d.resultUrls
             : Array.isArray(d?.result?.urls) ? d.result.urls
             : Array.isArray(d?.data?.resultUrls) ? d.data.resultUrls
             : [];
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
