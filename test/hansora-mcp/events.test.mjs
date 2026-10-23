import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

const { eventRow, recordToolEvent } = await import('../../lib/hansora-mcp/events.mjs');

test('an event row keeps the step, model, outcome and price, never the prompt', () => {
  const row = eventRow('user-1', 'create_generation',
    { model_id: 'seedance25', prompt: 'secret prompt', duration: 10, resolution: '720p' },
    { isError: true, structuredContent: { error: 'insufficient_credits', credits_required: 318, credits_available: 30, options_within_balance: [{ model_id: 'grok-video' }], first_generation: true } });
  assert.deepEqual(row, {
    user_id: 'user-1', tool: 'create_generation', model_id: 'seedance25', outcome: 'insufficient_credits',
    credits: 318, balance: 30, run_id: null,
    details: { duration: 10, resolution: '720p', options: ['grok-video'], first_generation: true }
  });
  assert.doesNotMatch(JSON.stringify(row), /secret prompt/);
  const balance = eventRow('user-1', 'get_account', {}, { structuredContent: { credits: 30 } });
  assert.equal(balance.balance, 30);
  assert.equal(balance.credits, null);
  assert.equal(eventRow('user-1', 'create_generation', { model_id: 'veo31-lite' }, { structuredContent: { ok: true, run_id: 'r-mcp-1', credits: 20 } }).outcome, 'ok');
});

test('a blocked request keeps its prompt and who blocked it; a plain-text error keeps its reason', () => {
  const blocked = eventRow('user-1', 'create_generation', { model_id: 'veo31-lite', prompt: 'A dog running like a human' },
    { isError: true, structuredContent: { error: 'content_blocked', category: 'nsfw_sexual_content', blocked_by: 'moderation' } });
  assert.equal(blocked.outcome, 'content_blocked');
  assert.deepEqual(blocked.details, { category: 'nsfw_sexual_content', blocked_by: 'moderation', prompt: 'A dog running like a human' });
  const failed = eventRow('user-1', 'create_generation', { model_id: 'kling25', prompt: 'secret' }, { isError: true, content: [{ type: 'text', text: 'provider_rejected' }] });
  assert.equal(failed.outcome, 'error');
  assert.equal(failed.details.reason, 'provider_rejected');
  assert.doesNotMatch(JSON.stringify(failed), /secret/);
});

test('logging never throws, skips card polling, and turns itself off when the table is missing', async () => {
  const originalFetch = globalThis.fetch;
  const posts = [];
  const waited = [];
  try {
    globalThis.fetch = async () => { throw new Error('network down'); };
    await recordToolEvent('user-1', 'quote_generation', { model_id: 'kling40' }, { structuredContent: { credits: 190 } }, (p) => waited.push(p));
    assert.equal(waited.length, 1);

    globalThis.fetch = async (url, options) => { posts.push({ url: String(url), body: JSON.parse(options.body) }); return new Response(null, { status: 404 }); };
    assert.equal(recordToolEvent('user-1', 'get_generation', { run_id: 'x' }, {}), undefined);
    await recordToolEvent('user-1', 'list_models', { category: 'video' }, { structuredContent: { models: [] } });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, 'https://supabase.test/rest/v1/chatgpt_events');
    assert.equal(posts[0].body.tool, 'list_models');
    // 404: the table was not created yet, so nothing more is sent.
    assert.equal(recordToolEvent('user-1', 'get_account', {}, { structuredContent: { credits: 30 } }), undefined);
    assert.equal(posts.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
