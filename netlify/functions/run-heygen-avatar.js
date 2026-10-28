// netlify/functions/run-heygen-avatar.js
// HeyGen talking-avatar submitter for one image + one audio file.
// Server-side Supabase auth, placeholder row, idempotent charge per (uid + run_id), and HeyGen submit.
// Env: HeyGen_api or HEYGEN_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Opt: SITE_BASE (default https://hansora.co)

const HEYGEN_API_ENV = pickEnv("HEYGEN_API_KEY", "HeyGen_api", "HEYGEN_API", "HeyGen_API");
const HEYGEN_API_KEY = HEYGEN_API_ENV.value;
const HEYGEN_BASE = (process.env.HEYGEN_BASE_URL || "https://api.heygen.com").replace(/\/+$/, "");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";
const AUTH_USER_URL = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1/user` : "";

const SITE_BASE = (process.env.SITE_BASE || "https://hansora.co").replace(/\/+$/, "");
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/heygen-check`;
const { createHash, randomUUID } = require("node:crypto");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return err(405, "Use POST");

  try {
    const headers = lowerKeys(event.headers || {});
    const body = safeJson(event.body);

    if (!HEYGEN_API_KEY) return ok({ submitted: false, error: "missing_heygen_api_key" });
    if (!SUPABASE_URL || !SERVICE_KEY) return ok({ submitted: false, error: "missing_supabase_server_env" });

    const uid = String(body.uid || body.user_id || "").trim();
    if (!uid) return ok({ submitted: false, error: "missing_uid" });

    const authz = String(headers.authorization || "");
    const token = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
    if (!token) return ok({ submitted: false, error: "missing_auth" });

    const authedUid = await verifyUser(token);
    if (!authedUid || authedUid !== uid) return ok({ submitted: false, error: "auth_mismatch" });

    const clientRunId = String(body.run_id || body.runId || "").trim();
    const run_id = clientRunId || `${uid}-${Date.now()}`;
    const existing = await getExistingTask(uid, run_id);
    if (existing?.meta?.status === "failed" || existing?.meta?.refunded) {
      return ok({ submitted: false, error: existing.meta.error || "generation_failed", run_id });
    }
    if (existing?.taskId) {
      return ok({ submitted: true, run_id, taskId: existing.taskId, video_id: existing.taskId, already: true });
    }

    // Resuming an async photo avatar must use the originally authorized inputs.
    const saved = existing?.meta || {};
    const model = normalizeModel(saved.model || body.model || body.engine || "avatar_v");
    const imageUrl = normalizeUrl(saved.image_url || body.imageUrl || body.image_url || "");
    const audioUrl = normalizeUrl(saved.audio_url || body.audioUrl || body.audio_url || "");
    const aspectRatio = normalizeAspect(saved.aspect_ratio || body.aspect_ratio || body.aspectRatio || "9:16");
    const durationSeconds = normalizeDuration(saved.duration_seconds || body.duration_seconds || body.duration || 0);
    const billableSeconds = Math.ceil(durationSeconds);
    const rate = model === "avatar_v" ? 0.7 : 0.3;
    const cost = roundCredits(billableSeconds * rate);

    if (!imageUrl) return ok({ submitted: false, error: "missing_image_url", run_id });
    if (!audioUrl) return ok({ submitted: false, error: "missing_audio_url", run_id });
    if (!durationSeconds) return ok({ submitted: false, error: "missing_audio_duration", run_id });
    if (durationSeconds < 5) return ok({ submitted: false, error: "audio_too_short_min_5_seconds", run_id });
    if (durationSeconds > 90.25) return ok({ submitted: false, error: "audio_too_long_max_90_seconds", run_id });

    const currentCredits = await getCredits(uid);
    if (currentCredits < cost) {
      return ok({ submitted: false, error: "insufficient_credits", needed: cost, credits: currentCredits, run_id });
    }

    await seedPlaceholder(uid, run_id, {
      model,
      imageUrl,
      audioUrl,
      aspectRatio,
      durationSeconds,
      billableSeconds,
      cost
    });

    const claim = await claimSubmission(uid, run_id);
    if (!claim) return ok({ submitted: true, pending: true, run_id });
    try {
      const callbackUrl = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;
      let heygenResult;
      try {
        heygenResult = await submitHeyGen({
          model,
          imageUrl,
          audioUrl,
          aspectRatio,
          billableSeconds,
          run_id,
          callbackUrl,
          uid,
          avatarId: claim.meta.avatar_id || ""
        });
      } catch (error) {
        // HeyGen often keeps making the video after a slow reply. Never report that as a failure: the run
        // stays "processing" and the next status check sends it again with the same Idempotency-Key, which
        // returns the same video instead of a new one. Nothing is charged until a video id comes back.
        if (!isSlowReply(error)) throw error;
        await patchMeta(uid, run_id, { heygen_submit_uncertain: true, heygen_submit_uncertain_at: new Date().toISOString() });
        return ok({ submitted: true, pending: true, run_id, status: "processing" });
      }

      // Busy or briefly down: nothing was made, so wait and send it again from the next status check.
      if (!heygenResult.ok && /^heygen_video_(429|5\d\d)$/.test(String(heygenResult.error || ""))) {
        await patchMeta(uid, run_id, { heygen_submit_retry: heygenResult.error, heygen_submit_retry_at: new Date().toISOString() });
        return ok({ submitted: true, pending: true, run_id, status: "processing" });
      }

      if (heygenResult.pending) {
        return ok({ submitted: true, pending: true, run_id, status: "processing" });
      }

      if (!heygenResult.ok) {
        await patchMeta(uid, run_id, {
          status: "failed",
          error: heygenResult.error || "heygen_submit_failed",
          heygen_response: heygenResult.data || null
        });
        return ok({
          submitted: false,
          error: heygenResult.error || "heygen_submit_failed",
          data: heygenResult.data,
          provider_message: extractProviderMessage(heygenResult.data),
          failed_stage: heygenResult.failedStage || "",
          avatar_id: heygenResult.avatarId || "",
          run_id,
          heygen_auth_debug: safeHeyGenAuthDebug()
        });
      }

      const taskId = String(heygenResult.videoId || "").trim();
      if (!taskId) {
        await patchMeta(uid, run_id, { status: "failed", error: "missing_video_id", heygen_response: heygenResult.data || null });
        return ok({ submitted: false, error: "missing_video_id", data: heygenResult.data, run_id });
      }

      const finalCost = Number.isFinite(Number(heygenResult.finalCost)) ? Number(heygenResult.finalCost) : cost;
      const charged = await isCharged(uid, run_id);
      if (!charged) {
        const debited = await debitCredits(uid, finalCost);
        if (!debited) {
          await patchMeta(uid, run_id, { status: "failed", error: "debit_failed", task_id: taskId, video_id: taskId });
          return ok({ submitted: false, error: "debit_failed", run_id, taskId, video_id: taskId });
        }
      }

      await markCharged(uid, run_id, finalCost, taskId, {
        model,
        provider_api: heygenResult.apiVersion,
        requested_model: heygenResult.requestedModel || model,
        heygen_engine: heygenResult.heygenEngine || "",
        fallback_reason: heygenResult.fallbackReason || "",
        avatar_id: heygenResult.avatarId || "",
        submit_response: heygenResult.data || null
      });

      return ok({
        submitted: true,
        run_id,
        taskId,
        video_id: taskId,
        cost: finalCost,
        billable_seconds: billableSeconds,
        requested_model: heygenResult.requestedModel || model,
        heygen_engine: heygenResult.heygenEngine || "",
        fallback_reason: heygenResult.fallbackReason || "",
        data: heygenResult.data
      });
    } finally {
      await releaseSubmission(uid, run_id, claim.token);
    }
  } catch (error) {
    return ok({ submitted: false, error: messageOf(error) });
  }
};

// API contract: https://developers.heygen.com/reference/create-video
async function submitHeyGen({ model, imageUrl, audioUrl, aspectRatio, billableSeconds, run_id, callbackUrl, uid, avatarId }) {
  if (model === "avatar_iii") {
    return submitAvatarIII({ uid, imageUrl, audioUrl, aspectRatio, billableSeconds, run_id, callbackUrl, avatarId });
  }
  const videoResp = await heygenFetch("/v3/videos", {
    timeoutMs: VIDEO_CREATE_TIMEOUT_MS,
    method: "POST",
    headers: { "Idempotency-Key": providerKey(uid, run_id, "video") },
    body: JSON.stringify({
      type: "image",
      image: { type: "url", url: imageUrl },
      audio_url: audioUrl,
      title: `Hansora Avatar IV ${run_id}`,
      resolution: "1080p",
      aspect_ratio: aspectRatio,
      callback_url: callbackUrl,
      callback_id: run_id
    })
  });
  return {
    ok: videoResp.ok,
    error: videoResp.ok ? "" : `heygen_video_${videoResp.status}`,
    videoId: extractVideoId(videoResp.data),
    data: videoResp.data,
    apiVersion: "v3",
    requestedModel: model,
    heygenEngine: "AvatarIV",
    failedStage: videoResp.ok ? "" : "video_create"
  };
}

// Avatar III cannot render type:image. Create a photo look, then wait for it
// across authenticated browser polls instead of blocking a Netlify invocation.
// https://developers.heygen.com/docs/avatar-from-photo
// https://developers.heygen.com/avatar-iii
async function submitAvatarIII({ uid, imageUrl, audioUrl, aspectRatio, billableSeconds, run_id, callbackUrl, avatarId }) {
  if (!avatarId) {
    const created = await heygenFetch("/v3/avatars", {
      method: "POST",
      headers: { "Idempotency-Key": providerKey(uid, run_id, "photo") },
      body: JSON.stringify({ type: "photo", name: `Hansora ${run_id}`, file: { type: "url", url: imageUrl } })
    });
    if (!created.ok) return { ok: false, error: `heygen_avatar_create_${created.status}`, data: created.data, failedStage: "avatar_create" };
    avatarId = extractAvatarId(created.data);
    if (!avatarId) return { ok: false, error: "missing_avatar_id", data: created.data, failedStage: "avatar_create" };
    await patchMeta(uid, run_id, {
      avatar_id: avatarId,
      avatar_create_response: created.data,
      provider_api: "v3",
      heygen_stage: "avatar_processing"
    });
  }

  const lookResp = await heygenFetch(`/v3/avatars/looks/${encodeURIComponent(avatarId)}`);
  if (!lookResp.ok) {
    if (lookResp.status === 429 || lookResp.status >= 500 || lookResp.status === 404) return { pending: true };
    return { ok: false, error: `heygen_avatar_status_${lookResp.status}`, data: lookResp.data, failedStage: "avatar_processing" };
  }
  const look = lookResp.data?.data || lookResp.data;
  if (look?.status === "failed") return { ok: false, error: look.error?.message || "heygen_avatar_failed", data: lookResp.data, failedStage: "avatar_processing" };
  if (look?.status !== "completed") return { pending: true };
  if (!Array.isArray(look.supported_api_engines) || !look.supported_api_engines.includes("avatar_iii")) {
    return { ok: false, error: "avatar_iii_not_supported", data: lookResp.data, failedStage: "avatar_processing" };
  }

  const resp = await heygenFetch("/v3/videos", {
    method: "POST",
    headers: { "Idempotency-Key": providerKey(uid, run_id, "video") },
    body: JSON.stringify({
      type: "avatar",
      avatar_id: avatarId,
      engine: { type: "avatar_iii" },
      audio_url: audioUrl,
      title: `Hansora Avatar III ${run_id}`,
      resolution: "1080p",
      aspect_ratio: aspectRatio,
      background: { type: "color", value: "#f6f6fc" },
      callback_url: callbackUrl,
      callback_id: run_id
    })
  });
  // An identical concurrent request may still be processing at HeyGen.
  if (resp.status === 409 && resp.data?.error?.code === "request_in_progress") return { pending: true };
  return {
    ok: resp.ok,
    error: resp.ok ? "" : `heygen_video_${resp.status}`,
    videoId: extractVideoId(resp.data),
    data: resp.data,
    apiVersion: "v3",
    requestedModel: "avatar_iii",
    heygenEngine: "AvatarIII",
    finalCost: roundCredits(Number(billableSeconds || 0) * 0.3),
    avatarId,
    failedStage: resp.ok ? "" : "video_create"
  };
}

function providerKey(uid, run_id, stage) {
  return `hansora-${stage}-${createHash("sha256").update(JSON.stringify([uid, run_id])).digest("hex")}`;
}

// A compare-and-set lease serializes repeated polls before submitting or
// debiting. The lease outlasts the 60-second Netlify invocation limit.
async function claimSubmission(uid, run_id) {
  const row = await getGeneration(uid, run_id);
  if (!row) throw new Error("missing_generation_row");
  const meta = row.meta || {};
  if (meta.task_id || meta.video_id || meta.status === "failed") return null;
  if (meta.heygen_submit_claim && Date.now() - Number(meta.heygen_submit_claim_at || 0) < 120000) return null;
  const token = randomUUID();
  const previous = meta.heygen_submit_claim;
  const condition = previous ? `eq.${encodeURIComponent(previous)}` : "is.null";
  const res = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}&meta->>heygen_submit_claim=${condition}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ meta: { ...meta, heygen_submit_claim: token, heygen_submit_claim_at: Date.now() } })
  });
  const rows = await res.json().catch(() => []);
  if (!res.ok) throw new Error("submission_claim_failed");
  return Array.isArray(rows) && rows.length ? { token, meta: rows[0].meta } : null;
}

async function releaseSubmission(uid, run_id, token) {
  const row = await getGeneration(uid, run_id);
  if (!row || row.meta?.heygen_submit_claim !== token) return;
  const res = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}&meta->>heygen_submit_claim=eq.${encodeURIComponent(token)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ meta: { ...row.meta, heygen_submit_claim: null, heygen_submit_claim_at: null } })
  });
  if (!res.ok) throw new Error("submission_release_failed");
}

// HeyGen takes in the photo and audio before it answers a video request, which can take well over 10
// seconds; the function itself may run for 60.
const VIDEO_CREATE_TIMEOUT_MS = 40000;
function isSlowReply(error) {
  return /abort|timeout|timed out|fetch failed|network|ECONNRESET|socket/i.test(`${error?.name || ""} ${error?.message || ""}`);
}

async function heygenFetch(path, { timeoutMs = 10000, ...options } = {}) {
  const resp = await fetch(`${HEYGEN_BASE}${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
    ...options,
    headers: {
      "x-api-key": HEYGEN_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {})
    }
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text || "{}"); } catch { data = { raw: text }; }
  return { ok: resp.ok, status: resp.status, data };
}

function ok(obj) { return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code, message) { return { statusCode: code, headers: cors(), body: JSON.stringify({ submitted: false, error: message }) }; }
function pickEnv(...names) {
  for (const name of names) {
    const value = cleanApiKey(process.env[name]);
    if (value) return { name, value };
  }
  return { name: "", value: "" };
}
function cleanApiKey(value) {
  let text = String(value || "").trim();
  text = text.replace(/^['"]|['"]$/g, "").trim();
  text = text.replace(/^bearer\s+/i, "").trim();
  text = text.replace(/\s+/g, "");
  return text;
}
function safeHeyGenAuthDebug() {
  return {
    env: HEYGEN_API_ENV.name || "missing",
    key_length: HEYGEN_API_KEY.length,
    key_prefix: HEYGEN_API_KEY ? HEYGEN_API_KEY.slice(0, 5) : "",
    key_suffix: HEYGEN_API_KEY ? HEYGEN_API_KEY.slice(-4) : "",
    base: HEYGEN_BASE
  };
}
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-USER-ID"
  };
}
function lowerKeys(headers) { const out = {}; for (const k in headers) out[k.toLowerCase()] = headers[k]; return out; }
function safeJson(raw) { try { return JSON.parse(raw || "{}"); } catch { return {}; } }
function messageOf(error) { return error && error.message ? error.message : String(error); }
function extractProviderMessage(data) {
  return String(data?.error?.message || data?.data?.error?.message || data?.message || "");
}
function sb() { return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }; }

function normalizeUrl(value) {
  try { return new URL(String(value || "").trim()).href; } catch { return ""; }
}
function normalizeAspect(value) {
  const v = String(value || "").trim();
  return /^(16:9|9:16)$/.test(v) ? v : "9:16";
}
function normalizeModel(value) {
  const v = String(value || "").toLowerCase().replace(/\s+/g, "").replace(/[-_]/g, "");
  if (v === "avatarv" || v === "v" || v === "5" || v === "avatar5") return "avatar_v";
  if (v === "avatariii" || v === "avatar3" || v === "iii" || v === "3") return "avatar_iii";
  return "avatar_v";
}
function normalizeDuration(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
}
function roundCredits(value) {
  const n = Number(value || 0);
  return Math.round(n * 100) / 100;
}

async function verifyUser(token) {
  try {
    if (!AUTH_USER_URL || !SERVICE_KEY) return "";
    const res = await fetch(AUTH_USER_URL, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
    if (!res.ok) return "";
    const data = await res.json().catch(() => null);
    return data && data.id ? String(data.id) : "";
  } catch { return ""; }
}

async function seedPlaceholder(uid, run_id, metaInput) {
  try {
    if (!UG_URL || !SERVICE_KEY) return;
    const existing = await getExistingTask(uid, run_id);
    if (existing) return;
    const provider = metaInput.model === "avatar_v" ? "heygen-avatar-iv" : "heygen-avatar-iii";
    const payload = {
      user_id: uid,
      provider,
      kind: "video",
      prompt: `HeyGen ${metaInput.model === "avatar_v" ? "Avatar IV" : "Avatar III"} talking avatar (${metaInput.billableSeconds}s)`,
      result_url: null,
      meta: {
        run_id,
        status: "processing",
        model: metaInput.model,
        image_url: metaInput.imageUrl,
        audio_url: metaInput.audioUrl,
        aspect_ratio: metaInput.aspectRatio,
        duration_seconds: metaInput.durationSeconds,
        billable_seconds: metaInput.billableSeconds,
        cost: metaInput.cost,
        refund_amount: metaInput.cost,
        provider: "heygen"
      }
    };
    await fetch(UG_URL, {
      method: "POST",
      headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.warn("[run-heygen-avatar] seedPlaceholder failed", error);
  }
}

async function getGeneration(uid, run_id) {
  try {
    if (!UG_URL || !SERVICE_KEY) return null;
    const q = `?select=id,user_id,meta,result_url&user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&limit=1`;
    const res = await fetch(UG_URL + q, { headers: sb() });
    const arr = await res.json().catch(() => []);
    return Array.isArray(arr) && arr[0] ? arr[0] : null;
  } catch { return null; }
}

async function getExistingTask(uid, run_id) {
  const row = await getGeneration(uid, run_id);
  if (!row) return null;
  const meta = row.meta || {};
  const taskId = meta.task_id || meta.taskId || meta.video_id || "";
  return { id: row.id, taskId: taskId ? String(taskId) : "", meta };
}

async function patchMeta(uid, run_id, extraMeta) {
  const row = await getGeneration(uid, run_id);
  if (!row) throw new Error("missing_generation_row");
  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  const res = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ meta: { ...meta, run_id, ...extraMeta } })
  });
  if (!res.ok) throw new Error("generation_metadata_update_failed");
}

async function getCredits(uid) {
  try {
    const res = await fetch(`${PROFILES_URL}?select=credits&user_id=eq.${encodeURIComponent(uid)}&limit=1`, { headers: sb() });
    const arr = await res.json().catch(() => []);
    const value = Number(Array.isArray(arr) && arr[0] ? arr[0].credits : 0);
    return Number.isFinite(value) ? value : 0;
  } catch { return 0; }
}

async function debitCredits(uid, cost) {
  try {
    const current = await getCredits(uid);
    if (current < cost) return false;
    const next = roundCredits(current - cost);
    const res = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(uid)}`, {
      method: "PATCH",
      headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ credits: next })
    });
    return res.ok;
  } catch { return false; }
}

async function isCharged(uid, run_id) {
  const row = await getGeneration(uid, run_id);
  const meta = row && row.meta ? row.meta : {};
  return meta.charged === true || meta.charged === "true";
}

async function markCharged(uid, run_id, cost, taskId, extraMeta) {
  const row = await getGeneration(uid, run_id);
  if (!row) return;
  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  const nextMeta = {
    ...meta,
    ...extraMeta,
    run_id,
    task_id: taskId,
    video_id: taskId,
    status: "processing",
    charged: true,
    charged_cost: cost,
    refund_amount: cost,
    submitted_at: meta.submitted_at || new Date().toISOString()
  };
  await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ meta: nextMeta })
  });
}

function extractVideoId(data) {
  const id = data?.data?.video_id || data?.video_id;
  return typeof id === "string" && id.trim() ? id.trim() : "";
}
function extractAvatarId(data) {
  const id = data?.data?.avatar_item?.id || data?.avatar_item?.id;
  return typeof id === "string" && id.trim() ? id.trim() : "";
}
