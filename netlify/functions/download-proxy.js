// netlify/functions/download-proxy.js
// Redirect-based proxy: no buffering, no base64. Handles huge files (12MB, 1GB+).
// - Unwraps double-proxied URLs
// - Fixes common typos (hhttps://)
// - Adds filename via Supabase ?download=
// - Simple domain allowlist
// - Console logs for diagnostics (view in Netlify function logs)

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

  // unwrap nested/double-proxy up to 3 times & fix common typos
  raw = unwrap(raw).replace(/^hhttps:\/\//i, 'https://').replace(/^hhttp:\/\//i, 'http://');

  let target;
  try { target = new URL(raw); }
  catch { return json(400, { ok:false, error:'bad_url', url: raw }); }

  // Basic allowlist to avoid open redirects (adjust as needed)
  const ALLOW = [
    'supabase.co',
    'supabase.in',
    'storage.supabase.com', // in case of CDN fronts
    'replicate.delivery'
  ];
  const allowed = ALLOW.some((d) => target.hostname === d || target.hostname.endsWith(`.${d}`));
  if (!allowed) {
    console.warn('[download-proxy] blocked host:', target.hostname, 'url:', target.toString());
    return json(400, { ok:false, error:'blocked_host', host: target.hostname });
  }

  // Derive a friendly filename if not given
  if (!name) {
    try {
      name = decodeURIComponent((target.pathname.split('/').pop() || 'download').split('?')[0]);
    } catch { name = target.pathname.split('/').pop() || 'download'; }
  }
  name = name.replace(/[^\w.\- ]+/g, '_').slice(0, 150);

  // Supabase Storage: force download with the desired file name
  if (/\b(supabase\.co|supabase\.in|storage\.supabase\.com)\b/.test(target.hostname)) {
    target.searchParams.set('download', name);
  }

  // Minimal structured logging for troubleshooting
  console.log('[download-proxy] redirecting', {
    host: target.hostname,
    path: target.pathname,
    size_limit: 'N/A (redirect)',
    filename: name
  });

  // 302 redirect: browser pulls bytes directly from origin/CDN (no size limit)
  return {
    statusCode: 302,
    headers: { ...cors(), Location: target.toString(), 'Cache-Control': 'no-store' },
    body: ''
  };
};

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
    } catch {
      break;
    }
  }
  return s;
}
