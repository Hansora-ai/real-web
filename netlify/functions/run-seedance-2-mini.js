// netlify/functions/run-seedance-2-mini.js
// Launches KIE Seedance 2.0 Mini jobs.
// The refund amount is written once by this run function as meta.refund_amount.
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

function clampDuration(value) {
  const duration = Number(value || 5);
  if (!Number.isFinite(duration)) return 5;
  return Math.min(15, Math.max(4, Math.round(duration)));
}

function normalizeSeedanceMiniModel(value) {
  const raw = String(value || '').trim();
  const key = raw.toLowerCase();
  const fallback = 'bytedance/seedance-2-mini';
  if (!raw) return fallback;
  if (key === 'seedance-2.0-mini' || key === 'seedance-2-mini' || key === 'bytedance/seedance-2-mini') return 'bytedance/seedance-2-mini';
  return fallback;
}

function costFor(body) {
  const duration = clampDuration(body.duration);
  return Number((duration * 1.3).toFixed(1));
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
    body: JSON.stringify({ user_id: uid, provider: 'Seedance 2.0 Mini', kind: 'video', prompt, result_url: null, meta }),
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
    if (!KIE_KEY || !SUPABASE_URL || !SERVICE_KEY) return json(500, { ok: false, error: 'missing_env' });
    const body = JSON.parse(event.body || '{}');
    const uid = getUID(event, body);
    if (!uid) return json(401, { ok: false, error: 'missing_uid' });
    const auth = await verifyAuth(event, uid);
    if (!auth.ok) return json(401, { ok: false, error: auth.error, details: auth });

    const prompt = String(body.prompt || '').trim();
    if (!prompt) return json(400, { ok: false, error: 'missing_prompt' });

    const runId = String(body.run_id || `${uid}-${Date.now()}`);
    const existing = await fetchGeneration(uid, runId);
    const existingTask = existing?.meta?.task_id || existing?.meta?.taskId || '';
    if (existingTask) return json(200, { ok: true, submitted: true, taskId: existingTask, run_id: runId, already_submitted: true });

    const variant = 'mini';
    const cost = costFor({ ...body, variant });
    const metaBase = {
      source: 'kie',
      engine: 'seedance-2.0-mini',
      variant,
      run_id: runId,
      status: 'pending',
      refund_amount: cost,
    };
    const rowId = existing?.id || await insertGeneration(uid, runId, prompt, metaBase);

    const currentCredits = await getCredits(uid);
    if (currentCredits < cost) {
      return json(402, { ok: false, error: 'not_enough_credits', credits: currentCredits, need: cost });
    }

    const model = normalizeSeedanceMiniModel(process.env.SEEDANCE_20_MINI_MODEL);
    const firstFrameUrl = String(body.first_frame_url || '').trim();
    const lastFrameUrl = String(body.last_frame_url || '').trim();
    const referenceImageUrls = Array.isArray(body.reference_image_urls) ? body.reference_image_urls.filter(Boolean).map(String) : [];
    const referenceVideoUrls = Array.isArray(body.reference_video_urls) ? body.reference_video_urls.filter(Boolean).map(String) : [];
    const referenceAudioUrls = Array.isArray(body.reference_audio_urls) ? body.reference_audio_urls.filter(Boolean).map(String) : [];
    const hasFrameMode = !!(firstFrameUrl || lastFrameUrl);
    const resolution = ['480p', '720p'].includes(String(body.resolution || '720p')) ? String(body.resolution || '720p') : '720p';
    const input = {
      prompt,
      resolution,
      duration: clampDuration(body.duration),
      aspect_ratio: String(body.aspect_ratio || '16:9'),
      generate_audio: body.generate_audio !== false,
      return_last_frame: !!body.return_last_frame,
      web_search: !!(body.enable_web_search || body.web_search),
      nsfw_checker: body.nsfw_checker === undefined ? false : !!body.nsfw_checker,
      ...(firstFrameUrl ? { first_frame_url: firstFrameUrl } : {}),
      ...(lastFrameUrl ? { last_frame_url: lastFrameUrl } : {}),
      ...(!hasFrameMode && referenceImageUrls.length ? { reference_image_urls: referenceImageUrls.slice(0, 9) } : {}),
      ...(!hasFrameMode && referenceVideoUrls.length ? { reference_video_urls: referenceVideoUrls.slice(0, 3) } : {}),
      ...(!hasFrameMode && referenceAudioUrls.length ? { reference_audio_urls: referenceAudioUrls.slice(0, 3) } : {}),
    };
    const callback = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(runId)}`;
    const kieRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input, callBackUrl: callback }),
    });
    const data = await kieRes.json().catch(() => ({}));
    if (!kieRes.ok) {
      await patchGeneration(rowId, { ...metaBase, status: 'failed', error: data });
      return json(kieRes.status || 502, { ok: false, error: 'kie_create_failed', details: data });
    }
    if (data && data.code && Number(data.code) !== 200) {
      await patchGeneration(rowId, { ...metaBase, status: 'failed', error: data });
      return json(422, { ok: false, error: 'kie_create_failed', details: data });
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
