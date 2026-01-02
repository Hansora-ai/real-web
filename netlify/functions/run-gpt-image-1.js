// netlify/functions/run-gpt-image-1.js
// KIE AI launcher for GPT-Image 1.5 (text-to-image + image-to-image)
// - Charges 2 credits server-side (idempotent per run_id), client must NOT debit.
// - Uses KIE createTask endpoint and routes completion via /.netlify/functions/kie-callback
//
// Env: KIE_CREATE_URL (optional), KIE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_BASE (optional)

const CREATE_URL = process.env.KIE_CREATE_URL || "https://api.kie.ai/api/v1/jobs/createTask";
const API_KEY    = process.env.KIE_API_KEY || "";

const SUPABASE_URL  = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const SITE_BASE   = (process.env.SITE_BASE || "https://webhansora.netlify.app").replace(/\/+$/, "");
const CALLBACK_URL = `${SITE_BASE}/.netlify/functions/kie-callback`;

const VERSION_TAG = "gpt_image_15_kie_v1";

function cors(){ return {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};}
const json = (c,o)=>({ statusCode:c, headers:{ "Content-Type":"application/json", ...cors() }, body:JSON.stringify(o) });

function getHeader(event, k){ return event.headers?.[k] || event.headers?.[k.toLowerCase()] || event.headers?.[k.toUpperCase()] || null; }
function getUID(event, body){
  const qs = new URLSearchParams(event.queryStringParameters || {});
  return ((getHeader(event,"x-user-id")||"") || (body && (body.uid||"")) || (qs.get("uid")||"")).trim();
}

async function getUidFromBearer(event){
  const auth = (getHeader(event,"authorization")||"").trim();
  if (!auth) return "";
  const m = auth.match(/Bearer\s+(.+)/i);
  if (!m) return "";
  const token = (m[1]||"").trim();
  if (!token || !SUPABASE_URL || !SERVICE_KEY) return "";
  try{
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${token}` }
    });
    if (!r.ok) return "";
    const u = await r.json().catch(()=>null);
    return (u && (u.id || u.user?.id) ? String(u.id || u.user.id) : "").trim();
  }catch(_e){ return ""; }
}

function normalizeAspectRatio(v) {
  if (!v) return "1:1";
  const s = String(v).trim().toLowerCase();

  const direct = new Set([
    "1:1","2:3","3:2","3:4","4:3","4:5","5:4","9:16","16:9","21:9"
  ]);
  if (direct.has(s)) return s;

  // Map named tokens used by site UI
  if (s === "square") return "1:1";
  if (s === "portrait_3_4") return "3:4";
  if (s === "portrait_9_16") return "9:16";
  if (s === "landscape_4_3") return "4:3";
  if (s === "landscape_16_9") return "16:9";

  // Coerce variants like "16_9", "16-9" -> "16:9"
  const coerced = s.replace(/(\d)[_\-:](\d)/g, "$1:$2");
  if (direct.has(coerced)) return coerced;

  return "1:1";
}

async function fetchUserGenByRunId(uid, run_id){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid || !run_id) return null;
  try{
    const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
    const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id,meta,provider,kind,prompt,result_url,created_at`;
    const r = await fetch(ug + q, { headers:{ "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` } });
    if (!r.ok) return null;
    const arr = await r.json().catch(()=>null);
    return (Array.isArray(arr) && arr[0]) ? arr[0] : null;
  }catch(_e){ return null; }
}

async function seedUserGeneration(uid, run_id, prompt, metaExtra){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return { row_id:null };
  try{
    const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
    const meta = Object.assign({ source:"gpt-image-1", run_id, model:"gpt-image-1", status:"pending" }, (metaExtra||{}));
    const rIns = await fetch(ug, {
      method: "POST",
      headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type":"application/json", "Prefer":"return=representation" },
      body: JSON.stringify({ user_id: uid, provider: "GPT-Image-1", kind: "image", prompt, result_url: null, meta }),
    });
    if (!rIns.ok) return { row_id:null };
    const arr = await rIns.json().catch(()=>null);
    return { row_id: (Array.isArray(arr) && arr[0] && arr[0].id) ? arr[0].id : null };
  }catch(_e){ return { row_id:null }; }
}

async function debitCredits(uid, cost){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return { ok:false, error:"missing_env_or_uid" };
  try{
    const profUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
    const r0 = await fetch(profUrl, { headers:{ "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` } });
    if (!r0.ok) return { ok:false, error:"profile_fetch_failed", status:r0.status };
    const arr = await r0.json().catch(()=>null);
    const cur = (Array.isArray(arr) && arr[0] && typeof arr[0].credits === "number") ? arr[0].credits : 0;
    if (cur < cost) return { ok:false, error:"insufficient_credits", credits: cur };
    const newCredits = Math.max(0, cur - cost);
    const updUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`;
    const r1 = await fetch(updUrl, {
      method:"PATCH",
      headers:{ "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type":"application/json", "Prefer":"return=representation" },
      body: JSON.stringify({ credits: newCredits })
    });
    if (!r1.ok) return { ok:false, error:"profile_update_failed", status:r1.status };
    return { ok:true, credits:newCredits };
  }catch(e){ return { ok:false, error:"server_exception", details:String(e && e.message || e) }; }
}

async function patchUserGenerationMetaById(id, meta){
  if (!SUPABASE_URL || !SERVICE_KEY || !id) return false;
  try{
    const ug = `${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(id)}`;
    const r = await fetch(ug, {
      method:"PATCH",
      headers:{ "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type":"application/json", "Prefer":"return=minimal" },
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
    if (String(meta0?.charged || "").toLowerCase() === "true"){
      return { ok:true, debit:{ ok:true, credits: null }, idempotent:true, already:true };
    }

    const claim = `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const mergedForClaim = { ...(meta0||{}), ...(baseMeta||{}), charge_claim: claim };

    const ug = `${SUPABASE_URL}/rest/v1/user_generations`;
    const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&meta->>charged=is.null&meta->>charge_claim=is.null&select=id`;
    const rClaim = await fetch(ug + q, {
      method:"PATCH",
      headers:{ "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type":"application/json", "Prefer":"return=representation" },
      body: JSON.stringify({ meta: mergedForClaim }),
    });

    const claimedArr = await rClaim.json().catch(()=>[]);
    const claimed = (rClaim.ok && Array.isArray(claimedArr) && claimedArr.length > 0);

    if (!claimed){
      const after = await fetchUserGenByRunId(uid, run_id);
      const metaAfter = after?.meta || {};
      if (String(metaAfter?.charged || "").toLowerCase() === "true"){
        return { ok:true, debit:{ ok:true, credits: null }, idempotent:true, already:true };
      }
      return { ok:false, error:"charge_in_progress", idempotent:true, already:false };
    }

    const debit = await debitCredits(uid, cost);
    if (!debit.ok){
      const rollbackMeta = { ...(mergedForClaim||{}) };
      delete rollbackMeta.charge_claim;
      await patchUserGenerationMetaById(row_id || (Array.isArray(claimedArr)&&claimedArr[0]?.id) || (existing?.id), rollbackMeta);
      return { ok:false, debit, idempotent:true, already:false };
    }

    const chargedMeta = { ...(mergedForClaim||{}), charged:"true", charged_cost: cost, charged_at: (new Date()).toISOString() };
    await patchUserGenerationMetaById(row_id || (Array.isArray(claimedArr)&&claimedArr[0]?.id) || (existing?.id), chargedMeta);

    return { ok:true, debit, idempotent:true, already:false };
  }catch(e){
    const debit = await debitCredits(uid, cost);
    return { ok: !!debit.ok, debit, idempotent:false, already:false, error:String(e && e.message || e) };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: { ...cors() } };
  if (event.httpMethod !== "POST") return json(405, { ok:false, submitted:false, error:"method_not_allowed", version: VERSION_TAG });

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
    const aspect_ratio = normalizeAspectRatio(body.size || body.aspect_ratio || body.aspectRatio);

    const rawUrls = Array.isArray(body.urls) ? body.urls : (Array.isArray(body.input_urls) ? body.input_urls : (Array.isArray(body.image_urls) ? body.image_urls : []));
    const input_urls = rawUrls.map(u => encodeURI(String(u)));

    const isImg2Img = Array.isArray(input_urls) && input_urls.length > 0;
    const model = isImg2Img ? "gpt-image/1.5-image-to-image" : "gpt-image/1.5-text-to-image";

    const cost = 2;

    // Seed user_generations row (pending)
    const seeded = await seedUserGeneration(uid, run_id, prompt, { aspect_ratio, model });
    const row_id = seeded?.row_id || null;

    // callback must include uid & run_id
    const cb = `${CALLBACK_URL}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    const input = {
      prompt,
      aspect_ratio,
      quality: "high",
    };
    if (isImg2Img) {
      // KIE docs: image-to-image uses input_urls (array of image URLs)
      input.input_urls = input_urls;
    }

    const payload = {
      model,
      input,

      // callbacks (send every known variant field name used by KIE market interfaces)
      webhook_url: cb,
      webhookUrl: cb,
      callbackUrl: cb,
      callBackUrl: cb,
      notify_url: cb,

      meta:     { uid, run_id, version: VERSION_TAG, cb, row_id },
      metadata: { uid, run_id, version: VERSION_TAG, cb, row_id }
    };

    const create = await fetch(CREATE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await create.text();
    let js; try { js = JSON.parse(text); } catch { js = { raw: text }; }

    const taskId = js.taskId || js.id || js.data?.taskId || js.data?.id || null;

    if (!create.ok) {
      try{
        if (SUPABASE_URL && SERVICE_KEY && row_id) {
          await patchUserGenerationMetaById(row_id, { source:"gpt-image-1", run_id, model, status:"create_failed", task_id: taskId, response: js });
        }
      }catch(_e){}
      return json(create.status || 500, { ok:false, submitted:false, error:"create_failed", status:create.status, response: js, version: VERSION_TAG });
    }

    // best-effort update meta processing + task id
    try{
      if (row_id) {
        await patchUserGenerationMetaById(row_id, { source:"gpt-image-1", run_id, model, status:"processing", task_id: taskId, aspect_ratio });
      }
    }catch(_e){}

    // Debit credits AFTER provider accepted and exactly once per (uid, run_id)
    const baseMeta = { source:"gpt-image-1", run_id, model, status:"processing", task_id: taskId, aspect_ratio };
    const charged = await chargeOnceForRun(uid, run_id, cost, row_id, baseMeta);

    if (!charged.ok) {
      if (charged.debit && !charged.debit.ok && (charged.debit.error === "insufficient_credits" || charged.debit.error === "insufficient")) {
        return json(402, { ok:false, submitted:false, error:"not_enough_credits", details: charged.debit, version: VERSION_TAG });
      }
      if (charged.error === "charge_in_progress") {
        return json(409, { ok:false, submitted:false, error:"charge_in_progress", version: VERSION_TAG });
      }
      return json(500, { ok:false, submitted:false, error:"charge_failed", details: charged.debit || charged.error || charged, version: VERSION_TAG });
    }

    return json(201, {
      ok:true,
      submitted:true,
      taskId,
      run_id,
      cost,
      already_charged: !!charged.already,
      version: VERSION_TAG,
      used_callback: cb
    });

  }catch(e){
    return json(500, { ok:false, submitted:false, error:"exception", message:String(e && e.message || e), version: VERSION_TAG });
  }
};
