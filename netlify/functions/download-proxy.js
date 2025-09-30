// netlify/functions/download-proxy.js
// Redirect + cache proxy (no response size limits to client):
//   • Supabase URL  -> 302 redirect with ?download=<name>
//   • Other allowed -> server-side fetch -> upload to Supabase Storage (x-upsert) -> 302 to Supabase public URL (?download=<name>)
// Notes:
//   - Guarantees "attachment" via Supabase download param for any origin
//   - Never streams big payloads to the client (avoids Netlify 6–10MB response cap)
//   - Unwraps nested proxies, fixes hhttps:// typos, has a small allowlist

const SUPABASE_URL  = (process.env.SUPABASE_URL || '').replace(/\/+$/,'');
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET        = process.env.SUPABASE_BUCKET || 'downloads';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors(), body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return json(405, { ok:false, error:'method_not_allowed' });
  }

  const sp = new URLSearchParams(event.queryStringParameters || {});
  let raw = sp.get('url') || '';
  let name = (sp.get('name') || '').trim();

  if (!raw) return json(400, { ok:false, error:'missing_url' });

  // unwrap nested/double-proxy & fix common typos
  raw = unwrap(raw).replace(/^hhttps:\/\//i, 'https://').replace(/^hhttp:\/\//i, 'http://');

  let target;
  try { target = new URL(raw); }
  catch { return json(400, { ok:false, error:'bad_url', url: raw }); }

  // allowlist (adjust as needed)
  const ALLOW = [
    'supabase.co',
    'supabase.in',
    'storage.supabase.com',
    'replicate.delivery',
    'aiquickdraw.com',
    'tempfile.aiquickdraw.com',
  ];
  const allowed = ALLOW.some((d) => target.hostname === d || target.hostname.endsWith(`.${d}`));
  if (!allowed) return json(400, { ok:false, error:'blocked_host', host: target.hostname });

  // filename
  if (!name) {
    try { name = decodeURIComponent((target.pathname.split('/').pop() || 'download').split('?')[0]); }
    catch { name = target.pathname.split('/').pop() || 'download'; }
  }
  name = name.replace(/[^\w.\- ]+/g, '_').slice(0, 150);

  // Supabase URL? just redirect with download param
  if (/\b(supabase\.co|supabase\.in|storage\.supabase\.com)\b/.test(target.hostname)) {
    target.searchParams.set('download', name);
    return redirect(target.toString());
  }

  // Otherwise: cache to Supabase then redirect to the cached object
  if (!(SUPABASE_URL && SERVICE_KEY)) {
    // if we can't cache, best effort redirect to original
    return redirect(target.toString());
  }

  try {
    const upstream = await fetch(target.toString(), { redirect: 'follow' });
    if (!upstream.ok) {
      const text = await upstream.text().catch(()=>'');
      return json(upstream.status, { ok:false, error:'upstream_error', details: text.slice(0,1000) });
    }
    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await upstream.arrayBuffer());

    // build deterministic path using date + stable hash of URL
    const path = buildPath(name, stableHash(target.toString()));

    // upload to Supabase Storage (upsert)
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(BUCKET)}/${path}`;
    const up = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': ct,
        'x-upsert': 'true',
      },
      body: buf,
    });

    if (!up.ok) {
      const t = await up.text().catch(()=>'');
      // fallback to direct redirect if upload failed
      return redirect(target.toString());
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${path}`;
    const redir = new URL(publicUrl);
    redir.searchParams.set('download', name);
    return redirect(redir.toString());
  } catch (e) {
    // on any error, best effort redirect
    return redirect(target.toString());
  }
};

function redirect(url){
  return {
    statusCode: 302,
    headers: { ...cors(), Location: url, 'Cache-Control': 'no-store' },
    body: ''
  };
}

function cors(){ return {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
}; }
const json = (c,o)=>({ statusCode:c, headers:{ 'Content-Type':'application/json', ...cors() }, body:JSON.stringify(o) });

function unwrap(v){
  let s = String(v || '');
  for (let i=0;i<3;i++){
    try {
      const once = decodeURIComponent(s);
      const m = once.match(/\/\.netlify\/functions\/download-proxy\?url=([^&]+)/i);
      if (m && m[1]) { s = m[1]; continue; }
      s = once;
      break;
    } catch { break; }
  }
  return s;
}

// simple stable hash (djb2)
function stableHash(s){
  let h = 5381;
  for (let i=0;i<s.length;i++) h = ((h<<5)+h) + s.charCodeAt(i);
  return (h>>>0).toString(16);
}

function buildPath(name, key){
  const d = new Date();
  const y = String(d.getUTCFullYear());
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  const day = String(d.getUTCDate()).padStart(2,'0');
  const safe = String(name || 'file.bin').replace(/[^\w.\- ]+/g,'_').slice(0,150);
  const prefix = key ? `${key}-` : '';
  return `${y}/${m}/${day}/${prefix}${safe}`;
}
