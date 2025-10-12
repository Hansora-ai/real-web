// netlify/functions/kie-upload.js
// Final single-file uploader: binary-safe, tolerant headers, MIME normalization, zero deps.
// Returns { downloadUrl, urls } and uses Supabase Storage REST.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET (e.g., 'video')

const crypto = require('crypto');

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return resp(204, '', cors());
    if (event.httpMethod !== 'POST') return resp(405, 'Method Not Allowed', cors());

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'user-uploads';
    const SIGN_EXP = parseInt(process.env.SUPABASE_SIGNED_URL_SECONDS || '3600', 10);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { error: 'server_config', detail: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
    }

    const ct = header(event.headers, 'content-type');
    if (!ct || !ct.toLowerCase().includes('multipart/form-data')) {
      return json(400, { error: 'bad_request', detail: 'Expected multipart/form-data' });
    }

    const m = /boundary=([^;]+)/i.exec(ct);
    if (!m) return json(400, { error: 'bad_request', detail: 'Missing multipart boundary' });
    const boundary = '--' + m[1];

    // Decode as base64 if flagged, otherwise raw binary (not utf8)
    const bodyBuf = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'binary');
    const parts = splitMultipart(bodyBuf, boundary);
    if (!parts.length) return json(400, { error: 'bad_request', detail: 'No multipart parts found' });

    const images = [];
    for (const p of parts) {
      const headerEnd = p.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;
      const headersTxt = p.slice(0, headerEnd).toString('utf8');
      let body = p.slice(headerEnd + 4);
      if (body.slice(-2).toString('binary') === '\r\n') body = body.slice(0, -2);

      // content-disposition
      const cd = /content-disposition:[^\n]*name="([^"]+)"(?:(?:;[^\r\n]*))?/i.exec(headersTxt);
      const fieldName = cd ? cd[1] : '';

      // filename (quoted) or filename* (RFC5987)
      let filename = '';
      const m1 = /;\s*filename="([^"]*)"/i.exec(headersTxt);
      if (m1) filename = m1[1];
      if (!filename) {
        const m2 = /;\s*filename\*=(?:UTF-8''|utf-8'')?([^;\r\n]+)/i.exec(headersTxt);
        if (m2) { try { filename = decodeURIComponent(m2[1]); } catch { filename = m2[1]; } }
      }

      // mime from header (if present)
      const ctPart = /content-type:\s*([^\r\n]+)/i.exec(headersTxt);
      let mime = (ctPart && ctPart[1]) ? ctPart[1].trim().toLowerCase() : '';
      mime = normalizeMime(mime);

      if (filename) {
        // Real file: fallback to sniff if header missing/odd
        if (!mime || !mime.startsWith('image/')) mime = normalizeMime(sniffImageMime(body));
        if (!isSupportedImage(mime)) continue;
        images.push({ filename, mime, data: body });
        continue;
      }

      // data URL fallback
      const txt = body.toString('utf8').trim();
      if (txt.startsWith('data:image/')) {
        const parsed = dataUrlToBuffer(txt);
        if (parsed && parsed.buffer) {
          const ext = extForMime(normalizeMime(parsed.mime)) || 'bin';
          const fname = (fieldName || 'image') + '.' + ext;
          images.push({ filename: fname, mime: normalizeMime(parsed.mime), data: parsed.buffer });
        }
      }
    }

    if (!images.length) return json(400, { error: 'no_file', detail: 'No file parts or data URLs found' });

    // Upload images
    const urls = [];
    for (const img of images) {
      const res = await uploadToSupabase({
        SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET, SIGN_EXP
      }, img.data, img.mime, img.filename);
      if (res.error) return json(502, { error: 'upload_failed', detail: res.error });
      urls.push(res.url);
    }

    return json(200, { downloadUrl: urls[0], urls });

  } catch (e) {
    return json(502, { error: 'server_error', detail: String(e && e.message ? e.message : e) });
  }
};

// ---------- helpers ----------
function header(h, k){ if(!h) return ''; const v = h[k] || h[k.toLowerCase()] || h[k.toUpperCase()]; return v || ''; }
function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'};}
function resp(statusCode,body,headers){return{statusCode,headers,body};}
function json(code,obj){return{statusCode:code,headers:{...cors(),'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(obj)};}
function encodePath(p){return p.split('/').map(encodeURIComponent).join('/');}
function sanitize(name){return String(name).replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^[-.]+|[-.]+$/g,'');}
function splitMultipart(buf,boundary){
  const out=[]; const b=Buffer.from(boundary);
  let i = buf.indexOf(b);
  if (i === -1) i = 0;
  while (true) {
    const j = buf.indexOf(b, i + b.length);
    if (j === -1) break;
    let part = buf.slice(i + b.length, j);
    if (part.slice(0,2).toString('binary') === '\r\n') part = part.slice(2);
    if (part.slice(-2).toString('binary') === '\r\n') part = part.slice(0, -2);
    if (part.length > 0) out.push(part);
    i = j;
  }
  return out;
}
function sniffImageMime(buf){
  if(!buf||buf.length<12)return'';
  if(buf[0]===0xFF&&buf[1]===0xD8&&buf[2]===0xFF)return'image/jpeg';
  if(buf.length>8&&buf[0]===0x89&&buf[1]===0x50&&buf[2]===0x4E&&buf[3]===0x47&&buf[4]===0x0D&&buf[5]===0x0A&&buf[6]===0x1A&&buf[7]===0x0A)return'image/png';
  if(buf.length>12&&buf[0]===0x52&&buf[1]===0x49&&buf[2]===0x46&&buf[3]===0x46&&buf[8]===0x57&&buf[9]===0x45&&buf[10]===0x42&&buf[11]===0x50)return'image/webp';
  if(buf.length>6&&buf[0]===0x47&&buf[1]===0x49&&buf[2]===0x46&&buf[3]===0x38)return'image/gif';
  return'';
}
function normalizeMime(m){
  if(!m) return '';
  const s = m.toLowerCase();
  if (s === 'image/jpg' || s === 'image/pjpeg') return 'image/jpeg';
  if (s === 'image/x-png') return 'image/png';
  // leave heic/avif unsupported for now
  return s;
}
function isSupportedImage(m){ return m==='image/jpeg'||m==='image/png'||m==='image/webp'||m==='image/gif'; }
function extForMime(m){
  if(m==='image/jpeg')return'jpg';
  if(m==='image/png')return'png';
  if(m==='image/webp')return'webp';
  if(m==='image/gif')return'gif';
  return'bin';
}
function dataUrlToBuffer(s){
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(s.trim());
  if (!m) return null;
  try { return { mime: m[1].toLowerCase(), buffer: Buffer.from(m[2], 'base64') }; }
  catch { return null; }
}
async function uploadToSupabase(cfg, fileBuf, mime, filename){
  const base = filename.replace(/\.[^.]+$/, '');
  const ext = extForMime(mime);
  const safeName = `${sanitize(base)}.${ext}`;
  const now = new Date();
  const y = now.getUTCFullYear();
  const mth = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const rand = crypto.randomBytes(8).toString('hex');
  const objectPath = `images/user-uploads/${y}/${mth}/${d}/${rand}-${safeName}`;

  const uploadUrl = `${cfg.SUPABASE_URL.replace(/\/+$/,'')}/storage/v1/object/${encodeURIComponent(cfg.SUPABASE_BUCKET)}/${encodePath(objectPath)}?upsert=true`;
  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': mime,
      'x-upsert': 'true',
      'cache-control': 'public, max-age=31536000'
    },
    body: fileBuf
  });
  if (!upRes.ok) {
    const detail = await upRes.text().catch(() => '');
    return { error: `status ${upRes.status}: ${detail || 'upload failed'}` };
  }

  // Try public URL, else sign
  let url = `${cfg.SUPABASE_URL.replace(/\/+$/,'')}/storage/v1/object/public/${encodeURIComponent(cfg.SUPABASE_BUCKET)}/${encodePath(objectPath)}`;
  const head = await fetch(url, { method: 'HEAD' });
  if (head.status === 401 || head.status === 404) {
    const signUrl = `${cfg.SUPABASE_URL.replace(/\/+$/,'')}/storage/v1/object/sign/${encodeURIComponent(cfg.SUPABASE_BUCKET)}/${encodePath(objectPath)}`;
    const signRes = await fetch(signUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: cfg.SIGN_EXP || 3600 })
    });
    if (!signRes.ok) {
      const msg = await signRes.text().catch(() => '');
      return { error: `sign ${signRes.status}: ${msg}` };
    }
    const data = await signRes.json().catch(() => ({}));
    const rel = data.signedURL || data.signedUrl;
    if (!rel) return { error: 'sign: missing signed URL' };
    url = `${cfg.SUPABASE_URL.replace(/\/+$/,'')}${rel.startsWith('/') ? '' : '/'}${rel}`;
  }
  return { url };
}
