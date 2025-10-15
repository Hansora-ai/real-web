// netlify/functions/nb-check.js
// Behavior requested by user:
// - Call ONLY KIE /api/task/{taskId} (console-accurate)
// - If HTTP 404: keep 'pending' until 180s have passed since `startedAt`
// - Any other HTTP >= 400 (422/500/501/etc): fail immediately
// - If JSON says status: success -> success
// - If JSON says failed/failure or code>=400 inside JSON -> fail immediately
// - Echo taskId + startedAt in every response
// - Minimal CORS
//
// Query params expected: ?taskId=...&startedAt=<ms epoch>&ttl=180 (ttl optional; default 180s)

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

    // startedAt and TTL (seconds)
    const now = Date.now();
    const startedAt = Number(qs.startedAt || qs.started_at || 0);
    const ttlSec = Number(qs.ttl || 180);
    const ageMs = startedAt ? (now - startedAt) : null;

    const url = `${KIE_BASE}/api/task/${encodeURIComponent(taskId)}`;
    const r = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${KIE_KEY}`,
        'Accept': 'application/json'
      }
    });

    const http = r.status;
    const ct = r.headers.get('content-type') || '';

    // HTTP error handling
    if (http >= 400) {
      // Special case: 404 -> grace window
      if (http === 404) {
        // If we know the job is younger than TTL seconds, keep pending
        if (ageMs !== null && ageMs < ttlSec * 1000) {
          return json(200, { ok:false, status:'pending', http, taskId, startedAt, ttl: ttlSec });
        }
        // If no startedAt provided, treat first minute as pending to avoid false negatives
        if (ageMs === null) {
          return json(200, { ok:false, status:'pending', http, taskId, note:'no startedAt; treating 404 as pending' });
        }
        // Past grace window -> fail
        return json(200, { ok:false, status:'failed', code:404, error:'Not found (expired/not ready after grace window)', taskId, startedAt, ttl: ttlSec });
      }

      // Any non-404 HTTP error -> fail immediately
      let body = null;
      if (ct.includes('application/json')) {
        body = await r.json().catch(() => null);
      } else {
        body = { error: await r.text().catch(()=>'') };
      }
      const code = body?.code ?? http;
      const err  = body?.error || body?.message || body?.msg || `HTTP ${http}`;
      return json(200, { ok:false, status:'failed', code, error: err, raw: body, taskId, startedAt, ttl: ttlSec });
    }

    // Non-error HTTP (<400)
    if (!ct.includes('application/json')) {
      // Non-JSON yet -> pending within grace window
      if (ageMs === null || ageMs < ttlSec * 1000) {
        return json(200, { ok:false, status:'pending', http, taskId, startedAt, ttl: ttlSec });
      }
      return json(200, { ok:false, status:'failed', http, error:'Non-JSON after grace window', taskId, startedAt, ttl: ttlSec });
    }

    const data = await r.json();
    const s = normalizeStatus(data);

    if (s === 'success') {
      const images = extractResultUrls(data, 4);
      return json(200, { ok:true, status:'success', images, image_url: images[0] || null, raw:data, taskId, startedAt, ttl: ttlSec });
    }
    if (s === 'failed') {
      const code = data?.code ?? null;
      const err  = data?.error || data?.message || data?.msg || null;
      return json(200, { ok:false, status:'failed', code, error: err, raw:data, taskId, startedAt, ttl: ttlSec });
    }

    // Still not final -> pending (respect grace window)
    if (ageMs === null || ageMs < ttlSec * 1000) {
      return json(200, { ok:false, status:'pending', raw:data, taskId, startedAt, ttl: ttlSec });
    }
    return json(200, { ok:false, status:'failed', error:'No final status after grace window', raw:data, taskId, startedAt, ttl: ttlSec });

  } catch (e) {
    // Network/exception -> pending inside grace window, otherwise failed
    const qs = event.queryStringParameters || {};
    const startedAt = Number(qs.startedAt || qs.started_at || 0);
    const ttlSec = Number(qs.ttl || 180);
    const ageMs = startedAt ? (Date.now() - startedAt) : null;

    if (ageMs === null || ageMs < ttlSec * 1000) {
      return json(200, { ok:false, status:'pending', error:String(e), startedAt, ttl: ttlSec });
    }
    return json(200, { ok:false, status:'failed', error:String(e), startedAt, ttl: ttlSec });
  }
};

function cors(){
  return {
    'Access-Control-Allow-Origin': '*', // set to 'https://hansora.co' if you want to restrict
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
