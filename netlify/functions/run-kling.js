// netlify/functions/run-kling.js
// KIE Kling job launcher (text→video or image→video) using URL-only image input.
// Minimal, surgical: accepts only imageUrl/image_url, ignores any data URLs.
// Preserves seeding user_generations and server-side credit debit.
//
// Env: KIE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Opt: KIE_BASE_URL, SUPABASE_BUCKET, SITE_BASE
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

function getHeader(event, k){ return event.headers?.[k] || event.headers?.[k.toLowerCase()] || event.headers?.[k.toUpperCase()] || null; }
function getUID(event, body){
  const qs = new URLSearchParams(event.queryStringParameters || {});
  return ((getHeader(event,'x-user-id')||'') || (body && (body.uid||'')) || (qs.get('uid')||'')).trim();
}


async function verifyAuth(event, uid){
  // Require a valid Supabase access token and ensure it matches uid.
  const auth = getHeader(event, 'authorization') || getHeader(event, 'Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : '';
  if (!token) return { ok:false, error:'missing_auth' };
  if (!SUPABASE_URL) return { ok:false, error:'missing_supabase_url' };

  try{
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey': SERVICE_KEY || '', 
        'Authorization': `Bearer ${token}`,
      }
    });
    if (!r.ok) return { ok:false, error:'bad_auth', status:r.status };
    const u = await r.json().catch(()=>null);
    const id = u && (u.id || u.user?.id);
    if (!id) return { ok:false, error:'bad_auth_payload' };
    if (String(id) !== String(uid)) return { ok:false, error:'uid_mismatch' };
    return { ok:true, user_id: String(id) };
  }catch(e){
    return { ok:false, error:'auth_exception', details:String(e&&e.message||e) };
  }
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
      body: JSON.stringify({ credits: newCredits })
    });
    if (!r1.ok) return { ok:false, error:'profile_update_failed', status:r1.status };
    return { ok:true, credits:newCredits };
  }catch(e){ return { ok:false, error:'server_exception', details:String(e&&e.message||e) }; }
}

// Extract a taskId from various KIE response shapes
function extractTaskId(data){
  if (!data || typeof data !== 'object') return '';
  const cands = [
    data?.data?.taskId, data?.taskId, data?.result?.taskId,
    data?.data?.task_id, data?.task_id, data?.result?.task_id,
    data?.id
  ].map(v => (v==null?'':String(v))).filter(s => s && s.length>3);
  if (cands.length) return cands[0];
  // deep scan fallback
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

    // Require valid Supabase auth token (prevents calling outside Hansora / uid spoofing)
    const authOk = await verifyAuth(event, uid);
    if (!authOk.ok) return json(401, { ok:false, error: authOk.error, details: authOk });

    const prompt = String(body.prompt || '').trim();
    const aspect_ratio = (body.aspect_ratio ? String(body.aspect_ratio) : '1:1').trim();
    const duration = (body && (body.duration === 10 || String(body.duration) === '10')) ? 10 : 5;

    // URL-only image intake (accept body.image_url OR body.imageUrl)
    const imageUrl = (body && (body.image_url || body.imageUrl)) ? String(body.image_url || body.imageUrl).trim() : '';
    if (!prompt && !imageUrl) {
      return json(400, { ok:false, error:'missing_input', details:'Provide a prompt or an image_url.' });
    }

    // Costs: 5s -> 4⚡, 10s -> 8⚡
    const cost = (duration === 10) ? 8 : 4;
    const run_id = (body.run_id && String(body.run_id).trim()) || `${uid || 'anon'}-${Date.now()}`;

    // Idempotency: if this run_id was already submitted, return the existing task without charging twice.
    let existingTaskId = '';
    let existingCharged = false;
    try{
      if (SUPABASE_URL && SERVICE_KEY){
        const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id,meta,provider`;
        const chk = await fetch(ug + q, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
        const arr = await chk.json().catch(()=>[]);
        if (Array.isArray(arr) && arr.length){
          const meta = arr[0].meta || {};
          existingTaskId = meta.task_id || meta.taskId || '';
          existingCharged = !!meta.charged;
          if (existingTaskId){
            return json(200, { ok:true, submitted:true, taskId: existingTaskId, id: existingTaskId, run_id, row_id: arr[0].id, already_submitted:true, charged: existingCharged });
          }
        }
      }
    }catch(_){}

    // Pre-check credits (no deduction here). Deduction still happens after KIE accepts.
    try{
      if (SUPABASE_URL && SERVICE_KEY){
        const profUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
        const r0 = await fetch(profUrl, { headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
        const arr = await r0.json().catch(()=>[]);
        const cur = (Array.isArray(arr) && arr[0] && (typeof arr[0].credits==='number' || typeof arr[0].credits==='string')) ? Number(arr[0].credits) : 0;
        if (cur < cost) return json(402, { ok:false, error:'not_enough_credits', credits: cur, need: cost });
      }
    }catch(_){}

    // Seed placeholder row
    let row_id = null;
    try {
      if (SUPABASE_URL && SERVICE_KEY && uid){
        const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
        const meta = { source:'kling', run_id, model:'kling', status:'pending' };
        const rIns = await fetch(ug, {
          method: 'POST',
          headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
          body: JSON.stringify({ user_id: uid, provider: (duration === 10 ? 'Kling-10s' : 'Kling-5s'), kind: 'video', prompt, result_url: null, meta }),
        });
        if (rIns.ok){
          const arr = await rIns.json().catch(()=>null);
          if (Array.isArray(arr) && arr[0] && arr[0].id) row_id = arr[0].id;
        }
      }
    } catch {}

    // Choose model per mode
    const image_url = imageUrl || ''; // normalize to snake_case key for KIE
    const model = image_url ? "kling/v2-5-turbo-image-to-video-pro" : "kling/v2-5-turbo-text-to-video-pro";

    // Build KIE createTask payload
    const payload = {
      model,
      input: {
        prompt,
        aspect_ratio,
        duration: (duration === 10 ? '10' : '5'),
        ...(image_url ? { image_url } : {}),
      },
      callBackUrl: `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`,
    };

    const resp = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
            body: JSON.stringify({ meta: { source:'kling', run_id, model, status:'processing', task_id: taskId } }),
          });
        }
      }
    } catch {}

    // Debit credits AFTER task was accepted
    const debit = await debitCredits(uid, cost);
    if (!debit.ok){
      return json(402, { ok:false, error:'not_enough_credits', details: debit });
    }

    
    // Mark charged in meta (best-effort, used for idempotency/traceability)
    try{
      if (SUPABASE_URL && SERVICE_KEY){
        const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id,meta`;
        const chk = await fetch(ug + q, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
        const arr = await chk.json().catch(()=>[]);
        if (Array.isArray(arr) && arr.length){
          const meta0 = arr[0].meta || {};
          const meta = { ...meta0, charged: true, charged_at: new Date().toISOString(), debited: cost };
          await fetch(`${ug}?id=eq.${encodeURIComponent(arr[0].id)}`, {
            method:'PATCH',
            headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type':'application/json', 'Prefer':'return=minimal' },
            body: JSON.stringify({ meta })
          });
        }
      }
    }catch(_){}
return json(201, { ok:true, submitted:true, taskId, id: taskId, run_id, row_id, debited: cost, credits: debit.credits });
  }catch(e){
    return json(500, { ok:false, error:'server_error', details: String(e && e.message || e) });
  }
};
