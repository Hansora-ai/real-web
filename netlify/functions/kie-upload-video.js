// netlify/functions/kie-upload-video.js
// Robust video uploader (<=10 MB raw) without relying on global fetch.
// Uses Node's https to POST JSON to KIE (works on older Netlify runtimes).

const https = require('node:https');
const { URL } = require('node:url');

const UPLOAD_BASE64_URL = 'https://kieai.redpandaai.co/api/file-base64-upload';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: cors(), body: '' };
    }
    if (event.httpMethod !== 'POST') {
      return respond(405, { error: 'method_not_allowed' });
    }

    const KIE_API_KEY = process.env.KIE_API_KEY;
    if (!KIE_API_KEY) return respond(500, { error: 'missing_api_key' });

    const ct = (event.headers['content-type'] || event.headers['Content-Type'] || '').toString();
    if (!ct.includes('multipart/form-data')) return respond(400, { error: 'expected_multipart', got: ct });

    const bMatch = /boundary=([^;]+)/i.exec(ct);
    if (!bMatch) return respond(400, { error: 'missing_boundary' });
    const boundary = bMatch[1];

    const bodyBuf = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8');

    const filePart = parseFirstFilePart(bodyBuf, boundary);
    if (!filePart) return respond(400, { error: 'no_file_found' });

    const { filename, mimeType, content } = filePart;
    if (!content || !content.length) return respond(400, { error: 'empty_file' });
    if (content.length > MAX_BYTES) return respond(413, { error: 'file_too_large', max: MAX_BYTES, got: content.length });

    const finalMime = normalizeVideoMime(mimeType, content);
    if (!finalMime.startsWith('video/')) return respond(415, { error: 'unsupported_type', type: finalMime });

    const baseName = (filename || 'video').replace(/\.[^.]+$/, '');
    const ext = extForVideoMime(finalMime);
    const safeName = `${baseName}.${ext}`;

    const dataUrl = `data:${finalMime};base64,${content.toString('base64')}`;
    const uploadPath = 'videos/user-uploads';

    // Build request
    const url = new URL(UPLOAD_BASE64_URL);
    const payload = JSON.stringify({ fileBase64: dataUrl, uploadPath, fileName: safeName });
    const options = {
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname + (url.search || ''),
      headers: {
        'Authorization': `Bearer ${KIE_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    let status = 0;
    const resJson = await httpsRequestJson(options, payload).then(({ statusCode, body }) => {
      status = statusCode;
      try { return JSON.parse(body || '{}'); } catch { return {}; }
    }).catch(err => ({ error: 'https_error', detail: String(err && err.message || err) }));

    const dl = resJson?.data?.downloadUrl || resJson?.downloadUrl || resJson?.url || resJson?.data?.url || '';
    if (status < 200 || status >= 300 || !dl) {
      return respond(502, { error: 'upload_failed', status, response: resJson });
    }

    return respond(200, { downloadUrl: dl });
  } catch (e) {
    return respond(500, { error: 'server_error', detail: String(e && e.message || e) });
  }
};

function httpsRequestJson(options, payload) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

function respond(code, obj) {
  return { statusCode: code, headers: { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

// -------- Multipart parsing using Buffer.indexOf --------
function parseFirstFilePart(buf, boundaryToken) {
  const dashBoundary = Buffer.from('--' + boundaryToken);
  const headerSep = Buffer.from('\r\n\r\n');

  let pos = 0;
  while (true) {
    const partStart = buf.indexOf(dashBoundary, pos);
    if (partStart === -1) break;
    const pStart = partStart + dashBoundary.length + 2; // skip CRLF
    // find end boundary
    const next = buf.indexOf(dashBoundary, pStart);
    const finalEnd = buf.indexOf(Buffer.from('--' + boundaryToken + '--'), pStart);
    const endIdx = next !== -1 ? next - 2 : (finalEnd !== -1 ? finalEnd - 2 : buf.length);

    const pBuf = buf.slice(pStart, Math.max(pStart, endIdx));
    const sep = pBuf.indexOf(headerSep);
    if (sep === -1) { pos = pStart; continue; }

    const head = pBuf.slice(0, sep).toString('utf8');
    const body = pBuf.slice(sep + headerSep.length);

    if (!/filename=/i.test(head)) { pos = pStart; continue; }

    const filenameMatch = /filename="([^"]*)"/i.exec(head);
    const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(head);
    const filename = filenameMatch ? filenameMatch[1] : 'upload.bin';
    const mimeType = typeMatch ? (typeMatch[1] || '').trim() : '';

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
    if (bytes.length > 12 && bytes[4]===0x66 && bytes[5]===0x74 && bytes[6]===0x79 && bytes[7]===0x70) mime = 'video/mp4';
    else if (bytes.length > 4 && bytes[0]===0x1A && bytes[1]===0x45 && bytes[2]===0xDF && bytes[3]===0xA3) mime = 'video/webm';
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
