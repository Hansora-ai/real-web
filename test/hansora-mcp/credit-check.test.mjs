import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.URL = 'https://hansora.test';

const { default: hansoraMcp } = await import('../../netlify/functions/hansora-mcp.mjs');

const token = `x.${Buffer.from(JSON.stringify({ client_id: 'chatgpt', scope: 'email' })).toString('base64url')}.y`;

// Drives the real /mcp handler; only Supabase and the generation runner are simulated.
async function callTool(name, args, { credits, generations = [], runner = () => ({ status: 202, body: { ok: true, submitted: true } }) }) {
  const submitted = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (href.endsWith('/auth/v1/user')) return reply(200, { id: 'user-1', email: 'user@example.com' });
    if (href.includes('/rest/v1/profiles')) return reply(200, [{ credits }]);
    if (href.includes('/rest/v1/user_subscriptions')) return reply(200, []);
    if (href.includes('/rest/v1/user_generations')) return reply(200, generations);
    if (href.includes('/.netlify/functions/safe-run')) {
      submitted.push(JSON.parse(options.body));
      const result = runner();
      return reply(result.status, result.body);
    }
    throw new Error(`unexpected fetch ${href}`);
  };
  try {
    const response = await hansoraMcp(new Request('https://hansora.test/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
    }));
    const text = await response.text();
    const json = text.startsWith('{') ? JSON.parse(text) : JSON.parse(text.split('\n').find((line) => line.startsWith('data:')).slice(5));
    return { result: json.result, submitted };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('an over-budget request is refused before anything is submitted, in displayed credits', async () => {
  const { result, submitted } = await callTool('create_generation', {
    model_id: 'grok-video', prompt: 'A cat doctor explainer', duration: 30, resolution: '1080p'
  }, { credits: 3 });
  assert.equal(submitted.length, 0);
  assert.equal(result.isError, true);
  const value = result.structuredContent;
  assert.equal(value.error, 'insufficient_credits');
  assert.equal(value.credits_required, 180);
  assert.equal(value.credits_available, 30);
  assert.equal(value.credits_used, 0);
  assert.ok(value.options_within_balance.length > 0);
  assert.ok(value.options_within_balance.every((option) => option.credits <= 30));
  assert.deepEqual(value.options_within_balance[0], {
    model_id: 'grok-video', model_name: 'Grok Video', settings: { duration: 6, resolution: '720p' }, credits: 18, same_model: true
  });
  assert.match(value.next_step, /Do not call create_generation again on your own/);
  assert.doesNotMatch(JSON.stringify(result), /buy|purchase|top.?up|upgrade|subscribe/i);
});

test('a request the balance covers is submitted as before', async () => {
  const { result, submitted } = await callTool('create_generation', {
    model_id: 'grok-video', prompt: 'A cat doctor explainer', duration: 6, resolution: '720p'
  }, { credits: 3 });
  assert.equal(submitted.length, 1);
  assert.notEqual(result.isError, true);
  assert.equal(result.structuredContent.ok, true);
});

test('a runner refusal for credits gets the same structured answer with the runner price', async () => {
  const { result, submitted } = await callTool('create_generation', {
    model_id: 'grok-video', prompt: 'x', duration: 6, resolution: '720p'
  }, { credits: 3, runner: () => ({ status: 402, body: { ok: false, error: 'not_enough_credits', credits: 3, need: 4 } }) });
  assert.equal(submitted.length, 1);
  assert.equal(result.structuredContent.error, 'insufficient_credits');
  assert.equal(result.structuredContent.credits_required, 40);
  assert.equal(result.structuredContent.credits_available, 30);
});

test('balance and quotes never expose internal billing credits', async () => {
  const account = await callTool('get_account', {}, { credits: 3 });
  assert.equal(account.result.structuredContent.credits, 30);
  assert.equal('internal_credits' in account.result.structuredContent, false);
  assert.ok(account.result.structuredContent.video_options_within_balance.every((option) => option.credits <= 30));

  const price = await callTool('quote_generation', { model_id: 'grok-video', duration: 30, resolution: '1080p' }, { credits: 3 });
  assert.equal(price.result.structuredContent.credits, 180);
  assert.doesNotMatch(JSON.stringify(price.result.structuredContent), /internal/i);
});

test('a generation refused for credits is reported as that, not as a policy failure', async () => {
  const row = {
    id: 'row-1', provider: 'Grok', kind: 'video', prompt: 'cat doctor', result_url: null, created_at: '2026-10-16T08:29:34Z',
    meta: { need: 18, credits: 3, run_id: 'run-1', status: 'failed', error_summary: 'not_enough_credits' }
  };
  const { result } = await callTool('get_generation', { run_id: 'run-1' }, { credits: 3, generations: [row] });
  const value = result.structuredContent;
  assert.equal(value.status, 'failed');
  assert.match(value.message, /^Not enough credits/);
  assert.match(value.message, /needed 180 Hansora credits and the balance was 30/);
  assert.doesNotMatch(value.message, /policy/);

  const other = { ...row, meta: { run_id: 'run-1', status: 'failed', error: 'provider_timeout' } };
  const failed = await callTool('get_generation', { run_id: 'run-1' }, { credits: 3, generations: [other] });
  assert.match(failed.result.structuredContent.message, /policy/);
});
