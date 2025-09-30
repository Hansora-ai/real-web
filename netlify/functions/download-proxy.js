// netlify/functions/download-proxy.js
// Hybrid download proxy:
//   • Supabase: 302 redirect with ?download=<name> (no size limit, full quality)
//   • Other allowed hosts: try to STREAM (force Content-Disposition) if <= 9MB;
//     otherwise 302 redirect (can't force attachment, but avoids lambda size limits).
//   • Unwraps double-proxied URLs, fixes hhttps:// typos, basic domain allowlist.

const MAX_STREAM_BYTES = 9_000_000; // ~9 MB safety for base64 response

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

  // Unwrap nested proxy & fix common typos
  raw = unwrap(raw).replace(/^hhttps:\/\//i, 'https://').replace(/^hhttp:\/\//i, 'http://');

  let target;
  try { target = new URL(raw); }
  catch { return json(400, { ok:false, error:'bad_url', url: raw }); }

  // Allowlist
  const ALLOW = [
    'supabase.co',
    'supabase.in',
    'storage.supabase.com',
    'replicate.delivery',
    'aiquickdraw.com',
    'tempfile.aiquickdraw.com',
  ];
  const allowed = ALLOW.some((d) => target.hostname === d || target.hostname.endsWith(`.${d}`));
  if (!allowed) {
    return json(400, { ok:false, error:'blocked_host', host: target.hostname });
  }

  // Derive filename
  if (!name) {
    try {
      name = decodeURIComponent((target.pathname.split('/').pop() || 'download').split('?')[0]);
    } catch { name = target.pathname.split('/').pop() || 'download'; }
  }
  name = name.replace(/[^\w.\- ]+/g, '_').slice(0, 150);

  // Supabase -> 302 with ?download=
  if (/\b(supabase\.co|supabase\.in|storage\.supabase\.com)\b/.test(target.hostname)) {
    target.searchParams.set('download', name);
    return redirect(target);
  }

  // Other allowed hosts: try HEAD for size
  let size = 0, type = 'application/octet-stream';
  try {
    const head = await fetch(target.toString(), { method: 'HEAD' });
    if (head.ok) {
      size = Number(head.headers.get('content-length') || 0) || 0;
      type = head.headers.get('content-type') || type;
    }
  } catch {}

  // Stream if small enough; else redirect
  if (size > 0 && size <= MAX_STREAM_BYTES) {
    try {
      const upstream = await fetch(target.toString(), { redirect: 'follow' });
      if (!upstream.ok) {
        const text = await upstream.text().catch(()=>'');
        return json(upstream.status, { ok:false, error:'upstream_error', details: text.slice(0,1000) });
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      const ctype = upstream.headers.get('content-type') || type || 'application/octet-stream';
      return {
        statusCode: 200,
        headers: {
          ...cors(),
          'Content-Type': ctype,
          'Content-Disposition': `attachment; filename="${name}"`,
          'Cache-Control': 'no-store'
        },
        body: buf.toString('base64'),
        isBase64Encoded: true
      };
    } catch(e) {
      // if streaming fails, fall back to redirect
      return redirect(target);
    }
  }

  // No size info or too large -> redirect (no buffer limits)
  return redirect(target);
};

function redirect(urlObj){
  return {
    statusCode: 302,
    headers: { ...cors(), Location: urlObj.toString(), 'Cache-Control': 'no-store' },
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
