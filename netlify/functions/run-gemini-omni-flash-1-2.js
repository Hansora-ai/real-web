// netlify/functions/run-gemini-omni-flash-1-2.js
// Launches KIE Gemini Omni 1.2 Flash jobs (docs.kie.ai/market/google/gemini-omni-flash-1-2). One mode per request:
// text / reference images (up to 6), first frame, first and last frame, or a video edit (up to 15 s, billed by the
// input video's length, measured here). Prices: public/gemini-omni-12-pricing.js (35% margin).
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
  ].map((v) => (v == null ? '' : String(v))).find((v) => v.length > 3);
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
    body: JSON.stringify({ user_id: uid, provider: 'Gemini Omni 1.2 Flash', kind: 'video', prompt, result_url: null, meta }),
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

async function debitCredits(uid, cost) {
  const profileUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
  const profileRes = await fetch(profileUrl, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const rows = await profileRes.json().catch(() => []);
  const current = Number(Array.isArray(rows) && rows[0] ? rows[0].credits : 0);
  if (current < cost) return { ok: false, error: 'not_enough_credits', credits: current };
  const next = Number((current - cost).toFixed(2));
  const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ credits: next }),
  });
  if (!updateRes.ok) return { ok: false, error: 'profile_update_failed', status: updateRes.status };
  return { ok: true, credits: next };
}

async function getCredits(uid) {
  const profileUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`;
  const profileRes = await fetch(profileUrl, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const rows = await profileRes.json().catch(() => []);
  return Number(Array.isArray(rows) && rows[0] ? rows[0].credits : 0);
}

const pricing = require('../../public/gemini-omni-12-pricing.js');

function normalizeDuration(value, max) {
  const duration = Math.round(Number(value || 4));
  return Number.isInteger(duration) ? Math.max(3, Math.min(max, duration)) : 4;
}

// The edit's source video length, measured on the server (our own storage only), so the price cannot be talked down.
async function measureVideo(url) {
  const media = require('../../lib/henshin/server-media.cjs');
  const { seconds } = await media.inspectVideo(url, { maxMB: 100, min: 1 });
  if (!(seconds > 0) || seconds > 15.0001) throw new Error('video_too_long');
  return seconds;
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
    if (prompt.length > 20000) return json(400, { ok: false, error: 'prompt_too_long', message: 'The prompt can be at most 20,000 characters.' });

    const runId = String(body.run_id || `${uid}-${Date.now()}`);
    const existing = await fetchGeneration(uid, runId);
    const existingTask = existing?.meta?.task_id || existing?.meta?.taskId || '';
    if (existingTask) return json(200, { ok: true, submitted: true, taskId: existingTask, run_id: runId, already_submitted: true });

    const firstFrameUrl = String(body.first_frame_url || '').trim();
    const lastFrameUrl = String(body.last_frame_url || '').trim();
    if (firstFrameUrl && !/^https:\/\//i.test(firstFrameUrl)) return json(400, { ok: false, error: 'invalid_first_frame_url' });
    if (lastFrameUrl && !/^https:\/\//i.test(lastFrameUrl)) return json(400, { ok: false, error: 'invalid_last_frame_url' });
    if (lastFrameUrl && !firstFrameUrl) return json(400, { ok: false, error: 'last_frame_requires_first_frame' });

    const rawImageUrls = Array.isArray(body.image_urls) ? body.image_urls.filter(Boolean).map(String) : [];
    if (rawImageUrls.length > 6) return json(400, { ok: false, error: 'too_many_images', message: 'Gemini Omni 1.2 Flash takes up to 6 reference images.' });
    if (rawImageUrls.some((url) => !/^https:\/\//i.test(url))) return json(400, { ok: false, error: 'invalid_image_url' });
    const imageUrls = rawImageUrls;
    const videoUrl = String(body.video_url || (Array.isArray(body.video_urls) ? body.video_urls[0] : '') || '').trim();
    if (videoUrl && !/^https:\/\//i.test(videoUrl)) return json(400, { ok: false, error: 'invalid_video_url' });
    if (firstFrameUrl && (imageUrls.length || videoUrl)) {
      return json(400, { ok: false, error: 'frames_cannot_mix_with_references', message: 'First/last frames cannot be combined with reference images or a video.' });
    }
    if (imageUrls.length + (videoUrl ? 2 : 0) > 7) return json(400, { ok: false, error: 'too_many_inputs', message: 'With a video, Gemini Omni 1.2 Flash takes up to 5 reference images.' });

    const resolution = pricing.normalizeResolution(body.resolution);
    const firstAndLast = Boolean(firstFrameUrl && lastFrameUrl);
    const duration = normalizeDuration(body.duration, firstAndLast ? 10 : 15);
    const aspectRatio = ['16:9', '9:16', 'auto'].includes(String(body.aspect_ratio || '')) ? String(body.aspect_ratio) : (imageUrls.length || firstFrameUrl ? 'auto' : '16:9');

    let inputSeconds = 0;
    if (videoUrl) {
      try { inputSeconds = await measureVideo(videoUrl); }
      catch (error) {
        const tooLong = /too_long|outside/i.test(String(error && error.message));
        return json(400, { ok: false, error: tooLong ? 'video_too_long' : 'video_unreadable', message: tooLong ? 'Gemini Omni 1.2 Flash edits a video of up to 15 seconds. Trim it and try again.' : 'The video could not be read. Upload an MP4 of up to 15 seconds.' });
      }
    }
    const price = pricing.quote({ resolution, duration, inputSeconds, firstAndLast });
    const cost = price.internalCredits;
    if (body.expected_credits != null && Number(body.expected_credits) !== price.displayedCredits) {
      return json(409, { ok: false, error: 'The verified video length changed the price. Review the new quote before submitting.', displayed_credits: price.displayedCredits, input_seconds: inputSeconds, need: cost });
    }
    const model = String(process.env.GEMINI_OMNI_FLASH_1_2_MODEL || 'google/gemini-omni-flash-1-2').trim();
    const metaBase = {
      source: 'kie',
      engine: 'gemini-omni-flash-1-2',
      model_id: 'gemini-omni-flash-1-2',
      run_id: runId,
      status: 'pending',
      resolution,
      duration: price.duration,
      aspect_ratio: aspectRatio,
      ...(inputSeconds ? { source_video_duration: Number(inputSeconds.toFixed(2)), video_edit_mode: true } : {}),
      billed_seconds: price.billedSeconds,
      refund_amount: cost,
    };
    const rowId = existing?.id || await insertGeneration(uid, runId, prompt, metaBase);

    const currentCredits = await getCredits(uid);
    if (currentCredits < cost) {
      await patchGeneration(rowId, { ...metaBase, status: 'failed', error: 'not_enough_credits' });
      return json(402, { ok: false, error: 'not_enough_credits', credits: currentCredits, need: cost });
    }

    const input = {
      prompt,
      ...(!videoUrl ? { duration } : {}),
      aspect_ratio: aspectRatio,
      resolution,
      ...(firstFrameUrl ? { first_frame_url: firstFrameUrl } : {}),
      ...(lastFrameUrl ? { last_frame_url: lastFrameUrl } : {}),
      ...(imageUrls.length ? { image_urls: imageUrls } : {}),
      ...(videoUrl ? { video_list: [videoUrl] } : {}),
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
    return json(201, { ok: true, submitted: true, taskId, id: taskId, run_id: runId, row_id: rowId, debited: cost, credits: debit.credits, displayed_credits: price.displayedCredits });
  } catch (error) {
    return json(500, { ok: false, error: 'server_error', details: String(error && error.message || error) });
  }
};

exports._pricing = pricing;
