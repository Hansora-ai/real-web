// netlify/functions/download-proxy.js
// Smart downloader for Usage page.
// - Small files (<~5.5MB): proxy with Content-Disposition: attachment (works on iOS/Android/desktop)
// - Large or unknown-size files: cache to Supabase Storage, then 302 redirect to a signed URL with ?download=<name>
// Query: /.netlify/functions/download-proxy?url=<encoded>&name=<optional filename.ext>
//
// Env (for large files):
//   SUPABASE_URL            (required to cache)
//   SUPABASE_SERVICE_ROLE   (required to cache)
//   SUPABASE_BUCKET         (optional; defaults to 'downloads')
//
// If Supabase env is missing, we fallback to a 302 redirect to the original URL (no guaranteed download).

export async function handler(event) {
  try {
    const url = event.queryStringParameters?.url;
    const name = event.queryStringParameters?.name || 'file';
    if (!url) return { statusCode: 400, body: 'Missing ?url=' };

    // HEAD (or tiny range GET) to inspect size
    const head = await tryHeadOrRange(url);
    const length = parseContentLength(head);
    const contentType = head?.headers?.get('content-type') || 'application/octet-stream';

    const LIMIT = 5_500_000; // ~5.5MB raw -> stays under ~6MB base64 response cap

    // === Path A: Small file -> proxy with attachment ===
    if (Number.isFinite(length) && length > 0 && length <= LIMIT) {
      const res = await fetch(url);
      if (!res.ok) return upstreamError(res);

      const buf = Buffer.from(await res.arrayBuffer());
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
    }

    // === Path B: Large/unknown -> cache to Supabase Storage, return signed download URL ===
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
    const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'downloads';

    // If we can't cache, fall back to redirect to the source.
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      return {
        statusCode: 302,
        headers: { Location: url, 'Cache-Control': 'private, max-age=0, no-cache' },
        body: '',
      };
    }

    // Download the file server-side
    const getRes = await fetch(url);
    if (!getRes.ok) return upstreamError(getRes);
    const fileBuf = Buffer.from(await getRes.arrayBuffer());

    // Upload to Supabase Storage via REST
    const path = buildPath(name);
    const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: fileBuf,
    });

    if (!upRes.ok) {
      const txt = await upRes.text().catch(() => '');
      return { statusCode: 502, body: `Upload failed: ${txt || upRes.status}` };
    }

    // Create a signed URL (1h) and append ?download=<name> to force attachment
    const signRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(SUPABASE_BUCKET)}/${path}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600 }),
    });

    if (!signRes.ok) {
      const txt = await signRes.text().catch(() => '');
      return { statusCode: 502, body: `Sign failed: ${txt || signRes.status}` };
    }

    const { signedURL } = await signRes.json();
    const downloadURL = `${SUPABASE_URL}${signedURL}&download=${encodeURIComponent(name)}`;

    return {
      statusCode: 302,
      headers: { Location: downloadURL, 'Cache-Control': 'private, max-age=0, no-cache' },
      body: '',
    };

  } catch (e) {
    return { statusCode: 500, body: String(e && e.message || e) };
  }
}

async function tryHeadOrRange(url) {
  try {
    const h = await fetch(url, { method: 'HEAD' });
    if (h.ok) return h;
  } catch {}
  try {
    return await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
  } catch {
    return null;
  }
}

function parseContentLength(res) {
  if (!res) return 0;
  const cl = res.headers?.get('content-length');
  const n = cl ? parseInt(cl, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

function sanitize(n) {
  return String(n).replace(/[^\w.\- ]+/g, '_').slice(0, 150) || 'file';
}

function buildPath(name) {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 10);
  return `${y}/${m}/${day}/${rand}-${sanitize(name)}`;
}

async function upstreamError(res) {
  let detail = '';
  try {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) detail = await res.text();
  } catch {}
  return {
    statusCode: res.status,
    headers: { 'Content-Type': 'application/json' },
    body: detail || JSON.stringify({ error: 'Upstream fetch failed' }),
  };
}
