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
      callBackUrl: cb, // KEEP existing field
      // pass meta as well in case KIE forwards it
      meta: { uid, run_id, provider: "MidJourney", version: VERSION_TAG }
    };

    // *** ADDED (minimal): set all common callback aliases ***
    payload.callbackUrl = cb;   // alias (lower camel)
    payload.webhook_url = cb;   // alias (snake)
    payload.webhookUrl  = cb;   // alias (camel)
    payload.notify_url  = cb;   // alias (notify)
    // *** ADDED (minimal): mirror identifiers into `metadata` too ***
    payload.metadata = { ...(payload.metadata||{}), uid, run_id, cb, version: VERSION_TAG };

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

    // NO server-side debit (client deducts 1⚡)

    return ok({
      submitted: true,
      taskId,
      run_id,
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
