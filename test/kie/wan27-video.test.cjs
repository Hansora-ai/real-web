'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.KIE_API_KEY = 'kie-key';
process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

const runner = require('../../netlify/functions/run-wan-27-video.js');
const img = (name) => `https://supabase.test/storage/v1/object/public/video/${name}.png`;

test('Wan 2.7 Video picks text, image or reference mode from the inputs', () => {
  assert.equal(runner.buildTask({}, 'a sunset', 5, '720p').mode, 't2v');
  const frames = runner.buildTask({ first_frame_url: img('a'), last_frame_url: img('b') }, 'p', 5, '720p');
  assert.equal(frames.mode, 'i2v');
  assert.deepEqual([frames.input.first_frame_url, frames.input.last_frame_url], [img('a'), img('b')]);
  const refs = runner.buildTask({ reference_image_urls: [img('a'), img('b'), img('c')], aspect_ratio: '9:16' }, 'p', 10, '1080p');
  assert.equal(refs.mode, 'r2v');
  assert.deepEqual(refs.input.reference_image, [img('a'), img('b'), img('c')]);
  assert.equal(refs.input.aspect_ratio, '9:16');
  assert.equal(runner.buildTask({ reference_image_urls: [1, 2, 3, 4, 5, 6].map(String).map(img) }, 'p', 5, '720p').error, 'too_many_references');
  assert.equal(runner.costFor(5, '720p'), 7.5);
  assert.equal(runner.costFor(10, '1080p'), 20);
});

async function run({ credits, body }) {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const href = String(url);
    calls.push({ href, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    const reply = (status, value) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    if (href.endsWith('/auth/v1/user')) return reply(200, { id: 'user-1' });
    if (href.includes('/rest/v1/profiles') && options.method === 'PATCH') return new Response(null, { status: 204 });
    if (href.includes('/rest/v1/profiles')) return reply(200, [{ credits }]);
    if (href.includes('/rest/v1/user_generations') && options.method === 'POST') return reply(201, [{ id: 'row-1' }]);
    if (href.includes('/rest/v1/user_generations') && options.method === 'PATCH') return new Response(null, { status: 204 });
    if (href.includes('/rest/v1/user_generations')) return reply(200, []);
    if (href.includes('/jobs/createTask')) return reply(200, { code: 200, data: { taskId: 'task-123' } });
    throw new Error(`unexpected fetch ${href}`);
  };
  try {
    const response = await runner.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t', 'x-user-id': 'user-1' }, body: JSON.stringify(body) });
    return { response, body: JSON.parse(response.body), calls };
  } finally {
    global.fetch = originalFetch;
  }
}

test('a short balance is refused before KIE is called', async () => {
  const { response, body, calls } = await run({ credits: 3, body: { prompt: 'p', duration: 5, resolution: '720p', run_id: 'run-1' } });
  assert.equal(response.statusCode, 402);
  assert.deepEqual([body.error, body.need], ['not_enough_credits', 7.5]);
  assert.equal(calls.some((call) => call.href.includes('createTask')), false);
});

test('a video request goes to the Wan 2.7 video model and is charged once accepted', async () => {
  const { response, body, calls } = await run({ credits: 20, body: { prompt: '@image1 walks', reference_image_urls: [img('a'), img('b')], duration: 5, resolution: '720p', run_id: 'run-2' } });
  assert.equal(response.statusCode, 201);
  const task = calls.find((call) => call.href.includes('createTask')).body;
  assert.equal(task.model, 'wan/2-7-r2v');
  assert.deepEqual(task.input.reference_image, [img('a'), img('b')]);
  const debit = calls.find((call) => call.href.includes('/profiles') && call.method === 'PATCH').body;
  assert.equal(debit.credits, 12.5);
  assert.equal(body.debited, 7.5);
});
