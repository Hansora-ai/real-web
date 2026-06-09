// netlify/functions/seedance-cheap-check.js
// Poll/refund checker for the text-only BytePlus ModelArk Seedance route.
const ARK_BASE = (process.env.ARK_BASE_URL || 'https://ark.ap-southeast.bytepluses.com').replace(/\/+$/, '');
const ARK_KEY = process.env.seedance_cheap || process.env.SEEDANCE_CHEAP || process.env.ARK_API_KEY || process.env.BYTEPLUS_ARK_API_KEY || '';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const UG_URL = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/user_generations` : '';
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/profiles` : '';
const NB_RESULTS_URL = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/nb_results` : '';
const HISTORY_BUCKET = process.env.SEEDANCE_HISTORY_BUCKET || 'generation-history';
const MAX_ARCHIVE_BYTES = Math.max(1, Number(process.env.SEEDANCE_HISTORY_MAX_MB || 200)) * 1024 * 1024;

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
    if (event.httpMethod === 'POST') return await handlePost(event);
    if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Use GET or POST' });

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

    const state = await fetchArkState(ids.taskId);
    if (state.failed) {
      const refund = await failAndRefundOnce({ row, ids, reason: state.error || 'seedance_failed' });
      return json(200, {
        ok: false,
        failed: true,
        status: 'failed',
        error: state.error || 'seedance_failed',
        refunded: !!refund.refunded,
        refund_amount: refund.amount || 0,
        already_claimed: !!refund.already_claimed,
      });
    }

    if (state.done && state.urls.length) {
      const savedUrls = await markDone({ row, ids, urls: state.urls });
      return json(200, {
        ok: true,
        status: 'done',
        result_url: savedUrls[0],
        video_url: savedUrls[0],
        image_url: savedUrls[0],
        urls: savedUrls,
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
  const bodyIds = extractIds(body);
  const ids = {
    uid: String(qs.uid || bodyIds.uid || '').trim(),
    run_id: String(qs.run_id || bodyIds.run_id || '').trim(),
    taskId: String(qs.taskId || qs.task_id || bodyIds.taskId || '').trim(),
  };

  const row = await findProcessingGeneration(ids);
  if (!row) return json(200, { ok: false, status: 'ignored', reason: 'not_processing' });

  ids.uid = ids.uid || row.user_id || '';
  ids.run_id = ids.run_id || row.meta?.run_id || '';
  ids.taskId = ids.taskId || row.meta?.task_id || row.meta?.taskId || '';

  const status = normalizeStatus(body);
  if (status === 'failed') {
    const refund = await failAndRefundOnce({ row, ids, reason: failureReason(body) });
    return json(200, { ok: false, failed: true, status: 'failed', error: failureReason(body), refunded: !!refund.refunded, refund_amount: refund.amount || 0 });
  }

  const urls = collectResultUrls(body);
  if (status === 'done' && urls.length) {
    const savedUrls = await markDone({ row, ids, urls });
    return json(200, { ok: true, status: 'done', result_url: savedUrls[0], video_url: savedUrls[0], urls: savedUrls });
  }

  return json(200, { ok: false, status: 'pending' });
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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

function extractIds(body) {
  const meta = body?.meta || body?.metadata || body?.data?.meta || body?.data?.metadata || body?.result?.meta || {};
  return {
    uid: String(body?.uid || body?.user_id || body?.data?.uid || meta.uid || '').trim(),
    run_id: String(body?.run_id || body?.data?.run_id || meta.run_id || '').trim(),
    taskId: String(body?.taskId || body?.task_id || body?.data?.id || body?.data?.task_id || body?.data?.taskId || body?.id || meta.task_id || '').trim(),
  };
}

async function findProcessingGeneration(ids) {
  if (!UG_URL || !SERVICE_KEY) return null;
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
    const arr = await res.json().catch(() => []);
    const row = Array.isArray(arr) ? arr[0] : null;
    if (!row || row.result_url) continue;
    const status = String(row.meta?.status || '').toLowerCase();
    if (status === 'processing' || status === 'pending' || !status) return row;
  }
  return null;
}

async function fetchArkState(taskId) {
  if (!ARK_KEY) return { pending: true, error: 'missing_seedance_cheap_key' };

  const res = await fetch(`${ARK_BASE}/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${ARK_KEY}` },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    return { pending: true, error: data?.error?.message || data?.message || `ark_status_${res.status}` };
  }

  const status = normalizeStatus(data);
  if (status === 'failed') return { failed: true, error: failureReason(data) };
  const urls = collectResultUrls(data);
  if (status === 'done' && urls.length) return { done: true, urls };
  if (urls.length) return { done: true, urls };
  return { pending: true };
}

async function markDone({ row, ids, urls }) {
  const archive = await archiveResultUrls({ row, urls });
  const savedUrls = archive.urls.length ? archive.urls : urls;
  const meta = {
    ...(row.meta && typeof row.meta === 'object' ? row.meta : {}),
    run_id: ids.run_id || row.meta?.run_id || '',
    task_id: ids.taskId || row.meta?.task_id || row.meta?.taskId || '',
    status: 'done',
    completed_at: new Date().toISOString(),
    original_result_url: urls[0],
    original_result_urls: urls,
    ...(archive.paths.length ? {
      storage_bucket: HISTORY_BUCKET,
      storage_path: archive.paths[0],
      storage_paths: archive.paths,
      archived_at: new Date().toISOString(),
      archive_errors: archive.errors,
    } : {
      archive_errors: archive.errors.length ? archive.errors : ['archive_failed'],
    }),
  };

  await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}`, {
    method: 'PATCH',
    headers: { ...sb(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ result_url: savedUrls[0], meta }),
  });

  if (NB_RESULTS_URL && savedUrls.length) {
    const rows = savedUrls.slice(0, 4).map((url) => ({
      user_id: ids.uid || row.user_id,
      run_id: ids.run_id || meta.run_id || '',
      task_id: ids.taskId || meta.task_id || '',
      image_url: url,
    }));
    await fetch(NB_RESULTS_URL, {
      method: 'POST',
      headers: { ...sb(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    }).catch(() => {});
  }
  return savedUrls;
}

async function archiveResultUrls({ row, urls }) {
  const archivedUrls = [];
  const paths = [];
  const errors = [];
  for (let index = 0; index < urls.slice(0, 4).length; index += 1) {
    const sourceUrl = urls[index];
    const archive = await archiveResultUrl({ row, sourceUrl, index });
    archivedUrls.push(archive.ok ? archive.publicUrl : sourceUrl);
    if (archive.ok) paths.push(archive.path);
    else errors.push(archive.error || `archive_${index + 1}_failed`);
  }
  return { urls: archivedUrls, paths, errors };
}

async function archiveResultUrl({ row, sourceUrl, index }) {
  if (!SUPABASE_URL || !SERVICE_KEY || !row?.id || !row?.user_id || !sourceUrl) {
    return { ok: false, error: 'missing_archive_config' };
  }
  try {
    const sourceRes = await fetch(sourceUrl);
    if (!sourceRes.ok) return { ok: false, error: `source_download_${sourceRes.status}` };

    const contentLength = Number(sourceRes.headers.get('content-length') || 0);
    if (contentLength > MAX_ARCHIVE_BYTES) return { ok: false, error: 'archive_file_too_large' };

    const bytes = await sourceRes.arrayBuffer();
    if (!bytes.byteLength) return { ok: false, error: 'archive_empty_file' };
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) return { ok: false, error: 'archive_file_too_large' };

    const contentType = normalizeVideoContentType(sourceRes.headers.get('content-type'), sourceUrl);
    const extension = extensionForVideo(contentType, sourceUrl);
    const suffix = index > 0 ? `-${index + 1}` : '';
    const path = `${row.user_id}/${row.id}${suffix}.${extension}`;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const uploadUrl = `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(HISTORY_BUCKET)}/${encodedPath}`;
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        ...sb(),
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: Buffer.from(bytes),
    });
    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => '');
      return { ok: false, error: `archive_upload_${uploadRes.status}${text ? `:${text.slice(0, 180)}` : ''}` };
    }
    return {
      ok: true,
      path,
      publicUrl: `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/${encodeURIComponent(HISTORY_BUCKET)}/${encodedPath}`,
    };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

function normalizeVideoContentType(value, url) {
  const type = String(value || '').split(';')[0].trim().toLowerCase();
  if (type === 'video/mp4' || type === 'video/webm' || type === 'video/quicktime') return type;
  if (/\.webm(?:[?#]|$)/i.test(String(url || ''))) return 'video/webm';
  if (/\.mov(?:[?#]|$)/i.test(String(url || ''))) return 'video/quicktime';
  return 'video/mp4';
}

function extensionForVideo(contentType, url) {
  if (contentType === 'video/webm' || /\.webm(?:[?#]|$)/i.test(String(url || ''))) return 'webm';
  if (contentType === 'video/quicktime' || /\.mov(?:[?#]|$)/i.test(String(url || ''))) return 'mov';
  return 'mp4';
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
    if (/fail|error|success|complete|finish|done|pending|process|running|queued|cancel|reject|blocked|moderation|sensitive|flag/i.test(value)) out.push(value);
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
    for (const key of ['data', 'result', 'response', 'task', 'job', 'content']) {
      if (value[key]) collectStatusText(value[key], out);
    }
  }
}

function failureReason(value) {
  return String(
    value?.error?.message ||
    value?.error ||
    value?.message ||
    value?.data?.error?.message ||
    value?.data?.error ||
    value?.data?.message ||
    value?.data?.reason ||
    value?.result?.error ||
    value?.result?.message ||
    'seedance_failed'
  );
}

function normalizeComparableUrl(url) {
  return String(url || '').replace(/[)"'\\\]}]+$/g, '').trim();
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
    const clean = normalizeComparableUrl(url);
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
