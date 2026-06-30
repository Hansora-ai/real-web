// netlify/functions/run-background-change-gemini-omni.js
// Launches Background Change jobs through KIE using the original video plus start/end timing.
const KIE_BASE = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/+$/, '');
const KIE_KEY = process.env.KIE_API_KEY || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SITE_BASE = (process.env.SITE_BASE || 'https://hansora.co').replace(/\/+$/, '');
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/background-change-check`;

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  },
  body: JSON.stringify(body),
});

function getHeader(event, key) {
  return event.headers?.[key] || event.headers?.[key.toLowerCase()] || event.headers?.[key.toUpperCase()] || '';
}

function getUID(event, body) {
  return String(getHeader(event, 'x-user-id') || body?.uid || body?.user_id || '').trim();
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

function normalizeResolution(value) {
  return String(value || '1080p').toLowerCase() === '4k' ? '4k' : '1080p';
}

function durationFromWindow(start, ends) {
  const selected = Math.max(1, Number(ends || 0) - Number(start || 0));
  return [4, 6, 8, 10].find((item) => item >= selected) || 10;
}

function normalizeVideoWindow(body) {
  const list = Array.isArray(body.video_list) ? body.video_list : [];
  const first = list.find((item) => item && item.url) || {};
  const url = String(first.url || body.video_url || '').trim();
  if (!url) return null;

  let start = Number(first.start ?? body.video_start ?? 0);
  let ends = Number(first.ends ?? first.end ?? body.video_end ?? 0);
  if (!Number.isFinite(start) || start < 0) start = 0;
  if (!Number.isFinite(ends) || ends <= start) ends = start + 10;
  ends = Math.min(ends, start + 10);
  if (ends <= start) ends = start + 1;
  return {
    url,
    start: Number(start.toFixed(3)),
    ends: Number(ends.toFixed(3)),
  };
}

function costFor(resolution) {
  return normalizeResolution(resolution) === '4k' ? 22 : 15;
}

function extractTaskId(data) {
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

function sbHeaders(extra = {}) {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...extra };
}

async function getCredits(uid) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits&limit=1`, {
    headers: sbHeaders(),
  });
  const rows = await res.json().catch(() => []);
  return Number(Array.isArray(rows) && rows[0] ? rows[0].credits : 0);
}

async function debitCredits(uid, cost) {
  const current = await getCredits(uid);
  if (current < cost) return { ok: false, error: 'not_enough_credits', credits: current, need: cost };
  const next = Math.round((current - cost) * 100) / 100;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ credits: next }),
  });
  if (!res.ok) return { ok: false, error: 'profile_update_failed', status: res.status };
  return { ok: true, credits: next };
}

async function fetchGeneration(uid, runId) {
  const url = `${SUPABASE_URL}/rest/v1/user_generations?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(runId)}&select=id,meta&limit=1`;
  const res = await fetch(url, { headers: sbHeaders() });
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function insertGeneration(uid, prompt, meta) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_generations`, {
    method: 'POST',
    headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({
      user_id: uid,
      provider: 'Background Change',
      kind: 'video',
      prompt,
      result_url: null,
      meta,
    }),
  });
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0].id : null;
}

async function patchGeneration(rowId, meta) {
  if (!rowId) return;
  await fetch(`${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(rowId)}`, {
    method: 'PATCH',
    headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ meta }),
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: json(204, {}).headers, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  try {
    if (!KIE_KEY || !SUPABASE_URL || !SERVICE_KEY) return json(500, { ok: false, error: 'missing_env' });
    const body = JSON.parse(event.body || '{}');
    const uid = getUID(event, body);
    if (!uid) return json(401, { ok: false, error: 'missing_uid' });
    const auth = await verifyAuth(event, uid);
    if (!auth.ok) return json(401, { ok: false, error: auth.error, details: auth });

    const userPrompt = String(body.prompt || '').trim();
    const videoWindow = normalizeVideoWindow(body);
    if (!userPrompt) return json(400, { ok: false, error: 'missing_prompt' });
    if (!videoWindow) return json(400, { ok: false, error: 'missing_video' });

    const originalDuration = Number(body.video_original_duration || body.original_duration || 0);
    if (Number.isFinite(originalDuration) && originalDuration > 180.05) {
      return json(400, { ok: false, error: 'video_too_long', max_seconds: 180 });
    }

    const selectedDuration = Number((videoWindow.ends - videoWindow.start).toFixed(3));
    if (selectedDuration > 10.001) return json(400, { ok: false, error: 'segment_too_long', max_seconds: 10 });

    const runId = String(body.run_id || `${uid}-${Date.now()}`);
    const existing = await fetchGeneration(uid, runId);
    const existingTask = existing?.meta?.task_id || existing?.meta?.taskId || '';
    if (existingTask) return json(200, { ok: true, submitted: true, taskId: existingTask, run_id: runId, already_submitted: true });

    const imageUrls = Array.isArray(body.image_urls) ? body.image_urls.filter(Boolean).map(String).slice(0, 5) : [];
    const quotaUnits = imageUrls.length + 2;
    if (quotaUnits > 7) {
      return json(400, { ok: false, error: 'too_many_inputs', message: 'This tool supports up to 7 input units. One video uses 2 units.' });
    }

    const resolution = normalizeResolution(body.resolution);
    const aspectRatio = ['16:9', '9:16'].includes(String(body.aspect_ratio || '16:9')) ? String(body.aspect_ratio || '16:9') : '16:9';
    const duration = durationFromWindow(videoWindow.start, videoWindow.ends);
    const cost = costFor(resolution);
    const model = String(process.env.BACKGROUND_CHANGE_GEMINI_MODEL || process.env.VIDEO_EDIT_GEMINI_MODEL || process.env.GEMINI_OMNI_VIDEO_MODEL || 'gemini-omni-video').trim();
    const prompt = [
      'Change only the background of the uploaded video.',
      'Keep the original subject, body, face, clothing, hairstyle, pose, motion, camera timing, framing, and foreground details unchanged.',
      'Do not change the person or main object. Do not alter identity, outfit, expression, hands, body shape, or movement.',
      'Replace only the environment/background according to the user request, matching perspective, lighting direction, shadows, reflections, and depth so it looks natural.',
      `User background request: ${userPrompt}`
    ].join(' ');
    const metaBase = {
      source: 'kie',
      engine: 'background-change-gemini-omni',
      source_feature: 'background-change',
      run_id: runId,
      status: 'pending',
      refund_amount: cost,
      input_window: { start: videoWindow.start, ends: videoWindow.ends },
      selected_duration: selectedDuration,
      original_duration: Number.isFinite(originalDuration) ? originalDuration : 0,
      original_video_url: videoWindow.url,
    };

    const rowId = existing?.id || await insertGeneration(uid, userPrompt, metaBase);
    const currentCredits = await getCredits(uid);
    if (currentCredits < cost) return json(402, { ok: false, error: 'not_enough_credits', credits: currentCredits, need: cost });

    const input = {
      prompt,
      duration: String(duration),
      aspect_ratio: aspectRatio,
      resolution,
      video_list: [videoWindow],
      ...(imageUrls.length ? { image_urls: imageUrls } : {}),
    };
    const callback = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(runId)}`;
    const kieRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input, callBackUrl: callback }),
    });
    const data = await kieRes.json().catch(() => ({}));
    if (!kieRes.ok || (data && data.code && Number(data.code) !== 200)) {
      await patchGeneration(rowId, { ...metaBase, status: 'failed', error: data || `kie_${kieRes.status}` });
      return json(kieRes.status || 422, { ok: false, error: 'kie_create_failed', details: data });
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
