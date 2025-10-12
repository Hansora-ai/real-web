// netlify/functions/kie-upload.js
const https = require('https');
const { URL } = require('url');
const crypto = require('crypto');

const HANDLER_VERSION = 'kie-upload@v3-node16-safe';

function tinyFetch(rawUrl, opts = {}) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(rawUrl);
      const method = (opts.method || 'GET').toUpperCase();
      const headers = opts.headers || {};
      const body = opts.body || null;

      const reqOpts = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + (url.search || ''),
        method,
        headers,
      };

      const req = https.request(reqOpts, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const text = () => Promise.resolve(buf.toString('utf8'));
          const json = () => Promise.resolve().then(() => JSON.parse(buf.toString('utf8') || '{}'));
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, headers: res.headers, buffer: buf, text, json });
        });
      });

      req.on('error', reject);
      if (body) {
        if (Buffer.isBuffer(body)) req.write(body);
        else if (typeof body === 'string') req.write(body, 'utf8');
        else return reject(new Error('Unsupported body type'));
      }
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

exports.handler = async (event) => {
  const reqId = (event.headers && (event.headers['x-nf-request-id'] || event.headers['X-NF-Request-ID'])) || '';
  const baseHeaders = {
    ...cors(),
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'x-handler-version': HANDLER_VERSION,
  };
  if (reqId) baseHeaders['x-echo-nf-request-id'] = String(reqId);

  try {
    if (event.httpMethod === 'OPTIONS') return resp(204, '', baseHeaders);
    if (event.httpMethod !== 'POST') return resp(405, JSON.stringify({ error: 'method_not_allowed' }), baseHeaders);

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'user-uploads';
    const SIGN_EXP = parseInt(process.env.SUPABASE_SIGNED_URL_SECONDS || '3600', 10);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return resp(500, JSON.stringify({ error: 'server_config', detail: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }), baseHeaders);
    }

    const ct = header(event.headers, 'content-type') || header(event.headers, 'Content-Type');
    if (!ct || !/multipart\/form-data/i.test(ct)) {
      return resp(400, JSON.stringify({ error: 'bad_request', detail: 'Expected multipart/form-data' }), baseHeaders);
    }

    const bm = /boundary=([^;]+)/i.exec(ct);
    if (!bm) return resp(400, JSON.stringify({ error: 'bad_request', detail: 'Missing multipart boundary' }), baseHeaders);
    const boundary = '--' + bm[1];

    const bodyBuf = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'binary');
    const parts = splitMultipart(bodyBuf, boundary);
    if (!parts.length) return resp(400, JSON.stringify({ error: 'bad_request', detail: 'No multipart parts found' }), baseHeaders);

    const images = [];
    for (const p of parts) {
      const headerEnd = p.indexOf('\\r\\n\\r\\n');
      if (headerEnd === -1) continue;
      const headersTxt = p.slice(0, headerEnd).toString('utf8');
      let body = p.slice(headerEnd + 4);
      if (body.slice(-2).toString('binary') === '\\r\\n') body = body.slice(0, -2);

      let filename = '';
      const m1 = /;\\s*filename="([^"]*)"/i.exec(headersTxt);
      if (m1) filename = m1[1];
      if (!filename) {
        const m2 = /;\\s*filename\\*=(?:UTF-8''|utf-8'')?([^;\\r\\n]+)/i.exec(headersTxt);
        if (m2) { try { filename = decodeURIComponent(m2[1]); } catch { filename = m2[1]; } }
      }

      const ctPart = /content-type:\\s*([^\\r\\n]+)/i.exec(headersTxt);
      let mime = (ctPart && ctPart[1]) ? ctPart[1].trim().toLowerCase() : '';
      mime = normalizeMime(mime);

      if (filename) {
        if (!mime || !mime.startsWith('image/')) mime = normalizeMime(sniffImageMime(body));
        if (!isSupportedImage(mime)) continue;
        images.push({ filename, mime, data: body });
      } else {
        const txt = body.toString('utf8').trim();
        if (txt.startsWith('data:image/')) {
          const parsed = dataUrlToBuffer(txt);
          if (parsed && parsed.buffer) {
            const ext = extForMime(normalizeMime(parsed.mime)) || 'bin';
            const fname = 'image.' + ext;
            images.push({ filename: fname, mime: normalizeMime(parsed.mime), data: parsed.buffer });
          }
        }
      }
    }

    if (!images.length) {
      return resp(400, JSON.stringify({ error: 'no_file', detail: 'No file parts or data URLs found' }), baseHeaders);
    }

    const urls = [];
    for (const img of images) {
      const res = await uploadToSupabase(
        { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET, SIGN_EXP },
        img.data, img.mime, img.filename
      );
      if (res.error) return resp(502, JSON.stringify({ error: 'upload_failed', detail: res.error }), baseHeaders);
      urls.push(res.url);
    }

    return resp(200, JSON.stringify({ downloadUrl: urls[0], urls }), baseHeaders);

  } catch (e) {
    const detail = (e && e.stack) ? e.stack : String(e);
    const hdrs = { ...baseHeaders, 'x-handler-crash': '1' };
    return resp(500, JSON.stringify({ error: 'server_error', version: HANDLER_VERSION, detail }), hdrs);
  }
};

function header(h, k){ if(!h) return ''; const v = h[k] || h[k.toLowerCase()] || h[k.toUpperCase()]; return v || ''; }
function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'};}
function resp(statusCode, body, headers){ return { statusCode, headers, body }; }
function encodePath(p){return p.split('/').map(encodeURIComponent).join('/');}
function sanitize(name){return String(name).replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^[-.]+|[-.]+$/g,'');}
function splitMultipart(buf,boundary){
  const out=[]; const b=Buffer.from(boundary); let i=buf.indexOf(b); if(i===-1)i=0;
  while(true){ const j=buf.indexOf(b,i+b.length); if(j===-1)break;
    let part=buf.slice(i+b.length,j);
    if(part.slice(0,2).toString('binary')==='\\r\\n') part=part.slice(2);
    if(part.slice(-2).toString('binary')==='\\r\\n') part=part.slice(0,-2);
    if(part.length>0) out.push(part);
    i=j;
  } return out;
}
function sniffImageMime(buf){
  if(!buf||buf.length<12)return'';
  if(buf[0]===0xFF&&buf[1]===0xD8&&buf[2]===0xFF)return'image/jpeg';
  if(buf.length>8&&buf[0]===0x89&&buf[1]===0x50&&buf[2]===0x4E&&buf[3]===0x47&&buf[4]===0x0D&&buf[5]===0x0A&&buf[6]===0x1A&&buf[7]===0x0A)return'image/png';
  if(buf.length>12&&buf[0]===0x52&&buf[1]===0x49&&buf[2]===0x46&&buf[3]===0x46&&buf[8]===0x57&&buf[9]===0x45&&buf[10]===0x42&&buf[11]===0x50)return'image/webp';
  if(buf.length>6&&buf[0]===0x47&&buf[1]===0x49&&buf[2]===0x46&&buf[3]===0x38)return'image/gif';
  return'';
}
function normalizeMime(m){ if(!m)return''; const s=m.toLowerCase(); if(s==='image/jpg'||s==='image/pjpeg')return'image/jpeg'; if(s==='image/x-png')return'image/png'; return s; }
function isSupportedImage(m){return m==='image/jpeg'||m==='image/png'||m==='image/webp'||m==='image/gif';}
function extForMime(m){ if(m==='image/jpeg')return'jpg'; if(m==='image/png')return'png'; if(m==='image/webp')return'webp'; if(m==='image/gif')return'gif'; return'bin'; }
function dataUrlToBuffer(s){ const m=/^data:(image\\/[^;]+);base64,(.+)$/i.exec(s.trim()); if(!m)return null; try{return{mime:m[1].toLowerCase(),buffer:Buffer.from(m[2],'base64')}}catch{return null}

async function uploadToSupabase(cfg, fileBuf, mime, filename){
  const base=(filename||'image').replace(/\\.[^.]+$/,'');
  const ext=extForMime(mime);
  const safeName=`${sanitize(base)}.${ext}`;
  const now=new Date(); const y=now.getUTCFullYear(); const m=String(now.getUTCMonth()+1).padStart(2,'0'); const d=String(now.getUTCDate()).padStart(2,'0');
  const rand=crypto.randomBytes(8).toString('hex');
  const objectPath=`images/user-uploads/${y}/${m}/${d}/${rand}-${safeName}`;

  const uploadUrl=`${cfg.SUPABASE_URL.replace(/\\/+$/,'')}/storage/v1/object/${encodeURIComponent(cfg.SUPABASE_BUCKET)}/${encodePath(objectPath)}?upsert=true`;
  const upRes=await tinyFetch(uploadUrl,{method:'POST',headers:{'Authorization':`Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':mime,'x-upsert':'true','cache-control':'public, max-age=31536000'},body:fileBuf});
  if(!upRes.ok){ const detail=await upRes.text().catch(()=>'');
    return { error: `status ${upRes.status}: ${detail || 'upload failed'}` }; }

  let url=`${cfg.SUPABASE_URL.replace(/\\/+$/,'')}/storage/v1/object/public/${encodeURIComponent(cfg.SUPABASE_BUCKET)}/${encodePath(objectPath)}`;
  const head=await tinyFetch(url,{method:'HEAD'});
  if(head.status===401||head.status===404){
    const signUrl=`${cfg.SUPABASE_URL.replace(/\\/+$/,'')}/storage/v1/object/sign/${encodeURIComponent(cfg.SUPABASE_BUCKET)}/${encodePath(objectPath)}`;
    const signRes=await tinyFetch(signUrl,{method:'POST',headers:{'Authorization':`Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:cfg.SIGN_EXP||3600})});
    if(!signRes.ok){ const msg=await signRes.text().catch(()=>'');
      return { error: `sign ${signRes.status}: ${msg}` }; }
    const data=await signRes.json().catch(()=>({}));
    const rel=data.signedURL||data.signedUrl;
    if(!rel) return { error:'sign: missing signed URL' };
    url=`${cfg.SUPABASE_URL.replace(/\\/+$/,'')}${rel.startsWith('/')?'':'/'}${rel}`;
  }
  return { url };
}
