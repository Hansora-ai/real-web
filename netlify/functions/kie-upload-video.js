// netlify/functions/kie-upload-video.js
// Ultra-tolerant video uploader (no size cap).
// - Accepts the FIRST non-empty multipart part (any field name, with OR without filename / Content-Type)
// - Defaults to video/mp4 when MIME missing; tries magic bytes for mp4/webm/mov
// - Posts { fileBase64, uploadPath, fileName } to KIE using Node's https
// - Returns { downloadUrl } or { error, status, response } (never a blank 500)

const https = require('https');
const { URL } = require('url');

const UPLOAD_BASE64_URL = 'https://kieai.redpandaai.co/api/file-base64-upload';
const UPLOAD_MULTIPART_URL = 'https://kieai.redpandaai.co/api/file-upload';
const MULTIPART_THRESHOLD = 4 * 1024 * 1024; // 4MB: switch to multipart to avoid base64 bloat

exports.handler = async (event) => {
  try {
    // CORS / method gate
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
    if (event.httpMethod !== 'POST') return j(405, { error: 'method_not_allowed' });

    const KIE_API_KEY = process.env.KIE_API_KEY;
    if (!KIE_API_KEY) return j(500, { error: 'missing_api_key' });

    // Must be multipart
    const ct = (event.headers['content-type'] || event.headers['Content-Type'] || '').toString();
    if (!ct.includes('multipart/form-data')) return j(400, { error: 'expected_multipart', got: ct });

    // Boundary
    const m = /boundary=([^;]+)/i.exec(ct);
    if (!m) return j(400, { error: 'missing_boundary' });
    const boundary = m[1];

    // Body buffer (Netlify sends base64 for multipart)
    const buf = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64')
                                      : Buffer.from(event.body || '', 'utf8');

    // Parse the FIRST non-empty part
    const part = parseFirstNonEmptyPart(buf, boundary);
    if (!part) return j(400, { error: 'no_file_found' });

    // Derive filename & mime (very tolerant)
    let { filename, mimeType, content } = part;
    if (!filename || !filename.trim()) filename = 'upload';
    mimeType = normalizeVideoMime(mimeType, content) || 'video/mp4';
    const ext = extForVideoMime(mimeType);
    const safeName = filename.replace(/\.[^.]+$/, '') + '.' + ext;

    // Build data URL (no size limit here; KIE may still enforce its own limit)
    
    let statusCode = 0; let body = '';
    if (content.length >= MULTIPART_THRESHOLD) {
      // Multipart path (bigger files)
      const mpRes = await httpsMultipart(
        UPLOAD_MULTIPART_URL,
        { uploadPath: 'videos/user-uploads' },
        'file',
        safeName,
        content,
        { 'Authorization': `Bearer ${KIE_API_KEY}` },
        'POST'
      );
      statusCode = mpRes.statusCode; body = mpRes.body;
    } else {
      // Base64 JSON path (smaller files)
      const dataUrl = `data:${mimeType};base64,${content.toString('base64')}`;
      const payload = JSON.stringify({ base64Data: dataUrl, uploadPath: 'videos/user-uploads', fileName: safeName });
      const jsonRes = await httpsJson(UPLOAD_BASE64_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${KIE_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, payload);
      statusCode = jsonRes.statusCode; body = jsonRes.body;
    }
    let uj = {};
    try { uj = JSON.parse(body || '{}'); } catch {}

    const dl = uj?.data?.downloadUrl || uj?.downloadUrl || uj?.url || uj?.data?.url || '';
    if ((statusCode < 200 || statusCode >= 300) || !dl) {
      return j(502, { error: 'upload_failed', status: statusCode, response: uj });
    }
    return j(200, { downloadUrl: dl });
  } catch (e) {
    return j(500, { error: 'server_error', detail: String(e && e.message || e) });
  }
};


// Multipart upload (streaming) to avoid base64 bloat
function httpsMultipart(urlStr, fields, fileFieldName, fileName, fileBytes, headers, method = 'POST') {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const boundary = '----NFX-' + Math.random().toString(16).slice(2);
    const dashdash = '--' + boundary;

    const parts = [];

    // Add text fields
    for (const [k, v] of Object.entries(fields || {})) {
      parts.push(Buffer.from(dashdash + "\r\n"
        + 'Content-Disposition: form-data; name="' + k + '"\r\n\r\n'
        + String(v) + "\r\n", 'utf8'));
    }

    // Add file field
    parts.push(Buffer.from(dashdash + "\r\n"
      + 'Content-Disposition: form-data; name="' + fileFieldName + '"; filename="' + fileName + '"\r\n'
      + 'Content-Type: application/octet-stream\r\n\r\n', 'utf8'));
    parts.push(Buffer.from(fileBytes)); // raw bytes
    parts.push(Buffer.from("\r\n" + dashdash + "--\r\n", 'utf8'));

    const bodyBuf = Buffer.concat(parts);

    const opts = {
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method,
      headers: {
        ...(headers || {}),
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': Buffer.byteLength(bodyBuf),
        'Accept': 'application/json'
      }
    };

    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}
// -------- Helpers --------
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}
function j(code, obj) {
  return { statusCode: code, headers: { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

function httpsJson(urlStr, options, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method: options.method || 'POST',
      headers: options.headers || {}
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Parse the FIRST non-empty multipart part, regardless of headers
function parseFirstNonEmptyPart(buf, boundaryToken) {
  const dashBoundary = Buffer.from('--' + boundaryToken);
  const headerSep = Buffer.from('\r\n\r\n');

  let pos = 0;
  while (true) {
    const start = buf.indexOf(dashBoundary, pos);
    if (start === -1) break;
    const pStart = start + dashBoundary.length + 2; // skip CRLF
    const next = buf.indexOf(dashBoundary, pStart);
    const finalEnd = buf.indexOf(Buffer.from('--' + boundaryToken + '--'), pStart);
    const endIdx = next !== -1 ? next - 2 : (finalEnd !== -1 ? finalEnd - 2 : buf.length);

    const partBuf = buf.slice(pStart, Math.max(pStart, endIdx));
    const sep = partBuf.indexOf(headerSep);
    if (sep === -1) { pos = pStart; continue; }

    const head = partBuf.slice(0, sep).toString('utf8');
    const body = partBuf.slice(sep + headerSep.length);
    if (!body || body.length === 0) { pos = pStart; continue; }

    const filenameMatch = /filename="([^"]*)"/i.exec(head);
    const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(head);
    const filename = filenameMatch ? filenameMatch[1] : 'upload';
    const mimeType = typeMatch ? (typeMatch[1] || '').trim() : '';

    // Trim trailing CRLF
    let end = body.length;
    if (end >= 2 && body[end-2] === 13 && body[end-1] === 10) end -= 2;
    const content = body.slice(0, end);

    // Return the FIRST non-empty part
    return { filename, mimeType, content };
  }
  return null;
}

// MIME inference
function normalizeVideoMime(m, bytes) {
  let mime = (m || '').toLowerCase();
  if (!mime.startsWith('video/')) {
    // MP4 family (ftyp)
    if (bytes.length > 12 && bytes[4]===0x66 && bytes[5]===0x74 && bytes[6]===0x79 && bytes[7]===0x70) mime = 'video/mp4';
    // WebM/Matroska
    else if (bytes.length > 4 && bytes[0]===0x1A && bytes[1]===0x45 && bytes[2]===0xDF && bytes[3]===0xA3) mime = 'video/webm';
    // MOV (QuickTime)
    else if (bytes.length > 12 && bytes[4]===0x66 && bytes[5]===0x74 && bytes[6]===0x79 && bytes[7]===0x70 && bytes[8]===0x71 && bytes[9]===0x74) mime = 'video/quicktime';
    else mime = 'video/mp4';
  }
  return mime;
}
function extForVideoMime(m) {
  if (m === 'video/mp4') return 'mp4';
  if (m === 'video/quicktime') return 'mov';
  if (m === 'video/webm') return 'webm';
  return 'bin';
}
