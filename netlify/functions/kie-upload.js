// netlify/functions/kie-upload.js (CommonJS)
// Backward compatible: supports both images and videos, returns { downloadUrl }.
// Works for Veo 3, Aleph, Nano Banana, etc.

const Busboy = require('busboy');

const UPLOAD_BASE64_URL = 'https://kieai.redpandaai.co/api/file-base64-upload';
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

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
    if (file.length > MAX_BYTES) {
      return { statusCode: 413, headers: cors(), body: 'File too large (max 10MB)' };
    }

    // ---- MIME detection ----
    let finalMime = (mimeFromForm || '').toLowerCase();
    if (!finalMime.startsWith('image/') && !finalMime.startsWith('video/')) finalMime = '';

    // If form mime missing or suspicious, sniff from bytes
    if (!finalMime) {
      const img = sniffImageMime(file);
      if (img) finalMime = img;
      else {
        const vid = sniffVideoMime(file);
        if (vid) finalMime = vid;
      }
    }

    // Validate
    const isImage = isSupportedImage(finalMime);
    const isVideo = isSupportedVideo(finalMime);
    if (!isImage && !isVideo) {
      return {
        statusCode: 415,
        headers: cors(),
        body: 'Unsupported file type. Use JPEG/PNG/WebP/GIF or MP4/MOV/WebM.'
      };
    }

    // ---- Build filename + base64 data URL ----
    const base = (filename || (run_id ? `${run_id}-${isVideo ? 'video' : 'image'}` : (isVideo ? 'video' : 'image'))).replace(/\.[^.]+$/, '');
    const ext = isImage ? extForImageMime(finalMime) : extForVideoMime(finalMime);
    const safeName = `${base}.${ext}`;

    const base64 = Buffer.from(file).toString('base64');
    const dataUrl = `data:${finalMime};base64,${base64}`;

    // ---- Upload to KIE public storage ----
    const uploadPath = isVideo ? 'videos/user-uploads' : 'images/user-uploads';

    const up = await fetch(UPLOAD_BASE64_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KIE_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        base64Data: dataUrl,
        uploadPath,
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

// -------- image sniffers --------
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
function extForImageMime(m) {
  if (m === 'image/jpeg') return 'jpg';
  if (m === 'image/png')  return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/gif')  return 'gif';
  return 'bin';
}

// -------- video sniffers --------
function sniffVideoMime(buf){
  if (!buf || buf.length < 12) return '';
  // MP4/MOV family: look for "ftyp" at offset 4
  if (buf.length > 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    // crude: treat anything with ftyp as MP4 container
    return 'video/mp4';
  }
  // WebM / Matroska: EBML header 1A 45 DF A3
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) {
    return 'video/webm';
  }
  return '';
}
function isSupportedVideo(m){
  return m === 'video/mp4' || m === 'video/quicktime' || m === 'video/webm';
}
function extForVideoMime(m){
  if (m === 'video/mp4') return 'mp4';
  if (m === 'video/quicktime') return 'mov';
  if (m === 'video/webm') return 'webm';
  return 'bin';
}
