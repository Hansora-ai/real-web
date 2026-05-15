// netlify/functions/upscale-download.js
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  try {
    const qs = event.queryStringParameters || {};
    const url = String(qs.url || '').trim();
    const name = String(qs.name || 'hansora-upscale').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 90) || 'hansora-upscale';
    if (!/^https?:\/\//i.test(url)) return json(400, { ok: false, error: 'invalid_url' });
    const resp = await fetch(url);
    if (!resp.ok) return json(502, { ok: false, error: `fetch_${resp.status}` });
    const contentType = resp.headers.get('content-type') || 'application/octet-stream';
    const ext = contentType.includes('video') ? '.mp4' : contentType.includes('png') ? '.png' : contentType.includes('jpeg') ? '.jpg' : '';
    const buf = Buffer.from(await resp.arrayBuffer());
    return { statusCode: 200, headers: { ...cors(), 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${name}${/\.[a-z0-9]{2,5}$/i.test(name) ? '' : ext}"` }, body: buf.toString('base64'), isBase64Encoded: true };
  } catch (error) { return json(200, { ok: false, error: error && error.message ? error.message : String(error) }); }
};
function cors(){return{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"*","Access-Control-Allow-Methods":"GET,OPTIONS"}}
function json(statusCode, body){return{statusCode,headers:{'Content-Type':'application/json',...cors()},body:JSON.stringify(body)}}
