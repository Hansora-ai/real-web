// real-web/netlify/functions/sign-upload.js
const https = require('https');
const { URL } = require('url');
const crypto = require('crypto');

function tinyFetch(rawUrl, opts = {}) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(rawUrl);
      const method = (opts.method || 'GET').toUpperCase();
      const headers = opts.headers || {};
      const body = opts.body || null;

      const req = https.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + (url.search || ''),
        method,
        headers,
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: res.headers,
            text: () => Promise.resolve(buf.toString('utf8')),
            json: () => Promise.resolve().then(() => {
              const s = buf.toString('utf8') || '{}';
              try { return JSON.parse(s); } catch { return { raw: s }; }
            })
          });
        });
      });
      req.on('error', reject);
      if (body) {
        if (Buffer.isBuffer(body)) req.write(body);
        else if (typeof body === 'string') req.write(body, 'utf8');
        else return reject(new Error('Unsupported body type'));
      }
      req.end();
    } catch (e) { reject(e); }
  });
}

function cors(){ return {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}; }
function resp(code, body, headers){ return { statusCode: code, headers: headers || {...cors()}, body }; }
function json(code, obj){ return { statusCode: code, headers: { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) }; }
function safeJSON(s){ try { return JSON.parse(s||'{}'); } catch { return {}; } }
function encodePath(p){ return p.split('/').map(encodeURIComponent).join('/'); }
function sanitize(name){ return String(name).replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^[-.]+|[-.]+$/g,''); }
function normalizeMime(m){ if(!m) return ''; m=m.toLowerCase(); if(m==='image/jpg'||m==='image/pjpeg')return'image/jpeg'; if(m==='image/x-png')return'image/png'; return m; }

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return resp(204, '', cors());
    if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
    const BUCKET = (process.env.SUPABASE_BUCKET || 'video').trim();
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json(500, { error: 'server_config', detail: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
    }

    const body = safeJSON(event.body);
    const filename = sanitize(body.filename || 'image.jpg');
    const mime = normalizeMime(body.mime || 'image/jpeg');

    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    const rand = crypto.randomBytes(8).toString('hex');
    const objectPath = `images/user-uploads/${y}/${m}/${d}/${rand}-${filename}`;

    // Primary: createSignedUploadUrl via REST (works for new objects)
    const signUrl = `${SUPABASE_URL.replace(/\/+$/,'')}/storage/v1/object/upload/sign`;
    const payload = JSON.stringify({
      bucketId: BUCKET,           // <-- bucketId required by REST
      bucketName: BUCKET,         // <-- keep for forward-compat
      objectName: objectPath,
      contentType: mime,
      expiresIn: 600,
    });

    let res = await tinyFetch(signUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,                 // some gateways require apikey as well
        'Content-Type': 'application/json',
      },
      body: payload
    });

    // Fallback if API returns 404 "Bucket not found" (older gateway)
    if (!res.ok && res.status === 404) {
      const legacyUrl = `${SUPABASE_URL.replace(/\/+$/,'')}/storage/v1/object/sign/${encodeURIComponent(BUCKET)}/${encodePath(objectPath)}`;
      res = await tinyFetch(legacyUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'apikey': SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 600, method: 'PUT', contentType: mime })
      });
    }

    if (!res.ok) {
      const txt = await res.text().catch(()=>'');
      return json(502, { error: 'sign_failed', detail: txt || `status ${res.status}` });
    }

    const data = await res.json();
    const rel = data.signedUrl || data.signedURL || data.url || '';
    if (!rel) return json(502, { error: 'sign_failed', detail: 'missing signedUrl' });

    const uploadUrl = `${SUPABASE_URL.replace(/\/+$/,'')}${rel.startsWith('/') ? '' : '/'}${rel}`;
    const publicUrl = `${SUPABASE_URL.replace(/\/+$/,'')}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${encodePath(objectPath)}`;

    return json(200, { uploadUrl, objectPath, publicUrl });
  } catch (e) {
    return json(500, { error: 'server_error', detail: String(e && e.message ? e.message : e) });
  }
};
