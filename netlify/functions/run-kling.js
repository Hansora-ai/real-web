// netlify/functions/run-kling.js
// Create a KIE Kling job (text→video or image→video), seed a placeholder Usage row,
// and (server-side) debit credits. Minimal changes elsewhere.
//
// Required env: KIE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional: KIE_BASE_URL (default https://api.kie.ai), SUPABASE_BUCKET (uploads/results bucket)
//
const KIE_BASE = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/+$/, '');
const KIE_KEY  = process.env.KIE_API_KEY || '';
const SUPABASE_URL  = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'downloads';
const SITE_BASE = (process.env.SITE_BASE || 'https://webhansora.netlify.app').replace(/\/+$/,'');
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/video-kie-callback`;


function cors(){ return {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
}; }
const json = (c,o)=>({ statusCode:c, headers:{ 'Content-Type':'application/json', ...cors() }, body:JSON.stringify(o) });

function getHeader(event, k){ return event.headers[k] || event.headers[k.toLowerCase()] || event.headers[k.toUpperCase()] || null; }
function getUID(event, body){
  const qs = new URLSearchParams(event.queryStringParameters || {});
  return ((getHeader(event,'x-user-id')||'') || (body && (body.uid||'')) || (qs.get('uid')||'')).trim();
}

// ---- server-side debit (4⚡ for 5s, 8⚡ for 10s) ----
async function debitCredits(uid, cost){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return { ok:false, error:'missing_env_or_uid' };
  try{
    const profUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
    const r0 = await fetch(profUrl, { headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
    if (!r0.ok) return { ok:false, error:'profile_fetch_failed', status:r0.status };
    const arr = await r0.json().catch(()=>null);
    const cur = (Array.isArray(arr) && arr[0] && typeof arr[0].credits==='number') ? arr[0].credits : 0;
    if (cur < cost) return { ok:false, error:'insufficient_credits', credits: cur };
    const newCredits = Math.max(0, cur - cost);
    const updUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`;
    const r1 = await fetch(updUrl, {
      method:'PATCH',
      headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer':'return=representation' },
      body: JSON.stringify([{ credits: newCredits }])
    });
    if (!r1.ok) return { ok:false, error:'profile_update_failed', status:r1.status };
    return { ok:true, credits:newCredits };
  }catch(e){ return { ok:false, error:'server_exception', details:String(e&&e.message||e) }; }
}

// Decode data URL -> { mime, buffer }
function decodeDataUrl(dataUrl){
  const m = String(dataUrl||'').match(/^data:([^;]+);base64,(.*)$/i);
  if (!m) return null;
  const mime = m[1]; const b64 = m[2];
  try { return { mime, buffer: Buffer.from(b64, 'base64') }; } catch { return null; }
}

// Upload buffer to Supabase public bucket -> public URL
async function uploadBuffer(buf, mime, nameHint){
  if (!(SUPABASE_URL && SERVICE_KEY && buf)) return '';
  const d = new Date();
  const y = String(d.getUTCFullYear());
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  const day = String(d.getUTCDate()).padStart(2,'0');
  const safe = String(nameHint||'kling-input').replace(/[^\w.\- ]+/g,'_').slice(0,120);
  const path = `${y}/${m}/${day}/${Date.now()}-${safe}`;
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${path}`;
  const up = await fetch(uploadUrl, {
    method:'POST',
    headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': mime || 'application/octet-stream', 'x-upsert':'true' },
    body: buf
  });
  if (!up.ok) return '';
  return `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(SUPABASE_BUCKET)}/${path}`;
}

// Extract common taskId from KIE responses
function extractTaskId(data){
  if (!data || typeof data !== 'object') return '';
  const cands = [
    data?.data?.taskId, data?.taskId, data?.result?.taskId,
    data?.data?.task_id, data?.task_id, data?.result?.task_id,
    data?.id
  ].map(v => (v==null?'':String(v))).filter(s => s && s.length>3);
  if (cands.length) return cands[0];
  // deep scan
  const seen = new Set();
  const scan = (x)=>{
    if (!x || typeof x!=='object' || seen.has(x)) return '';
    seen.add(x);
    for (const [k,v] of Object.entries(x)){
      if (/^(task[_-]?id|request[_-]?id|id)$/i.test(k) && (typeof v==='string'||typeof v==='number')) {
        const s = String(v); if (s.length>3) return s;
      }
      const inner = scan(v); if (inner) return inner;
    }
    return '';
  };
  return scan(data) || '';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok:false, error:'method_not_allowed' });

  try{
    if (!KIE_KEY) return json(500, { ok:false, error:'missing_kie_key' });

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch(e){ return json(400, { ok:false, error:'bad_json', details: String(e.message || e) }); }

    const uid = getUID(event, body);
    if (!uid) return json(401, { ok:false, error:'missing_uid' });

    const prompt = String(body.prompt || '').trim();
    const aspect_ratio = (body.aspect_ratio ? String(body.aspect_ratio) : '1:1').trim();
const duration = (body && (body.duration === 10 || String(body.duration) === '10')) ? 10 : 5;
    if (!prompt && !( || (s && s.length))) {
      return json(400, { ok:false, error:'missing_input', details:'Provide a prompt or an image.' });
    }

    // Costs: 5s -> 4⚡, 10s -> 8⚡
    const cost = (duration === 10) ? 8 : 4;
    const run_id = (body.run_id && String(body.run_id).trim()) || `${uid || 'anon'}-${Date.now()}`;

    // Seed placeholder row
    let row_id = null;
    try {
      if (SUPABASE_URL && SERVICE_KEY && uid){
        const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
        const meta = { source:'kling', run_id, model:'kling', status:'pending' };
        const rIns = await fetch(ug, {
          method: 'POST',
          headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
          body: JSON.stringify({ user_id: uid, provider: 'kling', kind: 'video', prompt, result_url: null, meta }),
        });
        if (rIns.ok){
          const arr = await rIns.json().catch(()=>null);
          if (Array.isArray(arr) && arr[0] && arr[0].id) row_id = arr[0].id;
        }
      }
    } catch {}

    // Prepare image_url if provided as data URL
    let image_url = '';

// If client sent a public URL already, take it directly and skip data URL decoding/upload.

if (__imageUrls && Array.isArray(__imageUrls) && __imageUrls.length) {
  try { image_urls = __imageUrls; } catch(e){}
}

    const firstData = (!__imageUrl && !(__imageUrls && __imageUrls.length)) ? ((s && s[0]) ||  || '') : '';
    if (firstData) {
      const dec = decodeDataUrl(firstData);
      if (!dec) return json(400, { ok:false, error:'bad_' });
      image_url = await uploadBuffer(dec.buffer, dec.mime, 'kling-input');
      if (!image_url) return json(500, { ok:false, error:'image_upload_failed' });
    }

    // Choose model per mode
    const model = image_url ? "kling/v2-5-turbo-image-to-video-pro" : "kling/v2-5-turbo-text-to-video-pro";

    // Build KIE createTask payload
    
// Normalize single/array image params before sending to provider
try {
  if (typeof image_urls === 'undefined' && typeof image_url !== 'undefined' && image_url) {
    image_urls = [ String(image_url) ];
  }
  if (Array.isArray(image_urls) && !image_url && image_urls.length) {
    image_url = String(image_urls[0]);
  }
} catch {}
const payload = {
      model,
      input: {
        prompt,
        aspect_ratio,
        duration: (duration === 10 ? '10' : '5'),
        ...(image_url ? { image_url } : {})
      }
    ,
      callBackUrl: `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`
    };

    // Create task (no webhook required; we poll)
    const resp = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json().catch(()=>({}));
    if (!resp.ok) return json(resp.status || 502, { ok:false, error:'kie_create_failed', details:data });

    const taskId = extractTaskId(data);
    if (!taskId) return json(502, { ok:false, error:'missing_task_id', details:data });

    // Persist taskId into meta for tracing (status: processing)
    try {
      if (SUPABASE_URL && SERVICE_KEY && taskId) {
        const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
        const chk = await fetch(ug + q, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
        const arr = await chk.json().catch(()=>[]);
        if (Array.isArray(arr) && arr.length) {
          await fetch(`${ug}?id=eq.${encodeURIComponent(arr[0].id)}`, {
            method: 'PATCH',
            headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ meta: { source:'kling', run_id, model, status:'processing', task_id: taskId } })
          });
        }
      }
    } catch {}


    // Debit credits AFTER task was accepted
    const debit = await debitCredits(uid, cost);
    if (!debit.ok){
      // We don't know a cancel endpoint for KIE generic jobs; return error.
      return json(402, { ok:false, error:'not_enough_credits', details: debit });
    }

    return json(201, { ok:true, submitted:true, taskId, id: taskId, run_id, row_id, debited: cost, credits: debit.credits });
  }catch(e){
    return json(500, { ok:false, error:'server_error', details: String(e && e.message || e) });
  }
};
