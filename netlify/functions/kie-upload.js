// netlify/functions/kie-upload.js
// Zero-dependency multipart parser for Netlify (no 'busboy' needed).
// Accepts images and videos (<=10MB). Returns { downloadUrl }.
// Works with existing front-ends that send FormData with a 'file' field.

const UPLOAD_BASE64_URL = 'https://kieai.redpandaai.co/api/file-base64-upload';
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors(), body: 'Method Not Allowed' };

    const KIE_API_KEY = process.env.KIE_API_KEY;
    if (!KIE_API_KEY) return { statusCode: 500, headers: cors(), body: 'Missing KIE_API_KEY' };

    const ct = event.headers['content-type'] || event.headers['Content-Type'] || '';
    if (!ct.includes('multipart/form-data')) {
      return { statusCode: 400, headers: cors(), body: 'Expected multipart/form-data' };
    }

    const boundary = getBoundary(ct);
    if (!boundary) return { statusCode: 400, headers: cors(), body: 'Missing boundary' };

    // Body buffer
    const bodyBuf = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '', 'utf8');

    // Parse first file part
    const part = findFirstFilePart(bodyBuf, boundary);
    if (!part) return { statusCode: 400, headers: cors(), body: 'No file provided' };

    const { filename, mimeType, content } = part;
    if (!content || !content.length) return { statusCode: 400, headers: cors(), body: 'Empty file' };
    if (content.length > MAX_BYTES) return { statusCode: 413, headers: cors(), body: 'File too large (max 10MB)' };

    // Validate MIME
    const finalMime = normalizeMime(mimeType, content);
    const isImage = finalMime.startsWith('image/');
    const isVideo = finalMime.startsWith('video/');
    if (!isImage && !isVideo) {
      return { statusCode: 415, headers: cors(), body: 'Unsupported file type' };
    }

    // Build data URL
    const baseName = (filename || (isVideo ? 'video' : 'image')).replace(/\.[^.]+$/, '');
    const ext = isVideo ? extForVideoMime(finalMime) : extForImageMime(finalMime);
    const safeName = `${baseName}.${ext}`;

    const dataUrl = `data:${finalMime};base64,${content.toString('base64')}`;
    const uploadPath = isVideo ? 'videos/user-uploads' : 'images/user-uploads';

    // Upload to KIE
    const up = await fetch(UPLOAD_BASE64_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KIE_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ base64Data: dataUrl, uploadPath, fileName: safeName })
    });

    const uj = await up.json().catch(()=>({}));
    const dl = uj?.data?.downloadUrl || uj?.downloadUrl || uj?.url || uj?.data?.url || '';
    if (!up.ok || !dl) {
      return {
        statusCode: 502,
        headers: { ...cors(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'upload_failed', status: up.status, detail: uj })
      };
    }

    return {
      statusCode: 200,
      headers: { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ downloadUrl: dl })
    };
  } catch (e) {
    return { statusCode: 502, headers: cors(), body: `Server error: ${e && e.message ? e.message : e}` };
  }
};

function cors(){ return {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};}

// ---- multipart helpers ----
function getBoundary(ct){
  const m = /boundary=([^;]+)/i.exec(ct);
  return m ? '--' + m[1] : '';
}

function findFirstFilePart(buf, boundary){
  const parts = splitBuffer(buf, Buffer.from(boundary));
  for (const p of parts){
    // Headers and body are separated by \r\n\r\n
    const sep = indexOfSub(p, Buffer.from('\r\n\r\n'));
    if (sep < 0) continue;
    const head = p.slice(0, sep).toString('utf8');
    const body = p.slice(sep + 4);
    if (!/name="file"/i.test(head)) continue;
    const filenameMatch = /filename="([^"]*)"/i.exec(head);
    const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(head);
    const filename = filenameMatch ? filenameMatch[1] : 'upload.bin';
    const mimeType = typeMatch ? typeMatch[1].trim() : '';
    // Trim final \r\n
    const trimmed = trimTrailing(body, Buffer.from('\r\n'));
    return { filename, mimeType, content: trimmed };
  }
  return null;
}

function splitBuffer(buf, delim){
  const out = [];
  let start = 0;
  while (true){
    const idx = indexOfSub(buf, delim, start);
    if (idx < 0){
      const last = buf.slice(start);
      if (last.length) out.push(last);
      break;
    }
    if (idx > start) out.push(buf.slice(start, idx));
    start = idx + delim.length;
  }
  return out.filter(b => b.length > 0);
}

function indexOfSub(buf, sub, from=0){
  for (let i=from;i<=buf.length - sub.length;i++){
    let ok = true;
    for (let j=0;j<sub.length;j++){ if (buf[i+j] !== sub[j]) { ok=false; break; } }
    if (ok) return i;
  }
  return -1;
}

function trimTrailing(buf, trail){
  let end = buf.length;
  while (end >= trail.length){
    let match = true;
    for (let i=0;i<trail.length;i++){ if (buf[end - trail.length + i] !== trail[i]) { match = false; break; } }
    if (match) end -= trail.length; else break;
  }
  return buf.slice(0, end);
}

// ---- mime helpers ----
function normalizeMime(mime, content){
  let m = (mime || '').toLowerCase();
  if (!m || (!m.startsWith('image/') && !m.startsWith('video/'))){
    // crude sniff
    if (content.length > 12 && content[0] === 0xFF && content[1] === 0xD8 && content[2] === 0xFF) m = 'image/jpeg';
    else if (content.length > 8 && content[0]===0x89 && content[1]===0x50 && content[2]===0x4E && content[3]===0x47) m = 'image/png';
    else if (content.length > 12 && content[0]===0x52 && content[1]===0x49 && content[2]===0x46 && content[3]===0x46 && content[8]===0x57 && content[9]===0x45 && content[10]===0x42 && content[11]===0x50) m = 'image/webp';
    else if (content.length > 6 && content[0]===0x47 && content[1]===0x49 && content[2]===0x46 && content[3]===0x38) m = 'image/gif';
    else if (content.length > 8 && content[4]===0x66 && content[5]===0x74 && content[6]===0x79 && content[7]===0x70) m = 'video/mp4';
    else if (content.length > 4 && content[0]===0x1A && content[1]===0x45 && content[2]===0xDF && content[3]===0xA3) m = 'video/webm';
  }
  return m || 'application/octet-stream';
}

function extForImageMime(m){
  if (m === 'image/jpeg') return 'jpg';
  if (m === 'image/png')  return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/gif')  return 'gif';
  return 'bin';
}
function extForVideoMime(m){
  if (m === 'video/mp4') return 'mp4';
  if (m === 'video/quicktime') return 'mov';
  if (m === 'video/webm') return 'webm';
  return 'bin';
}
