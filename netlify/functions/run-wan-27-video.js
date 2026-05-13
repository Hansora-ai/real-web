// netlify/functions/run-wan-27-video.js
const KIE_BASE = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/+$/, '');
const KIE_KEY = process.env.KIE_API_KEY || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SITE_BASE = (process.env.SITE_BASE || 'https://hansora.co').replace(/\/+$/, '');
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/kie-check`;

function cors() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': '*' };
}
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', ...cors() }, body: JSON.stringify(body) });
function getHeader(event, key) { return event.headers?.[key] || event.headers?.[key.toLowerCase()] || event.headers?.[key.toUpperCase()] || null; }
function getUID(event, body) {
  const qs = new URLSearchParams(event.queryStringParameters || {});
  return String(getHeader(event, 'x-user-id') || body?.uid || body?.user_id || qs.get('uid') || '').trim();
}
async function verifyAuth(event, uid) {
  const token = ((getHeader(event, 'authorization') || '').match(/^Bearer\s+(.+)$/i) || [])[1] || '';
  if (!token) return { ok: false, error: 'missing_auth' };
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!res.ok) return { ok: false, error: 'bad_auth', status: res.status };
  const user = await res.json().catch(() => null);
  const id = user && (user.id || user.user?.id);
  if (!id || String(id) !== String(uid)) return { ok: false, error: 'uid_mismatch' };
  return { ok: true };
}
function extractTaskId(data) {
  const direct = [data?.data?.taskId, data?.taskId, data?.result?.taskId, data?.data?.task_id, data?.task_id, data?.id]
    .map((v) => (v == null ? '' : String(v))).find((v) => v.length > 3);
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
  const rate = String(body.resolution || '720p') === '1080p' ? 2 : 1.5;
  return Number((duration * rate).toFixed(1));
}
async function fetchGeneration(uid, runId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_generations?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(runId)}&select=id,meta`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
async function insertGeneration(uid, runId, prompt, meta) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_generations`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: uid, provider: 'Wan 2.7', kind: 'video', prompt, result_url: null, meta }),
  });
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0].id : null;
}
async function patchGeneration(rowId, meta) {
  if (!rowId) return;
  await fetch(`${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(rowId)}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ meta }),
  });
}
async function getCredits(uid) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const rows = await res.json().catch(() => []);
  return Number(Array.isArray(rows) && rows[0] ? rows[0].credits : 0);
}
async function debitCredits(uid, cost) {
  const current = await getCredits(uid);
  if (current < cost) return { ok: false, error: 'not_enough_credits', credits: current };
  const next = Number((current - cost).toFixed(2));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
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
    const runId = String(body.run_id || `${uid}-${Date.now()}`);
    const existing = await fetchGeneration(uid, runId);
    const existingTask = existing?.meta?.task_id || existing?.meta?.taskId || '';
    if (existingTask) return json(200, { ok: true, submitted: true, taskId: existingTask, run_id: runId, already_submitted: true });
    const cost = costFor(body);
    const metaBase = { source: 'kie', engine: 'wan-2.7', run_id: runId, status: 'pending', refund_amount: cost };
    const rowId = existing?.id || await insertGeneration(uid, runId, prompt, metaBase);
    const credits = await getCredits(uid);
    if (credits < cost) return json(402, { ok: false, error: 'not_enough_credits', credits, need: cost });
    const input = {
      prompt,
      aspect_ratio: String(body.aspect_ratio || '16:9'),
      duration: Math.max(1, Number(body.duration || 5)),
      resolution: String(body.resolution || '720p'),
      prompt_extend: !!body.prompt_extend,
      watermark: false,
      ...(body.first_frame_url ? { first_frame_url: String(body.first_frame_url) } : {}),
      ...(body.last_frame_url ? { last_frame_url: String(body.last_frame_url) } : {}),
      ...(body.video_url ? { video_url: String(body.video_url), first_clip_url: String(body.video_url) } : {}),
      ...(body.audio_url ? { audio_url: String(body.audio_url) } : {}),
      ...(Array.isArray(body.image_urls) && body.image_urls.length ? { image_urls: body.image_urls } : {}),
      ...(Array.isArray(body.reference_image_urls) && body.reference_image_urls.length ? { reference_image_urls: body.reference_image_urls } : {}),
      ...(Array.isArray(body.reference_video_urls) && body.reference_video_urls.length ? { reference_video_urls: body.reference_video_urls } : {}),
      ...(Array.isArray(body.reference_audio_urls) && body.reference_audio_urls.length ? { reference_audio_urls: body.reference_audio_urls } : {}),
    };
    const hasVideo = !!body.video_url;
    const hasRefs = (Array.isArray(body.reference_image_urls) && body.reference_image_urls.length) || (Array.isArray(body.reference_video_urls) && body.reference_video_urls.length) || (Array.isArray(body.reference_audio_urls) && body.reference_audio_urls.length);
    const hasFrames = !!(body.first_frame_url || body.last_frame_url || (Array.isArray(body.image_urls) && body.image_urls.length));
    const model = hasVideo
      ? (process.env.WAN_27_VIDEO_EDIT_MODEL || 'wan/2-7-videoedit')
      : hasRefs
      ? (process.env.WAN_27_R2V_MODEL || 'wan/2-7-r2v')
      : hasFrames
      ? (process.env.WAN_27_I2V_MODEL || 'wan/2-7-image-to-video')
      : (process.env.WAN_27_T2V_MODEL || 'wan/2-7-text-to-video');
    const kieRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input, callBackUrl: `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(runId)}` }),
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
    await patchGeneration(rowId, { ...metaBase, status: 'processing', model, task_id: taskId, charged: true, charged_at: new Date().toISOString(), charged_cost: cost, debited: cost, refund_amount: cost });
    return json(201, { ok: true, submitted: true, taskId, id: taskId, run_id: runId, row_id: rowId, debited: cost, credits: debit.credits });
  } catch (error) {
    return json(500, { ok: false, error: 'server_error', details: String(error && error.message || error) });
  }
};
