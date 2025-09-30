// netlify/functions/download-proxy.js
// Forces a real download for small files. Redirects big/unknown-size files to avoid the ~6MB limit.
// Usage: /.netlify/functions/download-proxy?url=<encoded>&name=<optional filename.ext>
export async function handler(event) {
  try {
    const url = event.queryStringParameters?.url;
    const name = event.queryStringParameters?.name || 'file';
    if (!url) {
      return { statusCode: 400, body: 'Missing ?url=' };
    }

    // 1) Try HEAD first to detect size quickly
    let headResp;
    try {
      headResp = await fetch(url, { method: 'HEAD' });
    } catch {
      headResp = null;
    }

    // If HEAD not usable (some CDNs block it), try a 1-byte Range request to get headers
    if (!headResp || !headResp.ok) {
      try {
        headResp = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
      } catch {
        headResp = null;
      }
    }

    const contentLengthHeader = headResp?.headers?.get('content-length');
    const contentType = headResp?.headers?.get('content-type') || 'application/octet-stream';
    const length = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

    // Netlify/AWS API Gateway response body limit ~6MB. Base64 inflates by ~33%.
    // Keep a safety margin at 5.5MB for the *raw* file.
    const LIMIT = 5_500_000;

    // For unknown (0) or large files, redirect directly to the source URL.
    if (!Number.isFinite(length) || length === 0 || length > LIMIT) {
      return {
        statusCode: 302,
        headers: { Location: url, 'Cache-Control': 'private, max-age=0, no-cache' },
        body: '',
      };
    }

    // 2) Small file: fetch full and return with Content-Disposition so iOS/Android "Save" works
    const resp = await fetch(url);
    if (!resp.ok) {
      const text = await safeText(resp);
      return { statusCode: resp.status, headers: { 'Content-Type': 'application/json' }, body: text || 'Upstream error' };
    }

    const arrayBuf = await resp.arrayBuffer();
    const buf = Buffer.from(arrayBuf);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${sanitize(name)}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
      body: buf.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (e) {
    return { statusCode: 500, body: String(e) };
  }
}

function sanitize(n) {
  return String(n).replace(/[^\w.\- ]+/g, '_').slice(0, 150) || 'file';
}

async function safeText(res) {
  try {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return await res.text();
    return '';
  } catch {
    return '';
  }
}
