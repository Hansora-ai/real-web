// netlify/functions/download-proxy.js
// Redirect + cache proxy with extension-fix for filenames:
//   • Supabase URL  -> 302 redirect with ?download=<fixedName>
//   • Other allowed -> server-side fetch -> upload to Supabase Storage (x-upsert) -> 302 to Supabase public URL (?download=<fixedName>)
// Ensures the filename has the correct extension (derived from URL or Content-Type).

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
  let providedName = (sp.get('name') || '').trim();

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

  // initial name guess from URL if none provided
  let nameFromUrl = safeFileName(decodePath(target.pathname.split('/').pop() || 'download'));
  let name = providedName ? safeFileName(providedName) : nameFromUrl;

  // Supabase URL? just redirect with download param (derive ext from URL path)
  if (/\b(supabase\.co|supabase\.in|storage\.supabase\.com)\b/.test(target.hostname)) {
    name = ensureExt(name, nameFromUrl, null);
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

    // fix/append extension using content-type when needed
    name = ensureExt(name, nameFromUrl, ct);

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

function decodePath(p){
  try { return decodeURIComponent(p); } catch { return p; }
}

function safeFileName(n){
  return String(n || 'download').replace(/[^\w.\- ]+/g, '_').slice(0,150);
}

// ensure filename has extension; prefer URL ext, then content-type mapping
function ensureExt(name, urlName, contentType){
  const hasDot = /\.[A-Za-z0-9]{2,5}$/.test(name);
  if (hasDot) return name;

  // try ext from URL
  const m = (urlName || '').match(/\.([A-Za-z0-9]{2,5})$/);
  let ext = m ? m[1].toLowerCase() : '';

  // fallback to content-type
  if (!ext && contentType){
    ext = ctToExt(contentType);
  }

  if (!ext) ext = 'bin';
  return `${name}.${ext}`;
}

function ctToExt(ct){
  const t = String(ct).toLowerCase();
  if (t.includes('image/png')) return 'png';
  if (t.includes('image/jpeg')) return 'jpg';
  if (t.includes('image/webp')) return 'webp';
  if (t.includes('image/gif')) return 'gif';
  if (t.includes('image/svg')) return 'svg';
  if (t.includes('video/mp4')) return 'mp4';
  if (t.includes('video/webm')) return 'webm';
  if (t.includes('video/quicktime')) return 'mov';
  if (t.includes('application/pdf')) return 'pdf';
  if (t.includes('application/zip')) return 'zip';
  return '';
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
  const safe = safeFileName(name);
  const prefix = key ? `${key}-` : '';
  return `${y}/${m}/${day}/${prefix}${safe}`;
}
