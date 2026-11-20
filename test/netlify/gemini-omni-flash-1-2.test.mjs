import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.KIE_API_KEY = 'kie-key';
const runner = require('../../netlify/functions/run-gemini-omni-flash-1-2.js');
const UID = '11111111-1111-1111-1111-111111111111';
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function world({ credits = 10, kie = { code: 200, data: { taskId: 'task_omni12' } } } = {}) {
  const state = { credits, rows: [], kieCalls: [] };
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    const method = options.method || 'GET';
    if (href.endsWith('/auth/v1/user')) return reply(200, { id: UID });
    if (href.includes('api.kie.ai/api/v1/jobs/createTask')) { state.kieCalls.push(JSON.parse(options.body)); return reply(200, kie); }
    if (href.includes('/rest/v1/profiles')) {
      if (method === 'PATCH') { state.credits = JSON.parse(options.body).credits; return reply(200, [{ credits: state.credits }]); }
      return reply(200, [{ credits: state.credits }]);
    }
    if (href.includes('/rest/v1/user_generations')) {
      if (method === 'POST') { const row = { id: `row-${state.rows.length + 1}`, ...JSON.parse(options.body) }; state.rows.push(row); return reply(201, [row]); }
      if (method === 'PATCH') { if (state.rows[0]) state.rows[0].meta = JSON.parse(options.body).meta; return reply(200, []); }
      return reply(200, []);
    }
    throw new Error(`unexpected fetch ${href}`);
  };
  return state;
}
const call = (body) => runner.handler({ httpMethod: 'POST', headers: { 'x-user-id': UID, authorization: 'Bearer token' }, body: JSON.stringify(body) });

test('Gemini Omni 1.2 Flash sends Kie 1.2 inputs and charges the per-second price once', async () => {
  const state = world({ credits: 10 });
  const res = await call({ prompt: 'A cat plays piano in a jazz bar', duration: 10, resolution: '1080p', run_id: 'run-omni12-a', image_urls: ['https://cdn.test/a.png', 'https://cdn.test/b.png'] });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(state.kieCalls.length, 1);
  const sent = state.kieCalls[0];
  assert.equal(sent.model, 'google/gemini-omni-flash-1-2');
  assert.deepEqual(sent.input, { prompt: 'A cat plays piano in a jazz bar', duration: 10, aspect_ratio: 'auto', resolution: '1080p', image_urls: ['https://cdn.test/a.png', 'https://cdn.test/b.png'] });
  assert.equal(Number((10 - state.credits).toFixed(2)), 7.7, '77 displayed credits');
  assert.equal(state.rows[0].provider, 'Gemini Omni 1.2 Flash');
  assert.equal(state.rows[0].meta.engine, 'gemini-omni-flash-1-2');
  assert.equal(state.rows[0].meta.charged_cost, 7.7);
  assert.equal(JSON.parse(res.body).displayed_credits, 77);
});

test('Gemini Omni 1.2 Flash: first and last frame up to 10 s, at most 6 images, no frames with references, not enough credits', async () => {
  const frames = world({ credits: 10 });
  await call({ prompt: 'Morph', duration: 15, resolution: '720p', run_id: 'run-omni12-b', first_frame_url: 'https://cdn.test/1.png', last_frame_url: 'https://cdn.test/2.png' });
  assert.equal(frames.kieCalls[0].input.duration, 10);
  assert.equal(frames.kieCalls[0].input.first_frame_url, 'https://cdn.test/1.png');
  assert.equal(frames.kieCalls[0].input.image_urls, undefined);

  const many = world();
  const tooMany = await call({ prompt: 'x', run_id: 'run-omni12-c', image_urls: Array.from({ length: 7 }, (_, i) => `https://cdn.test/${i}.png`) });
  assert.equal(tooMany.statusCode, 400);
  assert.equal(many.kieCalls.length, 0);

  const mixed = world();
  const mix = await call({ prompt: 'x', run_id: 'run-omni12-d', first_frame_url: 'https://cdn.test/1.png', image_urls: ['https://cdn.test/a.png'] });
  assert.equal(mix.statusCode, 400);
  assert.equal(mixed.kieCalls.length, 0);

  const poor = world({ credits: 1 });
  const res = await call({ prompt: 'x', duration: 15, resolution: '1080p', run_id: 'run-omni12-e' });
  assert.equal(res.statusCode, 402);
  assert.equal(poor.kieCalls.length, 0);
  assert.equal(poor.credits, 1);
});

test('the shared price table: per second, 35% margin, edits by the input length', () => {
  const p = runner._pricing;
  assert.equal(p.quote({ resolution: '720p', duration: 4 }).displayedCredits, 28);
  assert.equal(p.quote({ resolution: '360p', duration: 15 }).displayedCredits, 47);
  assert.equal(p.quote({ resolution: '4k', duration: 6 }).displayedCredits, 102);
  assert.equal(p.quote({ resolution: '720p', inputSeconds: 7.2 }).displayedCredits, 56);
  assert.throws(() => p.quote({ resolution: '720p', inputSeconds: 16 }));
  assert.throws(() => p.quote({ resolution: '720p', duration: 12, firstAndLast: true }));
  for (const [res, d] of [['360p', 3], ['720p', 9], ['1080p', 15], ['4k', 10]]) {
    const q = p.quote({ resolution: res, duration: d });
    assert.ok(1 - q.providerCostUSD / (q.displayedCredits * 0.01) >= 0.35 - 1e-9, `${res} ${d}`);
  }
});
