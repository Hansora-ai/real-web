// netlify/functions/run-kling-30.js
// Launches KIE Kling 3.0 jobs with optional image/video elements.
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

function costFor(body) {
  const duration = Math.max(1, Number(body.duration || 5));
  const resolution = String(body.resolution || '720p');
  const sound = !!body.sound;
  let rate = 1;
  if (resolution === '4K') rate = 4;
  else if (resolution === '1080p') rate = sound ? 2 : 1.5;
  else rate = sound ? 1.5 : 1;
  return Number((duration * rate).toFixed(1));
}

function sanitizeElementName(name) {
  let s = String(name || '').trim().replace(/[^a-zA-Z0-9_]/g, '_');
  if (!s) return '';
  if (!/^[a-zA-Z_]/.test(s)) s = '_' + s;
  return s.slice(0, 32);
}

function appendElementReference(prompt, elementName) {
  const base = String(prompt || '').trim();
  const cleanName = sanitizeElementName(elementName);
  if (!cleanName) return base;
  const escaped = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const refRegex = new RegExp('(^|\\s)@' + escaped + '(?=\\s|$)', 'i');
  if (refRegex.test(base)) return base;
  return (base ? base + ' ' : '') + '@' + cleanName;
}

function normalizeAndValidateKlingElements(rawElements) {
  const elements = Array.isArray(rawElements) ? rawElements : [];
  if (elements.length > 3) {
    return { ok: false, error: 'too_many_kling_elements', details: 'Kling 3.0 supports up to 3 element references per request.' };
  }
  const normalized = [];
  const seen = new Set();
  for (let i = 0; i < elements.length; i += 1) {
    const item = elements[i] || {};
    const name = sanitizeElementName(item.name);
    const description = String(item.description || '').trim();
    const imageUrls = Array.isArray(item.element_input_urls) ? item.element_input_urls.map(String).filter(Boolean) : [];
    const videoUrls = Array.isArray(item.element_input_video_urls) ? item.element_input_video_urls.map(String).filter(Boolean) : [];
    if (!name) return { ok: false, error: 'invalid_kling_element', details: `Element ${i + 1}: name is required.` };
    if (!description) return { ok: false, error: 'invalid_kling_element', details: `Element ${i + 1}: description is required.` };
    if (seen.has(name)) return { ok: false, error: 'duplicate_kling_element_name', details: `Duplicate element name: ${name}` };
    seen.add(name);
    if (imageUrls.length && videoUrls.length) {
      return { ok: false, error: 'invalid_kling_element', details: `Element ${name}: use image URLs or video URLs, not both.` };
    }
    if (videoUrls.length) {
      if (videoUrls.length !== 1) return { ok: false, error: 'invalid_kling_element', details: `Element ${name}: video element requires exactly 1 video URL.` };
      normalized.push({ name, description, element_input_video_urls: videoUrls });
      continue;
    }
    if (imageUrls.length < 2 || imageUrls.length > 4) {
      return { ok: false, error: 'invalid_kling_element', details: `Element ${name}: image element requires 2-4 image URLs.` };
    }
    normalized.push({ name, description, element_input_urls: imageUrls });
  }
  return { ok: true, elements: normalized };
}

function normalizeMultiPrompt(rawMultiPrompt, elements) {
  const multiPrompt = Array.isArray(rawMultiPrompt) ? rawMultiPrompt.slice(0, 5) : [];
  return multiPrompt.map((shot, index) => {
    const duration = Math.max(1, Math.min(12, Number(shot?.duration || 3)));
    let prompt = String(shot?.prompt || '').trim();
    const element = elements[index] || null;
    if (element && element.name) prompt = appendElementReference(prompt, element.name);
    return { prompt, duration };
  });
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
    body: JSON.stringify({ user_id: uid, provider: 'Kling 3.0', kind: 'video', prompt, result_url: null, meta }),
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
    if (!prompt && !Array.isArray(body.kling_elements)) return json(400, { ok: false, error: 'missing_prompt' });

    const runId = String(body.run_id || `${uid}-${Date.now()}`);
    const existing = await fetchGeneration(uid, runId);
    const existingTask = existing?.meta?.task_id || existing?.meta?.taskId || '';
    if (existingTask) return json(200, { ok: true, submitted: true, taskId: existingTask, run_id: runId, already_submitted: true });

    const cost = costFor(body);
    const metaBase = {
      source: 'kie',
      engine: 'kling-3.0',
      run_id: runId,
      status: 'pending',
      refund_amount: cost,
    };
    const rowId = existing?.id || await insertGeneration(uid, runId, prompt, metaBase);

    const currentCredits = await getCredits(uid);
    if (currentCredits < cost) {
      return json(402, { ok: false, error: 'not_enough_credits', credits: currentCredits, need: cost });
    }

    const resolution = String(body.resolution || '720p');
    const elementsResult = normalizeAndValidateKlingElements(body.kling_elements);
    if (!elementsResult.ok) return json(400, { ok: false, error: elementsResult.error, details: elementsResult.details });
    const klingElements = elementsResult.elements || [];
    const multiPrompt = normalizeMultiPrompt(body.multi_prompt, klingElements);
    const totalShotSeconds = multiPrompt.reduce((sum, shot) => sum + Math.max(1, Number(shot?.duration || 1)), 0);
    if (body.multi_shots) {
      if (!multiPrompt.length) return json(400, { ok: false, error: 'missing_multi_prompt' });
      if (totalShotSeconds > 15) {
        return json(400, { ok: false, error: 'multi_shots_too_long', details: 'Kling 3.0 multi-shot total duration must be 15 seconds or less.' });
      }
      const badShot = multiPrompt.find((shot) => !shot.prompt || Number(shot.duration) < 1 || Number(shot.duration) > 12);
      if (badShot) return json(400, { ok: false, error: 'invalid_multi_prompt', details: 'Each multi-shot prompt must include prompt text and duration from 1-12 seconds.' });
    }
    const imageUrls = Array.isArray(body.image_urls) ? body.image_urls.map(String).filter(Boolean) : [];
    const safeImageUrls = body.multi_shots ? imageUrls.slice(0, 1) : imageUrls.slice(0, 2);
    const promptForKie = klingElements.length && !body.multi_shots
      ? klingElements.reduce((out, element) => appendElementReference(out, element.name), prompt)
      : prompt;
    const input = {
      prompt: promptForKie,
      aspect_ratio: String(body.aspect_ratio || '16:9'),
      duration: Math.max(1, Number(body.duration || 5)),
      mode: body.mode || (resolution === '4K' ? '4K' : (resolution === '1080p' ? 'pro' : 'std')),
      sound: !!body.sound,
      multi_shots: !!body.multi_shots,
      ...(body.first_frame_url ? { first_frame_url: String(body.first_frame_url) } : {}),
      ...(!body.multi_shots && body.last_frame_url ? { last_frame_url: String(body.last_frame_url) } : {}),
      ...(safeImageUrls.length ? { image_urls: safeImageUrls } : {}),
      ...(Array.isArray(body.element_input_urls) && body.element_input_urls.length ? { element_input_urls: body.element_input_urls } : {}),
      ...(Array.isArray(body.element_input_video_urls) && body.element_input_video_urls.length ? { element_input_video_urls: body.element_input_video_urls } : {}),
      ...(klingElements.length ? { kling_elements: klingElements } : {}),
      ...(multiPrompt.length ? { multi_prompt: multiPrompt } : {}),
    };
    const model = process.env.KLING_30_MODEL || 'kling-3.0';
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
    const taskId = extractTaskId(data);
    if (!taskId) return json(502, { ok: false, error: 'missing_task_id', details: data });

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
