// netlify/functions/kie-upload-video.js
// Fetch-only uploader (Edge/Node safe):
// - Forwards the original multipart body AS-IS to KIE (no parsing, no base64, no size bloat)
// - Uses only `fetch` (no `require`), so it runs in Netlify Functions (Node 18+) and Edge
// - ALWAYS returns 200 with JSON, so the UI never sees a blank 500

const KIE_ENDPOINTS = [
  'https://kieai.redpandaai.co/api/file-upload',
  'https://kieai.redpandaai.co/api/fileUpload',
  'https://kieai.redpandaai.co/api/upload-file'
];

const REQ_TIMEOUT_MS = 20000;

exports.handler = async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: cors(), body: '' };
    }
    if (event.httpMethod !== 'POST') {
      return resp(200, { ok: false, error: 'method_not_allowed' });
    }

    const contentType = String(event.headers['content-type'] || event.headers['Content-Type'] || '');
    const bMatch = /boundary=([^;]+)/i.exec(contentType);
    if (!bMatch) {
      return resp(200, { ok: false, error: 'missing_boundary', contentType });
    }

    const rawBody = decodeBodyToUint8(event);

    const KIE_API_KEY = (process.env.KIE_API_KEY || '').trim();

    // Try KIE endpoints by proxying the *original* multipart body as-is
    if (KIE_API_KEY) {
      let last = null;
      for (const ep of KIE_ENDPOINTS) {
        const r = await safeFetch(ep, {
          method: 'POST',
          headers: {
            'Content-Type': contentType,
            'Authorization': `Bearer ${KIE_API_KEY}`,
            'Accept': 'application/json'
          },
          body: rawBody
        });

        const status = r.status;
        const text = await r.text().catch(() => '');
        let j = {};
        try { j = JSON.parse(text); } catch { j = { raw: text }; }

        if (r.ok) {
          const url = j.url || j.downloadUrl || (j.data && j.data.url);
          if (url && /^https?:\/\//i.test(url)) {
            return resp(200, { ok: true, source: 'kie', downloadUrl: url, details: j });
          }
          // KIE responded but didn’t provide a URL
          return resp(200, { ok: false, error: 'kie_no_url', details: j });
        }
        last = { endpoint: ep, status, body: text };
      }
      // KIE failed on all endpoints
      return resp(200, { ok: false, error: 'kie_upload_failed', last });
    }

    // No API key present — return a readable result (still 200)
    return resp(200, { ok: false, error: 'missing_api_key' });

  } catch (e) {
    // Never bubble a 500 to the UI
    return resp(200, { ok: false, error: 'server_error', detail: String(e && e.stack || e) });
  }
};

// ---- helpers (Edge/Node safe) ----

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

function resp(code, body) {
  return { statusCode: code, headers: cors(), body: JSON.stringify(body) };
}

// Decode the incoming body into a Uint8Array (works in Edge/Node)
function decodeBodyToUint8(event) {
  const b64 = !!event.isBase64Encoded;
  const body = event.body || '';
  if (b64) {
    if (typeof atob === 'function') {
      const bin = atob(body);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    // Node path (no require, Buffer is global in Node 18 runtimes)
    return Uint8Array.from(Buffer.from(body, 'base64'));
  } else {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(body);
    }
    // Fallback for very old runtimes
    return Uint8Array.from(Buffer.from(body, 'utf8'));
  }
}

// Fetch with timeout
async function safeFetch(url, init) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), REQ_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}
