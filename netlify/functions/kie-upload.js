// netlify/functions/kie-upload.js
// Zero-deps uploader to Supabase Storage via REST
// Accepts EITHER real files (multipart with filename) OR base64 data URLs in fields.
// Returns { downloadUrl, urls } where downloadUrl is the first uploaded URL.

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
      return json(500, { error: 'server_config', detail: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
    }

    const ct = event.headers['content-type'] || event.headers['Content-Type'] || '';
    if (!ct.includes('multipart/form-data')) {
      return json(400, { error: 'bad_request', detail: 'Expected multipart/form-data' });
    }

    const m = ct.match(/boundary=([^;]+)/i);
    if (!m) return json(400, { error: 'bad_request', detail: 'Missing multipart boundary' });
    const boundary = '--' + m[1];

    const bodyBuf = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'binary');

    // Split parts by boundary
    const parts = splitMultipart(bodyBuf, boundary);
    if (!parts.length) return json(400, { error: 'bad_request', detail: 'No multipart parts found' });

    // Collect uploaded images: prefer real files; fall back to data-URL fields
    const images = [];

    for (const p of parts) {
      const headerEnd = p.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;
      const headersTxt = p.slice(0, headerEnd).toString('utf8');
      const body = p.slice(headerEnd + 4);
      // Trim trailing CRLF
      const cleanBody = body.slice(-2).toString('binary') === '\r\n' ? body.slice(0, -2) : body;

      const cd = /content-disposition:[^\n]*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i.exec(headersTxt);
      const ctPart = /content-type:\s*([^\r\n]+)/i.exec(headersTxt);
      const fieldName = cd ? cd[1] : '';
      const filename = cd && cd[2] ? cd[2] : '';

      if (filename) {
        // Real file
        const mime = (ctPart && ctPart[1]) ? ctPart[1].trim().toLowerCase() : sniffImageMime(cleanBody) || 'application/octet-stream';
        if (!isSupportedImage(mime)) continue;
        images.push({ kind: 'file', filename, mime, data: cleanBody });
        continue;
      }

      // Possible data URL string
      const asText = cleanBody.toString('utf8').trim();
      if (asText.startsWith('data:image/')) {
        const b = dataUrlToBuffer(asText);
        if (b && b.buffer && isSupportedImage(b.mime)) {
          const fname = (fieldName || 'image') + '.' + extForMime(b.mime);
          images.push({ kind: 'data', filename: fname, mime: b.mime, data: b.buffer });
        }
      }
    }

    if (!images.length) {
      return json(400, { error: 'no_file', detail: 'No image file or data URL found in form-data' });
    }

    // Upload all images; return first URL as downloadUrl and full list in urls[]
    const urls = [];
    for (const img of images) {
      const { url, error } = await uploadToSupabase({
        SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET, SIGN_EXP
      }, img.data, img.mime, img.filename);
      if (error) {
        return json(502, { error: 'upload_failed', detail: error });
      }
      urls.push(url);
    }

    return json(200, { downloadUrl: urls[0], urls });

  } catch (e) {
    return json(502, { error: 'server_error', detail: String(e && e.message ? e.message : e) });
  }
};

// ---- helpers ----
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}
function resp(statusCode, body, headers) {
  return { statusCode, headers, body };
}
function json(code, obj) {
  return {
    statusCode: code,
    headers: { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj),
  };
}
function sanitize(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
}
function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}
function splitMultipart(buf, boundary) {
  const out = [];
  const b = Buffer.from(boundary);
  let i = buf.indexOf(b);
  while (i !== -1) {
    const j = buf.indexOf(b, i + b.length);
    if (j === -1) break;
    // Slice between boundaries, trim leading/trailing CRLF
    let part = buf.slice(i + b.length, j);
    if (part.slice(0, 2).toString('binary') === '\r\n') part = part.slice(2);
    if (part.slice(-2).toString('binary') === '\r\n') part = part.slice(0, -2);
    if (part.length > 0) out.push(part);
    i = j;
  }
  return out;
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
function dataUrlToBuffer(s) {
  // data:image/png;base64,AAAA...
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(s.trim());
  if (!m) return null;
  try {
    return { mime: m[1].toLowerCase(), buffer: Buffer.from(m[2], 'base64') };
  } catch {
    return null;
  }
}
async function uploadToSupabase(cfg, fileBuf, mime, filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  const ext = extForMime(mime);
  const safeName = `${sanitize(base)}.${ext}`;
  const now = new Date();
  const y = now.getUTCFullYear();
  const mth = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const rand = crypto.randomBytes(8).toString('hex');
  const objectPath = `images/user-uploads/${y}/${mth}/${d}/${rand}-${safeName}`;

  const uploadUrl = `${cfg.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(cfg.SUPABASE_BUCKET)}/${encodePath(objectPath)}?upsert=true`;

  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': mime,
      'x-upsert': 'true',
      'cache-control': 'public, max-age=31536000'
    },
    body: fileBuf
  });

  if (!upRes.ok) {
    const detail = await upRes.text().catch(() => '');
    return { error: `status ${upRes.status}: ${detail || 'upload failed'}` };
  }

  // Build public URL first
  let url = `${cfg.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/${encodeURIComponent(cfg.SUPABASE_BUCKET)}/${encodePath(objectPath)}`;
  const head = await fetch(url, { method: 'HEAD' });
  if (head.status === 401 || head.status === 404) {
    // Sign
    const signUrl = `${cfg.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/sign/${encodeURIComponent(cfg.SUPABASE_BUCKET)}/${encodePath(objectPath)}`;
    const signRes = await fetch(signUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ expiresIn: cfg.SIGN_EXP || 3600 })
    });
    if (!signRes.ok) {
      const msg = await signRes.text().catch(() => '');
      return { error: `sign ${signRes.status}: ${msg}` };
    }
    const data = await signRes.json().catch(() => ({}));
    const rel = data.signedURL || data.signedUrl;
    if (!rel) return { error: 'sign: missing signed URL' };
    url = `${cfg.SUPABASE_URL.replace(/\/+$/, '')}${rel.startsWith('/') ? '' : '/'}${rel}`;
  }

  return { url };
}
