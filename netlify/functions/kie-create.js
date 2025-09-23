// netlify/functions/kie-create.js

const UPLOAD_BASE64_URL = 'https://kieai.redpandaai.co/api/file-base64-upload';

// Map any user/legacy values -> exact KIE tokens
function normalizeImageSize(v) {
  if (!v) return 'auto';
  const raw = String(v).trim().toLowerCase();

  // unify separators to colon
  let s = raw.replace(/\s+/g, '')
             .replace(/_/g, ':')
             .replace(/-/g, ':');

  const ALLOWED = new Set(['auto','1:1','3:4','9:16','4:3','16:9']);
  if (ALLOWED.has(s)) return s;

  const MAP = {
    'square':'1:1',
    'portrait3:4':'3:4',
    'portrait3/4':'3:4',
    'portrait_3_4':'3:4',
    'portrait9:16':'9:16',
    'portrait9/16':'9:16',
    'portrait_9_16':'9:16',
    'landscape4:3':'4:3',
    'landscape4/3':'4:3',
    'landscape_4_3':'4:3',
    'landscape16:9':'16:9',
    'landscape16/9':'16:9',
    'landscape_16_9':'16:9',
    'portrait':'3:4',
    'landscape':'16:9'
  };
  return MAP[s] || 'auto';
}

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
    if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: cors(), body: 'Method Not Allowed' };

    const KIE_API_URL      = process.env.KIE_API_URL;
    const KIE_API_KEY      = process.env.KIE_API_KEY;
    const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

    const miss = [];
    if (!KIE_API_URL)      miss.push('KIE_API_URL');
    if (!KIE_API_KEY)      miss.push('KIE_API_KEY');
    if (!MAKE_WEBHOOK_URL) miss.push('MAKE_WEBHOOK_URL');
    if (miss.length) return { statusCode: 500, headers: cors(), body: `Missing: ${miss.join(', ')}` };

    let bodyIn = {};
    try { bodyIn = JSON.parse(event.body || '{}'); }
    catch { return { statusCode: 400, headers: cors(), body: 'Bad JSON' }; }

    const {
      prompt,
      format = 'png',
      files = [],
      imageUrls = [],
      uid = '',
      run_id = '',
      image_size = 'auto'
    } = bodyIn;

    if (!prompt) return { statusCode: 400, headers: cors(), body: 'Missing "prompt"' };

    let image_urls = [];
    if (Array.isArray(imageUrls) && imageUrls.length) {
      image_urls = imageUrls;
    } else {
      if (!files.length)    return { statusCode: 400, headers: cors(), body: 'Provide at least one file or imageUrls' };
      if (files.length > 4) return { statusCode: 400, headers: cors(), body: 'Up to 4 files allowed' };

      for (const f of files) {
        const dataUrl = `data:${f.contentType || 'application/octet-stream'};base64,${f.data}`;
        const up = await fetch(UPLOAD_BASE64_URL, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ base64Data: dataUrl, uploadPath: 'images/user-uploads', fileName: f.name || 'image.png' })
        });
        const uj = await up.json().catch(()=> ({}));
        if (!up.ok || !uj?.data?.downloadUrl) {
          return { statusCode: 502, headers: cors(), body: `Upload failed: ${up.status} ${JSON.stringify(uj)}` };
        }
        image_urls.push(uj.data.downloadUrl);
      }
    }

    if (!image_urls.length) return { statusCode: 400, headers: cors(), body: 'No image URLs provided.' };

    // keep your previous direct-file normalization
    image_urls = image_urls.map(u => {
      try { const url = new URL(u); url.pathname = url.pathname.replace('/download/', '/files/'); return url.toString(); }
      catch { return u; }
    });

    const outFormat = String(format).toLowerCase();
    const first = image_urls[0];
    const COST = 1.5;

    const clientContext = { prompt, format: outFormat, submittedAt: new Date().toISOString(), run_id, uid };
    const callbackUrl =
      `${MAKE_WEBHOOK_URL}?ctx=${encodeURIComponent(JSON.stringify(clientContext))}` +
      `&uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}&cost=${encodeURIComponent(COST)}`;

    const input = {
      prompt,
      image_urls,
      init_image: first,
      init_image_url: first,
      output_format: outFormat,
      image_size: normalizeImageSize(image_size) // EXACT KIE tokens
    };

    const payload = {
      model: 'google/nano-banana-edit',
      callbackUrl,
      callBackUrl: callbackUrl,
      input
    };

    const resp = await fetch(KIE_API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    });

    const ct = resp.headers.get('content-type') || 'application/json';
    const body = await resp.text();
    return { statusCode: resp.status, headers: { ...cors(), 'Content-Type': ct, 'Cache-Control': 'no-store' }, body };
  } catch (e) {
    return { statusCode: 502, headers: cors(), body: `Server error: ${e.message || e}` };
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}
