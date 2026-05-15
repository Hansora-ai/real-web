// netlify/functions/run-upscale.js
// Submit Hansora Upscale tasks to KIE: image => nano-banana-pro, video => topaz/video-upscale.
// Env: KIE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_BASE

const KIE_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const API_KEY = process.env.KIE_API_KEY || process.env.KIEAI_API_KEY || "";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";
const AUTH_USER_URL = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1/user` : "";
const SITE_BASE = (process.env.SITE_BASE || "https://webhansora.netlify.app").replace(/\/+$/, "");
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/upscale-kie-callback`;

const IMAGE_PROMPT = "Ultra-photorealistic enhancement of the provided image, preserving the subject’s identity exactly with no changes to the face, facial structure, proportions, expression, skin tone, hairstyle, pose, camera angle, framing, lighting, background, clothing, or composition; upscale to very high resolution with crisp but natural sharpness, enhanced fine detail, realistic human skin texture with visible pores and subtle natural texture, eliminate plastic, waxy, over-smoothed, fake AI-looking skin, improve eyes, eyelashes, eyebrows, lips, hair strands, and all facial details carefully, remove blur, noise, compression artifacts, pixelation, banding, and distortions, recover lost detail while keeping the image clean and realistic, maintain balanced exposure and soft natural contrast, and make the final result look like a real premium high-end professional camera photo, not overprocessed or artificially retouched.";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return err(405, "Use POST");
  try {
    const headers = lowerKeys(event.headers || {});
    const body = safeJson(event.body);
    const uid = String(body.uid || body.user_id || "").trim();
    if (!uid) return ok({ submitted: false, error: "missing_uid" });

    const authz = String(headers.authorization || "");
    const token = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
    if (!token) return ok({ submitted: false, error: "missing_auth" });
    const authedUid = await verifyUser(token);
    if (!authedUid || authedUid !== uid) return ok({ submitted: false, error: "auth_mismatch" });

    const fileUrl = normalizeUrl(body.fileUrl || body.file_url || body.url || "");
    if (!fileUrl) return ok({ submitted: false, error: "missing_file_url" });

    const kind = normalizeKind(body.kind || body.media_type || body.mediaType || "");
    const run_id = String(body.run_id || body.runId || `${uid}-upscale-${Date.now()}`).trim();
    const fileName = String(body.fileName || body.file_name || "uploaded-file").trim().slice(0, 180);
    const fileType = String(body.fileType || body.file_type || "").trim().slice(0, 120);

    const config = buildConfig(kind, body);
    const cost = config.cost;
    const callBackUrl = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    const existing = await getExistingTask(uid, run_id);
    if (existing && existing.taskId) return ok({ submitted: true, run_id, taskId: existing.taskId, already: true });

    const provider = kind === "video" ? "topaz-video-upscale" : "nano-banana-pro";
    const prompt = kind === "video" ? `Topaz video upscale ${config.upscaleFactor}x` : IMAGE_PROMPT;
    await seedPlaceholder(uid, run_id, {
      provider,
      prompt,
      fileName,
      fileType,
      fileUrl,
      kind,
      cost,
      config
    });

    const kiePayload = kind === "video"
      ? {
          model: "topaz/video-upscale",
          callBackUrl,
          input: { video_url: fileUrl, upscale_factor: String(config.upscaleFactor) }
        }
      : {
          model: "nano-banana-pro",
          callBackUrl,
          input: {
            prompt: IMAGE_PROMPT,
            image_input: [fileUrl],
            aspect_ratio: "auto",
            resolution: config.resolution,
            output_format: "png"
          }
        };

    const resp = await fetch(KIE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(kiePayload)
    });
    const data = await resp.json().catch(() => ({}));
    const taskId = extractTaskId(data);
    if (!resp.ok) return ok({ submitted: false, error: `kie_${resp.status}`, data, run_id });
    if (!taskId) return ok({ submitted: false, error: "missing_taskId", data, run_id });

    if (!(await isCharged(uid, run_id))) {
      const debited = await debitCredits(uid, cost);
      if (!debited) return ok({ submitted: false, error: "debit_failed", run_id, taskId });
      await markCharged(uid, run_id, cost, taskId);
    }
    await patchTaskMeta(uid, run_id, { task_id: taskId, status: "processing", kie_model: kiePayload.model });
    return ok({ submitted: true, run_id, taskId, status: resp.status, data });
  } catch (error) {
    return ok({ submitted: false, error: messageOf(error) });
  }
};

function buildConfig(kind, body) {
  if (kind === "video") {
    const upscaleFactor = String(body.videoScale || body.upscale_factor || body.upscaleFactor || "2") === "4" ? "4" : "2";
    const durationSeconds = Number(body.durationSeconds || body.duration_seconds || 0);
    if (!Number.isFinite(durationSeconds) || durationSeconds < 4 || durationSeconds > 30) throw new Error("video_duration_must_be_4_to_30_seconds");
    const perSecond = upscaleFactor === "4" ? 1 : 0.7;
    const cost = Math.round(Math.ceil(durationSeconds) * perSecond * 10) / 10;
    return { upscaleFactor, durationSeconds, cost };
  }
  const resolution = String(body.imageResolution || body.resolution || "2K").toUpperCase() === "4K" ? "4K" : "2K";
  return { resolution, cost: resolution === "4K" ? 3 : 2 };
}
function normalizeKind(value) {
  const s = String(value || "").toLowerCase();
  if (s.includes("video")) return "video";
  return "image";
}
function ok(obj) { return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code, message) { return { statusCode: code, headers: cors(), body: JSON.stringify({ submitted: false, error: message }) }; }
function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-USER-ID" }; }
function safeJson(raw) { try { return JSON.parse(raw || "{}"); } catch { return {}; } }
function lowerKeys(h) { const out = {}; for (const k in h) out[k.toLowerCase()] = h[k]; return out; }
function normalizeUrl(value) { try { return new URL(String(value || "")).href; } catch { return ""; } }
function sb() { return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }; }
function messageOf(error) { return error && error.message ? error.message : String(error); }

async function verifyUser(token) {
  try {
    if (!AUTH_USER_URL || !SERVICE_KEY) return "";
    const res = await fetch(AUTH_USER_URL, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
    if (!res.ok) return "";
    const data = await res.json().catch(() => null);
    return data && data.id ? String(data.id) : "";
  } catch { return ""; }
}
async function seedPlaceholder(uid, run_id, data) {
  try {
    if (!UG_URL || !SERVICE_KEY) return;
    const check = await fetch(`${UG_URL}?select=id&user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&limit=1`, { headers: sb() });
    const arr = await check.json().catch(() => []);
    if (Array.isArray(arr) && arr.length) return;
    const payload = {
      user_id: uid,
      provider: data.provider,
      kind: "upscale",
      prompt: data.prompt,
      result_url: null,
      meta: {
        run_id,
        status: "processing",
        media_type: data.kind,
        input_url: data.fileUrl,
        file_name: data.fileName,
        file_type: data.fileType,
        refund_amount: data.cost,
        charged_cost: data.cost,
        ...data.config
      }
    };
    await fetch(UG_URL, { method: "POST", headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(payload) });
  } catch (e) { console.warn("[run-upscale] seed failed", e); }
}
async function patchTaskMeta(uid, run_id, extraMeta) {
  try {
    const current = await getRow(uid, run_id);
    const meta = { ...(current && current.meta && typeof current.meta === "object" ? current.meta : {}), run_id, ...extraMeta };
    await fetch(`${UG_URL}?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`, { method: "PATCH", headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ meta }) });
  } catch {}
}
async function getRow(uid, run_id) {
  try {
    const res = await fetch(`${UG_URL}?select=id,meta&user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&limit=1`, { headers: sb() });
    const arr = await res.json().catch(() => []);
    return Array.isArray(arr) && arr[0] ? arr[0] : null;
  } catch { return null; }
}
async function getCredits(uid) {
  try {
    const res = await fetch(`${PROFILES_URL}?select=credits&user_id=eq.${encodeURIComponent(uid)}&limit=1`, { headers: sb() });
    const arr = await res.json().catch(() => []);
    const credits = Number(Array.isArray(arr) && arr[0] ? arr[0].credits : 0);
    return Number.isFinite(credits) ? credits : 0;
  } catch { return 0; }
}
async function debitCredits(uid, cost) {
  try {
    const cur = await getCredits(uid);
    if (cur < cost) return false;
    const next = Math.round((cur - cost) * 100) / 100;
    const res = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(uid)}`, { method: "PATCH", headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ credits: next }) });
    return res.ok;
  } catch { return false; }
}
async function getExistingTask(uid, run_id) {
  const row = await getRow(uid, run_id);
  const taskId = row && row.meta ? (row.meta.task_id || row.meta.taskId || "") : "";
  return row ? { id: row.id, taskId: String(taskId || "") } : null;
}
async function isCharged(uid, run_id) {
  const row = await getRow(uid, run_id);
  const meta = row && row.meta ? row.meta : {};
  return meta.charged === true || meta.charged === "true";
}
async function markCharged(uid, run_id, cost, taskId) {
  try {
    const current = await getRow(uid, run_id);
    const meta = { ...(current && current.meta && typeof current.meta === "object" ? current.meta : {}), charged: true, charged_cost: cost, refund_amount: cost, task_id: taskId, run_id, status: "processing" };
    await fetch(`${UG_URL}?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`, { method: "PATCH", headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ meta }) });
  } catch {}
}
function extractTaskId(data) {
  if (!data || typeof data !== "object") return "";
  if (data?.data?.taskId) return String(data.data.taskId);
  if (data?.taskId) return String(data.taskId);
  if (data?.data?.task_id) return String(data.data.task_id);
  const seen = new Set();
  function scan(x) {
    if (!x || typeof x !== "object" || seen.has(x)) return "";
    seen.add(x);
    for (const [k, v] of Object.entries(x)) {
      if (/^(task[_-]?id|request[_-]?id)$/i.test(k) && (typeof v === "string" || typeof v === "number")) return String(v);
      const inner = scan(v); if (inner) return inner;
    }
    return "";
  }
  return scan(data);
}
