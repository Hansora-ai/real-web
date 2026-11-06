import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.REAPI_API_KEY = 'reapi-key';
const runner = require('../../netlify/functions/run-gpt-image-2-6.js');
const reapi = require('../../lib/reapi/client.cjs');

const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// A small fake of Supabase (profiles, user_generations) and reAPI.
function world({ credits = 10, reapiStatus = 200, reapiBody = { id: 'task_abc', status: 'processing' } } = {}) {
  const state = { credits, rows: [], reapiCalls: [] };
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    const method = options.method || 'GET';
    if (href.startsWith('https://reapi.ai/api/v1/images/generations')) { state.reapiCalls.push(JSON.parse(options.body)); return reply(reapiStatus, reapiBody); }
    if (href.includes('/rest/v1/profiles')) {
      if (method === 'PATCH') { state.credits = JSON.parse(options.body).credits; return reply(200, [{ credits: state.credits }]); }
      return reply(200, [{ credits: state.credits }]);
    }
    if (href.includes('/rest/v1/user_generations')) {
      if (method === 'POST') { const row = { id: `row-${state.rows.length + 1}`, ...JSON.parse(options.body) }; state.rows.push(row); return reply(201, [row]); }
      if (method === 'PATCH') {
        const body = JSON.parse(options.body);
        const row = state.rows[0];
        if (href.includes('charge_claim=is.null')) { if (row.meta.charge_claim || row.meta.charged) return reply(200, []); }
        if (row && body.meta) row.meta = body.meta;
        return reply(200, row ? [row] : []);
      }
      const runMatch = href.match(/meta->>run_id=eq\.([^&]+)/);
      const found = runMatch ? state.rows.filter((row) => row.meta.run_id === decodeURIComponent(runMatch[1])) : [];
      return reply(200, found);
    }
    throw new Error(`unexpected fetch ${href}`);
  };
  return state;
}

const call = (body) => runner.handler({ httpMethod: 'POST', headers: { 'x-user-id': '11111111-1111-1111-1111-111111111111' }, body: JSON.stringify(body) });

test('GPT Image 2.6 starts on reAPI at high quality with the right size, charges 4/5/7 credits once', async () => {
  for (const [resolution, cost, size] of [['1K', 0.4, '1360x768'], ['2K', 0.5, '2720x1536'], ['4K', 0.7, '3840x2160']]) {
    const state = world({ credits: 10 });
    const res = await call({ prompt: 'A neon city', resolution, aspect_ratio: '16:9', run_id: `run-${resolution}`, urls: ['https://cdn.test/me.png'] });
    const out = JSON.parse(res.body);
    assert.equal(res.statusCode, 201, resolution);
    assert.equal(out.taskId, 'task_abc');
    assert.equal(state.reapiCalls.length, 1);
    assert.deepEqual(state.reapiCalls[0], { model: 'gpt-image-2.6-sunburst', prompt: 'A neon city', size, quality: 'high', output_format: 'png', n: 1, image_urls: ['https://cdn.test/me.png'] });
    assert.equal(Number((10 - state.credits).toFixed(2)), cost, resolution);
    const row = state.rows[0];
    assert.equal(row.kind, 'image');
    assert.equal(row.provider, 'GPT Image 2.6');
    assert.equal(row.meta.provider_api, 'reapi-image');
    assert.equal(row.meta.task_id, 'task_abc');
    assert.equal(row.meta.charged, 'true');
    assert.equal(row.meta.refund_amount, cost);
    // The same run again: nothing new starts or is charged.
    const again = await call({ prompt: 'A neon city', resolution, aspect_ratio: '16:9', run_id: `run-${resolution}` });
    assert.equal(JSON.parse(again.body).already_submitted, true);
    assert.equal(state.reapiCalls.length, 1);
  }
});

test('GPT Image 2.6 never starts without the credits, and an empty reAPI balance charges nothing', async () => {
  const poor = world({ credits: 0.3 });
  const res = await call({ prompt: 'A cat', resolution: '1K', run_id: 'run-poor' });
  assert.equal(res.statusCode, 402);
  assert.equal(poor.reapiCalls.length, 0);
  assert.equal(poor.rows.length, 0);

  const empty = world({ credits: 10, reapiStatus: 402, reapiBody: { error: { code: 'insufficient_credits', message: 'Insufficient credits. Required: 23' } } });
  const out = await call({ prompt: 'A cat', resolution: '1K', run_id: 'run-empty' });
  assert.equal(out.statusCode, 503);
  assert.equal(JSON.parse(out.body).error, 'provider_unavailable');
  assert.equal(empty.credits, 10, 'nothing charged');
  assert.equal(empty.rows[0].meta.status, 'failed');
});

test('every 1K/2K/4K size and shape fits reAPI\'s size rules', () => {
  for (const resolution of ['1K', '2K', '4K']) {
    for (const aspect of ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', '9:21', '2:1', '1:2', '3:1', '1:3']) {
      const [w, h] = runner._sizeFor(resolution, aspect).split('x').map(Number);
      assert.ok(w % 16 === 0 && h % 16 === 0 && w <= 3840 && h <= 3840 && w * h >= 655360 && w * h <= 8294400 && Math.max(w / h, h / w) <= 3, `${resolution} ${aspect} ${w}x${h}`);
    }
  }
  // "auto" is never reAPI's default size: the photo's own shape, or a square, at the size paid for.
  assert.equal(runner._sizeFor('4K', 'auto'), '2880x2880');
  assert.equal(runner._sizeFor('1K', 'auto'), '1024x1024');
  assert.equal(runner._sizeFor('4K', 'auto', 4032 / 3024), '3312x2480');
  assert.equal(runner._sizeFor('2K', 'auto', 1080 / 1920), '1536x2720');
  for (const ratio of [0.1, 0.33, 0.75, 1, 1.5, 2.4, 9]) {
    for (const resolution of ['1K', '2K', '4K']) {
      const [w, h] = runner._sizeFor(resolution, 'auto', ratio).split('x').map(Number);
      assert.ok(w % 16 === 0 && h % 16 === 0 && w <= 3840 && h <= 3840 && w * h >= 655360 && w * h <= 8294400 && Math.max(w / h, h / w) <= 3, `${resolution} auto ${ratio} ${w}x${h}`);
    }
  }
});

test('reAPI image task state: done with its image, failed with its reason, otherwise pending', async () => {
  globalThis.fetch = async () => reply(200, { id: 'task_abc', status: 'completed', output: { image_urls: ['https://cdn.reapi.ai/a.png'] } });
  assert.deepEqual((await reapi.imageState('task_abc')).urls, ['https://cdn.reapi.ai/a.png']);
  globalThis.fetch = async () => reply(200, { id: 'task_abc', status: 'failed', error: { code: 'content_blocked', message: 'Blocked by moderation' } });
  assert.deepEqual(await reapi.imageState('task_abc'), { failed: true, error: 'Blocked by moderation', code: 'content_blocked' });
  globalThis.fetch = async () => reply(200, { id: 'task_abc', status: 'processing' });
  assert.equal((await reapi.imageState('task_abc')).pending, true);
  globalThis.fetch = async () => { throw new Error('network'); };
  assert.equal((await reapi.imageState('task_abc')).pending, true);
});
