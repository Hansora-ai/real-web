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

  const busy = await run({
    runnerStatus: 409,
    runnerBody: { ok: false, error: 'charge_in_progress' },
    rows: [{ id: 'row-1', meta: { run_id: 'run-1', status: 'pending' } }]
  });
  assert.equal(busy.patches.length, 0);
});

test('a provider rejection is recorded with the provider message instead of timing out later', async () => {
  const { patches } = await run({
    runnerStatus: 502,
    runnerBody: { ok: false, error: 'missing_task_id', details: { code: 422, msg: 'The image contains content that is not allowed.' } },
    rows: [{ id: 'row-1', meta: { run_id: 'run-1', status: 'pending', source: 'kling' } }]
  });
  assert.equal(patches.length, 1);
  assert.equal(patches[0].body.meta.status, 'failed');
  assert.equal(patches[0].body.meta.error_summary, 'provider_rejected');
  assert.equal(patches[0].body.meta.submit_error, 'missing_task_id');
  assert.equal(patches[0].body.meta.provider_message, 'The image contains content that is not allowed.');
  assert.equal(patches[0].body.meta.provider_code, 422);
});

test('a Veo failure callback (code and msg only) counts as failed, polling probes do not', () => {
  const kieCheck = require('../../netlify/functions/kie-check.js');
  const veoFail = { code: 400, msg: 'Your prompt was flagged.', data: { taskId: 't', info: null } };
  assert.equal(kieCheck.callbackStatus(veoFail), 'failed');
  assert.equal(kieCheck.failureReason(veoFail), 'Your prompt was flagged.');
  assert.equal(kieCheck.callbackStatus({ code: 200, msg: 'generated successfully', data: { info: { resultUrls: ['https://x/v.mp4'] } } }), 'pending');
  assert.equal(kieCheck.callbackStatus({ code: 200, data: { state: 'fail', failMsg: 'bad' } }), 'failed');
});

test('the provider error code is kept with the failure', () => {
  const kieCheck = require('../../netlify/functions/kie-check.js');
  assert.equal(kieCheck.failureCode({ code: 500, msg: 'Internal Error' }), 500);
  assert.equal(kieCheck.failureCode({ code: 200, data: { state: 'fail', failCode: '501' } }), 501);
  assert.equal(kieCheck.failureCode({ code: 200, data: { state: 'success' } }), null);
});
