// netlify/functions/unifically-grok-check.js
// Poll/refund checker for the short-duration UnificAlly Grok route.
const UNIFICALLY_BASE = (process.env.UNIFICALLY_BASE_URL || 'https://api.unifically.com').replace(/\/+$/, '');
const UNIFICALLY_KEY = process.env.UnificAlly_API || process.env.UNIFICALLY_API || process.env.UNIFICALLY_API_KEY || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const UG_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : '';
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : '';

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
    if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Use GET' });
    if (!UNIFICALLY_KEY || !UG_URL || !SERVICE_KEY) return json(200, { ok: false, status: 'pending', error: 'missing_env' });

    const qs = event.queryStringParameters || {};
    const ids = {
      uid: String(qs.uid || '').trim(),
      run_id: String(qs.run_id || '').trim(),
      taskId: String(qs.taskId || qs.task_id || '').trim(),
    };
    const row = await findProcessingGeneration(ids);
    if (!row) return json(200, { ok: false, status: 'ignored', reason: 'not_processing' });

    ids.uid = ids.uid || row.user_id || '';
    ids.run_id = ids.run_id || row.meta?.run_id || '';
    ids.taskId = ids.taskId || row.meta?.task_id || row.meta?.taskId || '';
    if (!ids.taskId) return json(200, { ok: false, status: 'pending', error: 'missing_task_id' });

    const state = await fetchTaskState(ids.taskId);
    if (state.failed) {
      const refund = await failAndRefundOnce({ row, ids, reason: state.error || 'grok_generation_failed' });
      return json(200, {
        ok: false,
        failed: true,
        status: 'failed',
        error: state.error || 'grok_generation_failed',
        refunded: !!refund.refunded,
        refund_amount: refund.amount || 0,
        already_claimed: !!refund.already_claimed,
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

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
  };
}
function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', ...cors() }, body: JSON.stringify(body) };
}
function sb() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
}
function safeJson(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function findProcessingGeneration(ids) {
  const select = 'select=id,user_id,provider,kind,result_url,meta,created_at';
  const queries = [];
  if (ids.uid && ids.run_id) {
    queries.push(`?user_id=eq.${encodeURIComponent(ids.uid)}&meta->>run_id=eq.${encodeURIComponent(ids.run_id)}&${select}&limit=1`);
  }
  if (ids.taskId) {
    queries.push(`?meta->>task_id=eq.${encodeURIComponent(ids.taskId)}&${select}&limit=1`);
    queries.push(`?meta->>taskId=eq.${encodeURIComponent(ids.taskId)}&${select}&limit=1`);
  }
  for (const query of queries) {
    const res = await fetch(UG_URL + query, { headers: sb() });
    const rows = await res.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || row.result_url) continue;
    const status = String(row.meta?.status || '').toLowerCase();
    if (status === 'processing' || status === 'pending' || !status) return row;
  }
  return null;
}

async function fetchTaskState(taskId) {
  const res = await fetch(`${UNIFICALLY_BASE}/v1/tasks/${encodeURIComponent(taskId)}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${UNIFICALLY_KEY}` },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    const error = failureReason(data) || `unifically_status_${res.status}`;
    if (res.status === 429 || res.status >= 500) return { pending: true, error };
    return { failed: true, error };
  }

  const status = normalizeStatus(data);
  if (status === 'failed') return { failed: true, error: failureReason(data) };
  const urls = collectResultUrls(data);
  if (status === 'done' && urls.length) return { done: true, urls };
  if (urls.length) return { done: true, urls };
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
    headers: { ...sb(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ result_url: urls[0], meta }),
  });
}

async function failAndRefundOnce({ row, ids, reason }) {
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  const amount = Number(meta.refund_amount || meta.charged_cost || meta.debited || 0);
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
    return { refunded: false, amount: 0, reason: 'missing_refund_amount' };
  }

  const claim = `r_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const claimMeta = { ...failedMeta, refund_claim: claim };
  const claimUrl = `${UG_URL}?id=eq.${encodeURIComponent(row.id)}&result_url=is.null&meta->>refunded=is.null&meta->>refund_claim=is.null&select=id`;
  const claimRes = await fetch(claimUrl, {
    method: 'PATCH',
    headers: { ...sb(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ result_url: null, meta: claimMeta }),
  });
  const claimedRows = await claimRes.json().catch(() => []);
  if (!claimRes.ok || !Array.isArray(claimedRows) || !claimedRows.length) {
    return { refunded: false, amount, already_claimed: true };
  }

  const profileRes = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(row.user_id)}&select=credits&limit=1`, { headers: sb() });
  const profiles = await profileRes.json().catch(() => []);
  const currentCredits = Number(Array.isArray(profiles) && profiles[0] ? profiles[0].credits : 0);
  const nextCredits = Math.round((currentCredits + amount) * 100) / 100;
  const updateRes = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(row.user_id)}`, {
    method: 'PATCH',
    headers: { ...sb(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ credits: nextCredits }),
  });

  if (!updateRes.ok) {
    await patchGeneration(row.id, { meta: { ...claimMeta, refund_error: 'profile_refund_failed' } });
    return { refunded: false, amount, error: 'profile_refund_failed' };
  }

  await patchGeneration(row.id, {
    meta: {
      ...claimMeta,
      refunded: true,
      refunded_cost: amount,
      refunded_at: new Date().toISOString(),
    },
  });

  return { refunded: true, amount, credits: nextCredits };
}

async function patchGeneration(id, payload) {
  const res = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...sb(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

function normalizeStatus(value) {
  if (hasFailureSignal(value)) return 'failed';
  if (hasDoneSignal(value)) return 'done';
  return 'pending';
}

const FAILURE_RE = /(fail(?:ed|ure)?|error|errored|invalid|bad request|unauthori[sz]ed|forbidden|permission|payment|required|insufficient|balance|not found|rate limit|too many requests|quota|limit exceeded|timeout|timed out|cancel|canceled|cancelled|reject|rejected|denied|blocked|moderation|policy|safety|unsafe|sensitive|flagged|unavailable|retry later|temporarily unavailable|internal server|server error|service|overload|capacity|busy|maintenance|unsupported|not supported|malformed|missing|required field|forbidden content|content violation)/i;
const FAILURE_STATUS_RE = /^(fail|failed|failure|error|errored|cancel|canceled|cancelled|rejected|denied|blocked|invalid|timeout|timed_out|expired|aborted)$/i;
const FAILURE_KEY_RE = /(error|errors|error_message|errormessage|failure|failed|fail_reason|reason|message|detail|details|description|output|outputs|result|response|status_message|statusmessage|code|statuscode|http_status|httpstatus)/;

function hasFailureSignal(value, depth = 0, keyHint = '') {
  if (value == null || depth > 10) return false;
  const key = String(keyHint || '').toLowerCase();

  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (!text || /^(none|null|undefined|false|ok|success|succeeded|completed|complete|done|no error|no errors)$/i.test(text)) return false;
    if (/^(status|state)$/.test(key)) {
      return FAILURE_STATUS_RE.test(text);
    }
    if (FAILURE_KEY_RE.test(key)) {
      return FAILURE_RE.test(text);
    }
    return FAILURE_RE.test(text);
  }

  if (typeof value === 'number') {
    if (/^(code|status|statuscode|http_status|httpstatus)$/.test(key)) return value >= 400;
    return false;
  }

  if (typeof value === 'boolean') {
    return /^(failed|failure|has_error|haserror|errored)$/.test(key) && value === true;
  }

  if (Array.isArray(value)) {
    if (/(error|errors|failures|messages)/.test(key) && value.length > 0) return true;
    return value.some((item) => hasFailureSignal(item, depth + 1, key));
  }

  if (typeof value === 'object') {
    if (/(error|errors|failure|fail_reason|error_info|errorinfo|task_error|taskerror)/.test(key) && Object.keys(value).length > 0) return true;
    for (const [childKey, child] of Object.entries(value)) {
      if (hasFailureSignal(child, depth + 1, childKey)) return true;
    }
  }

  return false;
}

function hasDoneSignal(value, depth = 0, keyHint = '') {
  if (value == null || depth > 10) return false;
  const key = String(keyHint || '').toLowerCase();

  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (/^(status|state)$/.test(key)) {
      return /^(success|succeeded|completed|complete|finish|finished|done)$/i.test(text);
    }
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasDoneSignal(item, depth + 1, key));
  }

  if (typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) {
      if (hasDoneSignal(child, depth + 1, childKey)) return true;
    }
  }

  return false;
}

function collectStatusText(value, out) {
  if (!value || out.length > 80) return;
  if (typeof value === 'string') {
    if (/fail|error|success|complete|finish|done|pending|process|running|queued|cancel|reject|blocked|moderation|sensitive|flag|unavailable|retry later|temporarily unavailable/i.test(value)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStatusText(item, out);
    return;
  }
  if (typeof value === 'object') {
    for (const key of ['status', 'state', 'message', 'error', 'reason', 'description']) {
      if (value[key] != null) collectStatusText(value[key], out);
    }
    for (const key of ['data', 'result', 'response', 'task', 'job', 'content', 'output', 'outputs']) {
      if (value[key]) collectStatusText(value[key], out);
    }
  }
}

function failureReason(value) {
  return String(findFailureMessage(value) || 'grok_generation_failed');
}

function findFailureMessage(value, depth = 0, keyHint = '') {
  if (value == null || depth > 10) return '';
  const key = String(keyHint || '').toLowerCase();
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return '';
    if (FAILURE_KEY_RE.test(key) || FAILURE_RE.test(text) || FAILURE_STATUS_RE.test(text)) return text;
    return '';
  }
  if (typeof value === 'number') {
    if (/^(code|status|statuscode|http_status|httpstatus)$/.test(key) && value >= 400) return `unifically_status_${value}`;
    return '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFailureMessage(item, depth + 1, key);
      if (found) return found;
    }
    return '';
  }
  if (typeof value === 'object') {
    const preferred = [
      'message', 'error_message', 'errorMessage', 'reason', 'detail', 'details',
      'description', 'output', 'outputs', 'error', 'errors', 'failure', 'fail_reason',
      'status_message', 'statusMessage',
    ];
    for (const childKey of preferred) {
      if (Object.prototype.hasOwnProperty.call(value, childKey)) {
        const found = findFailureMessage(value[childKey], depth + 1, childKey);
        if (found) return found;
      }
    }
    for (const [childKey, child] of Object.entries(value)) {
      const found = findFailureMessage(child, depth + 1, childKey);
      if (found) return found;
    }
  }
  return '';
}

function collectResultUrls(value) {
  const urls = [];
  const seen = new Set();
  const outputKeys = new Set([
    'video_url',
    'videoUrl',
    'result_url',
    'resultUrl',
    'download_url',
    'downloadUrl',
    'media_url',
    'mediaUrl',
    'asset_url',
    'assetUrl',
    'url',
    'content',
    'output',
    'outputs',
    'videos',
    'video_urls',
    'videoUrls',
    'urls',
    'file_url',
    'fileUrl',
  ]);
  const containerKeys = new Set(['data', 'result', 'results', 'response', 'task', 'job', 'content', 'output', 'outputs']);
  const blockedKeys = /(^|_)(input|inputs|reference|references|source|first|last|tail|start|end|frame|frames|request|payload|params|parameters|meta|metadata)(_|$)/i;

  function push(url) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    const clean = url.replace(/[)"'\\\]}]+$/g, '').trim();
    if (!/^https?:\/\/.+/i.test(clean) || seen.has(clean)) return;
    seen.add(clean);
    urls.push(clean);
  }

  function walk(x, depth = 0, trusted = false) {
    if (!x || depth > 8 || urls.length >= 4) return;
    if (typeof x === 'string') {
      if (!trusted) return;
      const parsed = safeJson(x);
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) {
        walk(parsed, depth + 1, true);
        return;
      }
      const matches = x.match(/https?:\/\/[^\s"'<>]+/gi);
      if (matches) matches.forEach(push);
      return;
    }
    if (Array.isArray(x)) {
      for (const item of x) walk(item, depth + 1, trusted || depth === 0);
      return;
    }
    if (typeof x === 'object') {
      for (const [rawKey, child] of Object.entries(x)) {
        const key = String(rawKey || '');
        const nextTrusted = trusted || outputKeys.has(key);
        if (!nextTrusted && !trusted && blockedKeys.test(key)) continue;
        if (nextTrusted || containerKeys.has(key)) walk(child, depth + 1, nextTrusted);
      }
    }
  }

  walk(value);
  return urls.slice(0, 4);
}

function messageOf(error) {
  return error && error.message ? error.message : String(error);
}
