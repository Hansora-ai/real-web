// netlify/functions/run-runway.js
// Submit a KIE Runway job and seed a placeholder row in user_generations.
// Only writes columns that exist: user_id, provider, kind, prompt, result_url, meta.
// Adds `taskId` in the response (extracted from KIE JSON).

const KIE_URL = "https://api.kie.ai/api/v1/runway/generate";
const API_KEY = process.env.KIE_API_KEY;

// Supabase (service role for server-side insert/patch)
const SUPABASE_URL  = process.env.SUPABASE_URL || "";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

// Your site base for callback (keep your current casing used by your working flow)
const SITE_BASE = (process.env.SITE_BASE || "https://hansora.co").replace(/\/+$/,'');
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/kie-check`;

function runwayCost(quality, duration) {
  const q = normalizeQuality(quality || "720p");
  const d = Number(duration) === 10 && q !== "1080p" ? 10 : 5;
  if (q === "1080p") return 3;
  return d === 10 ? 3 : 1.5;
}

async function getCredits(uid) {
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return { ok:false, error:"missing_env_or_uid" };
  try {
    const url = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
    const r = await fetch(url, { headers: sb() });
    if (!r.ok) return { ok:false, error:"profile_fetch_failed", status:r.status };
    const arr = await r.json().catch(()=>[]);
    const credits = (Array.isArray(arr) && arr[0] && typeof arr[0].credits !== "undefined") ? Number(arr[0].credits) : 0;
    return { ok:true, credits };
  } catch (e) {
    return { ok:false, error:"credits_exception", details:String(e && e.message || e) };
  }
}

async function debitCredits(uid, cost) {
  const before = await getCredits(uid);
  if (!before.ok) return before;
  if (before.credits < cost) return { ok:false, error:"insufficient_credits", credits: before.credits };

  const newCredits = Math.max(0, Number((before.credits - cost).toFixed(4)));
  const updUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`;
  const r = await fetch(updUrl, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=representation" },
    body: JSON.stringify({ credits: newCredits })
  });
  if (!r.ok) return { ok:false, error:"profile_update_failed", status:r.status };
  return { ok:true, credits:newCredits, credits_before: before.credits };
}

async function fetchUserGenByRunId(uid, run_id) {
  if (!UG_URL || !SERVICE_KEY || !uid || !run_id) return null;
  try {
    const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id,meta,provider,kind,prompt,result_url,created_at`;
    const r = await fetch(UG_URL + q, { headers: sb() });
    if (!r.ok) return null;
    const arr = await r.json().catch(()=>[]);
    return (Array.isArray(arr) && arr[0]) ? arr[0] : null;
  } catch {
    return null;
  }
}

async function patchUserGenerationMetaById(id, meta) {
  if (!UG_URL || !SERVICE_KEY || !id) return false;
  try {
    const r = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({ meta })
    });
    return !!r.ok;
  } catch {
    return false;
  }
}

async function chargeOnceForRun(uid, run_id, cost, row_id, baseMeta) {
  if (!SUPABASE_URL || !SERVICE_KEY || !uid || !run_id) {
    const debit = await debitCredits(uid, cost);
    return { ok: !!debit.ok, debit, idempotent:false, already:false };
  }

  try {
    const existing = await fetchUserGenByRunId(uid, run_id);
    const meta0 = existing?.meta || baseMeta || {};
    if (String(meta0?.charged || "").toLowerCase() === "true") {
      return { ok:true, debit:{ ok:true, credits:null }, idempotent:true, already:true };
    }

    const claim = `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const mergedForClaim = { ...(meta0||{}), ...(baseMeta||{}), charge_claim: claim };

    const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&meta->>charged=is.null&meta->>charge_claim=is.null&select=id`;
    const rClaim = await fetch(UG_URL + q, {
      method: "PATCH",
      headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=representation" },
      body: JSON.stringify({ meta: mergedForClaim })
    });

    const claimedArr = await rClaim.json().catch(()=>[]);
    const claimed = (rClaim.ok && Array.isArray(claimedArr) && claimedArr.length > 0);

    if (!claimed) {
      const after = await fetchUserGenByRunId(uid, run_id);
      const metaAfter = after?.meta || {};
      if (String(metaAfter?.charged || "").toLowerCase() === "true") {
        return { ok:true, debit:{ ok:true, credits:null }, idempotent:true, already:true };
      }
      return { ok:false, error:"charge_in_progress", idempotent:true, already:false };
    }

    const debit = await debitCredits(uid, cost);
    if (!debit.ok) {
      const rollbackMeta = { ...(mergedForClaim||{}) };
      delete rollbackMeta.charge_claim;
      await patchUserGenerationMetaById(row_id || (Array.isArray(claimedArr) && claimedArr[0]?.id) || existing?.id, rollbackMeta);
      return { ok:false, debit, idempotent:true, already:false };
    }

    const chargedMeta = {
      ...(mergedForClaim||{}),
      charged: "true",
      charged_cost: cost,
      charged_at: new Date().toISOString(),
      debited: cost,
      refund_amount: cost
    };
    await patchUserGenerationMetaById(row_id || (Array.isArray(claimedArr) && claimedArr[0]?.id) || existing?.id, chargedMeta);

    return { ok:true, debit, idempotent:true, already:false };
  } catch (e) {
    const debit = await debitCredits(uid, cost);
    return { ok: !!debit.ok, debit, idempotent:false, already:false, error:String(e && e.message || e) };
  }
}

exports.handler = async (event) => {
  // CORS + method guard
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
    if (!prompt && !body.fileUrl && !body.imageUrl && !body.image_url) {
      return ok({ submitted:false, error:"empty_prompt" });
    }

    const aspectRatio = normalizeAspect(body.aspectRatio || body.size || "3:4");
    const imageUrl = normalizeUrl(body.imageUrl || body.image_url || body.fileUrl || "");
    const quality = normalizeQuality(body.quality || body.resolution || "720p");
    let duration = Number(body.duration || 5);
    duration = duration === 10 ? 10 : 5;
    if (quality === "1080p") duration = 5;

    const cost = runwayCost(quality, duration);

    const clientRunId = (body.run_id || "").toString().trim();
    const run_id = clientRunId || `${uid}-${Date.now()}`;

    // Keep the same key casing you were already using in your working flow
    const callBackUrl = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    const existing = await fetchUserGenByRunId(uid, run_id);
    const existingTask = existing?.meta?.task_id || existing?.meta?.taskId || "";
    if (existingTask) {
      return ok({ submitted:true, run_id, taskId: String(existingTask), already_submitted:true, already_charged: String(existing?.meta?.charged || "").toLowerCase() === "true" });
    }

    // Pre-check credits before submitting to provider.
    if (SUPABASE_URL && SERVICE_KEY) {
      const creditCheck = await getCredits(uid);
      if (creditCheck.ok && creditCheck.credits < cost) {
        return ok({ submitted:false, error:"not_enough_credits", credits: creditCheck.credits, need: cost });
      }
      if (!creditCheck.ok) {
        return ok({ submitted:false, error:"credits_fetch_failed", details: creditCheck });
      }
    }

    // Seed placeholder row in user_generations (no thumb_url)
    let row_id = existing?.id || null;
    if (UG_URL && SERVICE_KEY) {
      try {
        const payload = {
          user_id: uid,
          provider: "runway",
          kind: "video",
          prompt,
          result_url: null,
          meta: { run_id, status: "pending", aspect_ratio: aspectRatio, quality, duration, refund_amount: cost }
        };

        if (row_id) {
          await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row_id)}`, {
            method: "PATCH",
            headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({ result_url: null, meta: payload.meta })
          });
        } else {
          const ins = await fetch(UG_URL, {
            method: "POST",
            headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=representation" },
            body: JSON.stringify(payload)
          });
          const arr = await ins.json().catch(()=>[]);
          row_id = Array.isArray(arr) && arr[0]?.id ? arr[0].id : null;
        }
      } catch (e) {
        console.warn("[run-runway] placeholder write failed:", e);
      }
    }

    // Build KIE payload. Keep user's fields but enforce callback/aspectRatio + normalize fileUrl.
    const kiePayload = {
      ...body,
      aspectRatio,
      callBackUrl,
    };
    kiePayload.duration = duration;
    kiePayload.quality = quality;

    // Image handling: send imageUrl only when a file is chosen; otherwise send no image fields.
    if (imageUrl) {
      kiePayload.imageUrl = imageUrl;
      // do NOT send fileUrl to avoid API confusion
    } else {
      // remove any empty image fields that might have come from the client
      delete kiePayload.imageUrl;
      delete kiePayload.fileUrl;
      delete kiePayload.image_url;
      delete kiePayload.frameImage;
    }

    // Call KIE
    const resp = await fetch(KIE_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(kiePayload)
    });
    const data = await resp.json().catch(()=>({}));

    if (!resp.ok) {
      if (row_id) {
        await patchUserGenerationMetaById(row_id, { run_id, status: "create_failed", aspect_ratio: aspectRatio, quality, duration, refund_amount: cost, raw: data });
      }
      return ok({ submitted:false, run_id, error:"create_failed", status: resp.status, data });
    }

    // Extract taskId robustly from KIE response
    const taskId = extractTaskId(data);
    if (!taskId) {
      if (row_id) {
        await patchUserGenerationMetaById(row_id, { run_id, status: "missing_task_id", aspect_ratio: aspectRatio, quality, duration, refund_amount: cost, raw: data });
      }
      return ok({ submitted:false, run_id, error:"missing_task_id", status: resp.status, data });
    }

    // Immediately store taskId into the placeholder meta so downstream tools can re-poll later
    const baseMeta = { run_id, status: "processing", aspect_ratio: aspectRatio, quality, duration, task_id: taskId, refund_amount: cost };
    if (row_id) await patchUserGenerationMetaById(row_id, baseMeta);

    // Debit credits AFTER provider accepted the task and exactly once per (uid, run_id)
    const charge = await chargeOnceForRun(uid, run_id, cost, row_id, baseMeta);
    if (!charge.ok) {
      if (charge.debit && !charge.debit.ok && (charge.debit.error === "insufficient_credits" || charge.debit.error === "insufficient")) {
        return ok({ submitted:false, error:"not_enough_credits", details: charge.debit, run_id, taskId });
      }
      if (charge.error === "charge_in_progress") {
        return ok({ submitted:false, error:"charge_in_progress", run_id, taskId });
      }
      return ok({ submitted:false, error:"charge_failed", details: charge.debit || charge.error || charge, run_id, taskId });
    }

    return ok({
      submitted: true,
      run_id,
      taskId,
      status: resp.status,
      cost,
      debited: cost,
      credits: (charge.debit && charge.debit.credits != null ? charge.debit.credits : undefined),
      already_charged: !!charge.already,
      data
    });

  } catch (e) {
    return ok({ submitted:false, error:String(e) });
  }
};

function ok(obj){ return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code, message){ return { statusCode: code, headers: cors(), body: JSON.stringify({ submitted:false, error: message }) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, X-USER-ID" }; }
function safeJson(s){ try{ return JSON.parse(s||"{}"); } catch { return {}; } }
function lowerKeys(h){ const o={}; for (const k in h) o[k.toLowerCase()] = h[k]; return o; }
function normalizeAspect(a){ a=String(a||"").trim(); return /^(16:9|9:16|1:1|4:3|3:4)$/.test(a)?a:"3:4"; }
function normalizeQuality(q){ q=String(q||"").trim().toLowerCase(); return q === "1080p" || q === "1080" ? "1080p" : "720p"; }
function normalizeUrl(u){ try{ const url=new URL(String(u||"")); return url.href; } catch { return ""; } }
function sb(){ return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }; }

// Searches the JSON object for common taskId locations or any property named "taskId".
function extractTaskId(data){
  if (!data || typeof data !== "object") return "";
  if (data?.data?.taskId) return String(data.data.taskId);
  if (data?.taskId) return String(data.taskId);
  if (data?.result?.taskId) return String(data.result.taskId);
  if (data?.id && String(data.id).length > 8) return String(data.id);
  // recursive search for a key named taskId
  const seen = new Set();
  function scan(x){
    if (!x || typeof x !== "object" || seen.has(x)) return "";
    seen.add(x);
    for (const [k,v] of Object.entries(x)){
      if (k === "taskId" && (typeof v === "string" || typeof v === "number")) return String(v);
      const inner = scan(v);
      if (inner) return inner;
    }
    return "";
  }
  return scan(data) || "";
}
