'use strict';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const QUEUE_SECRET = process.env.HANSORA_QUEUE_SECRET || '';
const SITE_BASE = (process.env.SITE_BASE || process.env.URL || 'https://hansora.co').replace(/\/+$/, '');

async function rpc(name, body = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${name}_${response.status}_${await response.text().catch(() => '')}`);
  return response.json().catch(() => null);
}

async function dispatch(job) {
  try {
    const response = await fetch(`${SITE_BASE}/.netlify/functions/process-unlimited-generation-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hansora-Queue-Secret': QUEUE_SECRET },
      body: JSON.stringify({ job_id: job.id }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok && response.status !== 202) throw new Error(`background_dispatch_${response.status}`);
  } catch (error) {
    await rpc('hansora_release_unlimited_generation', { p_job_id: job.id });
    throw error;
  }
}

exports.handler = async function handler() {
  if (!SUPABASE_URL || !SERVICE_KEY || !QUEUE_SECRET) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'missing_queue_environment' }) };
  }
  await rpc('hansora_requeue_stale_unlimited_generations');
  const jobs = [];
  for (let index = 0; index < 12; index += 1) {
    const job = await rpc('hansora_claim_due_unlimited_generation', { p_job_id: null });
    if (!job || !job.id) break;
    jobs.push(job);
  }
  await Promise.all(jobs.map(dispatch));
  return { statusCode: 200, body: JSON.stringify({ ok: true, dispatched: jobs.length }) };
};

exports.config = { schedule: '* * * * *' };
