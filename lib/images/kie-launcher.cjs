// Shared only by the two new image models. Existing launchers stay unchanged.
const crypto = require('node:crypto');
const BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const KIE_KEY = process.env.KIE_API_KEY || '';
const CREATE_URL = process.env.KIE_CREATE_URL || 'https://api.kie.ai/api/v1/jobs/createTask';
const SITE = (process.env.DEPLOY_PRIME_URL || process.env.SITE_BASE || process.env.URL || 'https://hansora.co').replace(/\/+$/, '');
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': '*' };
const json = (statusCode, body) => ({ statusCode, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const failure = (message, status = 400) => Object.assign(new Error(message), { status });

async function db(path, options = {}) {
  const response = await fetch(`${BASE}/rest/v1/${path}`, {
    ...options, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...options.headers }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw failure('Could not save generation data.', response.status === 409 ? 409 : 502);
  return data;
}

// Compare-and-set avoids overwriting another simultaneous generation's debit.
async function changeBalance(uid, amount) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await db(`profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`);
    const current = Number(rows?.[0]?.credits);
    if (!rows?.length || !Number.isFinite(current)) throw failure('Credit balance unavailable.', 503);
    const next = Number((current + amount).toFixed(2));
    if (next < 0) throw failure('not_enough_credits', 402);
    const updated = await db(`profiles?user_id=eq.${encodeURIComponent(uid)}&credits=eq.${current}`, { method: 'PATCH', body: JSON.stringify({ credits: next }) });
    if (updated?.length) return next;
  }
  throw failure('Credit balance changed. Please try again.', 409);
}

function validate(config, body) {
  const prompt = String(body.prompt || '').trim();
  if (!prompt || prompt.length > config.maxPrompt) throw failure(`Enter a prompt of up to ${config.maxPrompt} characters.`);
  const urls = body.urls === undefined ? [] : body.urls;
  if (!Array.isArray(urls) || urls.length > config.maxImages || !urls.every(value => {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
  })) throw failure(`Upload up to ${config.maxImages} valid reference images.`);
  const aliases = { square: '1:1', portrait_3_4: '3:4', portrait_9_16: '9:16', landscape_4_3: '4:3', landscape_16_9: '16:9' };
  const rawAspect = String(body.size || body.aspect_ratio || config.defaultAspect).toLowerCase();
  const aspect = aliases[rawAspect] || rawAspect;
  if (!config.aspects.includes(aspect)) throw failure('Choose a supported aspect ratio.');
  const resolution = String(body.resolution || '1K').toUpperCase();
  if (!Object.hasOwn(config.costs, resolution)) throw failure('Choose a supported resolution.');
  const format = String(body.format || 'png').toLowerCase();
  if (!['png', 'jpg', 'jpeg'].includes(format)) throw failure('Choose PNG or JPEG output.');
  const runId = String(body.run_id || body.runId || crypto.randomUUID());
  if (!runId || runId.length > 160) throw failure('Invalid run identifier.');
  return { prompt, urls, aspect, resolution, format, runId, cost: config.costs[resolution] };
}

function launcher(config) {
  return async event => {
    if (event.httpMethod === 'OPTIONS') return json(200, {});
    if (event.httpMethod !== 'POST') return json(405, { ok: false, submitted: false, error: 'method_not_allowed' });
    let uid, rowId, meta, cost, reserved = false, charged = false, started = false, rejected = false;
    try {
      if (!BASE || !KEY || !KIE_KEY) throw failure('Generation service is not configured.', 503);
      const bearer = event.headers?.authorization || event.headers?.Authorization || '';
      if (!/^Bearer \S+$/i.test(bearer)) throw failure('Sign in first.', 401);
      const auth = await fetch(`${BASE}/auth/v1/user`, { headers: { apikey: KEY, Authorization: bearer } });
      const user = await auth.json().catch(() => null);
      if (!auth.ok || !user?.id) throw failure('Session expired. Sign in again.', 401);
      uid = user.id;
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { throw failure('Invalid request.'); }
      const input = validate(config, body);
      cost = input.cost;
      // Deterministic primary key reserves one provider submission per run.
      const hash = crypto.createHash('sha256').update(`${config.id}:${uid}:${input.runId}`).digest('hex');
      rowId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
      const prior = (await db(`user_generations?id=eq.${rowId}&user_id=eq.${encodeURIComponent(uid)}&select=id,meta`))?.[0];
      if (prior) return json(prior.meta?.task_id ? 200 : 409, {
        ok: !!prior.meta?.task_id, submitted: !!prior.meta?.task_id, already_submitted: true,
        taskId: prior.meta?.task_id, run_id: input.runId, row_id: rowId,
        error: prior.meta?.task_id ? undefined : 'This run is already reserved. Check recent generations.'
      });
      const payload = config.payload(input);
      meta = {
        source: config.id, model: payload.model, model_id: config.id, run_id: input.runId,
        provider_api: 'market', checker: 'kie-check', status: 'pending', charged: false,
        size: input.aspect, resolution: input.resolution, input_urls: input.urls, reference_image_urls: input.urls,
        charge_cost: cost, refund_amount: cost, subscription_unlimited: false
      };
      await db('user_generations', { method: 'POST', body: JSON.stringify({ id: rowId, user_id: uid, provider: config.name, kind: 'image', prompt: input.prompt, result_url: null, meta }) });
      reserved = true;
      const credits = await changeBalance(uid, -cost);
      charged = true;
      meta = { ...meta, charged: true, charged_cost: cost, debited: cost, charged_at: new Date().toISOString() };
      await db(`user_generations?id=eq.${rowId}`, { method: 'PATCH', body: JSON.stringify({ meta }) });
      payload.callBackUrl = `${SITE}/.netlify/functions/kie-check?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(input.runId)}`;
      started = true;
      const response = await fetch(CREATE_URL, { method: 'POST', signal: AbortSignal.timeout(25000), headers: { Authorization: `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => null);
      const taskId = require('../kie/submission.cjs').acceptedTaskId(data);
      if (!response.ok || !taskId) {
        // A completed create response without an ID is a rejection, even on
        // HTTP 200. Network timeouts still use callback reconciliation below.
        rejected = true;
        throw failure('Generation could not be submitted.', 502);
      }
      meta = { ...meta, status: 'processing', task_id: taskId };
      // Preserve a callback that completed while createTask was returning.
      const latest = (await db(`user_generations?id=eq.${rowId}&select=meta,result_url`))?.[0];
      meta = { ...meta, ...(latest?.meta || {}), task_id: taskId };
      if (meta.status === 'pending') meta.status = 'processing';
      await db(`user_generations?id=eq.${rowId}`, { method: 'PATCH', body: JSON.stringify({ meta }) });
      return json(201, { ok: true, submitted: true, taskId, run_id: input.runId, row_id: rowId, cost, model_cost: cost, credits, subscription_unlimited: false });
    } catch (error) {
      // A timeout is ambiguous: keep the reservation for callback reconciliation.
      if (charged && started && !rejected && !meta?.task_id) {
        try {
          const latest = (await db(`user_generations?id=eq.${rowId}&select=meta,result_url`))?.[0];
          if (latest?.meta?.task_id || latest?.result_url) return json(202, { ok: true, submitted: true, taskId: latest.meta?.task_id, run_id: meta.run_id, row_id: rowId });
          await db(`user_generations?id=eq.${rowId}`, { method: 'PATCH', body: JSON.stringify({ meta: { ...meta, ...(latest?.meta || {}), submission_uncertain: true } }) });
        } catch {}
        return json(202, { ok: true, submitted: true, submission_uncertain: true, run_id: meta.run_id, row_id: rowId });
      }
      if (meta?.task_id) return json(202, { ok: true, submitted: true, taskId: meta.task_id, run_id: meta.run_id, row_id: rowId });
      if (reserved) {
        try {
          if (charged) { await changeBalance(uid, cost); meta = { ...meta, refunded: true, refunded_at: new Date().toISOString() }; }
          await db(`user_generations?id=eq.${rowId}`, { method: 'PATCH', body: JSON.stringify({ meta: { ...meta, status: 'failed', error: error.message } }) });
        } catch {}
      }
      return json(error.status || 500, { ok: false, submitted: false, error: error.message });
    }
  };
}
module.exports = { launcher };
