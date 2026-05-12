// netlify/functions/run-seedream-5-lite.js
// Seedream 5.0 Lite launcher with server-side credit debit (Service Role) + run_id idempotency.
// Client must NEVER mutate credits.

const CREATE_URL = process.env.KIE_CREATE_URL || "https://api.kie.ai/api/v1/jobs/createTask";
const API_KEY    = process.env.KIE_API_KEY || "";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const SITE_BASE   = (process.env.SITE_BASE || "https://webhansora.netlify.app").replace(/\/+$/, "");
const CALLBACK_URL = `${SITE_BASE}/.netlify/functions/kie-callback`;

const VERSION_TAG  = "seedream_5_lite_fn_v1";

function cors(){
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-USER-ID, x-user-id"
  };
}

function json(statusCode, obj){
  return {
    statusCode,
    headers: { ...cors(), "Content-Type": "application/json", "X-NB-Version": VERSION_TAG },
    body: JSON.stringify(obj)
  };
}

function getUID(event, body){
  const h = event?.headers || {};
  const uid =
    h["x-user-id"] || h["X-USER-ID"] ||
    body?.uid || body?.user_id || body?.userId ||
    "anon";
  return String(uid || "anon");
}

function normalizeImageSize(v) {
  if (!v) return "auto";
  const s = String(v).trim().toLowerCase();
  const direct = new Set(["auto","1:1","2:3","3:2","3:4","4:3","4:5","5:4","9:16","16:9","21:9"]);
  if (direct.has(s)) return s;
  if (s === "square") return "1:1";
  if (s === "portrait_3_4") return "3:4";
  if (s === "portrait_9_16") return "9:16";
  if (s === "landscape_4_3") return "4:3";
  if (s === "landscape_16_9") return "16:9";
  const coerced = s.replace(/(\d)[_\-:](\d)/g, "$1:$2");
  if (direct.has(coerced)) return coerced;
  return "auto";
}

async function seedUserGeneration(uid, run_id, prompt, metaExtra){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid || uid === "anon") return { row_id: null };
  try{
    const url = `${SUPABASE_URL}/rest/v1/user_generations`;
    const meta = Object.assign(
      { source:"seedream-5-lite", run_id, model:"seedream-5-lite", status:"pending", charged:"false" },
      (metaExtra||{})
    );
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        user_id: uid,
        provider: "Seedream 5.0 Lite",
        kind: "image",
        prompt,
        result_url: null,
        meta
      })
    });
    if (!r.ok) return { row_id: null };
    const arr = await r.json().catch(()=>null);
    return { row_id: (Array.isArray(arr) && arr[0]?.id) ? arr[0].id : null };
  }catch{
    return { row_id: null };
  }
}

async function patchUserGenerationMetaById(row_id, meta){
  if (!SUPABASE_URL || !SERVICE_KEY || !row_id) return false;
  try{
    const url = `${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(row_id)}`;
    const r = await fetch(url, {
      method: "PATCH",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({ meta })
    });
    return !!r.ok;
  }catch{
    return false;
  }
}

async function fetchUserGenByRunId(uid, run_id){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid || !run_id) return null;
  try{
    // PostgREST JSON filter (meta->>run_id)
    const url = `${SUPABASE_URL}/rest/v1/user_generations?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&select=id,meta&order=created_at.desc&limit=1`;
    const r = await fetch(url, {
      headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }
    });
    if (!r.ok) return null;
    const arr = await r.json().catch(()=>null);
    return (Array.isArray(arr) && arr[0]) ? arr[0] : null;
  }catch{
    return null;
  }
}

async function getCredits(uid){
  const url = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
  const r = await fetch(url, { headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }});
  if (!r.ok) return { ok:false, error:"profile_fetch_failed" };
  const j = await r.json().catch(()=>null);
  const credits = (Array.isArray(j) && j[0] && typeof j[0].credits !== "undefined") ? Number(j[0].credits) : 0;
  return { ok:true, credits };
}

async function setCredits(uid, newCredits){
  const url = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify({ credits: newCredits })
  });
  return { ok: !!r.ok };
}

// Idempotent charge: one debit per (uid, run_id)
async function chargeOnceForRun(uid, run_id, cost, row_id, baseMeta){
  if (!SUPABASE_URL || !SERVICE_KEY || !uid || uid === "anon" || !run_id) {
    return { ok:false, error:"missing_supabase_or_uid" };
  }

  // 1) if already charged, exit
  const existing = await fetchUserGenByRunId(uid, run_id);
  const meta0 = existing?.meta || baseMeta || {};
  if (String(meta0?.charged || "").toLowerCase() === "true"){
    return { ok:true, already:true };
  }

  // 2) claim lock (best-effort conditional)
  const claim = `${uid}:${run_id}`;
  const claimedMeta = { ...(meta0||{}), ...(baseMeta||{}), run_id, charge_claim: claim, charge_claimed_at: (new Date()).toISOString() };
  // If we have a row_id, claim it. Otherwise, claim the existing row id.
  const claimId = row_id || existing?.id || null;
  if (claimId){
    try{
      const url = `${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(claimId)}&meta->>charge_claim=is.null`;
      const r = await fetch(url, {
        method: "PATCH",
        headers: {
          "apikey": SERVICE_KEY,
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify({ meta: claimedMeta })
      });
      // If claim failed (no rows updated), do not debit; tell client it's in progress
      const arr = await r.json().catch(()=>null);
      if (!r.ok || !(Array.isArray(arr) && arr.length)){
        const nowExisting = await fetchUserGenByRunId(uid, run_id);
        if (String(nowExisting?.meta?.charged || "").toLowerCase() === "true"){
          return { ok:true, already:true };
        }
        return { ok:false, error:"charge_in_progress" };
      }
    }catch{
      // if claim check fails, continue but with caution (still idempotent by charged flag)
    }
  }

  // 3) debit
  const before = await getCredits(uid);
  if (!before.ok) return { ok:false, error:"credits_fetch_failed" };
  if (before.credits < cost){
    // mark insufficient
    const failMeta = { ...(claimedMeta||{}), charged:"false", charge_error:"insufficient_credits", charge_cost: cost, credits_before: before.credits };
    await patchUserGenerationMetaById(claimId, failMeta);
    return { ok:false, error:"insufficient_credits", credits: before.credits };
  }

  const afterCredits = Number((before.credits - cost).toFixed(4));
  const wrote = await setCredits(uid, afterCredits);
  if (!wrote.ok){
    const failMeta = { ...(claimedMeta||{}), charged:"false", charge_error:"debit_failed", charge_cost: cost, credits_before: before.credits };
    await patchUserGenerationMetaById(claimId, failMeta);
    return { ok:false, error:"debit_failed" };
  }

  // 4) mark charged
  const chargedMeta = {
    ...(claimedMeta||{}),
    charged: "true",
    charged_cost: cost,
    charged_at: (new Date()).toISOString(),
    credits_before: before.credits,
    credits_after: afterCredits
  };
  await patchUserGenerationMetaById(claimId, chargedMeta);

  return { ok:true, already:false, credits_before: before.credits, credits_after: afterCredits };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { ok:false, submitted:false, error:"method_not_allowed", version: VERSION_TAG });

  try{
    if (!API_KEY) return json(500, { ok:false, submitted:false, error:"missing_kie_api_key", version: VERSION_TAG });

    const body = JSON.parse(event.body || "{}");

    const uid = getUID(event, body);
    const run_id = String(body.run_id || `${uid}-${Date.now()}`);

    const rawUrls = Array.isArray(body.urls) ? body.urls : [];
    const image_input = rawUrls.map(u => encodeURI(String(u)));

    const prompt = String(body.prompt || "");
    const format = String(body.format || "png").toLowerCase();
    const size   = normalizeImageSize(body.size);

    const hasImages = Array.isArray(image_input) && image_input.length;

    const cb = `${CALLBACK_URL}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    const input = {
      prompt,
      aspect_ratio: size,
      quality: "high",
      output_format: format
    };
    if (hasImages){
      input.image_urls = image_input;
    }

    const payload = {
      model: hasImages ? "seedream/5-lite-image-to-image" : "seedream/5-lite-text-to-image",
      input,

      webhook_url: cb,
      webhookUrl:  cb,
      callbackUrl: cb,
      callBackUrl: cb,
      notify_url:  cb,

      meta:     { uid, run_id, version: VERSION_TAG, cb },
      metadata: { uid, run_id, version: VERSION_TAG, cb }
    };

    // Create provider job first
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

    const taskId = js.taskId || js.id || js.data?.taskId || js.data?.id || null;

    if (!create.ok){
      return json(create.status || 500, { ok:false, submitted:false, error:"create_failed", status:create.status, response: js, version: VERSION_TAG });
    }

    // Seed placeholder row
    const baseMeta = { run_id, task_id: taskId, size, status:"processing" };
    const seeded = await seedUserGeneration(uid, run_id, prompt, baseMeta);
    const row_id = seeded?.row_id || null;

    // Charge exactly once per run_id (cost = 0.5)
    const cost = 0.5;
    const charged = await chargeOnceForRun(uid, run_id, cost, row_id, { ...baseMeta, source:"seedream-5-lite", model:"seedream-5-lite" });

    if (!charged.ok){
      if (charged.error === "insufficient_credits"){
        return json(402, { ok:false, submitted:false, error:"not_enough_credits", run_id, cost, version: VERSION_TAG });
      }
      if (charged.error === "charge_in_progress"){
        return json(409, { ok:false, submitted:false, error:"charge_in_progress", run_id, cost, version: VERSION_TAG });
      }
      // do not block job; but report charging failure
      return json(500, { ok:false, submitted:false, error:"charge_failed", run_id, cost, version: VERSION_TAG });
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
    return json(500, { ok:false, submitted:false, error:"exception", message: String(e && e.message || e), version: VERSION_TAG });
  }
};
