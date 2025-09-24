// Handles KIE -> webhook callback and stores the result in Supabase nb_results
// Expects query params ?uid=...&run_id=... (we already append them in run-nano-banana.js)

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY; // service role key (NOT anon)
const TABLE_URL     = `${SUPABASE_URL}/rest/v1/nb_results`;

// NEW: read KIE host/key so we can verify final result if needed
const KIE_BASE = process.env.KIE_BASE_URL || 'https://api.kie.ai';
const KIE_KEY  = process.env.KIE_API_KEY;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: cors(), body: 'Use POST' };

  try {
    const qs = event.queryStringParameters || {};
    const headers = lowerKeys(event.headers || {});
    const ctype = headers['content-type'] || '';

    let bodyRaw = event.body || '';
    if (event.isBase64Encoded) bodyRaw = Buffer.from(bodyRaw, 'base64').toString('utf8');

    let data = null;
    if (ctype.includes('application/json')) {
      try { data = JSON.parse(bodyRaw); } catch {}
    }
    if (!data && (ctype.includes('application/x-www-form-urlencoded') || ctype.includes('text/plain'))) {
      data = parseFormLike(bodyRaw);
      for (const k of ['data','result','payload']) {
        if (typeof data[k] === 'string') {
          try { data[k] = JSON.parse(data[k]); } catch {}
        }
      }
    }
    if (!data) {
      try { data = JSON.parse(bodyRaw); } catch { data = { raw: bodyRaw }; }
    }

    // uid / run_id / taskId from query first, then from body meta/metadata
    const uid    = qs.uid    || get(data, 'meta.uid')      || get(data, 'metadata.uid')      || null;
    const run_id = qs.run_id || get(data, 'meta.run_id')   || get(data, 'metadata.run_id')   || null;
    const taskId = qs.taskId || qs.task_id || get(data,'taskId') || get(data,'id') ||
                   get(data,'data.taskId') || get(data,'result.taskId') || null;

    // Try hard to find an image URL anywhere in the payload (more shapes covered)
    const image_url = pickUrl(data);

    // --- NEW: verify/upgrade to the official KIE result URL when needed ---
    let final_url = image_url;
    const looksWrong =
      !final_url ||
      /webhansora|netlify|localhost/i.test(hostname(final_url)) ||   // our own site / preview
      !/(kie\.ai|redpandaai\.co)/i.test(hostname(final_url));        // not a known KIE host

    if ((looksWrong || !final_url) && taskId && KIE_KEY) {
      try {
        const r = await fetch(
          `${KIE_BASE}/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(taskId)}`,
          { headers: { 'Authorization': `Bearer ${KIE_KEY}`, 'Accept': 'application/json' } }
        );
        const j = await r.json();
        // Prefer explicit result paths
        final_url =
          j?.data?.result?.images?.[0]?.url ||
          j?.data?.result_url ||
          j?.image_url ||
          j?.url ||
          final_url;
      } catch (e) {
        console.log('[kie-callback] verify fetch failed:', String(e));
      }
    }
    // ---------------------------------------------------------------------

    // ⛔️ Don’t insert a stub row with NULL image_url — that’s what kept your UI spinning.
    if (!final_url) {
      return reply(200, {
        ok: true,
        saved: false,
        note: 'no image_url found; not inserting stub row',
        debug: { has_uid: !!uid, has_run_id: !!run_id, has_taskId: !!taskId }
      });
    }

    // Insert into Supabase only when we have a real URL (service role; bypass RLS)
    const row = {
      user_id: uid || '00000000-0000-0000-0000-000000000000',
      run_id:  run_id || 'unknown',
      task_id: taskId || null,
      image_url: final_url      // <-- use verified final URL
    };

    const resp = await fetch(TABLE_URL, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(row)
    });

    const ok = resp.ok;
    return reply(200, {
      ok,
      saved: true,
      insert_status: resp.status,
      row
    });

  } catch (e) {
    // Still return 200 so KIE doesn’t spam retries, but include the error
    return reply(200, { ok:false, error:String(e) });
  }
};

// ───────────────── helpers

function reply(statusCode, body) {
  return { statusCode, headers: { ...cors(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

function lowerKeys(obj) { const out={}; for (const k in obj) out[k.toLowerCase()] = obj[k]; return out; }

function parseFormLike(s) {
  const out = {};
  try {
    for (const part of s.split('&')) {
      const [k,v] = part.split('=');
      if (!k) continue;
      out[decodeURIComponent(k)] = decodeURIComponent(v || '');
    }
  } catch {}
  return out;
}

function get(o, path) { try { return path.split('.').reduce((a,k)=> (a && k in a ? a[k] : undefined), o); } catch { return undefined; } }

function isUrl(u){ return typeof u==='string' && /^https?:\/\//i.test(u); }

function hostname(u){ try { return new URL(u).hostname; } catch { return ''; } }

// Known KIE shapes first, then deep-scan
function pickUrl(obj){
  const candidates = [
    get(obj,'image_url'),
    get(obj,'imageUrl'),
    get(obj,'outputUrl'),
    get(obj,'url'),
    get(obj,'result.image_url'),
    get(obj,'result.imageUrl'),
    get(obj,'data.image_url'),
    get(obj,'data.imageUrl'),
    get(obj,'data.result.image_url'),
    get(obj,'data.result.imageUrl'),
    get(obj,'data.output_url'),
    get(obj,'result_url'),
    get(obj,'data.result_url'),
    get(obj,'images.0.url'),
    get(obj,'output.0.url'),
    get(obj,'data.images.0.url'),
    get(obj,'data.output.0.url')
  ];
  for (const u of candidates) if (isUrl(u)) return u;

  // Deep scan for first http(s) URL anywhere
  let found=null;
  (function walk(x){
    if (found || !x) return;
    if (typeof x==='string'){
      const m = x.match(/https?:\/\/[^\s"']+/i);
      if (m && isUrl(m[0])) { found = m[0]; return; }
    } else if (Array.isArray(x)) {
      for (const v of x) walk(v);
    } else if (typeof x==='object') {
      for (const v of Object.values(x)) walk(v);
    }
  })(obj);
  return found;
}
