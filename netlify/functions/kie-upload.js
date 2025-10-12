// netlify/functions/kie-upload.js
// Drop-in replacement to remove base64 bloat and support ~10 MB images reliably.
// Change: uploads image bytes directly to Supabase Storage, returns a public (or signed) URL
// with the SAME response shape { downloadUrl } so your frontend code does not need to change.

/* Required env vars (already typical in your project):
   SUPABASE_URL
   SUPABASE_SERVICE_ROLE_KEY   // service role is needed for server-side uploads
   SUPABASE_BUCKET             // name of public bucket that should store user images (e.g., 'user-uploads')
   // Optional:
   SUPABASE_SIGNED_URL_SECONDS // if bucket is not public, sign links for this many seconds (default 3600)
*/

const Busboy = require('busboy');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors(), body: 'Method Not Allowed' };

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'user-uploads';
    const SIGN_EXP = parseInt(process.env.SUPABASE_SIGNED_URL_SECONDS || '3600', 10);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return { statusCode: 500, headers: cors(), body: 'Missing: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' };
    }

    const ct = event.headers['content-type'] || event.headers['Content-Type'] || '';
    if (!ct.includes('multipart/form-data')) {
      return { statusCode: 400, headers: cors(), body: 'Expected multipart/form-data' };
    }

    // Parse the incoming multipart form in a streaming-friendly way
    const { file, filename, mimeType: mimeFromForm, run_id } = await parseMultipart(event, ct);
    if (!file || !file.length) {
      return { statusCode: 400, headers: cors(), body: 'No file provided' };
    }

    // Sniff/validate image type
    const sniffed = sniffImageMime(file);
    let finalMime = (mimeFromForm || '').toLowerCase();
    if (!finalMime.startsWith('image/')) finalMime = '';
    if (!finalMime) finalMime = sniffed;
    if (!isSupportedImage(finalMime)) {
      return { statusCode: 415, headers: cors(), body: 'Unsupported image type. Use JPEG/PNG/WebP/GIF.' };
    }

    // Make a safe filename (preserve base if present; force correct extension)
    const base = (filename || (run_id ? `${run_id}-image` : 'image')).replace(/\.[^.]+$/, '');
    const ext = extForMime(finalMime);
    const safeName = `${sanitize(base)}.${ext}`;

    // Organize path: images/user-uploads/YYYY/MM/DD/random-safeName.ext
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    const rand = crypto.randomBytes(8).toString('hex');
    const objectPath = `images/user-uploads/${y}/${m}/${d}/${rand}-${safeName}`;

    // Upload to Supabase Storage (binary, no base64 bloat)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      global: { fetch: (...args) => fetch(...args) },
    });

    // If the object already exists (unlikely due to random prefix), allow overwrite
    const { error: upErr } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(objectPath, file, {
        contentType: finalMime,
        cacheControl: '31536000',
        upsert: true,
      });

    if (upErr) {
      return json(502, { error: 'upload_failed', detail: upErr.message || upErr });
    }

    // Create URL: prefer public URL if bucket is public; otherwise sign it
    let downloadUrl;
    try {
      const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(objectPath);
      downloadUrl = data?.publicUrl;
    } catch (_) {
      // fallthrough to signed
    }

    if (!downloadUrl) {
      const { data: signed, error: signErr } = await supabase
        .storage
        .from(SUPABASE_BUCKET)
        .createSignedUrl(objectPath, SIGN_EXP);
      if (signErr || !signed?.signedUrl) {
        return json(502, { error: 'url_failed', detail: signErr?.message || 'Could not create URL' });
      }
      downloadUrl = signed.signedUrl;
    }

    // Return SAME shape that your frontend expects
    return json(200, { downloadUrl });

  } catch (e) {
    return { statusCode: 502, headers: cors(), body: `Server error: ${e.message || e}` };
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

function json(code, obj) {
  return {
    statusCode: code,
    headers: { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj),
  };
}

// -------- helpers --------
function parseMultipart(event, contentType) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: { 'content-type': contentType } });
    const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '');
    const files = [];
    const fields = {};
    bb.on('file', (fieldname, stream, info) => {
      const chunks = [];
      stream.on('data', d => chunks.push(d));
      stream.on('limit', () => {});
      stream.on('end', () => files.push({ buffer: Buffer.concat(chunks), filename: info.filename, mimeType: info.mimeType }));
    });
    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('error', reject);
    bb.on('finish', () => {
      const f = files[0] || {};
      resolve({ file: f.buffer, filename: f.filename, mimeType: f.mimeType, ...fields });
    });
    bb.end(body);
  });
}

function sniffImageMime(buf) {
  if (!buf || buf.length < 12) return '';
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.length > 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
      buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return 'image/png';
  // WEBP: "RIFF"...."WEBP"
  if (buf.length > 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  // GIF: "GIF8"
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

function sanitize(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
}
