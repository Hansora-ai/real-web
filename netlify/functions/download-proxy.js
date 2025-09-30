// netlify/functions/download-proxy.js
// Smart downloader for Usage page.
// - Small files (<~5.5MB): proxy with Content-Disposition: attachment
// - Large/unknown: cache to Supabase Storage, then 302 to signed URL with ?download=<name>
// Accepts: ?url= (or ?u= or ?link=) and ?name= (or ?filename=)
export async function handler(event) {
  try {
    const qs = event.queryStringParameters || {};
    const src = qs.url || qs.u || qs.link;
    const name = qs.name || qs.filename || 'file';
    if (!src) return { statusCode: 400, body: 'Missing ?url=' };

    // Inspect size with HEAD (or a tiny range GET as fallback)
    const head = await tryHeadOrRange(src);
    const length = parseContentLength(head);

    // Limit: keep under ~6MB API-Gateway cap after base64 inflation
    const LIMIT = 5_500_000; // raw bytes

    // === A) Small file -> proxy with forced download
    if (Number.isFinite(length) && length > 0 && length <= LIMIT) {
      const res = await fetch(src);
      if (!res.ok) return upstreamError(res);

      const buf = Buffer.from(await res.arrayBuffer());
      return {
        statusCode: 200,
        headers: {
          // Force download on iOS/Android/desktop:
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${sanitize(name)}"`,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
        body: buf.toString('base64'),
        isBase64Encoded: true,
      };
    }

    // === B) Large/unknown -> cache to Supabase, then signed URL with ?download=<name>
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
    const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'downloads';

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      // No env available: fall back to direct redirect (won't force download)
      return { statusCode: 302, headers: { Location: src }, body: '' };
    }

    const getRes = await fetch(src);
    if (!getRes.ok) return upstreamError(getRes);
    const fileBuf = Buffer.from(await getRes.arrayBuffer());

    // Upload to Supabase Storage (upsert)
    const path = buildPath(name);
    const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}`,
        // Use a generic content-type to avoid inline previews by some viewers
        'Content-Type': 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: fileBuf,
    });

    if (!upRes.ok) {
      const txt = await upRes.text().catch(() => '');
      return { statusCode: 502, body: `Upload failed: ${txt || upRes.status}` };
    }

    // Create a signed URL and append ?download=<name> to force attachment
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
    return { statusCode: 302, headers: { Location: downloadURL }, body: '' };

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
  } catch { return null; }
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
