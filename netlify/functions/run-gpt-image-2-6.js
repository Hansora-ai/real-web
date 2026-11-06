// netlify/functions/run-gpt-image-2-6.js
// GPT Image 2.6 (Sunburst) on reAPI: text to image and image editing (up to 16 reference images).
// reAPI bills one flat price per image ($0.023) for every size, quality and complexity, so the image is always made
// at high quality and normal size; the user chooses the complexity (simple, balanced, complex: how much the model
// plans before drawing). Credits: 0.4 per image (server-side only; the client must NOT debit).
// The row is an image row like GPT Image 2.5's; kie-check follows it on reAPI (meta.provider_api = reapi-image),
// then saves the picture or refunds exactly as for the other image models.
//
// Env: REAPI_API_KEY, REAPI_BASE_URL (optional), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
const reapi = require('../../lib/reapi/client.cjs');

const SUPABASE_URL  = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const MODEL = "gpt-image-2.6-sunburst";
const VERSION_TAG = "gpt_image_2_6_sunburst_reapi_v1";
const COST = 0.4;
const COMPLEXITY = new Set(["low", "medium", "high"]);
// The normal image size for a chosen shape: about 1024x1024 pixels, inside reAPI's limits (655,360 to 8,294,400
// pixels, edges up to 3840, both divisible by 16).
const PIXELS = 1024 * 1024;

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
    const meta = Object.assign({ source:'gpt-image-2-6', provider_api:'reapi-image', run_id, model:MODEL, model_id:'gpt-image-2-6', status:'pending' }, (metaExtra||{}));
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
    if (String(meta0?.status || '').toLowerCase() === 'failed' || meta0?.failed === true) {
      return { ok:true, debit:{ ok:true, credits: null }, idempotent:true, already:false, skipped:true };
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


const RATIOS = new Set(["1:1","3:2","2:3","4:3","3:4","16:9","9:16","21:9","9:21","5:4","4:5","2:1","1:2","3:1","1:3"]);
function normalizeAspectRatio(v) {
  const s = String(v || "auto").trim().toLowerCase().replace(/(\d)[_\-x](\d)/g, "$1:$2");
  return RATIOS.has(s) ? s : "auto";
}
function normalizeComplexity(v) {
  const c = String(v || "medium").trim().toLowerCase();
  return COMPLEXITY.has(c) ? c : "medium";
}// WIDTHxHEIGHT of the normal size for a shape; "auto" lets reAPI keep the shape of the user's photo.
function sizeFor(aspect) {
  if (aspect === "auto") return "auto";
  const [w, h] = aspect.split(":").map(Number);
  const ratio = w / h;
  const pixels = PIXELS;
  let width = Math.sqrt(pixels * ratio), height = Math.sqrt(pixels / ratio);
  const scale = Math.min(1, 3840 / Math.max(width, height));
  width = Math.floor((width * scale) / 16) * 16;
  height = Math.floor((height * scale) / 16) * 16;
  while (width * height < 655360) { width += 16; height = Math.round((width / ratio) / 16) * 16; }
  while (width * height > 8294400) { width -= 16; height = Math.floor((width / ratio) / 16) * 16; }
  // Rounding to 16 can push a 1:3 or 3:1 frame just past reAPI's 3:1 limit: widen the short edge back inside it.
  while (Math.max(width, height) / Math.min(width, height) > 3) {
    if (width < height) width += 16; else height += 16;
  }
  return `${width}x${height}`;
}

async function currentCredits(uid){
  try{
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`, { headers:{ 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
    const arr = r.ok ? await r.json().catch(()=>null) : null;
    return (Array.isArray(arr) && arr[0] && typeof arr[0].credits === 'number') ? arr[0].credits : null;
  }catch(_e){ return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: { ...cors() } };
  if (event.httpMethod !== "POST") return json(405, { ok:false, error:"method_not_allowed", version: VERSION_TAG });
  if (!process.env.REAPI_API_KEY) return json(500, { ok:false, error:"missing_reapi_key", version: VERSION_TAG });

  try{
    const body = JSON.parse(event.body || "{}");
    let uid = getUID(event, body);
    if (!uid || uid === "anon") {
      const b = await getUidFromBearer(event);
      if (b) uid = b;
    }
    if (!uid || uid === "anon") return json(401, { ok:false, error:"sign_in_required", version: VERSION_TAG });

    const run_id = (body.run_id || body.runId || `${uid}-${Date.now()}`).toString();
    const prompt = (body.prompt || "").toString().trim();
    if (!prompt) return json(400, { ok:false, error:"missing_prompt", version: VERSION_TAG });
    const aspect_ratio = normalizeAspectRatio(body.aspect_ratio || body.size || body.aspectRatio);
    const complexity = normalizeComplexity(body.complexity);
    const urls = Array.isArray(body.urls) ? body.urls : (Array.isArray(body.input_urls) ? body.input_urls : (Array.isArray(body.image_urls) ? body.image_urls : []));
    const image_urls = urls.map(u => String(u)).filter(u => /^https:\/\//.test(u)).slice(0, 16);
    const mode = image_urls.length ? "image-to-image" : "text-to-image";
    const cost = COST;
    const provider = "GPT Image 2.6";

    // A retry of the same run never starts or charges twice.
    const existing = await fetchUserGenByRunId(uid, run_id);
    if (existing) return json(200, { ok: existing.meta?.status !== 'failed', id: existing.meta?.task_id || null, run_id, row_id: existing.id, cost: existing.meta?.charged_cost ?? cost, already_submitted: true, version: VERSION_TAG });

    // Check the balance before anything is made, so a picture is never made without its credits.
    const balance = await currentCredits(uid);
    if (balance != null && balance < cost) return json(402, { ok:false, error:"not_enough_credits", credits: balance, need: cost, version: VERSION_TAG });

    const size = sizeFor(aspect_ratio);
    const baseMeta = { aspect_ratio, size, complexity, mode, quality: "high", reference_image_urls: image_urls, refund_amount: 0, charge_cost: cost };
    const seeded = await seedUserGeneration(uid, run_id, prompt, provider, baseMeta);
    const row_id = seeded?.row_id || null;

    const payload = { model: MODEL, prompt, size, quality: "high", complexity, output_format: "png", n: 1, ...(image_urls.length ? { image_urls } : {}) };
    let task;
    try {
      task = await reapi.submitImage(payload);
    } catch (error) {
      const metaFail = { source:'gpt-image-2-6', provider_api:'reapi-image', run_id, model: MODEL, model_id:'gpt-image-2-6', ...baseMeta, status: error.rejected ? "failed" : "create_failed", error: String(error.message || 'create_failed').slice(0, 300), failed: !!error.rejected };
      if (row_id) await patchUserGenerationMetaById(row_id, metaFail);
      const outOfCredits = /insufficient|balance|credit/i.test(String(error.message || '')) || error.code === 'insufficient_credits';
      return json(outOfCredits ? 503 : (error.rejected ? 400 : 502), { ok:false, error: outOfCredits ? "provider_unavailable" : "create_failed", message: outOfCredits ? "GPT Image 2.6 is temporarily unavailable. Nothing was charged." : String(error.message || ''), provider_error: String(error.message || '').slice(0, 200), version: VERSION_TAG });
    }

    const processingMeta = { source:'gpt-image-2-6', provider_api:'reapi-image', run_id, model: MODEL, model_id:'gpt-image-2-6', status:"processing", task_id: task.id, ...baseMeta };
    if (row_id) await patchUserGenerationMetaById(row_id, processingMeta);

    // Charge exactly once per (uid, run_id), after reAPI accepted the job.
    const charged = await chargeOnceForRun(uid, run_id, cost, row_id, processingMeta);
    if (!charged.ok) {
      if (charged.debit && !charged.debit.ok && charged.debit.error === "insufficient_credits") return json(402, { ok:false, error:"not_enough_credits", details: charged.debit, version: VERSION_TAG });
      if (charged.error === "charge_in_progress") return json(409, { ok:false, error:"charge_in_progress", version: VERSION_TAG });
      return json(500, { ok:false, error:"charge_failed", details: charged.debit || charged.error || charged, version: VERSION_TAG });
    }

    return json(201, { ok:true, id: task.id, taskId: task.id, run_id, row_id, cost, model_cost: cost, checker: 'kie-check', already_charged: !!charged.already, version: VERSION_TAG });
  }catch(e){
    return json(500, { ok:false, error:"exception", message:String(e), version: VERSION_TAG });
  }
};

exports._sizeFor = sizeFor;
