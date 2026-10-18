import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.URL = 'https://hansora.test';

const { default: hansoraMcp } = await import('../../netlify/functions/hansora-mcp.mjs');

const token = `x.${Buffer.from(JSON.stringify({ client_id: 'chatgpt', scope: 'email' })).toString('base64url')}.y`;

// Drives the real /mcp handler; only Supabase and the generation runner are simulated.
async function callTool(name, args, { credits, generations = [], runner = () => ({ status: 202, body: { ok: true, submitted: true } }), kieCheck = null }) {
  const submitted = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (href.endsWith('/auth/v1/user')) return reply(200, { id: 'user-1', email: 'user@example.com' });
    if (href.includes('/rest/v1/profiles')) return reply(200, [{ credits }]);
    if (href.includes('/rest/v1/user_subscriptions')) return reply(200, []);
    if (href.includes('/rest/v1/user_generations')) return reply(200, generations);
    if (kieCheck && href.includes('/.netlify/functions/kie-check')) return reply(200, kieCheck(new URL(href)));
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
  assert.match(failed.result.structuredContent.message, /is having a temporary issue right now/);
  assert.doesNotMatch(failed.result.structuredContent.message, /policy/);
});

test('a runner that refuses with 200 submitted:false is not reported as queued', async () => {
  const { result } = await callTool('create_generation', {
    model_id: 'veo31-lite', prompt: 'x', resolution: '720p'
  }, { credits: 3, runner: () => ({ status: 200, body: { submitted: false, error: 'insufficient_credits', need: 2, have: 1 } }) });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, 'insufficient_credits');
  assert.equal(result.structuredContent.credits_required, 20);
});

test('get_generation returns every generation ChatGPT started in the same burst', async () => {
  const at = (seconds) => new Date(Date.UTC(2026, 9, 16, 10, 46, 0) + seconds * 1000).toISOString();
  const target = { id: 'b', provider: 'Nano Banana 2', kind: 'image', prompt: 'outdoor', result_url: null, created_at: at(8),
    meta: { run_id: 'u-mcp-2', status: 'processing', model: 'nano-banana-2' } };
  const sibling = { id: 'a', provider: 'Nano Banana 2', kind: 'image', prompt: 'studio', result_url: 'https://cdn.test/a.png', created_at: at(0),
    meta: { run_id: 'u-mcp-1', status: 'done', model: 'nano-banana-2' } };
  const older = { id: 'z', provider: 'Grok', kind: 'video', prompt: 'old', result_url: 'https://cdn.test/z.mp4', created_at: at(-600),
    meta: { run_id: 'u-mcp-0', status: 'done', engine: 'grok' } };
  const { result } = await callTool('get_generation', { run_id: 'u-mcp-2' }, { credits: 3, generations: [target, sibling, older] });
  const value = result.structuredContent;
  assert.equal(value.model_name, 'Nano Banana 2');
  assert.deepEqual(value.batch.map((item) => [item.run_id, item.status]), [['u-mcp-1', 'ready'], ['u-mcp-2', 'processing']]);
  assert.equal(value.batch[0].result_url, 'https://cdn.test/a.png');
  assert.match(value.batch_summary, /^2 generations .* 1 ready, 1 still generating, 0 failed/);
  assert.match(value.batch_summary, /Ready results: #1 https:\/\/cdn\.test\/a\.png\./);
  assert.match(value.batch_summary, /give the user a link to every ready result/);
});

test('a single generation has no batch', async () => {
  const row = { id: 'b', provider: 'Grok', kind: 'video', prompt: 'x', result_url: null, created_at: new Date().toISOString(),
    meta: { run_id: 'u-mcp-9', status: 'processing', engine: 'grok' } };
  const { result } = await callTool('get_generation', { run_id: 'u-mcp-9' }, { credits: 3, generations: [row] });
  assert.equal('batch' in result.structuredContent, false);
  assert.equal(result.structuredContent.model_name, 'Grok Video');
});

test('a provider refusal reaches ChatGPT with its reason, both at submit and on status checks', async () => {
  const { result } = await callTool('create_generation', { model_id: 'kling25', prompt: 'a gymnast', image_urls: ['https://s.test/a.png'] }, {
    credits: 30, runner: () => ({ status: 502, body: { ok: false, error: 'missing_task_id', details: { code: 422, msg: 'Image not allowed' } } })
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /missing_task_id: Image not allowed\. Nothing was generated and no credits were used\./);

  const row = { id: 'r', provider: 'Kling-5s', kind: 'video', prompt: 'x', result_url: null, created_at: new Date().toISOString(),
    meta: { run_id: 'u-mcp-7', status: 'failed', error_summary: 'provider_rejected', provider_message: 'Image not allowed' } };
  const status = await callTool('get_generation', { run_id: 'u-mcp-7' }, { credits: 30, generations: [row] });
  assert.match(status.result.structuredContent.message, /^Kling 2\.5 Turbo can't create this content \(Image not allowed\)\. No credits were used\./);
});

test('a run stuck on processing is checked with KIE, so a failed Veo job stops spinning', async () => {
  const stuck = { id: 'v', provider: 'veo3.1lite', kind: 'video', prompt: 'Rikku on a beach', result_url: null,
    created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    meta: { model: 'veo3_lite', run_id: 'u-mcp-veo-1', status: 'processing', task_id: 'e6c1b8', charged: 'true' } };
  const generations = [stuck];
  const checks = [];
  const { result } = await callTool('get_generation', { run_id: 'u-mcp-veo-1' }, {
    credits: 30, generations,
    kieCheck: (url) => {
      checks.push([url.searchParams.get('uid'), url.searchParams.get('run_id')]);
      generations[0] = { ...stuck, meta: { ...stuck.meta, status: 'failed', failed: true, refunded: true } };
      return { ok: false, failed: true, status: 'failed' };
    }
  });
  assert.deepEqual(checks, [['user-1', 'u-mcp-veo-1']]);
  assert.equal(result.structuredContent.status, 'failed');
});

test('a fresh run is not checked with KIE yet', async () => {
  const fresh = { id: 'f', provider: 'Grok', kind: 'video', prompt: 'x', result_url: null, created_at: new Date().toISOString(),
    meta: { run_id: 'u-mcp-fresh', status: 'processing', task_id: 't1', engine: 'grok' } };
  let checked = false;
  const { result } = await callTool('get_generation', { run_id: 'u-mcp-fresh' }, { credits: 30, generations: [fresh], kieCheck: () => { checked = true; return {}; } });
  assert.equal(checked, false);
  assert.equal(result.structuredContent.status, 'processing');
});

test('ChatGPT gets the video selection guide with the model list and with each video model', async () => {
  const list = await callTool('list_models', { category: 'video' }, { credits: 30 });
  const guide = list.result.structuredContent.video_selection_guide;
  // Language first, then length, then meaning: simple clips never default to Seedance 2.5.
  assert.ok(guide.indexOf('0. Spoken language') < guide.indexOf('1. Length') && guide.indexOf('1. Length') < guide.indexOf('2. Meaning'));
  assert.match(guide, /only Veo 3\.1 Lite \(8 seconds\), Gemini Omni Flash and Gemini Omni \(up to 10 seconds\) can speak it/);
  assert.match(guide, /offer to split the speech into parts of up to 10 seconds/);
  assert.match(guide, /not from how long or detailed your own prompt is/);
  assert.match(guide, /3\. Simple: generate directly, do not ask\.\n   - Up to 8 seconds: Veo 3\.1 Lite, 1080p\.\n   - 9 to 10 seconds: Gemini Omni Flash, 1080p\..*\n   - 11 to 30 seconds: Wan 3\.0, 720p\./);
  assert.match(guide, /4\. Complex: ask the user before generating, at any length/);
  assert.match(guide, /Seedance 2\.5, 720p \(sharper\): recommended/);
  assert.match(guide, /Seedance 2\.5, 480p \(good quality, lower price\)/);
  assert.match(guide, /Seedance 2\.0, 720p: very strong for complex scenes \(up to 15 seconds only\)/);
  assert.match(guide, /pick the first option that fits/);
  assert.match(guide, /person or character to place into new scenes .*Gemini Omni Flash, 1080p, up to 10 seconds; Wan 3\.0, 720p, for longer/);
  assert.match(guide, /8\. Stay with the model\..*Do not switch on your own\..*start only after they agree\./);
  assert.ok(list.result.structuredContent.models.every((model) => !('video_selection_guide' in model)));

  const seedance = await callTool('get_model', { model_id: 'seedance25' }, { credits: 30 });
  assert.equal(seedance.result.structuredContent.video_selection_guide, guide);
  const image = await callTool('get_model', { model_id: 'nano-banana-pro' }, { credits: 30 });
  assert.equal('video_selection_guide' in image.result.structuredContent, false);
});

test('failures are explained by kind: temporary issues offer another model, refusals do not', async () => {
  const row = (meta, provider = 'veo3.1lite', kind = 'video') => ({ id: 'f', provider, kind, prompt: 'garden', result_url: null,
    created_at: new Date().toISOString(), meta: { run_id: 'u-mcp-f', status: 'failed', failed: true, ...meta } });
  const ask = async (generation) => (await callTool('get_generation', { run_id: 'u-mcp-f' }, { credits: 30, generations: [generation] })).result.structuredContent;

  const veo = await ask(row({ model: 'veo3_lite', error: 'Internal Error, Please try again later.', error_code: 500, charged: 'true', refunded: true, refunded_cost: 2 }));
  assert.equal(veo.failure_kind, 'temporary');
  assert.equal(veo.failure_title, 'Veo 3.1 Lite is having a temporary issue');
  assert.equal(veo.card_message, "Veo 3.1 Lite is having a temporary issue right now. It wasn't caused by your prompt or image. Your 20 credits were refunded.");
  assert.deepEqual([veo.alternative.model_id, veo.alternative.credits], ['grok-video', 18]);
  assert.match(veo.message, /Do you want me to try Grok Video instead\? It costs 18 credits\.$/);
  assert.match(veo.next_step, /Start it only after they agree/);

  const policy = await ask(row({ model: 'veo3_lite', error: 'Your prompt was flagged by the content policy', charged: 'true', refunded: true, refunded_cost: 2 }));
  assert.equal(policy.failure_kind, 'content');
  assert.equal('alternative' in policy, false);
  assert.match(policy.next_step, /Do not switch to another model/);

  const file = await ask(row({ engine: 'kling25', error_summary: 'provider_rejected', provider_message: 'image_input file type not supported', refund_skipped_reason: 'not_charged' }, 'Kling-5s'));
  assert.equal(file.failure_kind, 'input');
  assert.match(file.card_message, /No credits were used\. Please send a JPG or PNG under 10 MB\./);

  const image = await ask(row({ model: 'nano-banana-pro', error: 'kie_failed', charged: 'true', refunded: true, refunded_cost: 1.2 }, 'Nano Banana Pro', 'image'));
  assert.equal(image.failure_kind, 'unknown');
  assert.equal(image.failure_title, "Nano Banana Pro couldn't finish this image");
  assert.equal(image.alternative.model_id, 'seedream-4-5');
});
