// netlify/functions/sign-upload.js
// Purpose: return a signed PUT URL for Supabase Storage + a public URL
// Contract (POST JSON): { filename: string, mime?: string }
// Response (200 JSON): { uploadUrl: string, publicUrl: string, bucket: string, objectPath: string }
//
// Notes:
// - No silent defaults. If SUPABASE_BUCKET/URL/KEY are missing, we fail loudly with a clear message.
// - Adds debug headers x-bucket / x-project-host / x-object to help verify runtime values.
// - Robust fallback: tries /object/upload/sign first, then legacy /object/sign if API returns 404
//   either as HTTP status OR within the JSON body.
// - CORS preflight supported.

const https = require('https');
const { URL } = require('url');
const crypto = require('crypto');

const HANDLER_VERSION = 'sign-upload@v4-node16';

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
function resp(code, body, headers) {
  return { statusCode: code, headers: { ...cors(), ...(headers || {}) }, body };
}
function json(code, obj, headers) {
  return resp(code, JSON.stringify(obj), { 'Content-Type': 'application/json', ...(headers || {}) });
}

function tinyFetch(rawUrl, opts = {}) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(rawUrl);
      const method = (opts.method || 'GET').toUpperCase();
      const headers = opts.headers || {};
      const body = opts.body || null;

      const req = https.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + (url.search || ''),
        method,
        headers,
      }, (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString('utf8');
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: res.headers,
            text: async () => text,
            json: async () => { try { return JSON.parse(text); } catch { return {}; } },
          });
        });
      });
      req.on('error', reject);
      if (body) {
        if (Buffer.isBuffer(body)) req.write(body);
        else if (typeof body === 'string') req.write(body, 'utf8');
        else return reject(new Error('Unsupported body type'));
      }
      req.end();
    } catch (e) { reject(e); }
  });
}

function sanitize(name) {
  return String(name || 'file')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}
function extForMime(mime) {
  const m = (mime || '').toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg' || m === 'image/pjpeg') return 'jpg';
  if (m === 'image/png' || m === 'image/x-png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'video/mp4') return 'mp4';
  if (m === 'video/quicktime') return 'mov';
  if (m === 'image/gif') return 'gif';
  return 'bin';
}
function encodePath(p) {
  return String(p).split('/').map(encodeURIComponent).join('/');
}

function configFromEnv() {
  const rawUrl = (process.env.SUPABASE_URL || '').trim();
  const rawBucket = (process.env.SUPABASE_BUCKET || '').trim();
  const rawKey = ((process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) || ((process.env.SUPABASE_SERVICE_KEY || '').trim());

  if (!rawUrl) throw new Error('Missing SUPABASE_URL');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(rawUrl)) {
    // Allow custom domains, but strongly hint typical mistake (/rest/v1 etc.)
    if (/\/rest\/v1/i.test(rawUrl)) throw new Error('SUPABASE_URL must be the project base (no /rest/v1)');
  }
  if (!rawBucket) throw new Error('Missing SUPABASE_BUCKET');
  if (!rawKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)');

  const exp = parseInt(String(process.env.SIGN_EXP || '3600'), 10) || 3600;

  return {
    SUPABASE_URL: rawUrl.replace(/\/+$/, ''),
    SUPABASE_BUCKET: rawBucket,
    SUPABASE_KEY: rawKey,
    SIGN_EXP: exp,
  };
}

async function trySignNew(urlBase, key, bucket, objectPath, mime, exp) {
  // Newer endpoint: /storage/v1/object/upload/sign/{bucket}/{path}
  const u = `${urlBase}/storage/v1/object/upload/sign/${encodeURIComponent(bucket)}/${encodePath(objectPath)}`;
  const body = { contentType: mime || 'application/octet-stream', upsert: true, expiresIn: exp };
  const res = await tinyFetch(u, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  let data = {};
  try { data = JSON.parse(txt); } catch {}
  return { httpOk: res.ok, httpStatus: res.status, body: data, rawText: txt };
}

async function trySignLegacy(urlBase, key, bucket, objectPath, exp) {
  // Legacy endpoint: /storage/v1/object/sign/{bucket}/{path}
  const u = `${urlBase}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodePath(objectPath)}`;
  const body = { expiresIn: exp, upsert: true };
  const res = await tinyFetch(u, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  let data = {};
  try { data = JSON.parse(txt); } catch {}
  return { httpOk: res.ok, httpStatus: res.status, body: data, rawText: txt };
}

function buildObjectPath(filename, mime) {
  const base = String(filename || 'file').replace(/\.[^.]+$/, '');
  const ext = extForMime(mime);
  const safeName = `${sanitize(base)}.${ext}`;
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const rand = crypto.randomBytes(8).toString('hex');
  // Keep generic prefix that matches your existing structure but avoids opinionated changes
  return `images/user-uploads/${y}/${m}/${d}/${rand}-${safeName}`;
}

exports.handler = async (event) => {
  const reqId = (event.headers && (event.headers['x-nf-request-id'] || event.headers['X-NF-Request-ID'])) || '';
  const baseHeaders = {
    ...cors(),
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'x-handler-version': HANDLER_VERSION,
  };
  if (reqId) baseHeaders['x-echo-nf-request-id'] = String(reqId);

  try {
    if (event.httpMethod === 'OPTIONS') return resp(204, '', baseHeaders);
    if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' }, baseHeaders);

    const cfg = configFromEnv();

    // Parse JSON body
    let payload = {};
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'bad_json' }, { ...baseHeaders, 'x-project-host': new URL(cfg.SUPABASE_URL).host, 'x-bucket': cfg.SUPABASE_BUCKET });
    }
    const filename = (payload.filename || '').toString();
    const mime = (payload.mime || '').toString().toLowerCase();

    const objectPath = buildObjectPath(filename, mime);

    // --- Optional pre-flight bucket check for precise diagnostics
    const bucketProbe = await tinyFetch(`${cfg.SUPABASE_URL}/storage/v1/bucket/${encodeURIComponent(cfg.SUPABASE_BUCKET)}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${cfg.SUPABASE_KEY}` },
    });
    if (bucketProbe.status === 404) {
      return json(500, { error: 'bucket_not_found', detail: `Bucket '${cfg.SUPABASE_BUCKET}' does not exist on project host ${new URL(cfg.SUPABASE_URL).host}` },
        { ...baseHeaders, 'x-project-host': new URL(cfg.SUPABASE_URL).host, 'x-bucket': cfg.SUPABASE_BUCKET, 'x-object': objectPath });
    }

    // Try new signer first
    let signed = await trySignNew(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, cfg.SUPABASE_BUCKET, objectPath, mime, cfg.SIGN_EXP);

    // Decide if we need to fallback: either HTTP 404 or body signals 404-ish
    const body404 = signed.body && (
      String(signed.body.statusCode || '').includes('404') ||
      /not[\s_-]?found/i.test(JSON.stringify(signed.body)) ||
      /bucket.*not.*found/i.test(JSON.stringify(signed.body))
    );

    if ((!signed.httpOk && signed.httpStatus === 404) || body404) {
      signed = await trySignLegacy(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, cfg.SUPABASE_BUCKET, objectPath, cfg.SIGN_EXP);
    }

    if (!(signed && (signed.httpOk))) {
      const detail = (signed && (signed.rawText || JSON.stringify(signed.body))) || 'unknown';
      return json(502, { error: 'sign_failed', detail },
        { ...baseHeaders, 'x-project-host': new URL(cfg.SUPABASE_URL).host, 'x-bucket': cfg.SUPABASE_BUCKET, 'x-object': objectPath });
    }

    const signedUrl = signed.body && (signed.body.signedUrl || signed.body.signedURL || signed.body.url);
    if (!signedUrl) {
      return json(500, { error: 'sign_missing_url', detail: signed.body || signed.rawText || null },
        { ...baseHeaders, 'x-project-host': new URL(cfg.SUPABASE_URL).host, 'x-bucket': cfg.SUPABASE_BUCKET, 'x-object': objectPath });
    }

    // Construct absolute upload URL
    const uploadUrl = signedUrl.startsWith('http')
      ? signedUrl
      : `${cfg.SUPABASE_URL.replace(/\/+$/, '')}${signedUrl.startsWith('/') ? '' : '/'}${signedUrl}`;

    // Public URL (works when bucket is public)
    const publicUrl = `${cfg.SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(cfg.SUPABASE_BUCKET)}/${encodePath(objectPath)}`;

    return json(200, { uploadUrl, publicUrl, bucket: cfg.SUPABASE_BUCKET, objectPath },
      { ...baseHeaders, 'x-project-host': new URL(cfg.SUPABASE_URL).host, 'x-bucket': cfg.SUPABASE_BUCKET, 'x-object': objectPath });
  } catch (e) {
    return json(500, { error: 'server_error', detail: String(e && e.message ? e.message : e) }, { ...baseHeaders });
  }
};
