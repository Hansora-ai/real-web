// netlify/functions/download-proxy.js
// Forces a real download with Content-Disposition: attachment
export async function handler(event) {
  try {
    const url = event.queryStringParameters?.url;
    const name = event.queryStringParameters?.name || 'generation';
    if (!url) {
      return { statusCode: 400, body: 'Missing ?url=' };
    }
    const resp = await fetch(url);
    if (!resp.ok) {
      const t = await resp.text();
      return { statusCode: resp.status, body: t || 'Upstream error' };
    }
    const arrayBuf = await resp.arrayBuffer();
    const contentType = resp.headers.get('content-type') || 'application/octet-stream';
    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
      body: Buffer.from(arrayBuf).toString('base64'),
      isBase64Encoded: true,
    };
  } catch (e) {
    return { statusCode: 500, body: String(e) };
  }
}
