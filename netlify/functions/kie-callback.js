// Handles KIE -> webhook callback and stores the result in Supabase nb_results
// Expects query params ?uid=...&run_id=... (we already append them in run-nano-banana.js)

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY; // service role key (NOT anon)
const TABLE_URL     = `${SUPABASE_URL}/rest/v1/nb_results`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: cors(), body: 'Use POST' };

  try {
    const qs = event.queryStringParameters || {};
    const headers = lowerKeys(event.headers || {});
    const ctype = headers['content-type'] || '';

    // Body can be JSON, urlencoded, or plain text
    let bodyRaw = event.body || '';
    if (event.isBase64Encoded) bodyRaw = Buffer.from(bodyRaw, 'base64').toString('utf8');

    let data = null;
    if (ctype.includes('application/json')) {
      try { data = JSON.parse(bodyRaw); } catch {}
    }
    if (!data && (ctype.includes('application/x-www-form-urlencoded') || ctype.includes('text/plain'))) {
      data = parseFormLike(bodyRaw);
      // KIE sometimes nests JSON under a "data" or "result" string — parse if needed
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
    const taskId = qs.taskId || get(data, 'taskId')        || get(data, 'id')                ||
                   get(data, 'data.taskId') || get(data, 'result.taskId') || null;

    // Try hard to find an image URL anywhere in the payload
    const image_url = findFirstUrl(data);

    // Insert into Supabase (service role; bypass RLS)
    const row = {
      user_id: uid || '00000000-0000-0000-0000-000000000000', // fallback to avoid 400s
      run_id:  run_id || 'unknown',
      task_id: taskId || null,
      image_url: image_url || null,
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

    const insText = await resp.text();
    const ok = resp.ok;

    // Always 200 back to KIE; include a tiny debug summary
    return {
      statusCode: 200,
      headers: { ...cors(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok,
        saved: row,
        insert_status: resp.status,
        note: image_url ? 'image_url saved' : 'no image_url found; saved stub row',
      })
    };

  } catch (e) {
    // Still return 200 so KIE doesn’t spam retries, but include the error
    return {
      statusCode: 200,
      headers: { ...cors(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok:false, error: String(e) })
    };
  }
};

// ───────────────── helpers

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

function lowerKeys(obj) {
  const out = {};
  for (const k in obj) out[k.toLowerCase()] = obj[k];
  return out;
}

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

function get(o, path) {
  try {
    return path.split('.').reduce((a,k)=> (a && k in a ? a[k] : undefined), o);
  } catch { return undefined; }
}

function findFirstUrl(obj) {
  // Prioritize common fields
  const direct = get(obj,'image_url') || get(obj,'imageUrl') || get(obj,'outputUrl') || get(obj,'url');
  const arr1   = get(obj,'images.0.url') || get(obj,'output.0.url');
  const early  = direct || arr1;
  if (isUrl(early)) return early;

  // Deep scan for any http(s) URL (first match)
  let found = null;
  (function walk(x) {
    if (found) return;
    if (!x) return;
    if (typeof x === 'string') {
      const m = x.match(/https?:\/\/[^\s"']+/i);
      if (m && isUrl(m[0])) { found = m[0]; return; }
    } else if (Array.isArray(x)) {
      for (const v of x) walk(v);
    } else if (typeof x === 'object') {
      for (const v of Object.values(x)) walk(v);
    }
  })(obj);

  return found;
}

function isUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}
