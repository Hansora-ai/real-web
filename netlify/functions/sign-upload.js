// netlify/functions/sign-upload.js
// v6: Accept Supabase upload signed path with or without `/storage/v1` prefix.
// Treat returned `signedUrl` as the PUT URL.

const https = require('https');
const { URL } = require('url');
const crypto = require('crypto');

const HANDLER_VERSION = 'sign-upload@v6-accept-sign-path';

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

function cfg() {
  const rawUrl = (process.env.SUPABASE_URL || '').trim();
  const rawBucket = (process.env.SUPABASE_BUCKET || '').trim();
  const rawKey = ((process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) || ((process.env.SUPABASE_SERVICE_KEY || '').trim());
  if (!rawUrl) throw new Error('Missing SUPABASE_URL');
  if (!rawBucket) throw new Error('Missing SUPABASE_BUCKET');
  if (!rawKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)');
  const exp = parseInt(String(process.env.SIGN_EXP || '3600'), 10) || 3600;
  return {
    url: rawUrl.replace(/\/+$/, ''),
    bucket: rawBucket,
    key: rawKey,
    exp,
  };
}

async function signUpload(urlBase, key, bucket, objectPath, mime, exp) {
  // Request a signed PUT URL
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
  return { ok: res.ok, status: res.status, data, raw: txt };
}

function objectPathFor(filename, mime) {
  const base = String(filename || 'file').replace(/\.[^.]+$/, '');
  const ext = extForMime(mime);
  const safe = `${sanitize(base)}.${ext}`;
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const rand = crypto.randomBytes(8).toString('hex');
  return `images/user-uploads/${y}/${m}/${d}/${rand}-${safe}`;
}

function absolutize(base, pathOrUrl) {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  // Ensure we include /storage/v1 if missing
  const needsPrefix = !/^\/storage\/v1\//.test(pathOrUrl);
  const p = needsPrefix ? `/storage/v1${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}` : pathOrUrl;
  return `${base}${p}`;
}

exports.handler = async (event) => {
  const headers = { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'x-handler-version': HANDLER_VERSION };
  try {
    if (event.httpMethod === 'OPTIONS') return resp(204, '', headers);
    if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' }, headers);

    const { url, bucket, key, exp } = cfg();

    let payload = {};
    try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad_json' }, headers); }
    const filename = (payload.filename || '').toString();
    const mime = (payload.mime || '').toString().toLowerCase();
    const objectPath = objectPathFor(filename, mime);

    // Bucket probe for precise diagnostics
    const probe = await tinyFetch(`${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${key}` },
    });
    if (probe.status === 404) {
      return json(500, { error: 'bucket_not_found', detail: `Bucket '${bucket}' does not exist on ${new URL(url).host}` },
        { ...headers, 'x-project-host': new URL(url).host, 'x-bucket': bucket });
    }

    const signed = await signUpload(url, key, bucket, objectPath, mime, exp);
    if (!signed.ok) {
      return json(502, { error: 'sign_failed', detail: signed.raw || signed.data },
        { ...headers, 'x-project-host': new URL(url).host, 'x-bucket': bucket });
    }

    const signedUrl = signed.data && (signed.data.signedUrl || signed.data.signedURL || signed.data.url);
    if (!signedUrl) {
      return json(500, { error: 'sign_missing_url', detail: signed.data || signed.raw }, { ...headers, 'x-project-host': new URL(url).host, 'x-bucket': bucket });
    }

    // Accept `/object/upload/sign/...` with or without `/storage/v1` prefix

    const uploadUrl = absolutize(url, signedUrl);
    const publicUrl = `${url}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeURIComponent(objectPath).replace(/%2F/g,'/')}`;

    return json(200, { uploadUrl, publicUrl, bucket, objectPath },
      { ...headers, 'x-project-host': new URL(url).host, 'x-bucket': bucket, 'x-object': objectPath });
  } catch (e) {
    return json(500, { error: 'server_error', detail: String(e && e.message ? e.message : e) }, headers);
  }
};
