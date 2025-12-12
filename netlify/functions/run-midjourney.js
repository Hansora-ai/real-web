// netlify/functions/run-midimage.js
// Create MidJourney job via KIE and deduct credits server-side (Service Role).
// Logic mirrors Kling 2.6: server debit + run_id idempotent charging + placeholder insert.


const KIE_URL = "https://api.kie.ai/api/v1/mj/generate";
const API_KEY = process.env.KIE_API_KEY;

if (!API_KEY) console.warn("[run-midimage] Missing KIE_API_KEY env!");
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UG_URL = (process.env.SUPABASE_URL ? process.env.SUPABASE_URL + '/rest/v1/user_generations' : undefined);

// Same callback as Nano Banana
const CALLBACK_URL = "https://webhansora.netlify.app/.netlify/functions/kie-callback";
const VERSION_TAG  = "midimage_fn_v2";

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
    const size = body.size || body.aspectRatio || 'auto';
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
    const aspect = normalizeAspect(mapSizeToAR(size)); // default 2:3
    const speed     = "fast"; // per user request
    const version   = body.version ?? 7;
    const stylization = body.stylization ?? 100;
    const weirdness = body.weirdness ?? 0;
    const watermark = body.watermark ?? ""; // empty by default
    const paramJson = body.paramJson || JSON.stringify({ numberOfImages: 1 });
    // Identify user/run (server-side debit; require uid)
    const hdr = event.headers || {};
    const uid = String(hdr["x-user-id"] || hdr["X-USER-ID"] || "").trim();
    if (!uid) {
      return err(401, { error: "missing_uid", message: "Missing X-USER-ID header.", version: VERSION_TAG });
    }
    const run_id = body.run_id || `${uid}-${Date.now()}`;

    // Preflight: check credits before creating provider job
    const prof0 = await getProfileCredits(uid);
    const curCredits = Number(prof0?.credits ?? 0);
    if (!Number.isFinite(curCredits) || curCredits < 1) {
      return err(402, { error: "not_enough_credits", need: 1, credits: curCredits || 0, run_id, version: VERSION_TAG });
    }

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
          meta: { run_id, task_id: taskId, aspectRatio: aspect, status: 'processing', cost: 1, charge_claim: false, charged: false }
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

    
    // --- server-side debit (Service Role) + run_id idempotency ---
    let credits_after = null;
    try {
      const ugRows = await getUserGenerationRows(uid, run_id);
      const alreadyCharged = (ugRows || []).some(r => (r?.meta && (r.meta.charged === true || String(r.meta.charged).toLowerCase() === "true")));
      if (!alreadyCharged) {
        // debit
        const prof1 = await getProfileCredits(uid);
        const cur1 = Number(prof1?.credits ?? 0);
        if (!Number.isFinite(cur1) || cur1 < 1) {
          // should not happen (preflight check), but keep safe
          return err(402, { error: "not_enough_credits", need: 1, credits: cur1 || 0, run_id, taskId, version: VERSION_TAG });
        }
        credits_after = Number((cur1 - 1).toFixed(1));
        await setProfileCredits(uid, credits_after);
        // mark charged in user_generations meta (best-effort)
        await markUserGenerationCharged(uid, run_id, ugRows, { taskId, aspectRatio: aspect });
      } else {
        // reflect current credits
        const prof2 = await getProfileCredits(uid);
        credits_after = Number(prof2?.credits ?? 0);
      }
    } catch (e) {
      console.warn("[midimage] debit/mark failed", e);
      // do not fail the generation submission; client will still see submitted
    }

    return ok({
      submitted: true,
      taskId,
      run_id,
      credits_after,
      version: VERSION_TAG,
      used_callback: cb
    });

  } catch (e) {
    return ok({ submitted: true, note: "exception", message: String(e), version: VERSION_TAG });
  }
};


async function sbFetch(url, options) {
  const res = await fetch(url, options);
  const txt = await res.text();
  let js;
  try { js = txt ? JSON.parse(txt) : null; } catch { js = { raw: txt }; }
  if (!res.ok) {
    const errMsg = (js && (js.message || js.error_description || js.error)) || txt || res.statusText;
    const e = new Error(errMsg);
    e.status = res.status;
    e.payload = js;
    throw e;
  }
  return js;
}

async function getProfileCredits(uid) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY");
  const url = `${SUPABASE_URL}/rest/v1/profiles?select=credits&user_id=eq.${encodeURIComponent(uid)}&limit=1`;
  const out = await sbFetch(url, {
    method: "GET",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Accept": "application/json"
    }
  });
  return Array.isArray(out) ? out[0] : out;
}

async function setProfileCredits(uid, credits) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY");
  const url = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`;
  await sbFetch(url, {
    method: "PATCH",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify({ credits })
  });
}

async function getUserGenerationRows(uid, run_id) {
  if (!UG_URL || !SERVICE_KEY) return [];
  // Try to locate the placeholder row by meta.run_id
  const url = `${UG_URL}?select=id,meta&user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&limit=10`;
  try {
    const out = await sbFetch(url, {
      method: "GET",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Accept": "application/json"
      }
    });
    return Array.isArray(out) ? out : [];
  } catch (e) {
    // If JSON filter is unsupported in this project schema, silently ignore
    return [];
  }
}

async function markUserGenerationCharged(uid, run_id, rows, extraMeta) {
  if (!UG_URL || !SERVICE_KEY) return;
  const arr = Array.isArray(rows) ? rows : [];
  // Update by id when possible (best-effort)
  for (const r of arr) {
    const id = r && r.id;
    const meta = (r && r.meta && typeof r.meta === "object") ? r.meta : {};
    const nextMeta = { ...meta, ...(extraMeta || {}), run_id, charged: true, charge_claim: true, charged_at: new Date().toISOString() };
    if (!id) continue;
    const url = `${UG_URL}?id=eq.${encodeURIComponent(id)}`;
    try {
      await sbFetch(url, {
        method: "PATCH",
        headers: {
          "apikey": SERVICE_KEY,
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({ meta: nextMeta })
      });
    } catch {}
  }
}

function err(code, json) {
  return {
    statusCode: code,
    headers: { ...cors(), "X-MIDIMAGE-Version": VERSION_TAG },
    body: JSON.stringify(json || { error: "error" })
  };
}

function normalizeAspect(v) {
  if (!v) return "2:3";
  const s = String(v).trim().toLowerCase();
  // Accept many MJ ratios, default to 2:3 if unfamiliar
  const allowed = new Set(["2:3","3:2","1:1","3:4","4:3","9:16","16:9","5:6","6:5","4:5","5:4","7:4","4:7"]);
  if (allowed.has(s)) return s;
  const coerced = s.replace(/(\d)[_\-:](\d)/g, "$1:$2");
  return allowed.has(coerced) ? coerced : "2:3";
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
