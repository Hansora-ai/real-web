// netlify/functions/video-edit-check.js
// Dedicated checker/refunder for Video Edit jobs.
const KIE_BASE = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/+$/, '');
const KIE_KEY = process.env.KIE_API_KEY || process.env.KIEAI_API_KEY || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const UG_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : '';
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : '';

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: json(204, {}).headers, body: '' };
    if (event.httpMethod === 'POST') return handlePost(event);
    if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Use GET or POST' });

    const qs = event.queryStringParameters || {};
    const ids = {
      uid: String(qs.uid || '').trim(),
      run_id: String(qs.run_id || '').trim(),
      taskId: String(qs.taskId || qs.task_id || '').trim(),
    };
    const row = await findVideoEditGeneration(ids);
    if (!row) return json(200, { ok: false, status: 'ignored', reason: 'not_video_edit_processing' });

    ids.uid = ids.uid || row.user_id || '';
    ids.run_id = ids.run_id || row.meta?.run_id || '';
    ids.taskId = ids.taskId || row.meta?.task_id || row.meta?.taskId || '';
    if (!ids.taskId) return json(200, { ok: false, status: 'pending', error: 'missing_task_id' });

    const state = await fetchKieState(ids.taskId, collectKnownInputUrls(row));
    if (state.failed) {
      const refund = await failAndRefundOnce({ row, ids, reason: state.error || 'kie_failed' });
      return json(200, {
        ok: false,
        failed: true,
        status: 'failed',
        error: state.error || 'kie_failed',
        refunded: !!refund.refunded,
        refund_amount: refund.amount || 0,
      });
    }

    if (state.done && state.urls.length) {
      await markDone({ row, ids, urls: state.urls });
      return json(200, {
        ok: true,
        status: 'done',
        result_url: state.urls[0],
        video_url: state.urls[0],
        urls: state.urls,
      });
    }

    return json(200, { ok: false, status: 'pending' });
  } catch (error) {
    return json(200, { ok: false, status: 'error', error: messageOf(error) });
  }
};

async function handlePost(event) {
  const qs = event.queryStringParameters || {};
  const body = safeJson(event.body);
  const ids = {
    uid: String(qs.uid || body.uid || body.user_id || body?.data?.uid || '').trim(),
    run_id: String(qs.run_id || body.run_id || body?.data?.run_id || '').trim(),
    taskId: String(qs.taskId || qs.task_id || body.taskId || body.task_id || body?.data?.taskId || body?.data?.task_id || body.id || '').trim(),
  };
  const row = await findVideoEditGeneration(ids);
  if (!row) return json(200, { ok: false, status: 'ignored', reason: 'not_video_edit_processing' });

  ids.uid = ids.uid || row.user_id || '';
  ids.run_id = ids.run_id || row.meta?.run_id || '';
  ids.taskId = ids.taskId || row.meta?.task_id || row.meta?.taskId || '';
  const status = normalizeStatus(body);
  if (status === 'failed') {
    const refund = await failAndRefundOnce({ row, ids, reason: failureReason(body) });
    return json(200, { ok: false, failed: true, status: 'failed', error: failureReason(body), refunded: !!refund.refunded });
  }

  const urls = collectResultUrls(body, collectKnownInputUrls(row));
  if (urls.length) {
    await markDone({ row, ids, urls });
    return json(200, { ok: true, status: 'done', result_url: urls[0], video_url: urls[0], urls });
  }

  return json(200, { ok: false, status: 'pending' });
}

function sb(extra = {}) {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...extra };
}

function safeJson(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function isVideoEditRow(row) {
  const meta = row?.meta && typeof row.meta === 'object' ? row.meta : {};
  const provider = String(row?.provider || '').toLowerCase();
  const engine = String(meta.engine || '').toLowerCase();
  const feature = String(meta.source_feature || '').toLowerCase();
  return feature === 'video-edit' || engine === 'video-edit-gemini-omni' || provider === 'video edit';
}

async function findVideoEditGeneration(ids) {
  if (!UG_URL || !SERVICE_KEY) return null;
  const select = 'select=id,user_id,provider,kind,result_url,meta,created_at';
  const queries = [];
  if (ids.uid && ids.run_id) queries.push(`?user_id=eq.${encodeURIComponent(ids.uid)}&meta->>run_id=eq.${encodeURIComponent(ids.run_id)}&${select}&limit=1`);
  if (ids.taskId) {
    queries.push(`?meta->>task_id=eq.${encodeURIComponent(ids.taskId)}&${select}&limit=1`);
    queries.push(`?meta->>taskId=eq.${encodeURIComponent(ids.taskId)}&${select}&limit=1`);
  }
  for (const query of queries) {
    const res = await fetch(UG_URL + query, { headers: sb() });
    const rows = await res.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || row.result_url || !isVideoEditRow(row)) continue;
    const status = String(row.meta?.status || '').toLowerCase();
    if (status === 'processing' || status === 'pending' || !status) return row;
  }
  return null;
}

async function fetchKieState(taskId, excludeUrls = []) {
  if (!KIE_KEY) return { pending: true, error: 'missing_kie_key' };
  const endpoints = [
    `/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/jobs/result?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/jobs/getTask?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/veo/record-info?taskId=${encodeURIComponent(taskId)}`,
  ];
  let sawFailed = false;
  let failReason = '';
  let sawLiveTask = false;
  for (const path of endpoints) {
    try {
      const res = await fetch(KIE_BASE + path, { headers: { Accept: 'application/json', Authorization: `Bearer ${KIE_KEY}` } });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      const status = normalizeStatus(data);
      if (status === 'failed') {
        if (isLookupOnlyFailure(data)) continue;
        sawFailed = true;
        failReason = failReason || failureReason(data);
        continue;
      }
      const urls = collectResultUrls(data, excludeUrls);
      if (status === 'done' && urls.length) return { done: true, urls };
      if (urls.length) return { done: true, urls };
      sawLiveTask = true;
    } catch (error) {
      failReason = failReason || messageOf(error);
    }
  }
  if (sawLiveTask) return { pending: true };
  if (sawFailed) return { failed: true, error: failReason || 'kie_failed' };
  return { pending: true };
}

async function markDone({ row, ids, urls }) {
  const meta = {
    ...(row.meta && typeof row.meta === 'object' ? row.meta : {}),
    run_id: ids.run_id || row.meta?.run_id || '',
    task_id: ids.taskId || row.meta?.task_id || row.meta?.taskId || '',
    status: 'done',
    completed_at: new Date().toISOString(),
  };
  await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}`, {
    method: 'PATCH',
    headers: sb({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ result_url: urls[0], meta }),
  });
}

async function failAndRefundOnce({ row, ids, reason }) {
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  const amount = Number(meta.refund_amount || 0);
  const failedMeta = {
    ...meta,
    run_id: ids.run_id || meta.run_id || '',
    task_id: ids.taskId || meta.task_id || meta.taskId || '',
    status: 'failed',
    failed: true,
    error: reason,
    failed_at: new Date().toISOString(),
  };

  if (!Number.isFinite(amount) || amount <= 0) {
    await patchGeneration(row.id, { meta: { ...failedMeta, refund_skipped_reason: 'missing_refund_amount' } });
    return { refunded: false, amount: 0 };
  }

  const claim = `r_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const claimUrl = `${UG_URL}?id=eq.${encodeURIComponent(row.id)}&result_url=is.null&meta->>refunded=is.null&meta->>refund_claim=is.null&select=id`;
  const claimRes = await fetch(claimUrl, {
    method: 'PATCH',
    headers: sb({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ result_url: null, meta: { ...failedMeta, refund_claim: claim } }),
  });
  const claimed = await claimRes.json().catch(() => []);
  if (!claimRes.ok || !Array.isArray(claimed) || !claimed.length) return { refunded: false, amount, already_claimed: true };

  const profileRes = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(row.user_id)}&select=credits&limit=1`, { headers: sb() });
  const profiles = await profileRes.json().catch(() => []);
  const currentCredits = Number(Array.isArray(profiles) && profiles[0] ? profiles[0].credits : 0);
  const nextCredits = Math.round((currentCredits + amount) * 100) / 100;
  const updateRes = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(row.user_id)}`, {
    method: 'PATCH',
    headers: sb({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ credits: nextCredits }),
  });
  if (!updateRes.ok) {
    await patchGeneration(row.id, { meta: { ...failedMeta, refund_claim: claim, refund_error: 'profile_refund_failed' } });
    return { refunded: false, amount, error: 'profile_refund_failed' };
  }
  await patchGeneration(row.id, { meta: { ...failedMeta, refund_claim: claim, refunded: true, refunded_cost: amount, refunded_at: new Date().toISOString() } });
  return { refunded: true, amount, credits: nextCredits };
}

async function patchGeneration(id, payload) {
  const res = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: sb({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(payload),
  });
  return res.ok;
}

function normalizeStatus(value) {
  const flag = value?.data?.successFlag ?? value?.successFlag ?? value?.result?.successFlag;
  if (flag === 1 || flag === '1') return 'done';
  if (flag === 2 || flag === '2' || flag === 3 || flag === '3') return 'failed';
  const text = [];
  collectStatusText(value, text);
  const joined = text.join(' ').toLowerCase();
  if (/(fail|failed|failure|error|errored|cancel|canceled|cancelled|rejected|moderation|blocked|sensitive|flagged)/.test(joined)) return 'failed';
  if (/(success|succeeded|completed|complete|finish|finished|done)/.test(joined)) return 'done';
  return 'pending';
}

function collectStatusText(value, out) {
  if (!value || out.length > 80) return;
  if (typeof value === 'string') {
    if (/fail|error|success|complete|finish|done|pending|process|cancel|reject|blocked|moderation|sensitive|flag/i.test(value)) out.push(value);
    return;
  }
  if (Array.isArray(value)) return value.forEach((item) => collectStatusText(item, out));
  if (typeof value === 'object') {
    for (const key of ['status', 'state', 'message', 'error', 'reason', 'description']) {
      if (value[key] != null) collectStatusText(value[key], out);
    }
    for (const key of ['data', 'result', 'response', 'task', 'job']) {
      if (value[key]) collectStatusText(value[key], out);
    }
  }
}

function isLookupOnlyFailure(value) {
  const text = String(value?.msg || value?.message || value?.error || value?.data?.msg || value?.data?.message || value?.data?.error || '').toLowerCase();
  return /not\s*found|no\s*task|task\s*does\s*not\s*exist|invalid\s*task|missing\s*task|cannot\s*find|record\s*not\s*found|unsupported|wrong endpoint/.test(text);
}

function failureReason(value) {
  return String(value?.error || value?.message || value?.data?.error || value?.data?.message || value?.data?.reason || value?.result?.error || value?.result?.message || 'kie_failed');
}

function collectKnownInputUrls(row) {
  const meta = row?.meta && typeof row.meta === 'object' ? row.meta : {};
  const urls = [];
  if (meta.original_video_url) urls.push(String(meta.original_video_url));
  if (meta.input_window?.url) urls.push(String(meta.input_window.url));
  return urls;
}

function collectResultUrls(value, excludeUrls = []) {
  const urls = [];
  const seen = new Set(excludeUrls.map((url) => String(url || '').trim()).filter(Boolean));
  function push(url) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    const clean = url.replace(/[)"'\\\]}]+$/g, '');
    if (!/\.(?:mp4|mov|webm|png|jpe?g|webp|gif)(?:[?#].*)?$/i.test(clean)) return;
    if (seen.has(clean)) return;
    seen.add(clean);
    urls.push(clean);
  }
  function walk(x, depth = 0) {
    if (!x || depth > 8 || urls.length >= 4) return;
    if (typeof x === 'string') {
      const matches = x.match(/https?:\/\/[^\s"'<>]+/gi);
      if (matches) matches.forEach(push);
      return;
    }
    if (Array.isArray(x)) return x.forEach((item) => walk(item, depth + 1));
    if (typeof x === 'object') {
      for (const key of ['video_url', 'image_url', 'result_url', 'url', 'output', 'outputs', 'images', 'image_urls', 'result_urls', 'data', 'result']) {
        if (x[key] != null) walk(x[key], depth + 1);
      }
      for (const key of Object.keys(x).slice(0, 80)) walk(x[key], depth + 1);
    }
  }
  walk(value);
  return urls.slice(0, 4);
}

function messageOf(error) {
  return error && error.message ? error.message : String(error);
}
