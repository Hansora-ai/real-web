// netlify/functions/run-gemini-omni-video.js
// Launches KIE Gemini Omni Video jobs.
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

function normalizeDuration(value) {
  const duration = Number(value || 4);
  return [4, 6, 8, 10].includes(duration) ? duration : 4;
}

function normalizeResolution(value) {
  const key = String(value || '1080p').toLowerCase();
  return key === '4k' ? '4k' : '1080p';
}

function normalizeVideoWindow(body, duration) {
  const startRaw = Number(body.video_start ?? body.start ?? 0);
  const endRaw = Number(body.video_end ?? body.ends ?? body.end ?? duration);
  const start = Number.isFinite(startRaw) ? Math.max(0, startRaw) : 0;
  const fallbackEnd = start + Number(duration || 4);
  const ends = Number.isFinite(endRaw) ? Math.max(start + 0.1, endRaw) : fallbackEnd;
  return {
    start: Number(start.toFixed(1)),
    ends: Number(ends.toFixed(1)),
  };
}

const GEMINI_VOICE_PRESETS = {
  achernar: { label: 'Achernar', description: 'female, soft, high pitch', sample: 'Hello, I am achernar.' },
  achird: { label: 'Achird', description: 'male, friendly, mid pitch', sample: 'Hello, I am achird.' },
  algenib: { label: 'Algenib', description: 'male, raspy, low pitch', sample: 'Hello, I am algenib.' },
  algieba: { label: 'Algieba', description: 'male, easygoing, mid-low pitch', sample: 'Hello, I am algieba.' },
  alnilam: { label: 'Alnilam', description: 'male, steady, mid-low pitch', sample: 'Hello, I am alnilam.' },
  aoede: { label: 'Aoede', description: 'female, brisk, mid pitch', sample: 'Hello, I am aoede.' },
  autonoe: { label: 'Autonoe', description: 'female, bright, mid pitch', sample: 'Hello, I am autonoe.' },
  callirrhoe: { label: 'Callirrhoe', description: 'female, easygoing, mid pitch', sample: 'Hello, I am callirrhoe.' },
  charon: { label: 'Charon', description: 'male, intellectual, low pitch', sample: 'Hello, I am charon.' },
  despina: { label: 'Despina', description: 'female, smooth, mid pitch', sample: 'Hello, I am despina.' },
  enceladus: { label: 'Enceladus', description: 'male, breathy, low pitch', sample: 'Hello, I am enceladus.' },
  erinome: { label: 'Erinome', description: 'female, clear, mid pitch', sample: 'Hello, I am erinome.' },
  fenrir: { label: 'Fenrir', description: 'male, lively, younger pitch', sample: 'Hello, I am fenrir.' },
  gacrux: { label: 'Gacrux', description: 'female, mature, mid pitch', sample: 'Hello, I am gacrux.' },
  iapetus: { label: 'Iapetus', description: 'male, clear, mid-low pitch', sample: 'Hello, I am iapetus.' },
  kore: { label: 'Kore', description: 'female, capable, mid pitch', sample: 'Hello, I am kore.' },
  laomedeia: { label: 'Laomedeia', description: 'female, cheerful, mid-high pitch', sample: 'Hello, I am laomedeia.' },
  leda: { label: 'Leda', description: 'female, young, mid-high pitch', sample: 'Hello, I am leda.' },
  orus: { label: 'Orus', description: 'male, steady, mid-low pitch', sample: 'Hello, I am orus.' },
  puck: { label: 'Puck', description: 'male, cheerful, mid pitch', sample: 'Hello, I am puck.' },
  pulcherrima: { label: 'Pulcherrima', description: 'genderless, forward, mid-high pitch', sample: 'Hello, I am pulcherrima.' },
  rasalgethi: { label: 'Rasalgethi', description: 'male, intellectual, mid pitch', sample: 'Hello, I am rasalgethi.' },
  sadachbia: { label: 'Sadachbia', description: 'male, vivid, low pitch', sample: 'Hello, I am sadachbia.' },
  sadaltager: { label: 'Sadaltager', description: 'male, knowledgeable, mid pitch', sample: 'Hello, I am sadaltager.' },
  schedar: { label: 'Schedar', description: 'male, smooth, mid-low pitch', sample: 'Hello, I am schedar.' },
  sulafat: { label: 'Sulafat', description: 'female, warm, mid pitch', sample: 'Hello, I am sulafat.' },
  umbriel: { label: 'Umbriel', description: 'male, smooth, low pitch', sample: 'Hello, I am umbriel.' },
  vindemiatrix: { label: 'Vindemiatrix', description: 'female, gentle, mid pitch', sample: 'Hello, I am vindemiatrix.' },
  zephyr: { label: 'Zephyr', description: 'female, bright, mid-high pitch', sample: 'Hello, I am zephyr.' },
  zubenelgenubi: { label: 'Zubenelgenubi', description: 'male, casual, mid-low pitch', sample: 'Hello, I am zubenelgenubi.' },
};

function normalizeVoicePreset(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function extractKieAudioId(data) {
  const values = [
    data?.data?.kieAudioId,
    data?.data?.audioId,
    data?.data?.audio_id,
    data?.kieAudioId,
    data?.audioId,
    data?.audio_id,
  ];
  return values.map((value) => (value == null ? '' : String(value).trim())).find(Boolean) || '';
}

async function createGeminiOmniAudioId(presetId) {
  const preset = GEMINI_VOICE_PRESETS[presetId];
  if (!preset) return presetId;
  const res = await fetch(`${KIE_BASE}/api/v1/omni/audio/create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_id: presetId,
      name: `${preset.label} voice`,
      voice_description: preset.description,
      example_dialogue: preset.sample,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data && data.code && Number(data.code) !== 0 && Number(data.code) !== 200)) {
    const message = data?.msg || data?.message || `audio_create_failed_${res.status}`;
    throw new Error(message);
  }
  const id = extractKieAudioId(data);
  if (!id) throw new Error('missing_kie_audio_id');
  return id;
}

async function resolveGeminiOmniAudioIds(values) {
  const ids = [];
  for (const value of values) {
    const raw = String(value || '').trim();
    if (!raw) continue;
    const presetId = normalizeVoicePreset(raw);
    ids.push(await createGeminiOmniAudioId(presetId || raw));
  }
  return ids.slice(0, 1);
}

function costFor(body) {
  const resolution = normalizeResolution(body.resolution);
  const hasVideo = !!String(body.video_url || '').trim();
  if (hasVideo) return resolution === '4k' ? 16 : 11;
  const duration = normalizeDuration(body.duration);
  const table = { 4: 4.5, 6: 6, 8: 7.5, 10: 9 };
  return table[duration];
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
    body: JSON.stringify({ user_id: uid, provider: 'Gemini Omni', kind: 'video', prompt, result_url: null, meta }),
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

    const imageUrls = Array.isArray(body.image_urls) ? body.image_urls.filter(Boolean).map(String).slice(0, 7) : [];
    const videoUrl = String(body.video_url || '').trim();
    const requestedAudioIds = Array.isArray(body.audio_ids)
      ? body.audio_ids.filter(Boolean).map(String)
      : String(body.audio_ids || '').split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
    const quotaUnits = imageUrls.length + (videoUrl ? 2 : 0);
    if (quotaUnits > 7) return json(400, { ok: false, error: 'too_many_inputs', message: 'Gemini Omni supports up to 7 input units. Each image is 1 unit and one video is 2 units.' });
    const duration = normalizeDuration(body.duration);
    const resolution = normalizeResolution(body.resolution);
    const aspectRatio = ['16:9', '9:16'].includes(String(body.aspect_ratio || '16:9')) ? String(body.aspect_ratio || '16:9') : '16:9';
    const cost = costFor({ video_url: videoUrl, resolution, duration });
    const videoWindow = normalizeVideoWindow(body, duration);
    const model = String(process.env.GEMINI_OMNI_VIDEO_MODEL || 'gemini-omni-video').trim();
    const metaBase = {
      source: 'kie',
      engine: 'gemini-omni-video',
      run_id: runId,
      status: 'pending',
      refund_amount: cost,
    };
    const rowId = existing?.id || await insertGeneration(uid, runId, prompt, metaBase);

    const currentCredits = await getCredits(uid);
    if (currentCredits < cost) {
      return json(402, { ok: false, error: 'not_enough_credits', credits: currentCredits, need: cost });
    }

    let audioIds = [];
    try {
      audioIds = await resolveGeminiOmniAudioIds(requestedAudioIds);
    } catch (error) {
      await patchGeneration(rowId, { ...metaBase, status: 'failed', error: `voice_setup_failed: ${String(error && error.message || error)}` });
      return json(422, { ok: false, error: 'voice_setup_failed' });
    }

    const input = {
      prompt,
      duration: String(duration),
      aspect_ratio: aspectRatio,
      resolution,
      ...(imageUrls.length ? { image_urls: imageUrls } : {}),
      ...(videoUrl ? { video_list: [{ url: videoUrl, start: videoWindow.start, ends: videoWindow.ends }] } : {}),
      ...(audioIds.length ? { audio_ids: audioIds } : {}),
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
