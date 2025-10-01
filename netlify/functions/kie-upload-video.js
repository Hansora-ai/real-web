// netlify/functions/kie-upload-video.js
// Dedicated uploader for videos (<=10 MB).
// Returns { downloadUrl } on success, or { error } on failure.

const UPLOAD_BASE64_URL = 'https://kieai.redpandaai.co/api/file-base64-upload';
J * 1024 * 1024; // headroom // 10 MB raw

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: cors(), body: '' };
    }
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: cors(), body: JSON.stringify({ error: 'method_not_allowed' }) };
    }

    const KIE_API_KEY = process.env.KIE_API_KEY;
    if (!KIE_API_KEY) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: 'missing_api_key' }) };
    }

    const ct = event.headers['content-type'] || event.headers['Content-Type'] || '';
    if (!ct.includes('multipart/form-data')) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'expected_multipart' }) };
    }

    const boundary = getBoundary(ct);
    if (!boundary) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'missing_boundary' }) };
    }

    const bodyBuf = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8');

    const part = findFirstFilePart(bodyBuf, boundary);
    if (!part) return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'no_file' }) };

    const { filename, mimeType, content } = part;
    if (!content || !content.length) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'empty_file' }) };
    }
    if (content.length > MAX_BYTES) {
      return { statusCode: 413, headers: cors(), body: JSON.stringify({ error: 'file_too_large', max: MAX_BYTES }) };
    }

    const finalMime = normalizeMime(mimeType, content);
    if (!finalMime.startsWith('video/')) {
      return { statusCode: 415, headers: cors(), body: JSON.stringify({ error: 'unsupported_type', type: finalMime }) };
    }

    const baseName = (filename || 'video').replace(/\.[^.]+$/, '');
    const ext = extForVideoMime(finalMime);
    const safeName = `${baseName}.${ext}`;

    const dataUrl = `data:${finalMime};base64,${content.toString('base64')}`;
    const uploadPath = 'videos/user-uploads';

    const up = await fetch(UPLOAD_BASE64_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KIE_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ base64Data: dataUrl, uploadPath, fileName: safeName })
    });

    const uj = await up.json().catch(() => ({}));
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
    return { statusCode: 502, headers: cors(), body: JSON.stringify({ error: 'server_error', detail: e && e.message ? e.message : e }) };
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

function getBoundary(ct) {
  const m = /boundary=([^;]+)/i.exec(ct);
  return m ? '--' + m[1] : '';
}

function findFirstFilePart(buf, boundary) {
  const parts = splitBuffer(buf, Buffer.from(boundary));
  for (const p of parts) {
    const sep = indexOfSub(p, Buffer.from('\r\n\r\n'));
    if (sep < 0) continue;
    const head = p.slice(0, sep).toString('utf8');
    const body = p.slice(sep + 4);
    if (!/filename="/i.test(head)) continue;

    const filenameMatch = /filename="([^"]*)"/i.exec(head);
    const typeMatch = /Content-Type:\\s*([^\\r\\n]+)/i.exec(head);
    const filename = filenameMatch ? filenameMatch[1] : 'upload.bin';
    const mimeType = typeMatch ? typeMatch[1].trim() : '';

    const trimmed = trimTrailing(body, Buffer.from('\r\n'));
    return { filename, mimeType, content: trimmed };
  }
  return null;
}

function splitBuffer(buf, delim) {
  const out = [];
  let start = 0;
  while (true) {
    const idx = indexOfSub(buf, delim, start);
    if (idx < 0) {
      const last = buf.slice(start);
      if (last.length) out.push(last);
      break;
    }
    if (idx > start) out.push(buf.slice(start, idx));
    start = idx + delim.length;
  }
  return out.filter(b => b.length > 0);
}

function indexOfSub(buf, sub, from = 0) {
  for (let i = from; i <= buf.length - sub.length; i++) {
    let ok = true;
    for (let j = 0; j < sub.length; j++) {
      if (buf[i + j] !== sub[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

function trimTrailing(buf, trail) {
  let end = buf.length;
  while (end >= trail.length) {
    let match = true;
    for (let i = 0; i < trail.length; i++) {
      if (buf[end - trail.length + i] !== trail[i]) { match = false; break; }
    }
    if (match) end -= trail.length; else break;
  }
  return buf.slice(0, end);
}

function normalizeMime(mime, content) {
  let m = (mime || '').toLowerCase();
  if (!m.startsWith('video/')) {
    if (content.length > 8 && content[4]===0x66 && content[5]===0x74 && content[6]===0x79 && content[7]===0x70) m = 'video/mp4';
    else if (content.length > 4 && content[0]===0x1A && content[1]===0x45 && content[2]===0xDF && content[3]===0xA3) m = 'video/webm';
  }
  return m || 'video/mp4';
}

function extForVideoMime(m) {
  if (m === 'video/mp4') return 'mp4';
  if (m === 'video/quicktime') return 'mov';
  if (m === 'video/webm') return 'webm';
  return 'bin';
}
