// netlify/functions/kie-upload.js
// Single-file, zero-dependency version.
// - Parses single-file multipart manually (no busboy)
// - Uploads raw bytes to Supabase Storage REST (no @supabase/supabase-js)
// - Returns { downloadUrl } (public URL if bucket is public; otherwise signed URL)
// Keep everything else untouched in your project.

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
      return resp(400, 'Expected multipart/form-data', cors());
    }

    // Parse boundary
    const m = ct.match(/boundary=([^;]+)/i);
    if (!m) return resp(400, 'Missing multipart boundary', cors());
    const boundary = '--' + m[1];

    // Decode body buffer
    const bodyBuf = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8'); // Netlify typically sets base64 for binary

    // Extract first part (single file) naively and safely
    const firstBoundary = bufferIndexOf(bodyBuf, Buffer.from(boundary + '\r\n'));
    if (firstBoundary < 0) return resp(400, 'Invalid multipart: start', cors());
    const headerStart = firstBoundary + Buffer.byteLength(boundary + '\r\n');
    const headerEnd = bufferIndexOf(bodyBuf, Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd < 0) return resp(400, 'Invalid multipart: headers', cors());
    const headersBuf = bodyBuf.slice(headerStart, headerEnd);
    const contentStart = headerEnd + 4;

    const closingBoundaryIdx = bufferIndexOf(bodyBuf, Buffer.from('\r\n' + boundary), contentStart);
    if (closingBoundaryIdx < 0) return resp(400, 'Invalid multipart: end boundary', cors());

    const fileBuf = bodyBuf.slice(contentStart, closingBoundaryIdx);

    // Parse Content-Disposition for filename; Content-Type for mime
    const headersTxt = headersBuf.toString('utf8');
    const cd = /content-disposition:[^\n]*name="[^"]+"(?:;\s*filename="([^"]*)")?/i.exec(headersTxt);
    const ctPart = /content-type:\s*([^\r\n]+)/i.exec(headersTxt);
    let filename = (cd && cd[1]) ? cd[1] : 'image';
    let mime = (ctPart && ctPart[1]) ? ctPart[1].trim().toLowerCase() : sniffImageMime(fileBuf) || 'application/octet-stream';

    // Allow only common image types (like your previous logic)
    if (!isSupportedImage(mime)) {
      return json(415, { error: 'unsupported_type', detail: 'Use JPEG/PNG/WebP/GIF' });
    }

    const base = filename.replace(/\.[^.]+$/, '');
    const ext = extForMime(mime);
    const safeName = `${sanitize(base)}.${ext}`;

    const now = new Date();
    const y = now.getUTCFullYear();
    const mth = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    const rand = crypto.randomBytes(8).toString('hex');
    const objectPath = `images/user-uploads/${y}/${mth}/${d}/${rand}-${safeName}`;

    // Upload via Supabase Storage REST (no SDK)
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
      const text = await upRes.text().catch(() => '');
      return json(502, { error: 'upload_failed', status: upRes.status, detail: text });
    }

    // Try public URL first
    let downloadUrl = `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/${encodeURIComponent(SUPABASE_BUCKET)}/${encodePath(objectPath)}`;

    // Probe if bucket is public; if not, sign a URL via REST
    const testHead = await fetch(downloadUrl, { method: 'HEAD' });
    if (testHead.status === 401 || testHead.status === 404) {
      // Create signed URL
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
        const msg = await signRes.text().catch(() => '');
        return json(502, { error: 'url_failed', detail: msg });
      }
      const data = await signRes.json().catch(() => ({}));
      if (!data?.signedURL && !data?.signedUrl) {
        return json(502, { error: 'url_failed', detail: 'Could not create signed URL' });
      }
      const rel = data.signedURL || data.signedUrl; // API returns one of these
      downloadUrl = `${SUPABASE_URL.replace(/\/+$/, '')}${rel.startsWith('/') ? '' : '/'}${rel}`;
    }

    return json(200, { downloadUrl });

  } catch (e) {
    return resp(502, `Server error: ${e.message || e}`, cors());
  }
};

// ---------- Utils (no deps) ----------
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
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg'; // JPEG
  if (buf.length > 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
      buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return 'image/png'; // PNG
  if (buf.length > 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp'; // WEBP
  if (buf.length > 6 &&
      buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif'; // GIF
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

// Find a Buffer inside another Buffer (simple Boyer–Moore not needed here)
function bufferIndexOf(buf, subBuf, start = 0) {
  return buf.indexOf(subBuf, start);
}
