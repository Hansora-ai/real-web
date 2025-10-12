// netlify/functions/kie-upload.js
// Single-file, zero-dependency uploader to Supabase Storage via REST.
// Robust multipart parsing + correct binary handling to prevent 502s on larger files.

const crypto = require('crypto');

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return resp(204, '', cors());
    if (event.httpMethod !== 'POST') return resp(405, 'Method Not Allowed', cors());

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'user-uploads';
    const SIGN_EXP = parseInt(process.env.SUPABASE_SIGNED_URL_SECONDS || '3600', 10);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return resp(500, 'Missing: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY', cors());
    }

    const ct = event.headers['content-type'] || event.headers['Content-Type'] || '';
    if (!ct.includes('multipart/form-data')) {
      return json(400, { error: 'bad_request', detail: 'Expected multipart/form-data' });
    }

    // Parse boundary
    const m = ct.match(/boundary=([^;]+)/i);
    if (!m) return json(400, { error: 'bad_request', detail: 'Missing multipart boundary' });
    const boundary = '--' + m[1];

    // Decode body buffer safely: use base64 when flagged; otherwise treat as binary
    const bodyBuf = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'binary');

    // Split into parts
    const boundaryBuf = Buffer.from('\r\n' + boundary);
    let startIndex = bodyBuf.indexOf(boundary.startsWith('--') ? boundary : '--' + boundary);
    if (startIndex === -1) startIndex = 0;
    const parts = [];
    let idx = bodyBuf.indexOf(boundary, startIndex);
    while (idx !== -1) {
      const next = bodyBuf.indexOf(boundary, idx + boundary.length);
      if (next === -1) break;
      parts.push(bodyBuf.slice(idx + boundary.length + 2, next - 2)); // skip \r\n .. part .. \r\n
      idx = next;
    }

    // Fallback if loop didn't capture (e.g., trailing --)
    if (parts.length === 0) {
      const split = bodyBuf.toString('binary').split(boundary);
      for (const p of split) {
        const buf = Buffer.from(p, 'binary');
        if (buf.length > 4) parts.push(buf);
      }
    }

    if (!parts.length) return json(400, { error: 'bad_request', detail: 'No multipart parts found' });

    // Pick the first part with a filename (the uploaded file)
    let filePart = null;
    for (const p of parts) {
      const headerEnd = p.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;
      const headersTxt = p.slice(0, headerEnd).toString('utf8');
      const cd = /content-disposition:[^\n]*name="[^"]+"(?:;\s*filename="([^"]*)")?/i.exec(headersTxt);
      if (cd && cd[1]) { filePart = p; break; }
    }
    if (!filePart) return json(400, { error: 'no_file', detail: 'No file found in form-data' });

    const headerEnd = filePart.indexOf('\r\n\r\n');
    const headersTxt = filePart.slice(0, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    // Trim possible trailing \r\n at the end of the part
    let fileBuf = filePart.slice(bodyStart);
    if (fileBuf.slice(-2).toString('binary') === '\r\n') fileBuf = fileBuf.slice(0, -2);

    // Extract filename and content-type
    const cd = /content-disposition:[^\n]*name="[^"]+"(?:;\s*filename="([^"]*)")?/i.exec(headersTxt);
    const ctPart = /content-type:\s*([^\r\n]+)/i.exec(headersTxt);
    let filename = (cd && cd[1]) ? cd[1] : 'image';
    let mime = (ctPart && ctPart[1]) ? ctPart[1].trim().toLowerCase() : sniffImageMime(fileBuf) || 'application/octet-stream';

    // Validate allowed image types
    if (!isSupportedImage(mime)) {
      return json(415, { error: 'unsupported_type', detail: 'Use JPEG/PNG/WebP/GIF' });
    }

    // Build safe storage path
    const base = filename.replace(/\.[^.]+$/, '');
    const ext = extForMime(mime);
    const safeName = `${sanitize(base)}.${ext}`;
    const now = new Date();
    const y = now.getUTCFullYear();
    const mth = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    const rand = crypto.randomBytes(8).toString('hex');
    const objectPath = `images/user-uploads/${y}/${mth}/${d}/${rand}-${safeName}`;

    // Upload via Supabase Storage REST
    const uploadUrl = `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${encodePath(objectPath)}?upsert=true`;

    const upRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': mime,
        'x-upsert': 'true',
        'cache-control': 'public, max-age=31536000'
      },
      body: fileBuf
    });

    if (!upRes.ok) {
      const detail = await safeText(upRes);
      return json(502, { error: 'upload_failed', status: upRes.status, detail });
    }

    // Public URL try
    let downloadUrl = `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/${encodeURIComponent(SUPABASE_BUCKET)}/${encodePath(objectPath)}`;
    const testHead = await fetch(downloadUrl, { method: 'HEAD' });
    if (testHead.status === 401 || testHead.status === 404) {
      // Sign URL via REST
      const signUrl = `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/sign/${encodeURIComponent(SUPABASE_BUCKET)}/${encodePath(objectPath)}`;
      const signRes = await fetch(signUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ expiresIn: SIGN_EXP })
      });
      if (!signRes.ok) {
        const detail = await safeText(signRes);
        return json(502, { error: 'url_failed', status: signRes.status, detail });
      }
      const data = await signRes.json().catch(() => ({}));
      const rel = data.signedURL || data.signedUrl;
      if (!rel) return json(502, { error: 'url_failed', detail: 'Missing signed URL in response' });
      downloadUrl = `${SUPABASE_URL.replace(/\/+$/, '')}${rel.startsWith('/') ? '' : '/'}${rel}`;
    }

    return json(200, { downloadUrl });

  } catch (e) {
    return json(502, { error: 'server_error', detail: String(e && e.message ? e.message : e) });
  }
};

// ---------- Utils ----------
function resp(statusCode, body, headers) {
  return { statusCode, headers, body };
}
function json(code, obj) {
  return {
    statusCode: code,
    headers: { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj)
  };
}
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}
function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}
function sanitize(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
}
function sniffImageMime(buf) {
  if (!buf || buf.length < 12) return '';
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.length > 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
      buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return 'image/png';
  if (buf.length > 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  if (buf.length > 6 &&
      buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  return '';
}
function isSupportedImage(m) {
  return m === 'image/jpeg' || m === 'image/png' || m === 'image/webp' || m === 'image/gif';
}
function extForMime(m) {
  if (m === 'image/jpeg') return 'jpg';
  if (m === 'image/png')  return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/gif')  return 'gif';
  return 'bin';
}
async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}
