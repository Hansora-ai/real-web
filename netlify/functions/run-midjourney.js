// netlify/functions/run-midimage.js
// Create MidJourney job via KIE and immediately return "submitted".
// Logic mirrors run-nano-banana: callback-based, server placeholder insert, no server debit.

const KIE_URL = "https://api.kie.ai/api/v1/mj/generate";
const API_KEY = process.env.KIE_API_KEY;

if (!API_KEY) console.warn("[run-midimage] Missing KIE_API_KEY env!");
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UG_URL = (process.env.SUPABASE_URL ? process.env.SUPABASE_URL + '/rest/v1/user_generations' : undefined);

// Same callback as Nano Banana
const CALLBACK_URL = "https://webhansora.netlify.app/.netlify/functions/kie-callback";
const VERSION_TAG  = "midimage_fn_v1";

// Credits cost (must match UI)
const COST_CREDITS = 1.0;

// Supabase REST endpoints
const PROFILES_URL = (process.env.SUPABASE_URL ? process.env.SUPABASE_URL + '/rest/v1/profiles' : undefined);

// ---- Credits helpers (mirrors Kling 2.6 pattern: server-side debit + run_id idempotency via user_generations.meta) ----
async function fetchProfileCredits(uid){
  if (!PROFILES_URL || !SERVICE_KEY) return { ok:false, credits:null, status:0, text:'missing_supabase' };
  const url = `${PROFILES_URL}?user_id=eq.${encodeURIComponent(uid)}&select=credits&limit=1`;
  const r = await fetch(url, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Accept': 'application/json' } });
  const t = await r.text();
  let j = null; try{ j = JSON.parse(t); }catch(_e){}
  const credits = Array.isArray(j) && j[0] && typeof j[0].credits !== 'undefined' ? Number(j[0].credits) : null;
  return { ok: r.ok, credits, status: r.status, text: t };
}

async function setProfileCredits(uid, newCredits){
  if (!PROFILES_URL || !SERVICE_KEY) return { ok:false, status:0, text:'missing_supabase' };
  const url = `${PROFILES_URL}?user_id=eq.${encodeURIComponent(uid)}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type':'application/json', 'Prefer':'return=representation' },
    body: JSON.stringify({ credits: newCredits })
  });
  const t = await r.text();
  let j = null; try{ j = JSON.parse(t); }catch(_e){}
  const credits = Array.isArray(j) && j[0] && typeof j[0].credits !== 'undefined' ? Number(j[0].credits) : null;
  return { ok: r.ok, credits, status: r.status, text: t };
}

async function debitCredits(uid, cost){
  const cur = await fetchProfileCredits(uid);
  if (!cur.ok || typeof cur.credits !== 'number') return { ok:false, credits: cur.credits, error:'read_failed', detail: cur.text };
  const after = Number((cur.credits - cost).toFixed(1));
  if (after < 0) return { ok:false, credits: cur.credits, error:'insufficient_credits' };
  const upd = await setProfileCredits(uid, after);
  return { ok: !!upd.ok, credits: upd.credits ?? after, error: upd.ok ? null : 'update_failed', detail: upd.text };
}

async function fetchUserGenByRunId(uid, run_id){
  if (!UG_URL || !SERVICE_KEY) return null;
  const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id,meta&order=created_at.desc&limit=1`;
  const r = await fetch(UG_URL + q, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Accept':'application/json' }
  });
  const arr = await r.json().catch(()=>[]);
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

async function patchUserGenerationMetaById(id, meta){
  if (!UG_URL || !SERVICE_KEY || !id) return false;
  try{
    const q = `?id=eq.${encodeURIComponent(id)}`;
    const r = await fetch(UG_URL + q, {
      method: 'PATCH',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type':'application/json', 'Prefer':'return=minimal' },
      body: JSON.stringify({ meta }),
    });
    return !!r.ok;
  }catch(_e){ return false; }
}

// Exactly-once charging per (uid, run_id) via meta charge_claim + charged
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
      await patchUserGenerationMetaById(row_id || (claimedArr[0]?.id) || (existing?.id), rollbackMeta);
      return { ok:false, debit, idempotent:true, already:false };
    }

    const chargedMeta = { ...(mergedForClaim||{}), charged:'true', charged_cost: cost, charged_at: (new Date()).toISOString() };
    await patchUserGenerationMetaById(row_id || (claimedArr[0]?.id) || (existing?.id), chargedMeta);

    return { ok:true, debit, idempotent:true, already:false };
  }catch(e){
    const debit = await debitCredits(uid, cost);
    return { ok: !!debit.ok, debit, idempotent:false, already:false, error: String(e && e.message || e) };
  }
}


exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Use POST" };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    const image_url = String(body.image_url || "").trim();
    const prompt    = body.prompt || "";
    const size = body.size || 'auto';

// Prefer explicit aspect ratio if provided (e.g., "9:16", "1:1", etc.)
const explicitAR = body.aspect_ratio || body.aspectRatio || body.aspect || body.ar || null;

function mapSizeToAR(s){
  switch(String(s||'').toLowerCase()){
    case 'square': return '1:1';
    case 'portrait_3_4': return '3:4';
    case 'portrait_9_16': return '9:16';
    case 'landscape_4_3': return '4:3';
    case 'landscape_16_9': return '16:9';
    case 'auto': default: return '2:3'; // default per your note
  }
}

// If explicitAR looks like a ratio, use it; otherwise map size token -> ratio.
const aspect = normalizeAspect((explicitAR && /\d+\s*:\s*\d+/.test(String(explicitAR))) ? explicitAR : mapSizeToAR(size));
    const speed     = "fast"; // per user request
    const version   = body.version ?? 7;
    const stylization = body.stylization ?? 100;
    const weirdness = body.weirdness ?? 0;
    const watermark = body.watermark ?? ""; // empty by default
    const paramJson = body.paramJson || JSON.stringify({ numberOfImages: 1 });

    // Identify the user/run to bind result
    const uid    = event.headers["x-user-id"] || event.headers["X-USER-ID"] || "anon";
    const run_id = body.run_id || `${uid}-${Date.now()}`;

    // include uid & run_id in the callback URL
    const cb = `${CALLBACK_URL}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    // Choose task type
    const taskType = image_url ? "mj_img2img" : "mj_txt2img";

    // Build KIE payload
    const payload = {
      taskType,
      prompt,
      speed,
      fileUrl: image_url || "",
      aspectRatio: aspect,
      version,
      stylization,
      weirdness,
      waterMark: watermark,
      paramJson,
      callBackUrl: cb, // existing field retained
      // pass meta as well in case KIE forwards it
      meta: { uid, run_id, provider: "MidJourney", version: VERSION_TAG }
    };

    // ****** Add all callback/webhook aliases + metadata (to mirror Nano Banana) ******
    payload.callbackUrl = cb;   // alias (lower camel)
    payload.webhook_url = cb;   // alias (snake)
    payload.webhookUrl  = cb;   // alias (camel)
    payload.notify_url  = cb;   // alias (notify)
    payload.metadata    = { ...(payload.metadata||{}), uid, run_id, cb, version: VERSION_TAG };
    // ********************************************************************************

    // Create the job
    const create = await fetch(KIE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type":  "application/json",
        "Accept":        "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await create.text();
    let js; try { js = JSON.parse(text); } catch { js = { raw: text }; }

    // Best-effort taskId extraction
    const taskId = js.taskId || js.id || js.data?.taskId || js.data?.id || null;

    // --- server-side placeholder so Usage shows even if client closes ---
    try {
      if (UG_URL && SERVICE_KEY && uid && uid !== 'anon') {
        const bodyPlaceholder = {
          user_id: uid,
          provider: 'MidJourney',
          kind: 'image',
          prompt,
          result_url: null,
          meta: { run_id, task_id: taskId, aspectRatio: aspect, status: 'processing' }
        };
        await fetch(UG_URL, {
          method: 'POST',
          headers: {
            'apikey': SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(bodyPlaceholder)
        });
      }
    } catch (e) {
      console.warn('[midimage] placeholder insert failed', e);
    }

    // NO client-side debit; server handles charging


    // Server-side debit (Service Role) + run_id idempotency (Kling 2.6 pattern)
    let charge = null;
    try{
      if (uid && uid !== 'anon') {
        const baseMeta = { source:'midjourney', run_id, status:'processing', task_id: taskId };
        charge = await chargeOnceForRun(uid, run_id, COST_CREDITS, null, baseMeta);
        if (!charge.ok){
          if (charge.debit && !charge.debit.ok && (charge.debit.error === 'insufficient_credits' || charge.debit.error === 'insufficient')){
            return json(402, { ok:false, error:'not_enough_credits', details: charge.debit, version: VERSION_TAG });
          }
          if (charge.error === 'charge_in_progress'){
            return json(409, { ok:false, error:'charge_in_progress', version: VERSION_TAG });
          }
          return json(500, { ok:false, error:'charge_failed', details: charge, version: VERSION_TAG });
        }
      }
    }catch(e){
      return json(500, { ok:false, error:'charge_exception', message: String(e && e.message || e), version: VERSION_TAG });
    }


    return ok({
      submitted: true,
      taskId,
      run_id,
      credits_after: charge?.debit?.credits ?? null,
      charged: charge?.ok ?? null,
      already_charged: charge?.already ?? null,
      version: VERSION_TAG,
      used_callback: cb
    });

  } catch (e) {
    return ok({ submitted: true, note: "exception", message: String(e), version: VERSION_TAG });
  }
};

function normalizeAspect(v) {
  if (!v) return "2:3";
  const s = String(v).trim().toLowerCase();
  // Accept many MJ ratios, default to 2:3 if unfamiliar
  const allowed = new Set(["2:3","3:2","1:1","3:4","4:3","9:16","16:9","5:6","6:5","4:5","5:4","7:4","4:7"]);
  if (allowed.has(s)) return s;
  const coerced = s.replace(/(\d)[_\-:](\d)/g, "$1:$2");
  return allowed.has(coerced) ? coerced : "2:3";
}


function json(statusCode, payload){
  return {
    statusCode,
    headers: { ...cors(), "X-MIDIMAGE-Version": VERSION_TAG },
    body: JSON.stringify(payload)
  };
}

function ok(json) {
  return {
    statusCode: 200,
    headers: { ...cors(), "X-MIDIMAGE-Version": VERSION_TAG },
    body: JSON.stringify(json)
  };
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-USER-ID, x-user-id"
  };
}
