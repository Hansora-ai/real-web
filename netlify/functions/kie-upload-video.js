// Netlify Function: kie-upload-video (fixed v4)
// Parses multipart/form-data reliably and returns a temporary downloadUrl.
// Avoids CRLF escape pitfalls by using byte constants.

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: cors(), body: JSON.stringify({ error: 'method_not_allowed' }) };
    }

    const contentType = (event.headers['content-type'] || event.headers['Content-Type'] || '').toString();
    const bMatch = /boundary=([^;]+)/i.exec(contentType);
    if (!bMatch) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'missing_boundary' }) };
    }
    const boundary = bMatch[1];

    const bodyBuf = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8');

    const part = findFirstFilePart(bodyBuf, boundary);
    if (!part) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'no_file' }) };
    }

    const { filename, mimeType, content } = part;

    // Size guard
    const MAX_BYTES = 12 * 1024 * 1024; // a little headroom
    if (!content || content.length === 0) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'empty_file' }) };
    }
    if (content.length > MAX_BYTES) {
      return { statusCode: 413, headers: cors(), body: JSON.stringify({ error: 'file_too_large', max: MAX_BYTES }) };
    }

    // TODO: Upload `content` to storage of your choice; here we just echo a fake URL
    // Replace this with your actual upload (Supabase/S3/etc.) and return its public URL.
    const downloadUrl = `data:${mimeType || 'application/octet-stream'};base64,` + content.toString('base64');

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ ok: true, filename, mimeType, size: content.length, downloadUrl })
    };
  } catch (e) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: 'server_error', detail: String(e && e.stack || e) }) };
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

// ---- Multipart helpers ----

const CRLF = Buffer.from([13, 10]);
const CRLFCRLF = Buffer.from([13, 10, 13, 10]);

function indexOfSub(haystack, needle, from = 0) {
  for (let i = from; i <= haystack.length - needle.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

function splitBuffer(buf, delim) {
  const out = [];
  let start = 0;
  while (true) {
    const idx = indexOfSub(buf, delim, start);
    if (idx < 0) { out.push(buf.slice(start)); break; }
    out.push(buf.slice(start, idx));
    start = idx + delim.length;
  }
  return out;
}

function trimTrailingCRLF(b) {
  let end = b.length;
  // trim one trailing CRLF if present
  if (end >= 2 && b[end - 2] === 13 && b[end - 1] === 10) end -= 2;
  return b.slice(0, end);
}

function findFirstFilePart(buf, boundaryStr) {
  const boundary = Buffer.from('--' + boundaryStr);
  const closing = Buffer.from('--' + boundaryStr + '--');

  // Split by boundary lines (ignore preamble before first boundary)
  const chunks = splitBuffer(buf, boundary);
  for (let i = 1; i < chunks.length; i++) {
    let part = chunks[i];
    // Strip leading CRLF if present
    if (part.length >= 2 && part[0] === 13 && part[1] === 10) part = part.slice(2);
    // Stop at closing boundary marker
    if (part.length >= closing.length && part.slice(0, closing.length).equals(closing)) break;

    const sep = indexOfSub(part, CRLFCRLF);
    if (sep < 0) continue; // invalid part

    const head = part.slice(0, sep).toString('utf8');
    const body = part.slice(sep + CRLFCRLF.length);

    // Must be a file field (has filename=)
    if (!/filename="([^"]*)"/i.test(head)) continue;

    const filenameMatch = /filename="([^"]*)"/i.exec(head);
    const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(head);
    const filename = filenameMatch ? (filenameMatch[1] || 'upload.bin') : 'upload.bin';
    const mimeType = typeMatch ? typeMatch[1].trim() : '';

    const content = trimTrailingCRLF(body);
    return { filename, mimeType, content };
  }
  return null;
}
