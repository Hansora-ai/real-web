// netlify/functions/sign-upload.js
// v7: Robust signer — accepts any Supabase signed URL shape, sets upsert:true, and returns both uploadUrl & publicUrl.
// Minimal surface change vs. earlier versions; only relaxes URL checks and always upserts.

const https = require('https');
const { URL } = require('url');

const HANDLER_VERSION = 'sign-upload@v7-robust-upsert';

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(status, body, extra = {}) {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors(), ...extra, 'x-handler-version': HANDLER_VERSION },
    body: JSON.stringify(body),
  };
}

function absolutize(baseUrl, maybePath) {
  try {
    const u = new URL(maybePath);
    return u.toString(); // already absolute
  } catch {
    // relative path from Supabase like /storage/v1/object/upload/sign/...
    return new URL(maybePath, baseUrl).toString();
  }
}

function safeJoinPath(...parts) {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\//, '') // no leading slash
    .replace(/\/$/, ''); // no trailing slash
}

function fetchJSON(u, { method='GET', headers={}, body } = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(u);
    const req = https.request({
      method,
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => data += c);
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(data || '{}'); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  const headers = cors();
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { error: 'missing_env', detail: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing' }, headers);
    }

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch {}
    const filename = (body.filename || 'upload.bin').replace(/[^A-Za-z0-9._-]/g, '_');
    const mime = String(body.mime || 'application/octet-stream');
    const bucket = String(body.bucket || 'video'); // default you used in screenshots

    // object path: images/user-uploads/YYYY/MM/DD/<rand>-<filename>
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    const rand = Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
    const objectPath = safeJoinPath('images/user-uploads', `${y}`, `${m}`, `${d}`, `${rand}-${filename}`);

    // Request a signed upload URL from Supabase (upsert:true)
    const signUrl = new URL(`/storage/v1/object/upload/sign/${encodeURIComponent(bucket)}/${encodeURIComponent(objectPath)}`, SUPABASE_URL);
    const { status, body: signBody } = await fetchJSON(signUrl.toString(), {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'content-type': 'application/json',
        'x-client-info': HANDLER_VERSION,
      },
      body: { expiresIn: 3600, upsert: true, contentType: mime },
    });

    if (status < 200 || status >= 300) {
      return json(500, { error: 'sign_failed', detail: signBody && (signBody.message || signBody.error) || 'unknown', signBody }, headers);
    }

    // Supabase returns { signedUrl: "...", path: "..." } — accept any shape
    const rawSigned = signBody.signedUrl || signBody.url || signBody.signed_url || signBody.signedURL;
    if (!rawSigned) {
      return json(500, { error: 'sign_missing_url', detail: signBody }, headers);
    }

    const uploadUrl = absolutize(SUPABASE_URL, rawSigned);
    const publicUrl = new URL(`/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath.split('/').map(encodeURIComponent).join('/')}`, SUPABASE_URL).toString();

    return json(200, { uploadUrl, publicUrl, bucket, objectPath },
      { ...headers, 'x-project-host': new URL(SUPABASE_URL).host, 'x-bucket': bucket, 'x-object': objectPath });
  } catch (e) {
    return json(500, { error: 'server_error', detail: String(e && e.message ? e.message : e) }, headers);
  }
};
