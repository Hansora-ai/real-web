// netlify/functions/kie-upload.js (CommonJS)
const Busboy = require('busboy');

const UPLOAD_BASE64_URL = 'https://kieai.redpandaai.co/api/file-base64-upload';

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors(), body: 'Method Not Allowed' };

    const KIE_API_KEY = process.env.KIE_API_KEY;
    if (!KIE_API_KEY) return { statusCode: 500, headers: cors(), body: 'Missing: KIE_API_KEY' };

    const ct = event.headers['content-type'] || event.headers['Content-Type'] || '';
    if (!ct.includes('multipart/form-data')) {
      return { statusCode: 400, headers: cors(), body: 'Expected multipart/form-data' };
    }

    const { file, filename, mimeType: mimeFromForm, run_id } = await parseMultipart(event, ct);
    if (!file || !file.length) return { statusCode: 400, headers: cors(), body: 'No file provided' };

    // --- MIME sniffing from bytes (JPEG/PNG/WebP/GIF only) ---
    const sniffed = sniffImageMime(file); // returns 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | ''
    let finalMime = (mimeFromForm || '').toLowerCase();
    if (!finalMime.startsWith('image/')) finalMime = ''; // ignore bogus types
    if (!finalMime) finalMime = sniffed;                 // trust bytes if header was missing/bad

    // If still not a supported image, hard-stop (avoid prompt-only runs later)
    if (!isSupportedImage(finalMime)) {
      return {
        statusCode: 415,
        headers: cors(),
        body: 'Unsupported image type. Use JPEG/PNG/WebP/GIF.'
      };
    }

    // --- Ensure filename has the right extension for the MIME ---
    const base = (filename || (run_id ? `${run_id}-image` : 'image')).replace(/\.[^.]+$/, '');
    const ext = extForMime(finalMime); // 'jpg'|'png'|'webp'|'gif'
    const safeName = `${base}.${ext}`;

    // Build data URL with the corrected MIME
    const base64 = Buffer.from(file).toString('base64');
    const dataUrl = `data:${finalMime};base64,${base64}`;

    // Upload to KIE
    const up = await fetch(UPLOAD_BASE64_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KIE_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        base64Data: dataUrl,
        uploadPath: 'images/user-uploads',
        fileName: safeName
      })
    });

    const uj = await up.json().catch(() => ({}));
    if (!up.ok || !uj?.data?.downloadUrl) {
      return {
        statusCode: 502,
        headers: { ...cors(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'upload_failed', detail: uj })
      };
    }

    return {
      statusCode: 200,
      headers: { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ downloadUrl: uj.data.downloadUrl })
    };
  } catch (e) {
    return { statusCode: 502, headers: cors(), body: `Server error: ${e.message || e}` };
  }
};

function cors(){ return {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};}

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
