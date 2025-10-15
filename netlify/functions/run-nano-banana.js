// netlify/functions/run-nano-banana.js
// Create Nano Banana job and immediately return "submitted".
// KIE will POST the final result to our callback; UI should watch Supabase by run_id.

const CREATE_URL = process.env.KIE_CREATE_URL || "https://api.kie.ai/api/v1/jobs/createTask";
const API_KEY = process.env.KIE_API_KEY;

if (!API_KEY) console.warn("[run-nano-banana] Missing KIE_API_KEY env!");
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UG_URL = (process.env.SUPABASE_URL ? process.env.SUPABASE_URL + '/rest/v1/user_generations' : undefined);


// Base Netlify Functions callback (WITH DOT)
const CALLBACK_URL = "https://webhansora.netlify.app/.netlify/functions/kie-callback";
const VERSION_TAG  = "nb_fn_final_submit_only_qs";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Use POST" };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    // Required inputs
    const rawUrls = Array.isArray(body.urls) ? body.urls : [];
    if (!rawUrls.length) {
      return ok({ submitted: false, note: "urls_required", version: VERSION_TAG });
    }

    // Normalize/encode URLs (handles spaces/commas)
    const image_urls = rawUrls.map(u => encodeURI(String(u)));

    const prompt  = body.prompt || "";
    const format  = (body.format || "png").toLowerCase();
    const size    = normalizeImageSize(body.size);

    // Identify the user/run to bind result
    const uid    = event.headers["x-user-id"] || event.headers["X-USER-ID"] || "anon";
    const run_id = body.run_id || `${uid}-${Date.now()}`;

    // include uid & run_id in the callback URL (works even if KIE posts non-JSON)
    const cb = `${CALLBACK_URL}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    // Build KIE payload
    const payload = {
      model: "google/nano-banana-edit",
      input: { prompt, image_urls, output_format: format, image_size: size },

      // Callbacks (add all variants)
      webhook_url: cb,
      webhookUrl:  cb, // ← added line (minimal change)
      callbackUrl: cb,
      callBackUrl: cb,
      notify_url:  cb,

      // meta used by kie-callback.js
      meta:      { uid, run_id, version: VERSION_TAG, cb },
      metadata:  { uid, run_id, version: VERSION_TAG, cb }
    };

    // Create the job
    const create = await fetch(CREATE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type":  "application/json",
        "Accept":        "application/json"
      },
      body: JSON.stringify(payload)
    });

    // Parse response (even if not 200)
    const text = await create.text();
    let js; try { js = JSON.parse(text); } catch { js = { raw: text }; }

    // Best-effort taskId extraction
    const taskId =
      js.taskId || js.id || js.data?.taskId || js.data?.id || null;
    // --- server-side placeholder: ensures Usage shows even if client closes ---
    try {
      if (UG_URL && SERVICE_KEY && uid && uid !== 'anon') {
        const bodyPlaceholder = {
          user_id: uid,
          provider: 'Nano Banana',
          kind: 'image',
          prompt,
          result_url: null,
          meta: { run_id, task_id: taskId, size, status: 'processing' }
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
      console.warn('[nb] placeholder insert failed', e);
    }

    // --- debit credits immediately on accepted submit (server-side) ---
    try {
      const COST = 0; // adjust if Nano Banana uses a different cost
      if (SUPABASE_URL && SERVICE_KEY && uid && uid !== 'anon') {
        // re-check current credits and subtract one
        const base = SUPABASE_URL;
        const profGet = `${base}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
        const r0 = await fetch(profGet, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
        const j0 = await r0.json();
        const c0 = (Array.isArray(j0) && j0[0] && j0[0].credits) || 0;
        if (c0 > 0) {
          await fetch(`${base}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`, {
            method: 'PATCH',
            headers: {
              'apikey': SERVICE_KEY,
              'Authorization': `Bearer ${SERVICE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ credits: c0 - COST })
          });
        }
      }
    } catch (e) {
      console.warn('[nb] debit credits failed', e);
    }



    // Always return 200 submitted (let callback deliver final result)
    return ok({
      submitted: true,
      taskId,
      run_id,
      version: VERSION_TAG,
      used_callback: cb
    });

  } catch (e) {
    // Still 200 so the UI stays in "submitted" and waits for callback
    return ok({ submitted: true, note: "exception", message: String(e), version: VERSION_TAG });
  }
};

// ───────────────────────────────── helpers

function normalizeImageSize(v) {
  if (!v) return "auto";
  const s = String(v).trim().toLowerCase();

  // Pass through if already valid ratio or auto
  const direct = new Set(["auto", "1:1", "3:4", "4:3", "9:16", "16:9"]);
  if (direct.has(s)) return s;

  // Map named tokens to ratio strings (KIE-accepted)
  if (s === "square") return "1:1";
  if (s === "portrait_3_4") return "3:4";
  if (s === "portrait_9_16") return "9:16";
  if (s === "landscape_4_3") return "4:3";
  if (s === "landscape_16_9") return "16:9";

  // Coerce variants like "16_9", "16-9" → "16:9"
  const coerced = s.replace(/(\d)[_\-:](\d)/g, "$1:$2");
  if (direct.has(coerced)) return coerced;

  return "auto";
}

function ok(json) {
  return {
    statusCode: 200,
    headers: { ...cors(), "X-NB-Version": VERSION_TAG },
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
