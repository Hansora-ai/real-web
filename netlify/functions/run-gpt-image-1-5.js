// netlify/functions/run-gpt-image-1.js
// GPT Image 1.5 launcher via KIE createTask with server-side credit debit (idempotent per run_id).
// - Text→Image: model gpt-image/1.5-text-to-image
// - Image→Image: model gpt-image/1.5-image-to-image (uses input_urls)
// Credits: 2 per job (server-side only; client must NOT debit)
//
// Env: KIE_CREATE_URL (optional), KIE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_BASE (optional)
//
const CREATE_URL = process.env.KIE_CREATE_URL || "https://api.kie.ai/api/v1/jobs/createTask";
const API_KEY    = process.env.KIE_API_KEY || "";

const SUPABASE_URL  = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const SITE_BASE   = (process.env.SITE_BASE || "https://hansora.co").replace(/\/+$/, "");
const CALLBACK_URL = `${SITE_BASE}/.netlify/functions/kie-check`;

const VERSION_TAG  = "gpt_image_15_kie_v1";

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

async function getUidFromBearer(event){
  const auth = (getHeader(event,'authorization')||'').trim();
  if (!auth) return '';
  const m = auth.match(/Bearer\s+(.+)/i);
  if (!m) return '';
  const token = (m[1]||'').trim();
  if (!token || !SUPABASE_URL || !SERVICE_KEY) return '';
  try{
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) return '';
    const u = await r.json().catch(()=>null);
    return (u && (u.id || u.user?.id) ? String(u.id || u.user.id) : '').trim();
  }catch(_e){ return ''; }
}

function normalizeAspectRatio(v) {
  if (!v) return "1:1";
  const s = String(v).trim().toLowerCase();
  const direct = new Set(["1:1","2:3","3:2","3:4","4:3","4:5","5:4","9:16","16:9"]);
  if (direct.has(s)) return s;
  const coerced = s.replace(/(\d)[_\-:](\d)/g, "$1:$2");
  if (direct.has(coerced)) return coerced;
  return "1:1";
}

async function fetchUserGenByRunId(uid, run_id){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid || !run_id) return null;
  try{
    const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
    const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id,meta,provider,kind,prompt,result_url,created_at`;
    const r = await fetch(ug + q, { headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
    if (!r.ok) return null;
    const arr = await r.json().catch(()=>null);
    return (Array.isArray(arr) && arr[0]) ? arr[0] : null;
  }catch(_e){ return null; }
}

async function seedUserGeneration(uid, run_id, prompt, provider, metaExtra){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return { row_id:null };
  try{
    const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
    const meta = Object.assign({ source:'gpt-image-1.5', run_id, model:'gpt-image-1.5', status:'pending' }, (metaExtra||{}));
    const rIns = await fetch(ug, {
      method: 'POST',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({ user_id: uid, provider, kind: 'image', prompt, result_url: null, meta }),
    });
    if (!rIns.ok) return { row_id:null };
    const arr = await rIns.json().catch(()=>null);
    return { row_id: (Array.isArray(arr) && arr[0] && arr[0].id) ? arr[0].id : null };
  }catch(_e){ return { row_id:null }; }
}

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

async function patchUserGenerationMetaById(id, meta){
  if (!SUPABASE_URL || !SERVICE_KEY || !id) return false;
  try{
    const ug = `${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(id)}`;
    const r = await fetch(ug, {
      method:'PATCH',
      headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type':'application/json', 'Prefer':'return=minimal' },
      body: JSON.stringify({ meta })
    });
    return !!r.ok;
  }catch(_e){ return false; }
}

async function chargeOnceForRun(uid, run_id, cost, row_id, baseMeta){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid || !run_id) {
    const debit = await debitCredits(uid, cost);
    return { ok: !!debit.ok, debit, idempotent: false, already: false };
  }

  try{
    const existing = await fetchUserGenByRunId(uid, run_id);
    const meta0 = existing?.meta || baseMeta || {};
    if (String(meta0?.charged || '').toLowerCase() === 'true'){
      return { ok:true, debit:{ ok:true, credits: null }, idempotent:true, already:true };
    }

    const claim = `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const mergedForClaim = { ...(meta0||{}), ...(baseMeta||{}), charge_claim: claim };

    const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
    const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&meta->>charged=is.null&meta->>charge_claim=is.null&select=id`;
    const rClaim = await fetch(ug + q, {
      method: 'PATCH',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type':'application/json', 'Prefer':'return=representation' },
      body: JSON.stringify({ meta: mergedForClaim }),
    });

    const claimedArr = await rClaim.json().catch(()=>[]);
    const claimed = (rClaim.ok && Array.isArray(claimedArr) && claimedArr.length > 0);

    if (!claimed){
      const after = await fetchUserGenByRunId(uid, run_id);
      const metaAfter = after?.meta || {};
      if (String(metaAfter?.charged || '').toLowerCase() === 'true'){
        return { ok:true, debit:{ ok:true, credits: null }, idempotent:true, already:true };
      }
      return { ok:false, error:'charge_in_progress', idempotent:true, already:false };
    }

    const debit = await debitCredits(uid, cost);
    if (!debit.ok){
      const rollbackMeta = { ...(mergedForClaim||{}) };
      delete rollbackMeta.charge_claim;
      await patchUserGenerationMetaById(row_id || (Array.isArray(claimedArr)&&claimedArr[0]?.id) || (existing?.id), rollbackMeta);
      return { ok:false, debit, idempotent:true, already:false };
    }

    const chargedMeta = { ...(mergedForClaim||{}), charged:'true', charged_cost: cost, charged_at: (new Date()).toISOString(), refund_amount: cost };
    await patchUserGenerationMetaById(row_id || (Array.isArray(claimedArr)&&claimedArr[0]?.id) || (existing?.id), chargedMeta);

    return { ok:true, debit, idempotent:true, already:false };
  }catch(e){
    const debit = await debitCredits(uid, cost);
    return { ok: !!debit.ok, debit, idempotent:false, already:false, error: String(e && e.message || e) };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: { ...cors() } };
  if (event.httpMethod !== "POST") return json(405, { ok:false, error:"method_not_allowed", version: VERSION_TAG });
  if (!API_KEY) return json(500, { ok:false, error:"missing_kie_key", version: VERSION_TAG });

  try{
    const body = JSON.parse(event.body || "{}");

    // Identify user (X-USER-ID OR uid) + fallback to bearer token
    let uid = getUID(event, body);
    if (!uid || uid === "anon") {
      const b = await getUidFromBearer(event);
      if (b) uid = b;
    }
    if (!uid) uid = "anon";

    const run_id = (body.run_id || body.runId || `${uid}-${Date.now()}`).toString();

    const prompt = (body.prompt || "").toString();
    const aspect_ratio = normalizeAspectRatio(body.aspect_ratio || body.size || body.aspectRatio);

    // Optional images from client (already-uploaded URLs)
    const urls = Array.isArray(body.urls) ? body.urls : (Array.isArray(body.input_urls) ? body.input_urls : []);
    const input_urls = urls.map(u => String(u)).filter(Boolean);

    const isImageToImage = input_urls.length > 0;
    const model = isImageToImage ? "gpt-image/1.5-image-to-image" : "gpt-image/1.5-text-to-image";

    const cost = 1.5;

    // Provider label: keep stable, include mode
    const provider = isImageToImage ? "GPT-Image-1.5" : "GPT-Image-1.5";

    // Seed user_generations row (pending)
    const seeded = await seedUserGeneration(uid, run_id, prompt, provider, { aspect_ratio, mode: isImageToImage ? "image-to-image" : "text-to-image", refund_amount: cost });
    const row_id = seeded?.row_id || null;

    // callback must include uid & run_id
    const cb = `${CALLBACK_URL}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    // Build KIE payload (per docs: model, callBackUrl, input)
    const input = {
      prompt,
      aspect_ratio,
      quality: "high"
    };
    if (isImageToImage) input.input_urls = input_urls;

    const payload = { model, callBackUrl: cb, input };

    const create = await fetch(CREATE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await create.text();
    let js; try { js = JSON.parse(text); } catch { js = { raw: text }; }

    const id = js?.data?.taskId || js?.taskId || js?.data?.id || js?.id || null;

    if (!create.ok || !id) {
      // best-effort mark failure in meta
      try {
        if (SUPABASE_URL && SERVICE_KEY && row_id) {
          await fetch(`${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(row_id)}`, {
            method: "PATCH",
            headers: {
              "apikey": SERVICE_KEY,
              "Authorization": `Bearer ${SERVICE_KEY}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal"
            },
            body: JSON.stringify({ meta: { source:"gpt-image-1.5", run_id, model, status:"create_failed", task_id: id, raw: js, refund_amount: cost } })
          });
        }
      } catch {}
      return json(create.status || 500, { ok:false, error:"create_failed", status:create.status, response: js, version: VERSION_TAG });
    }

    // best-effort update meta processing + task id
    try {
      if (SUPABASE_URL && SERVICE_KEY && row_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(row_id)}`, {
          method: "PATCH",
          headers: {
            "apikey": SERVICE_KEY,
            "Authorization": `Bearer ${SERVICE_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({ meta: { source:"gpt-image-1.5", run_id, model, status:"processing", task_id: id, aspect_ratio, mode: isImageToImage ? "image-to-image" : "text-to-image", refund_amount: cost } })
        });
      }
    } catch {}

    // Debit credits AFTER provider accepted and exactly once per (uid, run_id)
    const baseMeta = { source:"gpt-image-1.5", run_id, model, status:"processing", task_id: id, aspect_ratio, mode: isImageToImage ? "image-to-image" : "text-to-image", refund_amount: cost };
    const charged = await chargeOnceForRun(uid, run_id, cost, row_id, baseMeta);

    if (!charged.ok) {
      if (charged.debit && !charged.debit.ok && charged.debit.error === "insufficient_credits") {
        return json(402, { ok:false, error:"not_enough_credits", details: charged.debit, version: VERSION_TAG });
      }
      if (charged.error === "charge_in_progress") {
        return json(409, { ok:false, error:"charge_in_progress", version: VERSION_TAG });
      }
      return json(500, { ok:false, error:"charge_failed", details: charged.debit || charged.error || charged, version: VERSION_TAG });
    }

    return json(201, {
      ok:true,
      id,
      run_id,
      row_id,
      cost,
      already_charged: !!charged.already,
      version: VERSION_TAG,
      used_callback: cb
    });

  }catch(e){
    return json(500, { ok:false, error:"exception", message:String(e), version: VERSION_TAG });
  }
};
