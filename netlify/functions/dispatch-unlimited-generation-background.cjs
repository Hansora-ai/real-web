'use strict';

const crypto = require('node:crypto');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const QUEUE_SECRET = process.env.HANSORA_QUEUE_SECRET || '';
const SITE_BASE = (process.env.SITE_BASE || process.env.URL || 'https://hansora.co').replace(/\/+$/, '');

const ALLOWED_ENDPOINTS = new Set([
  '/.netlify/functions/run-nano-banana-2-lite',
  '/.netlify/functions/run-nano-banana-2',
  '/.netlify/functions/run-gpt-image-2',
  '/.netlify/functions/run-seedream-5-lite',
  '/.netlify/functions/run-grok-image',
  '/.netlify/functions/run-qwen-2',
  '/.netlify/functions/run-z-image',
  '/.netlify/functions/run-wan-2-7-image',
  '/.netlify/functions/run-grok-video',
  '/.netlify/functions/run-veo31',
  '/.netlify/functions/run-kling'
]);

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function serviceFetch(path, options = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
}

async function readRunningJob(jobId) {
  const response = await serviceFetch(`/rest/v1/unlimited_generation_jobs?id=eq.${encodeURIComponent(jobId)}&status=eq.running&select=*&limit=1`);
  if (!response.ok) throw new Error(`queue_job_read_${response.status}`);
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

function findTaskId(value, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return '';
  seen.add(value);
  for (const [key, inner] of Object.entries(value)) {
    if (/^(task[_-]?id|request[_-]?id|job[_-]?id|id)$/i.test(key) && (typeof inner === 'string' || typeof inner === 'number')) {
      const text = String(inner);
      if (text.length > 3) return text;
    }
    const nested = findTaskId(inner, depth + 1, seen);
    if (nested) return nested;
  }
  return '';
}

function providerAccepted(status, payload) {
  if (status < 200 || status >= 300 || !payload || typeof payload !== 'object') return false;
  if (payload.ok === false || payload.success === false || payload.submitted === false) return false;
  if (payload.error || payload.error_message) return false;
  return payload.submitted === true || payload.ok === true || payload.success === true || Boolean(findTaskId(payload));
}

async function finishJob(jobId, triggered, providerStatus, providerPayload, errorMessage) {
  const response = await serviceFetch('/rest/v1/rpc/hansora_finish_unlimited_generation', {
    method: 'POST',
    body: JSON.stringify({
      p_job_id: jobId,
      p_triggered: Boolean(triggered),
      p_provider_status: Number.isFinite(providerStatus) ? providerStatus : null,
      p_provider_response: providerPayload && typeof providerPayload === 'object' ? providerPayload : null,
      p_error_message: String(errorMessage || '').slice(0, 2000)
    })
  });
  if (!response.ok) throw new Error(`queue_finish_${response.status}_${await response.text().catch(() => '')}`);
}

async function beginProviderAttempt(jobId) {
  const response = await serviceFetch('/rest/v1/rpc/hansora_begin_unlimited_provider_attempt', {
    method: 'POST',
    body: JSON.stringify({ p_job_id: jobId })
  });
  if (!response.ok) throw new Error(`queue_begin_${response.status}_${await response.text().catch(() => '')}`);
  return response.json().catch(() => null);
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });
  if (!SUPABASE_URL || !SERVICE_KEY || !QUEUE_SECRET) return json(500, { ok: false, error: 'missing_queue_environment' });
  if (!safeEqual(event.headers?.['x-hansora-queue-secret'], QUEUE_SECRET)) return json(401, { ok: false, error: 'invalid_queue_secret' });

  let request;
  try { request = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'invalid_json' }); }
  const jobId = String(request.job_id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json(400, { ok: false, error: 'invalid_job_id' });

  const job = await readRunningJob(jobId);
  if (!job) return json(200, { ok: true, skipped: true, reason: 'job_not_running' });
  if (!ALLOWED_ENDPOINTS.has(job.target_endpoint)) {
    await finishJob(job.id, false, 400, null, 'Unsupported queued generation endpoint.');
    return json(400, { ok: false, error: 'unsupported_endpoint' });
  }

  const attempt = await beginProviderAttempt(job.id);
  if (!attempt?.id) return json(200, { ok: true, skipped: true, reason: 'provider_attempt_already_started' });

  let providerResponse;
  let providerPayload = null;
  try {
    providerResponse = await fetch(`${SITE_BASE}${job.target_endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-USER-ID': job.user_id,
        'X-Hansora-Queue-Secret': QUEUE_SECRET
      },
      body: JSON.stringify({ ...(job.request_payload || {}), billing_mode: 'unlimited' }),
      signal: AbortSignal.timeout(12 * 60 * 1000)
    });
    const text = await providerResponse.text();
    try { providerPayload = JSON.parse(text); } catch { providerPayload = { raw: text.slice(0, 20000) }; }
    const triggered = providerAccepted(providerResponse.status, providerPayload);
    const errorMessage = triggered ? '' : String(providerPayload?.message || providerPayload?.error || `provider_http_${providerResponse.status}`);
    await finishJob(job.id, triggered, providerResponse.status, providerPayload, errorMessage);
    return json(200, { ok: triggered, job_id: job.id, provider_status: providerResponse.status });
  } catch (error) {
    await finishJob(job.id, false, providerResponse?.status || 503, providerPayload, error && error.message);
    return json(500, { ok: false, job_id: job.id, error: String(error && error.message || error) });
  }
};
