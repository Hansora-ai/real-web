// netlify/functions/kie-upload-video.js
// Robust video uploader (<=10 MB raw).
// - Accepts the *first* file part (any field name) from multipart/form-data
// - No external deps; safe Buffer.indexOf parsing
// - Sends { fileBase64, uploadPath, fileName } to KIE
// - Returns { downloadUrl } or a clear JSON { error, ... }

const UPLOAD_BASE64_URL = 'https://kieai.redpandaai.co/api/file-base64-upload';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: cors(), body: '' };
    }
    if (event.httpMethod !== 'POST') {
      return res(405, { error: 'method_not_allowed' });
    }

    const KIE_API_KEY = process.env.KIE_API_KEY;
    if (!KIE_API_KEY) return res(500, { error: 'missing_api_key' });

    const ct = (event.headers['content-type'] || event.headers['Content-Type'] || '').toString();
    if (!ct.includes('multipart/form-data')) return res(400, { error: 'expected_multipart', got: ct });

    const bMatch = /boundary=([^;]+)/i.exec(ct);
    if (!bMatch) return res(400, { error: 'missing_boundary' });
    const boundary = bMatch[1]; // without leading dashes

    // Body buffer (Netlify sends base64 for multipart)
    const bodyBuf = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8');

    const filePart = parseFirstFilePart(bodyBuf, boundary);
    if (!filePart) return res(400, { error: 'no_file_found' });

    const { filename, mimeType, content } = filePart;
    if (!content || !content.length) return res(400, { error: 'empty_file' });
    if (content.length > MAX_BYTES) return res(413, { error: 'file_too_large', max: MAX_BYTES, got: content.length });

    const finalMime = normalizeVideoMime(mimeType, content);
    if (!finalMime.startsWith('video/')) return res(415, { error: 'unsupported_type', type: finalMime });

    const baseName = (filename || 'video').replace(/\.[^.]+$/, '');
    const ext = extForVideoMime(finalMime);
    const safeName = `${baseName}.${ext}`;

    const dataUrl = `data:${finalMime};base64,${content.toString('base64')}`;
    const uploadPath = 'videos/user-uploads';

    let upRes;
    try {
      upRes = await fetch(UPLOAD_BASE64_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${KIE_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ fileBase64: dataUrl, uploadPath, fileName: safeName })
      });
    } catch (err) {
      return res(502, { error: 'fetch_crash', detail: String(err && err.message || err) });
    }

    let uj = {};
    try { uj = await upRes.json(); } catch (_) {}

    const dl = uj?.data?.downloadUrl || uj?.downloadUrl || uj?.url || uj?.data?.url || '';
    if (!upRes.ok || !dl) return res(502, { error: 'upload_failed', status: upRes.status, response: uj });

    return res(200, { downloadUrl: dl });
  } catch (e) {
    return res(500, { error: 'server_error', detail: String(e && e.message || e) });
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

function res(code, obj) {
  return { statusCode: code, headers: { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

// -------- Multipart parsing using Buffer.indexOf --------
function parseFirstFilePart(buf, boundaryToken) {
  const dashBoundary = Buffer.from('--' + boundaryToken);
  const headerSep = Buffer.from('\r\n\r\n');
  const crlf = Buffer.from('\r\n');

  // Iterate over parts: each starts with --boundary
  let pos = 0;
  while (true) {
    const partStart = buf.indexOf(dashBoundary, pos);
    if (partStart === -1) break;
    const partEnd = buf.indexOf(dashBoundary, partStart + dashBoundary.length);
    // If not found, look for the closing boundary with '--\r\n'
    const finalEndMarker = Buffer.from('--' + boundaryToken + '--');
    const maybeClose = buf.indexOf(finalEndMarker, partStart + dashBoundary.length);
    const endIdx = partEnd !== -1 ? partEnd - 2 /* strip \r\n before boundary */ :
                   (maybeClose !== -1 ? maybeClose - 2 : buf.length);

    // Slice this part (skip initial boundary + CRLF)
    const pStart = partStart + dashBoundary.length + 2; // + \r\n
    const pBuf = buf.slice(pStart, Math.max(pStart, endIdx));

    const sep = pBuf.indexOf(headerSep);
    if (sep === -1) { pos = pStart; continue; }
    const head = pBuf.slice(0, sep).toString('utf8');
    const body = pBuf.slice(sep + headerSep.length);

    // We only accept parts that look like files (have filename=)
    if (!/filename=/i.test(head)) { pos = pStart; continue; }

    const filenameMatch = /filename="([^"]*)"/i.exec(head);
    const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(head);
    const filename = filenameMatch ? filenameMatch[1] : 'upload.bin';
    const mimeType = typeMatch ? (typeMatch[1] || '').trim() : '';

    // Trim final CRLF from body
    let end = body.length;
    if (end >= 2 && body[end-2] === 13 && body[end-1] === 10) end -= 2;
    const content = body.slice(0, end);

    return { filename, mimeType, content };
  }
  return null;
}

// -------- MIME helpers --------
function normalizeVideoMime(m, bytes) {
  let mime = (m || '').toLowerCase();
  if (!mime.startsWith('video/')) {
    // MP4 family (ftyp)
    if (bytes.length > 12 && bytes[4]===0x66 && bytes[5]===0x74 && bytes[6]===0x79 && bytes[7]===0x70) mime = 'video/mp4';
    // WebM/Matroska
    else if (bytes.length > 4 && bytes[0]===0x1A && bytes[1]===0x45 && bytes[2]===0xDF && bytes[3]===0xA3) mime = 'video/webm';
    // MOV (QuickTime) often also has 'ftypqt  '
    else if (bytes.length > 12 && bytes[4]===0x66 && bytes[5]===0x74 && bytes[6]===0x79 && bytes[7]===0x70 && bytes[8]===0x71 && bytes[9]===0x74) mime = 'video/quicktime';
  }
  return mime || 'video/mp4';
}

function extForVideoMime(m) {
  if (m === 'video/mp4') return 'mp4';
  if (m === 'video/quicktime') return 'mov';
  if (m === 'video/webm') return 'webm';
  return 'bin';
}
