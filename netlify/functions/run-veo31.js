// netlify/functions/run-veo31.js
// Submit a KIE Veo 3 job and seed a placeholder row in user_generations.
// Mirrors your working Runway flow with minimal changes:
// - Endpoint: https://api.kie.ai/api/v1/veo/generate
// - model: "veo3_lite", "veo3_fast" (default), or "veo3"
// - imageUrls: [<uploaded-url>] when image is provided

const KIE_URL = "https://api.kie.ai/api/v1/veo/generate";
const API_KEY = process.env.KIE_API_KEY;

// Supabase (service role for server-side insert/patch)
const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

// Your site base for callback (same style as Runway)
const SITE_BASE = (process.env.SITE_BASE || "https://hansora.co").replace(/\/+$/,'');
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/kie-check`;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return err(405, "Use POST");

  try {
    const headers = lowerKeys(event.headers || {});
    const isJson = (headers["content-type"] || "").includes("application/json");
    const body = isJson ? safeJson(event.body) : {};

    const uid = (body.uid || body.user_id || "").toString().trim();
    if (!uid) return ok({ submitted:false, error:"missing_user_id" });

    const promptRaw = (body.prompt || "").toString();
    const prompt = promptRaw.trim();
    if (!prompt && !body.fileUrl && !body.imageUrl && !body.imageUrls) {
      return ok({ submitted:false, error:"empty_prompt" });
    }

    const model = normalizeModel(body.model || "veo3_fast");
    const aspectRatio = normalizeAspect(body.aspectRatio || "16:9");
    const quality = normalizeQuality(body.quality || body.resolution || "1080p", model);

    // Accept a single URL, convert to array as imageUrls
    const imageUrl = normalizeUrl(body.imageUrl || body.fileUrl || "");
    const imageUrls = imageUrl ? [ imageUrl ] : [];

    const clientRunId = (body.run_id || "").toString().trim();
    const run_id = clientRunId || `${uid}-${Date.now()}`;
    const cost = veo31Cost(model, quality);
    const queueAuthorized = process.env.HANSORA_QUEUE_SECRET
      && headers["x-hansora-queue-secret"] === process.env.HANSORA_QUEUE_SECRET;
    const unlimitedBySubscription = String(body.billing_mode || "").toLowerCase() === "unlimited"
      && queueAuthorized && await hasUnlimitedVeo31Subscription(uid, model, quality);
    const chargeCost = unlimitedBySubscription ? 0 : cost;

    // Idempotency: if this run_id already has a task_id, return it and avoid double-debit.
    const existing = await findUserGeneration(uid, run_id);
    if (existing && existing.meta && (existing.meta.task_id || existing.meta.taskId)) {
      if (!isCharged(existing.meta) && chargeCost > 0) {
        const chargeExisting = await chargeOnceForRun(uid, run_id, chargeCost, existing.id, { ...existing.meta, refund_amount: chargeCost });
        if (!chargeExisting.ok) return ok({ submitted:false, error: chargeExisting.error || "charge_failed", details: chargeExisting });
      }
      return ok({ ok:true, submitted:true, run_id, taskId: existing.meta.task_id || existing.meta.taskId, reused:true, already_submitted:true });
    }

    // Pre-check credits before creating provider job. Debit still happens only after KIE returns taskId.
    const currentCredits = await getCredits(uid);
    if (chargeCost > 0 && currentCredits < chargeCost) {
      return ok({ submitted:false, error:"insufficient_credits", need: chargeCost, have: currentCredits });
    }

    const callBackUrl = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    // Seed placeholder row in user_generations
    if (UG_URL && SERVICE_KEY) {
      try {
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
        const chk = await fetch(UG_URL + q, { headers: sb() });
        const arr = await chk.json().catch(()=>[]);
        const idToPatch = Array.isArray(arr) && arr.length ? arr[0].id : null;

        const payload = {
          user_id: uid,
          provider: veo31ProviderName(model),
          kind: "video",
          prompt,
          result_url: null,
          meta: { run_id, status: "pending", aspect_ratio: aspectRatio, quality, duration: 8, model, charge_cost: chargeCost, refund_amount: chargeCost, subscription_unlimited: unlimitedBySubscription }
        };

        if (idToPatch) {
          await fetch(`${UG_URL}?id=eq.${encodeURIComponent(idToPatch)}`, {
            method: "PATCH",
            headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({ result_url: null, meta: payload.meta })
          });
        } else {
          await fetch(UG_URL, {
            method: "POST",
            headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify(payload)
          });
        }
      } catch (e) {
        console.warn("[run-veo3] placeholder write failed:", e);
      }
    }

    
// Build KIE payload (spec-only fields)
// (Do NOT spread the entire body to KIE; avoid non-spec keys)
const kiePayload = {
  prompt,
  model,
  aspect_ratio: aspectRatio,
  resolution: kieResolutionValue(quality),
  callBackUrl
};
// Veo 3.1 generationType handling
const firstFrameUrl = normalizeUrl(body.firstFrameUrl || "");
const lastFrameUrl  = normalizeUrl(body.lastFrameUrl  || "");
if (firstFrameUrl && lastFrameUrl){
  kiePayload.generationType = "FIRST_AND_LAST_FRAMES_2_VIDEO";
  kiePayload.firstFrameUrl = firstFrameUrl;
  kiePayload.lastFrameUrl  = lastFrameUrl;
  kiePayload.imageUrls = [firstFrameUrl, lastFrameUrl];
} else if (firstFrameUrl) {
  kiePayload.generationType = "FIRST_FRAME_2_VIDEO";
  kiePayload.firstFrameUrl = firstFrameUrl;
  kiePayload.imageUrls = [firstFrameUrl];
} else {
  kiePayload.generationType = "TEXT_2_VIDEO";
}

const referenceImageUrls = Array.isArray(body.referenceImageUrls) ? body.referenceImageUrls.map(normalizeUrl).filter(Boolean) : [];
if (referenceImageUrls.length) {
  kiePayload.referenceImageUrls = referenceImageUrls.slice(0, 3);
}

// Optional spec keys
if (Number.isInteger(body.seeds)) kiePayload.seeds = body.seeds;
if (typeof body.enableFallback === 'boolean') kiePayload.enableFallback = body.enableFallback;
if (typeof body.enableTranslation === 'boolean') kiePayload.enableTranslation = body.enableTranslation;
if (typeof body.watermark === 'string' && body.watermark.length) kiePayload.watermark = body.watermark;

// Image handling: array 0–1
if (imageUrls.length) {
  kiePayload.imageUrls = imageUrls;
}

// Call KIE

    const resp = await fetch(KIE_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(kiePayload)
    });
    const data = await resp.json().catch(()=>({}));

    const taskId = extractTaskId(data);

    // Guard: if KIE didn't accept or no taskId, report as not submitted
    if (!resp.ok) {
      return ok({ submitted:false, error:`kie_${resp.status}`, data });
    }
    if (!taskId) {
      return ok({ submitted:false, error:'missing_taskId', data });
    }

    // Persist taskId into meta for easier tracing
    try {
      if (UG_URL && SERVICE_KEY && taskId) {
        const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id`;
        const chk = await fetch(UG_URL + q, { headers: sb() });
        const arr = await chk.json().catch(()=>[]);
        if (Array.isArray(arr) && arr.length) {
          await fetch(`${UG_URL}?id=eq.${encodeURIComponent(arr[0].id)}`, {
            method: "PATCH",
            headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({ meta: { run_id, status: "processing", aspect_ratio: aspectRatio, quality, duration: 8, task_id: taskId, model, charge_cost: chargeCost, refund_amount: chargeCost, subscription_unlimited: unlimitedBySubscription } })
          });
        }
      }
    } catch {}


    const foundForCharge = await findUserGeneration(uid, run_id);
    const rowId = foundForCharge?.id || null;
    const baseMeta = {
      ...(foundForCharge?.meta || {}),
      run_id,
      status: "processing",
      aspect_ratio: aspectRatio,
      quality,
      duration: 8,
      task_id: taskId,
      model,
      refund_amount: chargeCost,
      charge_cost: chargeCost,
      subscription_unlimited: unlimitedBySubscription
    };
    const charge = chargeCost > 0
      ? await chargeOnceForRun(uid, run_id, chargeCost, rowId, baseMeta)
      : { ok:true, debit:{ ok:true, credits:null }, already:false };
    if (!charge.ok) {
      return ok({ submitted:false, error: charge.error || "charge_failed", details: charge, taskId, run_id });
    }
    if (chargeCost === 0 && rowId) {
      await patchUserGenerationMetaById(rowId, {
        ...baseMeta,
        charged: "true",
        charged_cost: 0,
        charge_cost: 0,
        charged_at: new Date().toISOString(),
        debited: 0,
        refund_amount: 0
      });
    }

    return ok({ ok:true, submitted: true, run_id, taskId, status: resp.status, data, debited: chargeCost, credits: charge.debit?.credits, already_charged: !!charge.already, subscription_unlimited: unlimitedBySubscription });
  } catch (e) {
    return ok({ submitted:false, error:String(e) });
  }
};

function ok(obj){ return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code, message){ return { statusCode: code, headers: cors(), body: JSON.stringify({ submitted:false, error: message }) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, X-USER-ID" }; }
function safeJson(s){ try{ return JSON.parse(s||"{}"); } catch { return {}; } }
function lowerKeys(h){ const o={}; for (const k in h) o[k.toLowerCase()] = h[k]; return o; }
function normalizeModel(m){
  const raw = String(m||"");
  const s = raw.toLowerCase().replace(/[\s_-]+/g,"");
  if (s === "veo3" || s === "veo31" || s === "veo3quality" || s === "veo31quality" || s === "veo3standard" || s === "veo31standard") return "veo3";
  if (s === "veo3fast" || s === "veo31fast") return "veo3_fast";
  if (s === "veo3lite" || s === "veo31lite") return "veo3_lite";
  // default to fast so existing "fast" behavior remains
  return "veo3_fast";
}
function normalizeAspect(a){ a=String(a||"").trim(); return /^(16:9|9:16)$/.test(a)?a:"16:9"; }
function normalizeQuality(q, model){
  const raw = String(q||"").trim().toLowerCase();
  const isLite = normalizeModel(model) === "veo3_lite";
  if (raw === "720p" || raw === "720") return "720p";
  if (!isLite && (raw === "4k" || raw === "2160p" || raw === "2160")) return "4K";
  return "1080p";
}
function kieResolutionValue(quality){
  const q = normalizeQuality(quality);
  if (q === "720p") return "720p";
  if (q === "4K") return "4k";
  return "1080p";
}
function normalizeUrl(u){ try{ const url=new URL(String(u||"")); return url.href; } catch { return ""; } }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }

function veo31Cost(model, quality){
  const normalizedModel = normalizeModel(model);
  const q = normalizeQuality(quality, normalizedModel);
  if (normalizedModel === "veo3_lite") return q === "1080p" ? 2.5 : 2;
  // Prices requested: Fast 1080p=5, Fast 4K=12, Quality 1080p=17, Quality 4K=22.
  if (normalizedModel === "veo3_fast") return q === "4K" ? 12 : 5;
  return q === "4K" ? 22 : 17;
}

function veo31ProviderName(model){
  const normalizedModel = normalizeModel(model);
  if (normalizedModel === "veo3_lite") return "veo3.1lite";
  if (normalizedModel === "veo3_fast") return "veo3.1fast";
  return "veo3.1";
}

async function hasUnlimitedVeo31Subscription(uid, model, quality){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return false;
  const normalizedModel = normalizeModel(model);
  if (normalizedModel !== "veo3_lite") return false;
  const q = normalizeQuality(quality, normalizedModel);
  if (q !== "720p" && q !== "1080p") return false;
  try{
    const url = `${SUPABASE_URL}/rest/v1/user_subscriptions?user_id=eq.${encodeURIComponent(uid)}&select=status,plan_id,current_period_end`;
    const r = await fetch(url, { headers: sb() });
    if (!r.ok) return false;
    const arr = await r.json().catch(()=>[]);
    const row = Array.isArray(arr) ? arr[0] : null;
    if (!row || row.status !== "active") return false;
    const endMs = row.current_period_end ? Date.parse(row.current_period_end) : 0;
    if (!Number.isFinite(endMs) || endMs <= Date.now()) return false;
    if (row.plan_id === "pro_monthly" && q === "720p") return true;
    if (row.plan_id === "pro_max_monthly" && (q === "720p" || q === "1080p")) return true;
    return false;
  }catch{
    return false;
  }
}

function isCharged(meta){
  if (!meta || typeof meta !== "object") return false;
  return meta.charged === true || String(meta.charged).toLowerCase() === "true";
}

async function findUserGeneration(uid, run_id){
  if (!UG_URL || !uid || !run_id) return null;
  try{
    const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id,meta`;
    const r = await fetch(UG_URL + q, { headers: sb() });
    const arr = await r.json().catch(()=>[]);
    return (Array.isArray(arr) && arr[0]) ? arr[0] : null;
  }catch{ return null; }
}

async function getCredits(uid){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return 0;
  try{
    const url = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
    const r = await fetch(url, { headers: sb() });
    const arr = await r.json().catch(()=>[]);
    const credits = (Array.isArray(arr) && arr[0] && typeof arr[0].credits !== "undefined") ? Number(arr[0].credits) : 0;
    return Number.isFinite(credits) ? credits : 0;
  }catch{ return 0; }
}

async function debitCredits(uid, cost){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return { ok:false, error:"missing_env_or_uid" };
  try{
    const profUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
    const r0 = await fetch(profUrl, { headers: sb() });
    if (!r0.ok) return { ok:false, error:"profile_fetch_failed", status:r0.status };
    const arr = await r0.json().catch(()=>null);
    const cur = (Array.isArray(arr) && arr[0] && typeof arr[0].credits !== "undefined") ? Number(arr[0].credits) : 0;
    if (!Number.isFinite(cur) || cur < cost) return { ok:false, error:"insufficient_credits", credits: cur };
    const newCredits = Math.max(0, Number((cur - cost).toFixed(4)));
    const updUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`;
    const r1 = await fetch(updUrl, {
      method:"PATCH",
      headers:{ ...sb(), "Content-Type":"application/json", "Prefer":"return=representation" },
      body: JSON.stringify({ credits: newCredits })
    });
    if (!r1.ok) return { ok:false, error:"profile_update_failed", status:r1.status };
    return { ok:true, credits:newCredits };
  }catch(e){ return { ok:false, error:"server_exception", details:String(e && e.message || e) }; }
}

async function patchUserGenerationMetaById(id, meta){
  if (!UG_URL || !SERVICE_KEY || !id) return false;
  try{
    const r = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
      method:"PATCH",
      headers:{ ...sb(), "Content-Type":"application/json", "Prefer":"return=minimal" },
      body: JSON.stringify({ meta })
    });
    return !!r.ok;
  }catch{ return false; }
}

async function chargeOnceForRun(uid, run_id, cost, row_id, baseMeta){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid || !run_id) {
    const debit = await debitCredits(uid, cost);
    return { ok: !!debit.ok, debit, idempotent:false, already:false };
  }

  try{
    const existing = await findUserGeneration(uid, run_id);
    const meta0 = existing?.meta || baseMeta || {};
    if (isCharged(meta0)){
      return { ok:true, debit:{ ok:true, credits:null }, idempotent:true, already:true };
    }

    const claim = `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const mergedForClaim = { ...(meta0||{}), ...(baseMeta||{}), charge_claim: claim, refund_amount: cost };

    const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&meta->>charged=is.null&meta->>charge_claim=is.null&select=id`;
    const rClaim = await fetch(UG_URL + q, {
      method:"PATCH",
      headers:{ ...sb(), "Content-Type":"application/json", "Prefer":"return=representation" },
      body: JSON.stringify({ meta: mergedForClaim })
    });

    const claimedArr = await rClaim.json().catch(()=>[]);
    const claimed = (rClaim.ok && Array.isArray(claimedArr) && claimedArr.length > 0);
    if (!claimed){
      const after = await findUserGeneration(uid, run_id);
      if (isCharged(after?.meta)){
        return { ok:true, debit:{ ok:true, credits:null }, idempotent:true, already:true };
      }
      return { ok:false, error:"charge_in_progress", idempotent:true, already:false };
    }

    const debit = await debitCredits(uid, cost);
    if (!debit.ok){
      const rollbackMeta = { ...(mergedForClaim||{}) };
      delete rollbackMeta.charge_claim;
      await patchUserGenerationMetaById(row_id || claimedArr[0]?.id || existing?.id, rollbackMeta);
      return { ok:false, debit, idempotent:true, already:false };
    }

    const chargedMeta = {
      ...(mergedForClaim||{}),
      charged:"true",
      charged_cost: cost,
      charge_cost: cost,
      charged_at: new Date().toISOString(),
      debited: cost,
      refund_amount: cost
    };
    await patchUserGenerationMetaById(row_id || claimedArr[0]?.id || existing?.id, chargedMeta);
    return { ok:true, debit, idempotent:true, already:false };
  }catch(e){
    const debit = await debitCredits(uid, cost);
    return { ok: !!debit.ok, debit, idempotent:false, already:false, error:String(e && e.message || e) };
  }
}

// Searches the JSON object for common taskId locations or any property named "taskId".
function extractTaskId(data){
  if (!data || typeof data !== "object") return "";
  // Common fast paths
  if (data?.data?.taskId)    return String(data.data.taskId);
  if (data?.taskId)          return String(data.taskId);
  if (data?.result?.taskId)  return String(data.result.taskId);
  // snake/request variants
  if (data?.data?.task_id)   return String(data.data.task_id);
  if (data?.task_id)         return String(data.task_id);
  if (data?.result?.task_id) return String(data.result.task_id);
  if (data?.data?.requestId)    return String(data.data.requestId);
  if (data?.requestId)          return String(data.requestId);
  if (data?.result?.requestId)  return String(data.result.requestId);
  if (data?.data?.request_id)   return String(data.data.request_id);
  if (data?.request_id)         return String(data.request_id);
  if (data?.result?.request_id) return String(data.result.request_id);
  // Generic id fallback
  if (data?.id && String(data.id).length > 8) return String(data.id);
  const seen = new Set();
  function scan(x){
    if (!x || typeof x !== "object" || seen.has(x)) return "";
    seen.add(x);
    for (const [k,v] of Object.entries(x)){
      if (/^(task[_-]?id|request[_-]?id)$/i.test(k) && (typeof v === "string" || typeof v === "number")) {
        const s = String(v); if (s.length > 3) return s;
      }
      const inner = scan(v);
      if (inner) return inner;
    }
    return "";
  }
  return scan(data) || "";
}
