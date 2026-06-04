// netlify/functions/run-video-prompt-builder.js
// KIE Claude Opus 4.8 launcher for the video prompt builder.
// This function returns fast. The long Claude call runs in
// video-prompt-builder-worker-background.js, then the checker reads Supabase.

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const SITE_BASE = (process.env.SITE_BASE || "https://hansora.co").replace(/\/+$/, "");
const WORKER_URL =
  process.env.VIDEO_PROMPT_WORKER_URL ||
  `${SITE_BASE}/.netlify/functions/video-prompt-builder-worker-background`;
const WORKER_SECRET = process.env.VIDEO_PROMPT_WORKER_SECRET || "";

const MODEL = "claude-opus-4-8";
const COST = 1;
const VERSION_TAG = "video_prompt_builder_claude_opus_4_8_background_v8";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "*"
  };
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...cors() },
    body: JSON.stringify(body)
  };
}

function getHeader(event, key) {
  return event.headers?.[key] || event.headers?.[key.toLowerCase()] || event.headers?.[key.toUpperCase()] || "";
}

function getUID(event, body) {
  const qs = event.queryStringParameters || {};
  return String(getHeader(event, "x-user-id") || body?.uid || qs.uid || "").trim();
}

async function getUidFromBearer(event) {
  const auth = String(getHeader(event, "authorization") || "").trim();
  const match = auth.match(/Bearer\s+(.+)/i);
  if (!match || !SUPABASE_URL || !SERVICE_KEY) return "";
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${match[1].trim()}` }
    });
    if (!response.ok) return "";
    const data = await response.json().catch(() => null);
    return String(data?.id || data?.user?.id || "").trim();
  } catch (_) {
    return "";
  }
}

function sbHeaders(extra = {}) {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...extra };
}

function buildPrompt(userIdea) {
  return `You are an expert cinematic 3D animation director, story artist, scene planner, prompt engineer, and timing supervisor.

Your task is to transform the user’s simple idea into an extremely detailed video-generation prompt for a premium family-friendly 3D animated feature-film scene.

The final prompt must feel like a high-budget animated movie scene, with warm cinematic lighting, expressive characters, smooth camera movement, emotional storytelling, clear timing, perfect scene progression, and realistic 3D animation details.

CRITICAL USER-INTENT LOCK:
Before expanding the idea, identify the user’s exact main action, subject, relationship, mood, location, direction of movement, and intended ending.

Preserve the user’s core idea exactly.
Do not reverse the action.
Do not change the relationship.
Do not change the emotional meaning.
Do not replace the main event with a different event.
Do not make the character do the opposite of what the user requested.
Do not turn a short idea into a different story.

If the user gives a very short idea, expand it into clear visual storytelling while keeping the same meaning. Add specific cinematic actions only to make the idea more visible, emotional, and understandable.

At the beginning of the final video prompt, write one clear sentence that locks the user’s original idea, action, emotion, and story direction. This sentence must be generated from the user’s idea automatically.

Do NOT write a short prompt.
Do NOT make it vague.
Do NOT skip timing.
Do NOT skip camera movement.
Do NOT skip character actions.
Do NOT skip environment details.
Do NOT skip lighting details.
Do NOT skip facial expressions.
Do NOT skip body movement.
Do NOT skip sound/music direction.
Do NOT create random new story elements unless they clearly support the user’s original idea.
Do NOT make the scene confusing or too fast.

Write the final result as a complete video prompt that can be pasted directly into an AI video model.

STYLE REQUIREMENTS:
Create a premium cinematic 3D animated feature-film look, similar to high-end family animation movies: soft expressive faces, detailed character design, polished 3D textures, warm emotional lighting, smooth believable motion, rich environments, cinematic composition, strong storytelling, and clear character acting.

The style should feel expensive, magical, emotional, and professional, but do not copy any existing movie, character, studio, franchise, or copyrighted design.

VIDEO FORMAT:
Aspect ratio: 16:9 horizontal cinematic widescreen.
Duration: 15 seconds.
Camera: smooth professional cinematic camera movement.
Scene structure: exact timing from 0.0s to 15.0s.
The scene must have a clear beginning, middle, and ending.
Every second must have a purpose.

SHORT IDEA EXPANSION RULES:
If the user’s idea is short, improve it by adding visible physical actions, clear emotional reactions, natural body movement, a strong beginning, middle, and ending, cinematic camera direction, environmental details, lighting changes, sound and music cues, small character acting details, and a clear final emotional beat.

Never add anything that changes the main meaning of the user’s idea.

MAIN ACTION CLARITY:
The main action must start early enough to be clearly shown within 15 seconds.
Do not spend too much time on setup.
The viewer must understand the story even without dialogue.
The most important action must be visually obvious.
The ending must clearly resolve the moment.

LANGUAGE RULE:
Write the entire output in the same language as the user’s idea. If the user’s idea is Russian, write Russian. If it is Armenian, write Armenian. If it is English, write English. Preserve the user’s language naturally while keeping the exact structure below.

OUTPUT FORMAT:
Give the final answer in this exact structure:

1. FINAL VIDEO PROMPT
   Write one complete, highly detailed video prompt.

2. TIMING BREAKDOWN
   Break the full 15 seconds into exact timestamps:
   0.0–2.0s
   2.0–4.0s
   4.0–6.0s
   6.0–8.0s
   8.0–10.0s
   10.0–12.0s
   12.0–15.0s

For every timing section, describe:

* character action
* facial expression
* body movement
* camera movement
* lighting changes
* environment movement
* emotional feeling
* sound/music cue

3. CAMERA DIRECTION
   Describe lens, framing, movement, focus, depth of field, close-ups, wide shots, tracking shots, camera height, camera speed, and final shot composition.

4. CHARACTER ANIMATION
   Describe small acting details:
   eye movement, blinking, breathing, hands, posture, hair movement, clothing movement, reaction timing, emotional expression, weight shifts, pauses, and natural physical behavior.

5. ENVIRONMENT AND LIGHTING
   Describe background, props, atmosphere, shadows, color palette, reflections, particles, texture details, and how lighting supports the mood.

6. AUDIO DIRECTION
   Describe music, ambience, sound effects, emotional sound moments, and what should happen exactly at important seconds.

7. NEGATIVE INSTRUCTIONS
   Write what the video must avoid:
   bad anatomy, distorted faces, extra fingers, flickering, random cuts, unstable camera, fast confusing motion, wrong character identity, inconsistent clothing, blurry faces, low-quality textures, broken objects, strange expressions, unreadable storytelling, sudden scene changes, unnatural animation, reversed story direction, changed main action, changed relationship, changed mood, or a different ending than the user requested.

8. FINAL CLEAN PROMPT
   After all analysis, write a polished final version in one copyable block, without extra explanation.

IMPORTANT QUALITY RULES:
The scene must feel intentional, not random.
The character must move naturally, not stiff.
The emotion must build gradually.
The camera must not jump randomly.
The lighting must stay consistent.
The ending must feel clear and cinematic.
The main action must be understandable even without dialogue.
The video should feel like one continuous professional animated scene.
The user’s original idea must remain the foundation of the entire prompt.

USER IDEA:
${userIdea}`;
}

async function seedGeneration(uid, runId, userIdea, prompt) {
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return { row_id: null };
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/user_generations`, {
      method: "POST",
      headers: sbHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify({
        user_id: uid,
        provider: "Claude Opus 4.8",
        kind: "text",
        prompt: userIdea,
        result_url: null,
        meta: {
          source: "video-prompt-builder",
          run_id: runId,
          model: MODEL,
          status: "pending",
          refund_amount: COST,
          request_prompt: prompt
        }
      })
    });
    if (!response.ok) return { row_id: null };
    const rows = await response.json().catch(() => []);
    return { row_id: Array.isArray(rows) && rows[0]?.id ? rows[0].id : null };
  } catch (_) {
    return { row_id: null };
  }
}

async function fetchGenerationByRunId(uid, runId) {
  if (!SUPABASE_URL || !SERVICE_KEY || !uid || !runId) return null;
  try {
    const query = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(runId)}&select=id,meta`;
    const response = await fetch(`${SUPABASE_URL}/rest/v1/user_generations${query}`, { headers: sbHeaders() });
    if (!response.ok) return null;
    const rows = await response.json().catch(() => []);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (_) {
    return null;
  }
}

async function patchGenerationMeta(id, meta) {
  if (!SUPABASE_URL || !SERVICE_KEY || !id) return false;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: sbHeaders({
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      }),
      body: JSON.stringify({ meta })
    });
    return response.ok;
  } catch (_) {
    return false;
  }
}

async function patchGeneration(id, payload) {
  if (!SUPABASE_URL || !SERVICE_KEY || !id) return false;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: sbHeaders({
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      }),
      body: JSON.stringify(payload)
    });
    return response.ok;
  } catch (_) {
    return false;
  }
}

async function debitCredits(uid, cost) {
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return { ok: false, error: "missing_env_or_uid" };
  try {
    const profileResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits&limit=1`,
      { headers: sbHeaders() }
    );
    if (!profileResponse.ok) return { ok: false, error: "profile_fetch_failed", status: profileResponse.status };
    const profiles = await profileResponse.json().catch(() => []);
    const current = Number(Array.isArray(profiles) && profiles[0] ? profiles[0].credits : 0);
    if (current < cost) return { ok: false, error: "insufficient_credits", credits: current };
    const next = Math.round((current - cost) * 100) / 100;
    const updateResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`, {
      method: "PATCH",
      headers: sbHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify({ credits: next })
    });
    if (!updateResponse.ok) return { ok: false, error: "profile_update_failed", status: updateResponse.status };
    return { ok: true, credits: next };
  } catch (error) {
    return { ok: false, error: "server_exception", details: String(error?.message || error) };
  }
}

async function chargeOnceForRun(uid, runId, cost, rowId, baseMeta) {
  if (!SUPABASE_URL || !SERVICE_KEY || !uid || !runId) {
    const debit = await debitCredits(uid, cost);
    return { ok: !!debit.ok, debit, already: false };
  }

  const existing = await fetchGenerationByRunId(uid, runId);
  const meta0 = existing?.meta || baseMeta || {};
  if (String(meta0.charged || "").toLowerCase() === "true") {
    return { ok: true, debit: { ok: true, credits: null }, already: true };
  }

  const claim = `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const claimMeta = { ...meta0, ...baseMeta, charge_claim: claim };
  const query = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(runId)}&meta->>charged=is.null&meta->>charge_claim=is.null&select=id`;
  const claimResponse = await fetch(`${SUPABASE_URL}/rest/v1/user_generations${query}`, {
    method: "PATCH",
    headers: sbHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify({ meta: claimMeta })
  });
  const claimedRows = await claimResponse.json().catch(() => []);
  const claimed = claimResponse.ok && Array.isArray(claimedRows) && claimedRows.length > 0;

  if (!claimed) {
    const after = await fetchGenerationByRunId(uid, runId);
    if (String(after?.meta?.charged || "").toLowerCase() === "true") {
      return { ok: true, debit: { ok: true, credits: null }, already: true };
    }
    return { ok: false, error: "charge_in_progress" };
  }

  const targetId = rowId || claimedRows[0]?.id || existing?.id;
  const debit = await debitCredits(uid, cost);
  if (!debit.ok) {
    const rollback = { ...claimMeta };
    delete rollback.charge_claim;
    await patchGenerationMeta(targetId, rollback);
    return { ok: false, debit };
  }

  await patchGenerationMeta(targetId, {
    ...claimMeta,
    charged: "true",
    charged_cost: cost,
    charged_at: new Date().toISOString()
  });
  return { ok: true, debit, already: false };
}

async function refundOnce(rowId, uid, amount, reason) {
  if (!SUPABASE_URL || !SERVICE_KEY || !rowId || !uid || !Number.isFinite(amount) || amount <= 0) {
    return { refunded: false, amount: 0 };
  }

  const rowResponse = await fetch(`${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(rowId)}&select=id,meta,user_id&limit=1`, {
    headers: sbHeaders()
  });
  const rows = await rowResponse.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : null;
  const meta = row?.meta && typeof row.meta === "object" ? row.meta : {};
  if (String(meta.refunded || "").toLowerCase() === "true") {
    return { refunded: false, amount, already_refunded: true };
  }

  const profileResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits&limit=1`, {
    headers: sbHeaders()
  });
  const profiles = await profileResponse.json().catch(() => []);
  const current = Number(Array.isArray(profiles) && profiles[0] ? profiles[0].credits : 0);
  const next = Math.round((current + amount) * 100) / 100;
  const updateResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`, {
    method: "PATCH",
    headers: sbHeaders({
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    }),
    body: JSON.stringify({ credits: next })
  });
  if (!updateResponse.ok) return { refunded: false, amount, error: "profile_refund_failed" };

  await patchGenerationMeta(rowId, {
    ...meta,
    status: "failed",
    failed: true,
    error: reason,
    refunded: true,
    refunded_cost: amount,
    refunded_at: new Date().toISOString()
  });

  return { refunded: true, amount, credits: next };
}

async function invokeWorker(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(WORKER_SECRET ? { "X-Worker-Secret": WORKER_SECRET } : {})
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      data = { raw };
    }
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "method_not_allowed", version: VERSION_TAG });

  try {
    const body = JSON.parse(event.body || "{}");
    let uid = getUID(event, body);
    if (!uid || uid === "anon") {
      uid = await getUidFromBearer(event);
    }
    if (!uid) return json(401, { ok: false, error: "missing_user", version: VERSION_TAG });

    const runId = String(body.run_id || body.runId || `${uid}-${Date.now()}`);
    const userIdea = String(body.user_idea || body.idea || body.prompt || "").trim();
    if (userIdea.length < 3) return json(400, { ok: false, error: "missing_user_idea", version: VERSION_TAG });

    const prompt = buildPrompt(userIdea);
    const seeded = await seedGeneration(uid, runId, userIdea, prompt);
    const rowId = seeded.row_id || null;

    const baseMeta = {
      source: "video-prompt-builder",
      run_id: runId,
      model: MODEL,
      status: "processing",
      worker: "video-prompt-builder-worker-background",
      refund_amount: COST
    };

    const charged = await chargeOnceForRun(uid, runId, COST, rowId, baseMeta);
    if (!charged.ok) {
      if (charged.error === "charge_in_progress") {
        return json(409, { ok: false, error: "charge_in_progress", version: VERSION_TAG });
      }
      if (charged.debit?.error === "insufficient_credits") {
        return json(402, { ok: false, error: "not_enough_credits", credits: charged.debit.credits, version: VERSION_TAG });
      }
      return json(500, { ok: false, error: "charge_failed", details: charged.debit || charged, version: VERSION_TAG });
    }

    const worker = await invokeWorker({ uid, run_id: runId, row_id: rowId, user_idea: userIdea, prompt, model: MODEL, cost: COST });
    if (!worker.ok) {
      if (rowId) {
        await patchGenerationMeta(rowId, {
          ...baseMeta,
          status: "failed",
          failed: true,
          error: "worker_enqueue_failed",
          worker_response: worker,
          failed_at: new Date().toISOString()
        });
        await refundOnce(rowId, uid, COST, "worker_enqueue_failed");
      }
      return json(502, { ok: false, error: "worker_enqueue_failed", response: worker, version: VERSION_TAG });
    }

    return json(201, {
      ok: true,
      status: "submitted",
      submitted: true,
      id: "",
      taskId: "",
      run_id: runId,
      row_id: rowId,
      cost: COST,
      credits: charged.debit?.credits ?? null,
      model: MODEL,
      checker: "video-prompt-builder-check",
      worker: "video-prompt-builder-worker-background",
      version: VERSION_TAG
    });
  } catch (error) {
    return json(500, { ok: false, error: "exception", message: String(error?.message || error), version: VERSION_TAG });
  }
};
