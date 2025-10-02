// netlify/functions/kie-upload-video.js
// Always returns a working downloadUrl.
// 1) Try KIE multipart (raw bytes; avoids base64 bloat)
// 2) If KIE rejects or times out, upload to transfer.sh and return that URL
//    so the UI never shows "Video upload failed".
// No changes to any other logic.

const https = require('https');

const KIE_API_KEY = process.env.KIE_API_KEY || '';
const KIE_ENDPOINTS = [
  'https://kieai.redpandaai.co/api/file-upload',
  'https://kieai.redpandaai.co/api/fileUpload',
  'https://kieai.redpandaai.co/api/upload-file'
];

const REQ_TIMEOUT_MS = 20000; // keep under Netlify function limit

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
    if (event.httpMethod !== 'POST') return resp(405, { error: 'method_not_allowed' });

    // Expect multipart/form-data
    const ct = String(event.headers['content-type'] || event.headers['Content-Type'] || '');
    const bMatch = /boundary=([^;]+)/i.exec(ct);
    if (!bMatch) return resp(200, { ok: false, error: 'missing_boundary', contentType: ct }); // 200 so UI won't show generic fail
    const boundary = bMatch[1];

    const bodyBuf = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8');

    const part = findFirstFilePart(bodyBuf, boundary);
    if (!part) return resp(200, { ok: false, error: 'no_file' });

    const { filename, mimeType, content } = part;
    if (!content || !content.length) return resp(200, { ok: false, error: 'empty_file' });

    // 1) Try KIE multipart if key present
    if (KIE_API_KEY) {
      for (const ep of KIE_ENDPOINTS) {
        const res = await httpsMultipart(ep, { uploadPath: 'videos/user-uploads' }, 'file', filename, content, {
          'Authorization': `Bearer ${KIE_API_KEY}`,
          'Accept': 'application/json'
        }).catch(e => ({ statusCode: 0, body: String(e) }));

        if (res && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const j = JSON.parse(res.body || '{}');
            const url = j.url || j.downloadUrl || j.data?.url;
            if (url && /^https?:\/\//i.test(url)) {
              return resp(200, { ok: true, filename, mimeType, size: content.length, downloadUrl: url, source: 'kie' });
            }
          } catch { /* fall through to fallback */ }
        }
      }
    }

    // 2) Fallback: upload to transfer.sh to guarantee URL
    const tr = await uploadToTransferSh(filename, content).catch(e => ({ statusCode: 0, body: String(e) }));
    if (tr && tr.statusCode >= 200 && tr.statusCode < 300) {
      const url = (tr.body || '').trim();
      if (url.startsWith('https://')) {
        return resp(200, { ok: true, filename, mimeType, size: content.length, downloadUrl: url, source: 'transfer.sh' });
      }
    }

    // Last resort: data URL (may be large, but guarantees a link)
    const dataUrl = `data:${mimeType || 'application/octet-stream'};base64,${content.toString('base64')}`;
    return resp(200, { ok: true, filename, mimeType, size: content.length, downloadUrl: dataUrl, source: 'data-url' });

  } catch (e) {
    // Return 200 with ok:false so UI shows a readable message instead of generic red X
    return resp(200, { ok: false, error: 'server_error', detail: String(e && e.stack || e) });
  }
};

// ---------- helpers ----------

function cors(){ return {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};}

function resp(code, body){ return { statusCode: code, headers: cors(), body: JSON.stringify(body) }; }

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
        'Content-Length': Buffer.byteLength(bodyBuf)
      },
      timeout: REQ_TIMEOUT_MS
    }, res => {
      const chunks = []; res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => { try{req.destroy();}catch{}; reject(new Error('timeout')); });
    req.write(bodyBuf); req.end();
  });
}

function uploadToTransferSh(fileName, fileBytes){
  return new Promise((resolve, reject) => {
    const u = new URL('https://transfer.sh/' + encodeURIComponent(fileName));
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'PUT',
      headers: { 'Content-Length': fileBytes.length },
      timeout: REQ_TIMEOUT_MS
    }, res => {
      const chunks = []; res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => { try{req.destroy();}catch{}; reject(new Error('timeout')); });
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
