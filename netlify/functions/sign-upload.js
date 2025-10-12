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
        headers
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
            json: () => Promise.resolve().then(() => JSON.parse(buf.toString('utf8') || '{}'))
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

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return resp(204, '', cors());
    if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'video';

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { error: 'server_config', detail: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
    }

    const { filename = 'image.jpg', mime = 'image/jpeg' } = safeJSON(event.body);
    const safeName = sanitize(filename);
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    const rand = crypto.randomBytes(8).toString('hex');
    const objectPath = `images/user-uploads/${y}/${m}/${d}/${rand}-${safeName}`;

    // Sign an UPLOAD (PUT) URL
    const signUrl = `${SUPABASE_URL.replace(/\/+$/,'')}/storage/v1/object/sign/${encodeURIComponent(SUPABASE_BUCKET)}/${encodePath(objectPath)}`;
    const res = await tinyFetch(signUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 600, method: 'PUT', contentType: normalizeMime(mime) })
    });

    if (!res.ok) {
      const txt = await res.text().catch(()=>'');
      return json(502, { error: 'sign_failed', detail: txt || `status ${res.status}` });
    }

    const data = await res.json().catch(()=> ({}));
    const rel = data.signedURL || data.signedUrl;
    if (!rel) return json(502, { error: 'sign_failed', detail: 'missing signedURL' });

    const uploadUrl = `${SUPABASE_URL.replace(/\/+$/,'')}${rel.startsWith('/') ? '' : '/'}${rel}`;
    const publicUrl = `${SUPABASE_URL.replace(/\/+$/,'')}/storage/v1/object/public/${encodeURIComponent(SUPABASE_BUCKET)}/${encodePath(objectPath)}`;

    return json(200, { uploadUrl, objectPath, publicUrl });
  } catch (e) {
    return json(500, { error: 'server_error', detail: String(e && e.message ? e.message : e) });
  }
};

function cors(){ return {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}; }
function resp(code, body, headers){ return { statusCode: code, headers: headers || {...cors()}, body }; }
function json(code, obj){ return { statusCode: code, headers: { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) }; }
function safeJSON(s){ try { return JSON.parse(s||'{}'); } catch { return {}; } }
function encodePath(p){ return p.split('/').map(encodeURIComponent).join('/'); }
function sanitize(name){ return String(name).replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^[-.]+|[-.]+$/g,''); }
function normalizeMime(m){ if(!m) return ''; m=m.toLowerCase(); if(m==='image/jpg'||m==='image/pjpeg')return'image/jpeg'; if(m==='image/x-png')return'image/png'; return m; }
