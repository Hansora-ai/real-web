// netlify/functions/run-seedance-25-cheap.js
// Text-only economy route for the Seedance 2.5 feature through BytePlus ModelArk.
// Any request with uploaded media must stay on run-seedance-25.js.
const ARK_BASE = (process.env.ARK_BASE_URL || 'https://ark.ap-southeast.bytepluses.com').replace(/\/+$/, '');
const ARK_KEY = process.env.seedance_cheap || process.env.SEEDANCE_CHEAP || process.env.ARK_API_KEY || process.env.BYTEPLUS_ARK_API_KEY || '';
const ARK_MODEL = 'dreamina-seedance-2-5-260628';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SITE_BASE = (process.env.SITE_BASE || 'https://hansora.co').replace(/\/+$/, '');
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/seedance-cheap-check`;

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
    data?.data?.id,
    data?.data?.task_id,
    data?.data?.taskId,
    data?.id,
    data?.task_id,
    data?.taskId,
    data?.result?.id,
    data?.result?.task_id,
    data?.result?.taskId,
  ].map((v) => (v == null ? '' : String(v))).find((v) => v.length > 3);
  if (direct) return direct;

  const seen = new Set();
  const scan = (value) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return '';
    seen.add(value);
    for (const [key, inner] of Object.entries(value)) {
      if (/^(id|task[_-]?id|request[_-]?id)$/i.test(key) && (typeof inner === 'string' || typeof inner === 'number')) {
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

function clampDuration(value) {
  const duration = Number(value || 5);
  if (!Number.isFinite(duration)) return 5;
  return Math.min(15, Math.max(4, Math.round(duration)));
}

function normalizeResolution(value) {
  const raw = String(value || '720p').toLowerCase();
  return raw === '480p' ? '480p' : '720p';
}

function normalizeRatio(value) {
  const raw = String(value || '16:9').trim();
  return ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'].includes(raw) ? raw : '16:9';
}

function normalizeModel() {
  return ARK_MODEL;
}

function costFor(body) {
  const duration = clampDuration(body.duration);
  const resolution = String(body.resolution || '720p').toLowerCase();
  const rate = resolution === '480p' ? 1.7 : 3.8;
  return Number((duration * rate).toFixed(1));
}

function hasMedia(body) {
  const singles = [
    body.first_frame_url,
    body.last_frame_url,
    body.image_url,
    body.video_url,
    body.audio_url,
  ];
  const arrays = [
    body.reference_image_urls,
    body.reference_video_urls,
    body.reference_audio_urls,
    body.image_urls,
    body.video_urls,
    body.audio_urls,
  ];
  return !!(
    singles.some((value) => String(value || '').trim()) ||
    arrays.some((value) => Array.isArray(value) && value.some((item) => String(item || '').trim()))
  );
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
    body: JSON.stringify({ user_id: uid, provider: 'Seedance 2.5', kind: 'video', prompt, result_url: null, meta }),
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  try {
    if (!ARK_KEY || !SUPABASE_URL || !SERVICE_KEY) {
      return json(500, {
        ok: false,
        error: 'missing_env',
        missing: [
          !ARK_KEY ? 'seedance_cheap' : '',
          !SUPABASE_URL ? 'SUPABASE_URL' : '',
          !SERVICE_KEY ? 'SUPABASE_SERVICE_ROLE_KEY' : '',
        ].filter(Boolean),
      });
    }
    const body = JSON.parse(event.body || '{}');
    const uid = getUID(event, body);
    if (!uid) return json(401, { ok: false, error: 'missing_uid' });
    const auth = await verifyAuth(event, uid);
    if (!auth.ok) return json(401, { ok: false, error: auth.error, details: auth });

    const prompt = String(body.prompt || '').trim();
    if (!prompt) return json(400, { ok: false, error: 'missing_prompt' });
    if (hasMedia(body)) return json(409, { ok: false, error: 'media_requires_standard_seedance_route' });

    const runId = String(body.run_id || `${uid}-${Date.now()}`);
    const existing = await fetchGeneration(uid, runId);
    const existingTask = existing?.meta?.task_id || existing?.meta?.taskId || '';
    if (existingTask) return json(200, { ok: true, submitted: true, taskId: existingTask, run_id: runId, already_submitted: true });

    const duration = clampDuration(body.duration);
    const resolution = normalizeResolution(body.resolution);
    const ratio = normalizeRatio(body.aspect_ratio || body.ratio);
    const cost = costFor({ ...body, duration, resolution });
    const model = normalizeModel();
    const callback = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(runId)}`;

    const metaBase = {
      source: 'byteplus',
      checker: 'seedance-cheap-check',
      engine: 'seedance-2.5',
      provider_route: 'text_only_low_cost',
      ratio,
      resolution,
      duration,
      run_id: runId,
      status: 'pending',
      refund_amount: cost,
    };
    const rowId = existing?.id || await insertGeneration(uid, runId, prompt, metaBase);

    const currentCredits = await getCredits(uid);
    if (currentCredits < cost) {
      return json(402, { ok: false, error: 'not_enough_credits', credits: currentCredits, need: cost });
    }

    const arkPayload = {
      model,
      content: [{ type: 'text', text: prompt }],
      ratio,
      resolution,
      duration,
      generate_audio: body.generate_audio !== false,
      return_last_frame: !!body.return_last_frame,
      watermark: false,
      callback_url: callback,
    };

    const arkRes = await fetch(`${ARK_BASE}/api/v3/contents/generations/tasks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ARK_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(arkPayload),
    });
    const data = await arkRes.json().catch(() => ({}));
    if (!arkRes.ok) {
      await patchGeneration(rowId, { ...metaBase, status: 'failed', error: data });
      return json(arkRes.status || 502, { ok: false, error: 'seedance_create_failed', details: data });
    }

    const providerStatus = String(data?.data?.status || data?.status || '').toLowerCase();
    if (/(fail|failed|error|rejected|denied|blocked)/.test(providerStatus)) {
      await patchGeneration(rowId, { ...metaBase, status: 'failed', error: data });
      return json(422, { ok: false, error: 'seedance_create_failed', details: data });
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
    return json(201, { ok: true, submitted: true, taskId, id: taskId, run_id: runId, row_id: rowId, debited: cost, credits: debit.credits, checker: 'seedance-cheap-check' });
  } catch (error) {
    return json(500, { ok: false, error: 'server_error', details: String(error && error.message || error) });
  }
};
