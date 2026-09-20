// netlify/functions/run-wan-3.js
// Launches KIE Wan 3.0 jobs and charges the internal (unscaled) credit amount.
const KIE_BASE = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/+$/, '');
const KIE_KEY = process.env.KIE_API_KEY || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SITE_BASE = (process.env.SITE_BASE || 'https://hansora.co').replace(/\/+$/, '');
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/kie-check`;

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

function extractTaskId(data) {
  if (!data || typeof data !== 'object') return '';
  const direct = [
    data?.data?.taskId,
    data?.taskId,
    data?.result?.taskId,
    data?.data?.task_id,
    data?.task_id,
    data?.id,
  ].map((value) => (value == null ? '' : String(value))).find((value) => value.length > 3);
  if (direct) return direct;
  const seen = new Set();
  const scan = (value) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return '';
    seen.add(value);
    for (const [key, inner] of Object.entries(value)) {
      if (/^(task[_-]?id|request[_-]?id|id)$/i.test(key) && (typeof inner === 'string' || typeof inner === 'number')) {
        const out = String(inner);
        if (out.length > 3) return out;
      }
      const nested = scan(inner);
      if (nested) return nested;
    }
    return '';
  };
  return scan(data);
}

function normalizeResolution(value) {
  const key = String(value || '1080P').trim().toUpperCase();
  return ['480P', '720P', '1080P'].includes(key) ? key : '1080P';
}

function normalizeAspectRatio(value) {
  const key = String(value || 'adaptive').trim();
  return ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(key) ? key : 'adaptive';
}

function normalizeDuration(value) {
  const duration = Math.round(Number(value || 5));
  return Number.isFinite(duration) ? Math.max(2, Math.min(30, duration)) : 5;
}

function costFor(resolution, duration) {
  const rate = resolution === '480P' ? 0.6 : (resolution === '720P' ? 1 : 2);
  return Number((duration * rate).toFixed(2));
}

function cleanUrls(value, limit) {
  const values = Array.isArray(value) ? value : [];
  return values.map((item) => String(item || '').trim()).filter(Boolean).slice(0, limit);
}

function allHttps(values) {
  return values.every((value) => /^https:\/\//i.test(value));
}

async function fetchGeneration(uid, runId) {
  const url = `${SUPABASE_URL}/rest/v1/user_generations?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(runId)}&select=id,meta`;
  const res = await fetch(url, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function insertGeneration(uid, runId, prompt, meta) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_generations`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ user_id: uid, provider: 'Wan 3.0', kind: 'video', prompt, result_url: null, meta }),
  });
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0].id : null;
}

async function patchGeneration(rowId, meta) {
  if (!rowId) return;
  await fetch(`${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(rowId)}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ meta }),
  });
}

async function getCredits(uid) {
  const url = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
  const res = await fetch(url, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const rows = await res.json().catch(() => []);
  return Number(Array.isArray(rows) && rows[0] ? rows[0].credits : 0);
}

async function debitCredits(uid, cost) {
  const current = await getCredits(uid);
  if (current < cost) return { ok: false, error: 'not_enough_credits', credits: current };
  const next = Number((current - cost).toFixed(2));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
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
    const body = JSON.parse(event.body || '{}');
    const uid = getUID(event, body);
    if (!uid) return json(401, { ok: false, error: 'missing_uid' });
    const auth = await verifyAuth(event, uid);
    if (!auth.ok) return json(401, { ok: false, error: auth.error, details: auth });

    const prompt = String(body.prompt || '').trim();
    if (!prompt) return json(400, { ok: false, error: 'missing_prompt' });
    if (prompt.length > 20000) return json(400, { ok: false, error: 'prompt_too_long' });

    const runId = String(body.run_id || `${uid}-${Date.now()}`);
    const existing = await fetchGeneration(uid, runId);
    const existingTask = existing?.meta?.task_id || existing?.meta?.taskId || '';
    if (existingTask) return json(200, { ok: true, submitted: true, taskId: existingTask, run_id: runId, already_submitted: true });

    const firstFrameUrl = String(body.first_frame_url || '').trim();
    const lastFrameUrl = String(body.last_frame_url || '').trim();
    const rawReferenceImageUrls = Array.isArray(body.reference_image_urls) && body.reference_image_urls.length
      ? body.reference_image_urls
      : (Array.isArray(body.image_urls) ? body.image_urls : []);
    const rawReferenceVideoUrls = Array.isArray(body.reference_video_urls) ? body.reference_video_urls : [];
    const rawReferenceAudioUrls = Array.isArray(body.reference_audio_urls) ? body.reference_audio_urls : [];
    if (rawReferenceImageUrls.filter(Boolean).length > 10) return json(400, { ok: false, error: 'too_many_reference_images' });
    if (rawReferenceVideoUrls.filter(Boolean).length > 5) return json(400, { ok: false, error: 'too_many_reference_videos' });
    if (rawReferenceAudioUrls.filter(Boolean).length > 5) return json(400, { ok: false, error: 'too_many_reference_audio_files' });
    const referenceImageUrls = cleanUrls(rawReferenceImageUrls, 10);
    const referenceVideoUrls = cleanUrls(rawReferenceVideoUrls, 5);
    const referenceAudioUrls = cleanUrls(rawReferenceAudioUrls, 5);
    const suppliedUrls = [firstFrameUrl, lastFrameUrl, ...referenceImageUrls, ...referenceVideoUrls, ...referenceAudioUrls].filter(Boolean);
    if (!allHttps(suppliedUrls)) return json(400, { ok: false, error: 'invalid_input_url' });
    if (lastFrameUrl && !firstFrameUrl) return json(400, { ok: false, error: 'last_frame_requires_first_frame' });
    if (firstFrameUrl && (referenceImageUrls.length || referenceVideoUrls.length || referenceAudioUrls.length)) {
      return json(400, {
        ok: false,
        error: 'frames_cannot_mix_with_references',
        message: 'First/last frames cannot be combined with reference images, videos, or audio.',
      });
    }

    const resolution = normalizeResolution(body.resolution);
    const aspectRatio = normalizeAspectRatio(body.aspect_ratio);
    const duration = normalizeDuration(body.duration);
    const cost = costFor(resolution, duration);
    const model = String(process.env.WAN_3_MODEL || 'wan/3-0-video').trim();
    const metaBase = {
      source: 'kie',
      engine: 'wan-3',
      run_id: runId,
      status: 'pending',
      refund_amount: cost,
    };
    const rowId = existing?.id || await insertGeneration(uid, runId, prompt, metaBase);

    const currentCredits = await getCredits(uid);
    if (currentCredits < cost) return json(402, { ok: false, error: 'not_enough_credits', credits: currentCredits, need: cost });

    const seed = Number(body.seed);
    const input = {
      prompt,
      resolution,
      aspect_ratio: aspectRatio,
      duration,
      audio: body.audio !== false,
      ...(firstFrameUrl ? { first_frame_url: firstFrameUrl } : {}),
      ...(lastFrameUrl ? { last_frame_url: lastFrameUrl } : {}),
      ...(referenceImageUrls.length ? { reference_image_urls: referenceImageUrls } : {}),
      ...(referenceVideoUrls.length ? { reference_video_urls: referenceVideoUrls } : {}),
      ...(referenceAudioUrls.length ? { reference_audio_urls: referenceAudioUrls } : {}),
      ...(Number.isInteger(seed) && seed >= 0 && seed <= 2147483647 ? { seed } : {}),
    };
    const callback = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(runId)}`;
    const kieRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input, callBackUrl: callback }),
    });
    const data = await kieRes.json().catch(() => ({}));
    if (!kieRes.ok || (data && data.code && Number(data.code) !== 200)) {
      await patchGeneration(rowId, { ...metaBase, status: 'failed', error: data });
      return json(kieRes.ok ? 422 : (kieRes.status || 502), { ok: false, error: 'kie_create_failed', details: data });
    }
    const taskId = extractTaskId(data);
    if (!taskId) {
      await patchGeneration(rowId, { ...metaBase, status: 'failed', error: data || 'missing_task_id' });
      return json(502, { ok: false, error: 'missing_task_id', details: data });
    }

    const debit = await debitCredits(uid, cost);
    if (!debit.ok) return json(402, { ok: false, error: debit.error, details: debit });

    const meta = {
      ...metaBase,
      status: 'processing',
      model,
      task_id: taskId,
      charged: true,
      charged_at: new Date().toISOString(),
      charged_cost: cost,
      debited: cost,
      refund_amount: cost,
    };
    await patchGeneration(rowId, meta);
    return json(201, { ok: true, submitted: true, taskId, id: taskId, run_id: runId, row_id: rowId, debited: cost, credits: debit.credits });
  } catch (error) {
    return json(500, { ok: false, error: 'server_error', details: String(error && error.message || error) });
  }
};
