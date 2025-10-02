// netlify/functions/kie-upload-video.js
// Robust uploader: tries KIE multipart first; on failure, falls back to base64 (small files)
// and finally to transfer.sh to guarantee a URL. No other logic changed.

const https = require('https');

const KIE_API_KEY = process.env.KIE_API_KEY || '';
const MULTIPART_THRESHOLD = 4 * 1024 * 1024; // 4MB
const KIE_ENDPOINTS = [
  'https://kieai.redpandaai.co/api/file-upload',   // primary guess
  'https://kieai.redpandaai.co/api/fileUpload',    // fallback variant
  'https://kieai.redpandaai.co/api/upload-file'    // fallback variant
];
const UPLOAD_BASE64_URL = 'https://kieai.redpandaai.co/api/file-base64-upload'; // for small files

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
    if (event.httpMethod !== 'POST') return resp(405, { error: 'method_not_allowed' });

    if (!KIE_API_KEY) return resp(400, { error: 'missing_api_key' });

    // Expect multipart/form-data from browser
    const ct = String(event.headers['content-type'] || event.headers['Content-Type'] || '');
    const bMatch = /boundary=([^;]+)/i.exec(ct);
    if (!bMatch) return resp(400, { error: 'missing_boundary', contentType: ct });

    const boundary = bMatch[1];
    const bodyBuf = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8');

    const part = findFirstFilePart(bodyBuf, boundary);
    if (!part) return resp(400, { error: 'no_file' });

    const { filename, mimeType, content } = part;
    if (!content || !content.length) return resp(400, { error: 'empty_file' });

    // 1) Try KIE multipart (no base64 bloat)
    let lastErr = null;
    for (const ep of KIE_ENDPOINTS) {
      const mp = await httpsMultipart(ep,
        { uploadPath: 'videos/user-uploads' },
        'file', filename, content,
        { 'Authorization': `Bearer ${KIE_API_KEY}` }
      ).catch(e => ({ statusCode: 0, body: String(e) }));

      if (mp && (mp.statusCode >= 200 && mp.statusCode < 300)) {
        try {
          const j = JSON.parse(mp.body || '{}');
          if (j && (j.url || j.downloadUrl)) {
            const downloadUrl = j.url || j.downloadUrl;
            return resp(200, { ok: true, filename, mimeType, size: content.length, downloadUrl });
          }
        } catch (e) {
          lastErr = 'invalid_json:' + String(e);
        }
      } else {
        lastErr = `mp_${ep}_status_${mp && mp.statusCode}`;
      }
    }

    // 2) If small enough, try KIE base64
    if (content.length < MULTIPART_THRESHOLD) {
      const dataUrl = `data:${mimeType || 'application/octet-stream'};base64,${content.toString('base64')}`;
      const payload = JSON.stringify({ base64Data: dataUrl, uploadPath: 'videos/user-uploads', fileName: filename });
      const res = await httpsJson(UPLOAD_BASE64_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${KIE_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, payload).catch(e => ({ statusCode: 0, body: String(e) }));

      if (res && (res.statusCode >= 200 && res.statusCode < 300)) {
        try {
          const j = JSON.parse(res.body || '{}');
          if (j && (j.url || j.downloadUrl)) {
            const downloadUrl = j.url || j.downloadUrl;
            return resp(200, { ok: true, filename, mimeType, size: content.length, downloadUrl });
          }
        } catch (e) {
          lastErr = 'invalid_json_b64:' + String(e);
        }
      } else {
        lastErr = `b64_status_${res && res.statusCode}`;
      }
    }

    // 3) Final fallback: upload to transfer.sh to guarantee a URL
    const tf = await uploadToTransferSh(filename, content).catch(e => ({ statusCode: 0, body: String(e) }));
    if (tf && tf.statusCode >= 200 && tf.statusCode < 300) {
      const url = (tf.body || '').trim();
      if (url.startsWith('https://')) {
        return resp(200, { ok: true, filename, mimeType, size: content.length, downloadUrl: url });
      }
    }

    return resp(500, { error: 'upload_failed', detail: lastErr });
  } catch (e) {
    return resp(500, { error: 'server_error', detail: String(e && e.stack || e) });
  }
};

// ---------- helpers ----------

function cors(){ return {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};}

function resp(code, body){ return { statusCode: code, headers: cors(), body: JSON.stringify(body) }; }

function httpsJson(urlStr, opts, bodyStr){
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + (u.search || ''),
      method: opts.method || 'POST', headers: opts.headers || {}
    }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function httpsMultipart(urlStr, fields, fileFieldName, fileName, fileBytes, headers, method = 'POST'){
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const boundary = '----NFX-' + Math.random().toString(16).slice(2);
    const dashdash = '--' + boundary;

    const parts = [];
    for (const [k,v] of Object.entries(fields || {})) {
      parts.push(Buffer.from(
        `${dashdash}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${String(v)}\r\n`, 'utf8'));
    }
    parts.push(Buffer.from(
      `${dashdash}\r\nContent-Disposition: form-data; name="${fileFieldName}"; filename="${fileName}"\r\n`
      + `Content-Type: application/octet-stream\r\n\r\n`, 'utf8'));
    parts.push(Buffer.from(fileBytes));
    parts.push(Buffer.from(`\r\n${dashdash}--\r\n`, 'utf8'));

    const bodyBuf = Buffer.concat(parts);

    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method,
      headers: {
        ...(headers || {}),
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': Buffer.byteLength(bodyBuf),
        'Accept': 'application/json'
      }
    }, res => {
      const chunks = []; res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(bodyBuf); req.end();
  });
}

// Upload to transfer.sh as a last-resort to get a public URL
function uploadToTransferSh(fileName, fileBytes){
  return new Promise((resolve, reject) => {
    const u = new URL('https://transfer.sh/' + encodeURIComponent(fileName));
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'PUT',
      headers: { 'Content-Length': fileBytes.length }
    }, res => {
      const chunks = []; res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(fileBytes); req.end();
  });
}

// Binary-safe multipart parsing
const CR = 13, LF = 10; const CRLFCRLF = Buffer.from([CR,LF,CR,LF]);
function indexOf(h, n, f=0){ outer: for (let i=f; i<=h.length-n.length; i++){ for (let j=0;j<n.length;j++){ if (h[i+j]!==n[j]) continue outer; } return i; } return -1; }
function trimTrailingCRLF(b){ let e=b.length; if (e>=2 && b[e-2]===CR && b[e-1]===LF) e-=2; return b.slice(0,e); }
function findFirstFilePart(buf, boundaryStr){
  const boundary = Buffer.from('--' + boundaryStr);
  const closing = Buffer.from('--' + boundaryStr + '--');
  let pos = indexOf(buf, boundary, 0); if (pos===-1) return null;
  while (pos !== -1){
    let start = pos + boundary.length;
    if (buf[start]===CR && buf[start+1]===LF) start += 2;
    if (buf.slice(pos, pos+closing.length).equals(closing)) break;
    let next = indexOf(buf, boundary, start); if (next===-1) next = buf.length;
    let part = trimTrailingCRLF(buf.slice(start, next));
    const sep = indexOf(part, CRLFCRLF); if (sep===-1) { pos = next; continue; }
    const head = part.slice(0, sep).toString('utf8'); const content = part.slice(sep+4);
    const fm = /filename="([^"]*)"/i.exec(head); if (!fm) { pos = next; continue; }
    const tm = /Content-Type:\s*([^\r\n]+)/i.exec(head);
    const filename = fm[1] || 'upload.bin'; const mimeType = tm ? tm[1].trim() : '';
    return { filename, mimeType, content };
  }
  return null;
}
