// netlify/functions/run-wan-27-video.js
// Wan 2.7 video launcher via KIE createTask. The mode follows the inputs:
// - reference images/videos      -> wan/2-7-r2v (reference to video, optional first frame)
// - first/last frame or a clip   -> wan/2-7-image-to-video
// - prompt only                  -> wan/2-7-text-to-video
// Credits: 1.5 per second at 720p, 2 per second at 1080p (same as the website quote).
// The balance is checked before KIE is called and debited once KIE accepts the task.
//
// Env: KIE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Opt: KIE_BASE_URL, SITE_BASE, WAN_27_T2V_MODEL, WAN_27_I2V_MODEL, WAN_27_R2V_MODEL
const KIE_BASE = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/+$/, '');
const KIE_KEY = process.env.KIE_API_KEY || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SITE_BASE = (process.env.SITE_BASE || 'https://hansora.co').replace(/\/+$/, '');
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/kie-check`;
const MODELS = {
  t2v: process.env.WAN_27_T2V_MODEL || 'wan/2-7-text-to-video',
  i2v: process.env.WAN_27_I2V_MODEL || 'wan/2-7-image-to-video',
  r2v: process.env.WAN_27_R2V_MODEL || 'wan/2-7-r2v',
};
const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const MAX_REFERENCES = 5;

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...cors() },
  body: JSON.stringify(body),
});

function getHeader(event, key) {
  return event.headers?.[key] || event.headers?.[key.toLowerCase()] || event.headers?.[key.toUpperCase()] || null;
}

function getUID(event, body) {
  const qs = new URLSearchParams(event.queryStringParameters || {});
  return String(getHeader(event, 'x-user-id') || body?.uid || body?.user_id || qs.get('uid') || '').trim();
}

async function verifyAuth(event, uid) {
  const auth = getHeader(event, 'authorization') || '';
  const token = (auth.match(/^Bearer\s+(.+)$/i) || [])[1] || '';
  if (!token) return { ok: false, error: 'missing_auth' };
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { ok: false, error: 'bad_auth', status: res.status };
  const user = await res.json().catch(() => null);
  const id = user && (user.id || user.user?.id);
  if (!id || String(id) !== String(uid)) return { ok: false, error: 'uid_mismatch' };
  return { ok: true };
}

function httpsUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function urlList(...values) {
  const out = [];
  for (const value of values.flat()) {
    const url = httpsUrl(value);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

function normalizeResolution(value) {
  return String(value || '').toLowerCase() === '1080p' ? '1080p' : '720p';
}

function normalizeDuration(value) {
  const seconds = Math.round(Number(value) || 5);
  return Math.max(2, Math.min(10, seconds));
}

function costFor(duration, resolution) {
  return Number((duration * (resolution === '1080p' ? 2 : 1.5)).toFixed(1));
}

// Picks the KIE model and input from what the caller supplied.
function buildTask(body, prompt, duration, resolution) {
  const aspect = ASPECT_RATIOS.includes(String(body.aspect_ratio)) ? String(body.aspect_ratio) : '16:9';
  const firstFrame = httpsUrl(body.first_frame_url);
  const lastFrame = httpsUrl(body.last_frame_url);
  const clip = httpsUrl(body.first_clip_url || body.video_url);
  const referenceImages = urlList(body.reference_image_urls || []).filter((url) => url !== firstFrame && url !== lastFrame);
  const referenceVideos = urlList(body.reference_video_urls || []).filter((url) => url !== clip);
  const voice = urlList(body.reference_audio_urls || [], body.audio_url)[0] || '';
  const common = { prompt, resolution, duration, prompt_extend: body.prompt_extend !== false, watermark: false };

  if (referenceImages.length || referenceVideos.length) {
    if (referenceImages.length + referenceVideos.length > MAX_REFERENCES) {
      return { error: 'too_many_references', details: `Wan 2.7 accepts up to ${MAX_REFERENCES} reference images and videos in total.` };
    }
    return {
      mode: 'r2v',
      input: {
        ...common,
        aspect_ratio: aspect,
        ...(referenceImages.length ? { reference_image: referenceImages } : {}),
        ...(referenceVideos.length ? { reference_video: referenceVideos } : {}),
        ...(firstFrame ? { first_frame: firstFrame } : {}),
        ...(voice ? { reference_voice: voice } : {}),
      },
    };
  }
  if (firstFrame || clip) {
    return {
      mode: 'i2v',
      input: {
        ...common,
        ...(firstFrame ? { first_frame_url: firstFrame } : { first_clip_url: clip }),
        ...(firstFrame && lastFrame ? { last_frame_url: lastFrame } : {}),
      },
    };
  }
  if (lastFrame) return { error: 'last_frame_requires_first_frame', details: 'Add a first frame to use a last frame.' };
  return { mode: 't2v', input: { ...common, aspect_ratio: aspect } };
}

function extractTaskId(data) {
  const candidates = [data?.data?.taskId, data?.taskId, data?.data?.task_id, data?.task_id, data?.data?.id];
  return candidates.map((value) => (value == null ? '' : String(value))).find((value) => value.length > 3) || '';
}

async function supabase(path, options = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
}

async function fetchGeneration(uid, runId) {
  const res = await supabase(`/rest/v1/user_generations?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(runId)}&select=id,meta`);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function insertGeneration(uid, prompt, meta) {
  const res = await supabase('/rest/v1/user_generations', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: uid, provider: 'Wan 2.7', kind: 'video', prompt, result_url: null, meta }),
  });
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0].id : null;
}

async function patchGeneration(rowId, meta) {
  if (!rowId) return;
  await supabase(`/rest/v1/user_generations?id=eq.${encodeURIComponent(rowId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ meta }),
  });
}

async function getCredits(uid) {
  const res = await supabase(`/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`);
  if (!res.ok) throw new Error(`profile_fetch_failed_${res.status}`);
  const rows = await res.json().catch(() => []);
  return Number(Array.isArray(rows) && rows[0] ? rows[0].credits : 0) || 0;
}

async function debitCredits(uid, cost) {
  const current = await getCredits(uid);
  if (current < cost) return { ok: false, error: 'not_enough_credits', credits: current };
  const next = Number((current - cost).toFixed(2));
  const res = await supabase(`/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ credits: next }),
  });
  if (!res.ok) return { ok: false, error: 'profile_update_failed', status: res.status };
  return { ok: true, credits: next };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  try {
    if (!KIE_KEY || !SUPABASE_URL || !SERVICE_KEY) return json(500, { ok: false, error: 'missing_env' });
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'bad_json' }); }
    const uid = getUID(event, body);
    if (!uid) return json(401, { ok: false, error: 'missing_uid' });
    const auth = await verifyAuth(event, uid);
    if (!auth.ok) return json(401, { ok: false, error: auth.error });

    const prompt = String(body.prompt || '').trim();
    if (!prompt) return json(400, { ok: false, error: 'missing_prompt' });

    const runId = String(body.run_id || `${uid}-${Date.now()}`);
    const existing = await fetchGeneration(uid, runId);
    const existingTask = existing?.meta?.task_id || '';
    if (existingTask) return json(200, { ok: true, submitted: true, taskId: existingTask, run_id: runId, already_submitted: true });

    const duration = normalizeDuration(body.duration);
    const resolution = normalizeResolution(body.resolution);
    const task = buildTask(body, prompt, duration, resolution);
    if (task.error) return json(400, { ok: false, error: task.error, details: task.details });

    const cost = costFor(duration, resolution);
    const credits = await getCredits(uid);
    if (credits < cost) return json(402, { ok: false, error: 'not_enough_credits', credits, need: cost });

    const model = MODELS[task.mode];
    const metaBase = { source: 'kie', engine: 'wan-2.7', model_id: 'wan27-video', model, mode: task.mode, run_id: runId, status: 'pending', duration, resolution, refund_amount: cost };
    const rowId = existing?.id || await insertGeneration(uid, prompt, metaBase);

    const kieRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: task.input,
        callBackUrl: `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(runId)}`,
      }),
    });
    const data = await kieRes.json().catch(() => ({}));
    const taskId = kieRes.ok ? extractTaskId(data) : '';
    if (!taskId) {
      await patchGeneration(rowId, { ...metaBase, status: 'failed', failed: true, error: 'kie_create_failed', provider_response: data, failed_at: new Date().toISOString() });
      return json(kieRes.ok ? 502 : (kieRes.status || 502), { ok: false, error: 'kie_create_failed', details: data });
    }

    const debit = await debitCredits(uid, cost);
    if (!debit.ok) {
      await patchGeneration(rowId, { ...metaBase, status: 'processing', task_id: taskId, charged: false, charge_error: debit.error });
      return json(402, { ok: false, error: 'not_enough_credits', credits: debit.credits, need: cost });
    }
    await patchGeneration(rowId, {
      ...metaBase,
      status: 'processing',
      task_id: taskId,
      charged: true,
      charged_at: new Date().toISOString(),
      charged_cost: cost,
      debited: cost,
    });
    return json(201, { ok: true, submitted: true, taskId, id: taskId, run_id: runId, row_id: rowId, mode: task.mode, debited: cost, credits: debit.credits });
  } catch (error) {
    return json(500, { ok: false, error: 'server_error', details: String(error && error.message || error) });
  }
};

exports.buildTask = buildTask;
exports.costFor = costFor;
