// netlify/functions/run-heygen-avatar.js
// HeyGen talking-avatar submitter for one image + one audio file.
// Server-side Supabase auth, placeholder row, idempotent charge per (uid + run_id), and HeyGen submit.
// Env: HeyGen_api or HEYGEN_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Opt: SITE_BASE (default https://webhansora.netlify.app)

const HEYGEN_API_ENV = pickEnv("HEYGEN_API_KEY", "HeyGen_api", "HEYGEN_API", "HeyGen_API");
const HEYGEN_API_KEY = HEYGEN_API_ENV.value;
const HEYGEN_BASE = (process.env.HEYGEN_BASE_URL || "https://api.heygen.com").replace(/\/+$/, "");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";
const AUTH_USER_URL = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1/user` : "";

const SITE_BASE = (process.env.SITE_BASE || "https://webhansora.netlify.app").replace(/\/+$/, "");
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/heygen-check`;

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

    const model = normalizeModel(body.model || body.engine || "avatar_v");
    const imageUrl = normalizeUrl(body.imageUrl || body.image_url || "");
    const audioUrl = normalizeUrl(body.audioUrl || body.audio_url || "");
    const aspectRatio = normalizeAspect(body.aspect_ratio || body.aspectRatio || "9:16");
    const durationSeconds = normalizeDuration(body.duration_seconds || body.duration || 0);
    const billableSeconds = Math.ceil(durationSeconds);
    const rate = model === "avatar_v" ? 0.7 : 0.3;
    const cost = roundCredits(billableSeconds * rate);
    const clientRunId = String(body.run_id || body.runId || "").trim();
    const run_id = clientRunId || `${uid}-${Date.now()}`;

    if (!imageUrl) return ok({ submitted: false, error: "missing_image_url", run_id });
    if (!audioUrl) return ok({ submitted: false, error: "missing_audio_url", run_id });
    if (!durationSeconds) return ok({ submitted: false, error: "missing_audio_duration", run_id });
    if (durationSeconds < 5) return ok({ submitted: false, error: "audio_too_short_min_5_seconds", run_id });
    if (durationSeconds > 90.25) return ok({ submitted: false, error: "audio_too_long_max_90_seconds", run_id });

    const existing = await getExistingTask(uid, run_id);
    if (existing && existing.taskId) {
      return ok({ submitted: true, run_id, taskId: existing.taskId, video_id: existing.taskId, already: true });
    }

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

    const callbackUrl = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;
    const heygenResult = await submitHeyGen({
      model,
      imageUrl,
      audioUrl,
      aspectRatio,
      run_id,
      callbackUrl
    });

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
        run_id,
        heygen_auth_debug: safeHeyGenAuthDebug()
      });
    }

    const taskId = String(heygenResult.videoId || "").trim();
    if (!taskId) {
      await patchMeta(uid, run_id, { status: "failed", error: "missing_video_id", heygen_response: heygenResult.data || null });
      return ok({ submitted: false, error: "missing_video_id", data: heygenResult.data, run_id });
    }

    const charged = await isCharged(uid, run_id);
    if (!charged) {
      const debited = await debitCredits(uid, cost);
      if (!debited) {
        await patchMeta(uid, run_id, { status: "failed", error: "debit_failed", task_id: taskId, video_id: taskId });
        return ok({ submitted: false, error: "debit_failed", run_id, taskId, video_id: taskId });
      }
    }

    await markCharged(uid, run_id, cost, taskId, {
      model,
      provider_api: heygenResult.apiVersion,
      avatar_id: heygenResult.avatarId || "",
      avatar_create_response: heygenResult.avatarCreateData || null,
      submit_response: heygenResult.data || null
    });

    return ok({ submitted: true, run_id, taskId, video_id: taskId, cost, billable_seconds: billableSeconds, data: heygenResult.data });
  } catch (error) {
    return ok({ submitted: false, error: messageOf(error) });
  }
};

async function submitHeyGen({ model, imageUrl, audioUrl, aspectRatio, run_id, callbackUrl }) {
  // HeyGen's documented direct image + audio lip-sync endpoint is /v2/videos.
  // It accepts a public image_url and audio_url directly, avoiding the v3 avatar/video flow
  // that can return 401 when the key is not enabled for that product surface.
  const payload = {
    image_url: imageUrl,
    audio_url: audioUrl,
    title: `Hansora ${model === "avatar_v" ? "Photo Avatar" : "Avatar III"} ${new Date().toISOString()}`,
    resolution: "1080p",
    aspect_ratio: aspectRatio,
    callback_url: callbackUrl,
    callback_id: run_id
  };
  if (model === "avatar_v") {
    payload.expressiveness = "medium";
  }

  const resp = await heygenFetch("/v2/videos", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const data = resp.data;
  return {
    ok: resp.ok,
    error: resp.ok ? "" : `heygen_video_${resp.status}`,
    videoId: extractVideoId(data),
    data,
    apiVersion: "v2"
  };
}

async function heygenFetch(path, options = {}) {
  const resp = await fetch(`${HEYGEN_BASE}${path}`, {
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
    const provider = metaInput.model === "avatar_v" ? "heygen-avatar-v" : "heygen-avatar-iii";
    const payload = {
      user_id: uid,
      provider,
      kind: "video",
      prompt: `HeyGen ${metaInput.model === "avatar_v" ? "Avatar V" : "Avatar III"} talking avatar (${metaInput.billableSeconds}s)`,
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
  try {
    const row = await getGeneration(uid, run_id);
    if (!row) return;
    const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
    const nextMeta = { ...meta, run_id, ...extraMeta };
    await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ meta: nextMeta })
    });
  } catch {}
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
  if (!data || typeof data !== "object") return "";
  const direct = data.video_id || data.id || data.task_id || data.taskId || data?.data?.video_id || data?.data?.id || data?.data?.task_id || data?.data?.taskId || data?.result?.video_id || data?.result?.id;
  if (direct) return String(direct);
  return scanForKey(data, /^(video[_-]?id|task[_-]?id|id)$/i);
}
function extractAvatarId(data) {
  if (!data || typeof data !== "object") return "";
  const direct = data?.data?.avatar_item?.id || data?.avatar_item?.id || data?.data?.id || data?.id || data?.data?.avatar_id || data?.avatar_id;
  if (direct) return String(direct);
  return scanForKey(data, /^(avatar[_-]?id|id)$/i);
}
function scanForKey(obj, regex) {
  const seen = new Set();
  function walk(value) {
    if (!value || typeof value !== "object" || seen.has(value)) return "";
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (regex.test(key) && (typeof child === "string" || typeof child === "number")) {
        const s = String(child);
        if (s.length > 3) return s;
      }
      const inner = walk(child);
      if (inner) return inner;
    }
    return "";
  }
  return walk(obj);
}
