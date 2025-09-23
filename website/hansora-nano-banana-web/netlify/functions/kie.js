// /.netlify/functions/kie
// Proxies multipart form-data to your KIE endpoint with Authorization.
// Keeps your API key secret and fixes CORS.

export const handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: 'Method Not Allowed',
    };
  }

  const KIE_API_URL = process.env.KIE_API_URL;   // <-- set this in Netlify
  const KIE_API_KEY = process.env.KIE_API_KEY;   // <-- set this in Netlify

  if (!KIE_API_URL || !KIE_API_KEY) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: 'Missing KIE_API_URL or KIE_API_KEY env vars.',
    };
  }

  try {
    const isBase64 = event.isBase64Encoded;
    const reqBuf = Buffer.from(event.body || '', isBase64 ? 'base64' : 'utf8');
    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || 'application/octet-stream';

    const resp = await fetch(KIE_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KIE_API_KEY}`,
        'Content-Type': contentType,
        'Content-Length': String(reqBuf.length),
      },
      body: reqBuf,
    });

    const ct = resp.headers.get('content-type') || 'application/octet-stream';
    const ab = await resp.arrayBuffer();
    const buf = Buffer.from(ab);

    const baseHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': ct,
    };

    // Pass through status and body exactly; keep images binary
    const isBinary = /^image\//.test(ct) || ct === 'application/octet-stream';
    return {
      statusCode: resp.status,
      headers: baseHeaders,
      body: isBinary ? buf.toString('base64') : buf.toString('utf8'),
      isBase64Encoded: isBinary,
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' },
      body: `Proxy error: ${e.message || e}`,
    };
  }
};
