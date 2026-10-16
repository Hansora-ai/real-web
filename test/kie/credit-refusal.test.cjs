'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

const { handler } = require('../../netlify/functions/safe-run.cjs');

// Runs the real safe-run gateway; Supabase and the generation runner are simulated.
async function run({ runnerStatus, runnerBody, rows }) {
  const patches = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const href = String(url);
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (href.endsWith('/auth/v1/user')) return reply(200, { id: 'user-1' });
    if (href.includes('/.netlify/functions/run-kling-30')) return reply(runnerStatus, runnerBody);
    if (href.includes('/rest/v1/user_generations') && options.method === 'PATCH') {
      patches.push({ url: href, body: JSON.parse(options.body) });
      return new Response(null, { status: 204 });
    }
    if (href.includes('/rest/v1/user_generations')) return reply(200, rows);
    throw new Error(`unexpected fetch ${href}`);
  };
  try {
    const response = await handler({
      httpMethod: 'POST',
      headers: { host: 'hansora.test', 'x-forwarded-proto': 'https', authorization: 'Bearer token', 'x-user-id': 'user-1' },
      body: JSON.stringify({
        target_endpoint: '/.netlify/functions/run-kling-30',
        model_id: 'kling30', kind: 'video', prompt: 'a calm lake', usage_mode: 'credits',
        payload: { prompt: 'a calm lake', run_id: 'run-1', uid: 'user-1' }
      })
    });
    return { response, patches };
  } finally {
    global.fetch = originalFetch;
  }
}

test('a runner credit refusal marks the pending row as not_enough_credits', async () => {
  const { response, patches } = await run({
    runnerStatus: 402,
    runnerBody: { ok: false, error: 'not_enough_credits', credits: 3, need: 5 },
    rows: [{ id: 'row-1', meta: { run_id: 'run-1', status: 'pending', engine: 'kling-3.0' } }]
  });
  assert.equal(response.statusCode, 402);
  assert.equal(patches.length, 1);
  assert.match(patches[0].url, /id=eq\.row-1/);
  assert.equal(patches[0].body.meta.status, 'failed');
  assert.equal(patches[0].body.meta.error_summary, 'not_enough_credits');
  assert.equal(patches[0].body.meta.need, 5);
  assert.equal(patches[0].body.meta.credits, 3);
  assert.equal(patches[0].body.meta.engine, 'kling-3.0');
});

test('rows that already started or are not credit refusals are left alone', async () => {
  const started = await run({
    runnerStatus: 402,
    runnerBody: { ok: false, error: 'not_enough_credits' },
    rows: [{ id: 'row-1', meta: { run_id: 'run-1', status: 'processing', task_id: 'task-9' } }]
  });
  assert.equal(started.patches.length, 0);

  const other = await run({
    runnerStatus: 500,
    runnerBody: { ok: false, error: 'kie_create_failed' },
    rows: [{ id: 'row-1', meta: { run_id: 'run-1', status: 'pending' } }]
  });
  assert.equal(other.patches.length, 0);
});
