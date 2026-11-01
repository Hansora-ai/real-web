import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.URL = 'https://hansora.test';
process.env.HANSORA_MODEL_HEALTH = 'on'; // the outage check is off in production unless switched on

const { default: hansoraMcp } = await import('../../netlify/functions/hansora-mcp.mjs');
const { resetHealthCache, unavailableFromRuns } = await import('../../lib/hansora-mcp/health.mjs');

const token = `x.${Buffer.from(JSON.stringify({ client_id: 'chatgpt', scope: 'email' })).toString('base64url')}.y`;

// Drives the real /mcp handler; only Supabase and the generation runner are simulated.
async function callTool(name, args, { credits, generations = [], runner = () => ({ status: 202, body: { ok: true, submitted: true } }), kieCheck = null, rest = null, files = {}, veoChosen = false }) {
  const submitted = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (href.endsWith('/auth/v1/user')) return reply(200, { id: 'user-1', email: 'user@example.com' });
    const custom = rest && href.includes('/rest/v1/') ? await rest(href, options) : undefined;
    if (custom) return custom;
    // A first video already steered to Grok once, so this Veo request is ChatGPT's deliberate exception.
    if (veoChosen && href.includes('/rest/v1/chatgpt_events') && href.includes('outcome=in.')) return reply(200, [{ id: 'steered' }]);
    if (href.includes('/rest/v1/profiles')) return reply(200, [{ credits }]);
    if (href.includes('/rest/v1/user_subscriptions')) return reply(200, []);
    if (href.includes('/rest/v1/user_generations')) return reply(200, generations);
    if (kieCheck && href.includes('/.netlify/functions/kie-check')) return reply(200, kieCheck(new URL(href)));
    if (href.includes('/.netlify/functions/safe-run')) {
      submitted.push(JSON.parse(options.body));
      const result = runner();
      return reply(result.status, result.body);
    }
    if (files[href]) return new Response(files[href], { status: 206 });
    throw new Error(`unexpected fetch ${href}`);
  };
  resetHealthCache();
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

// A user who already received a result: the first-generation shortcut below does not apply.
const returningUser = (href) => (href.includes('result_url=not.is.null')
  ? new Response(JSON.stringify([{ id: 'earlier' }]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  : undefined);

test('an over-budget request is refused before anything is submitted, in displayed credits', async () => {
  const { result, submitted } = await callTool('create_generation', {
    model_id: 'grok-video', prompt: 'A cat doctor explainer', duration: 30, resolution: '1080p'
  }, { credits: 3, rest: returningUser });
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

test('a new user whose free credits do not cover the request gets their first video without a question', async () => {
  const { result, submitted } = await callTool('create_generation', {
    model_id: 'seedance25', prompt: 'A dragon fights a knight on a castle wall', duration: 10, resolution: '720p'
  }, { credits: 3 });
  assert.equal(submitted.length, 0);
  const value = result.structuredContent;
  assert.equal(value.error, 'insufficient_credits');
  assert.equal(value.first_generation, true);
  assert.equal(value.credits_used, 0);
  const first = value.options_within_balance[0];
  assert.ok(first.credits <= 30);
  assert.match(value.next_step, new RegExp(`do not ask the user to choose\\. Call create_generation right now with model_id ${first.model_id}`));
  assert.match(value.next_step, new RegExp(`their first video is being made with ${first.model_name} \\(${first.credits} credits\\)`));
  assert.match(value.next_step, /is the model in use for the user's next videos/);
  assert.doesNotMatch(JSON.stringify(result), /buy|purchase|top.?up|upgrade|subscribe/i);
});

test('the first-video shortcut is used only once: if that option is refused too, the user chooses', async () => {
  const { result } = await callTool('create_generation', {
    model_id: 'grok-video', prompt: 'A cat doctor explainer', duration: 6, resolution: '720p'
  }, { credits: 3, runner: () => ({ status: 402, body: { error: 'insufficient_credits', need: 1.8 } }) });
  const value = result.structuredContent;
  assert.equal(value.error, 'insufficient_credits');
  assert.equal(value.first_generation, undefined);
  assert.match(value.next_step, /Do not call create_generation again on your own/);
});

test('each tool call is logged for the funnel, without slowing or changing the answer', async () => {
  const logged = [];
  const { result } = await callTool('quote_generation', { model_id: 'kling40', duration: 10, resolution: '720p' }, {
    credits: 3,
    rest: (href) => { if (href.includes('/rest/v1/chatgpt_events')) { logged.push(href); return new Response(null, { status: 201 }); } return undefined; }
  });
  assert.equal(result.structuredContent.credits, 190);
  assert.equal(logged.length, 1);
});

test('when no video fits a returning user\'s credits, an image of the same idea is offered once', async () => {
  const { result, submitted } = await callTool('create_generation', {
    model_id: 'seedance25', prompt: 'A dragon over a castle', duration: 10, resolution: '720p'
  }, { credits: 1.2, rest: returningUser });
  assert.equal(submitted.length, 0);
  const value = result.structuredContent;
  assert.deepEqual(value.options_within_balance, []);
  assert.ok(value.image_instead && value.image_instead.credits <= 12);
  assert.match(value.next_step, new RegExp(`offer once, in one short line, to make an image of the same idea with ${value.image_instead.model_name} for ${value.image_instead.credits} credits`));
  assert.match(value.next_step, /Do not call create_generation again for this request\./);
  assert.doesNotMatch(JSON.stringify(result), /buy|purchase|top.?up|upgrade|subscribe/i);
});

test('a started generation tells ChatGPT the card follows it, and a ready one hands over the exact link', async () => {
  const started = await callTool('create_generation', { model_id: 'grok-video', prompt: 'A cat', duration: 6, resolution: '720p' }, { credits: 3 });
  assert.match(started.result.structuredContent.next_step, /do not call get_generation on your own/);
  const url = 'https://supabase.test/storage/v1/object/public/generation-history/user-1/gen-1.mp4';
  const ready = await callTool('get_generation', { run_id: 'user-1-mcp-1-ready' }, {
    credits: 3,
    generations: [{ id: 'gen-1', provider: 'Grok', kind: 'video', prompt: 'A cat', result_url: url, created_at: new Date().toISOString(), meta: { run_id: 'user-1-mcp-1-ready', status: 'done' } }]
  });
  const value = ready.result.structuredContent;
  assert.equal(value.link_for_user, url);
  assert.ok(value.next_step.includes(`copied character for character: ${url} `));
  assert.match(value.next_step, /Never build, shorten or change a link yourself/);
});

test('a new user\'s 10-second request still starts on Grok; ChatGPT uses Veo 3.1 Lite only if the user asked for the length', async () => {
  const { result } = await callTool('create_generation', {
    model_id: 'seedance25', prompt: 'A knight fights a dragon', duration: 10, resolution: '720p'
  }, { credits: 3 });
  const value = result.structuredContent;
  assert.deepEqual(value.options_within_balance.map((option) => option.model_id).slice(0, 2), ['grok-video', 'veo31-lite']);
  assert.deepEqual(value.options_within_balance[1].settings, { duration: 8, resolution: '720p' });
  assert.equal(value.options_within_balance[1].credits, 20);
  assert.match(value.next_step, /Call create_generation right now with model_id grok-video and duration 6, resolution 720p/);
  assert.match(value.next_step, /If the user themselves asked for 7 or 8 seconds, use duration 8 instead \(24 credits\)/);
  assert.match(value.next_step, /use model_id veo31-lite with duration 8, resolution 720p \(20 credits\) instead only if people in the video must speak a language other than English \(Chinese included\)/);
});

test('if the first video is refused by its model, the next model in line is started without a question', async () => {
  const { result } = await callTool('create_generation', {
    model_id: 'veo31-lite', prompt: 'A girl waving', duration: 8, resolution: '1080p'
  }, { credits: 3, veoChosen: true, runner: () => ({ status: 400, body: { ok: false, error: 'provider_rejected' } }) });
  const value = result.structuredContent;
  assert.equal(value.error, 'first_video_refused');
  assert.equal(value.credits_used, 0);
  // Grok comes before Veo, so the next model in line after Veo is Wan 3.0.
  assert.equal(value.next_option.model_id, 'wan-3');
  assert.match(value.next_step, /This is the user's first video, so do not stop or ask: call create_generation right now with model_id wan-3/);

  // The chain always ends: after the last model there is no further suggestion.
  const last = await callTool('create_generation', {
    model_id: 'kling25', prompt: 'A girl waving', duration: 5, resolution: '1080p'
  }, { credits: 3, runner: () => ({ status: 400, body: { ok: false, error: 'provider_rejected' } }) });
  assert.notEqual(last.result.structuredContent?.error, 'first_video_refused');

  // A returning user gets the usual explanation, not an automatic switch.
  const returning = await callTool('create_generation', {
    model_id: 'veo31-lite', prompt: 'A girl waving', duration: 8, resolution: '1080p'
  }, { credits: 3, rest: returningUser, runner: () => ({ status: 400, body: { ok: false, error: 'provider_rejected' } }) });
  assert.notEqual(returning.result.structuredContent?.error, 'first_video_refused');
});

test('a video price the balance does not cover is marked so ChatGPT does not show it', async () => {
  const pricey = (await callTool('quote_generation', { model_id: 'seedance25', duration: 10, resolution: '720p' }, { credits: 3 })).result.structuredContent;
  assert.equal(pricey.credits, 380);
  assert.equal(pricey.fits_balance, false);
  assert.equal(pricey.credits_available, 30);
  assert.match(pricey.next_step, /do not show it to them/);
  const fits = (await callTool('quote_generation', { model_id: 'veo31-lite', duration: 8, resolution: '1080p' }, { credits: 3 })).result.structuredContent;
  assert.equal(fits.fits_balance, undefined);
  assert.equal(fits.next_step, undefined);
});

test('a video animated from a tall photo is made tall, even when ChatGPT sent 16:9', async () => {
  const pngOf = (width, height) => {
    const png = Buffer.alloc(33);
    png.writeUInt32BE(0x89504e47, 0); png.write('IHDR', 12, 'latin1'); png.writeUInt32BE(width, 16); png.writeUInt32BE(height, 20);
    return png;
  };
  const files = { 'https://cdn.test/portrait.png': pngOf(1080, 1920), 'https://cdn.test/wide.png': pngOf(1920, 1080), 'https://cdn.test/square.png': pngOf(1000, 1000) };
  const run = async (photo, args = {}, modelId = 'veo31-lite') => (await callTool('create_generation', {
    model_id: modelId, prompt: 'She smiles', duration: modelId === 'grok-video' ? 6 : 8, resolution: '720p', image_urls: [`https://cdn.test/${photo}.png`], ...args
  }, { credits: 3, files, veoChosen: true })).submitted[0].payload;
  assert.equal((await run('portrait')).aspectRatio, '9:16');
  // ChatGPT often fills in 16:9 by itself; cropping a tall photo that way cuts off heads.
  assert.equal((await run('portrait', { aspect_ratio: '16:9' })).aspectRatio, '9:16');
  assert.equal((await run('portrait', { aspect_ratio: '16:9' }, 'grok-video')).aspect_ratio, '9:16');
  assert.equal((await run('wide', { aspect_ratio: '9:16' })).aspectRatio, '16:9');
  // A square photo has no clear shape, and any other shape is kept as asked.
  assert.equal((await run('square', { aspect_ratio: '16:9' })).aspectRatio, '16:9');
  assert.equal((await run('portrait', { aspect_ratio: '1:1' }, 'grok-video')).aspect_ratio, '1:1');
});

test('a new user\'s first video starts on Grok; Veo 3.1 Lite 720p only when the user asked for longer or another language', async () => {
  const { firstVideoOrder, insufficientCreditsResult } = await import('../../lib/hansora-mcp/credits.mjs');
  const { getModel } = await import('../../lib/hansora-mcp/registry.mjs');
  assert.equal(firstVideoOrder({ duration: 6 })[0], 'grok-video');
  assert.equal(firstVideoOrder({})[0], 'grok-video');
  // ChatGPT often picks 10 seconds itself, so the duration does not move the first video to Veo.
  assert.equal(firstVideoOrder({ duration: 10 })[0], 'grok-video');

  const seedance = getModel('seedance25');
  const short = insufficientCreditsResult({ model: seedance, price: { displayedCredits: 380 }, balanceInternal: 3, input: { duration: 5 }, firstGeneration: true }).structuredContent;
  assert.deepEqual(short.options_within_balance[0], { model_id: 'grok-video', model_name: 'Grok Video', settings: { duration: 6, resolution: '720p' }, credits: 18, same_model: false });
  assert.match(short.next_step, /Call create_generation right now with model_id grok-video and duration 6, resolution 720p/);
  assert.match(short.next_step, /Exception: use model_id veo31-lite with duration 8, resolution 720p \(20 credits\) instead only if people in the video must speak a language other than English \(Chinese included\)\. A language you picked yourself does not count\. In that case name Veo 3\.1 Lite and its credits in your line\./);
  assert.match(short.next_step, /If the user themselves asked for 7 or 8 seconds, use duration 8 instead \(24 credits\); a length you picked yourself does not count\./);
  assert.doesNotMatch(short.next_step, /longer than 6 seconds/);
  const long = insufficientCreditsResult({ model: seedance, price: { displayedCredits: 380 }, balanceInternal: 3, input: { duration: 10 }, firstGeneration: true }).structuredContent;
  assert.equal(long.options_within_balance[0].model_id, 'grok-video');
  assert.match(long.next_step, /Call create_generation right now with model_id grok-video and duration 6, resolution 720p/);
  assert.match(long.next_step, /use model_id veo31-lite with duration 8, resolution 720p \(20 credits\) instead only if people in the video must speak a language other than English \(Chinese included\)/);
  // A returning user's choices are not reordered for the first video.
  const returning = insufficientCreditsResult({ model: seedance, price: { displayedCredits: 380 }, balanceInternal: 3, input: { duration: 5 } }).structuredContent;
  assert.equal(returning.options_within_balance[0].model_id, 'veo31-lite');
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
  }, { credits: 3, veoChosen: true, runner: () => ({ status: 200, body: { submitted: false, error: 'insufficient_credits', need: 2, have: 1 } }) });
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
  assert.match(status.result.structuredContent.message, /^Kling 2\.5 Turbo's safety filter blocked this\. No credits were used\. You can try again, change the image or prompt, or try Veo 3\.1 Lite/);
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
  assert.match(guide, /3\. Simple: generate directly, do not ask\. If the user already has a video in this conversation, step 8 comes first: keep that model\.\n   - A new user's first video \(no video yet\): Grok Video, 720p, 6 seconds, or 8 seconds if the user asked for 7 or 8 seconds\. Use Veo 3\.1 Lite \(8 seconds, 720p\) only if people in the video must speak a language other than English \(Chinese included\)\./);
  assert.match(guide, /7\. The user's photo with big changes .*Grok Video and Veo 3\.1 Lite use a photo only as the first frame, so with them \(always for a new user's first video\) first make the changed picture with Nano Banana 2\.1 \(1K, 3 credits\).*Start the video as soon as the picture is ready \(get_generation\), without asking.*Models that take reference images \(Seedance 2\.5, Kling 4\.0, Wan 3\.0, Gemini Omni Flash, Gemini Omni\) get the photo as the character reference instead, with no picture step\./);
  assert.match(guide, /If you are not sure, treat it as complex/);
  // One short question with plain choices, so users who know no model names can pick. The model of
  // the user's last video comes first, so "ok" keeps the price they already know.
  assert.match(guide, /4\. Complex: first call get_account to see the balance and last_video \(before quoting or showing any price\)\. Then ask one short question before generating, at any length, with these options/);
  assert.match(guide, /If the balance covers none of the options, do not ask and do not show their prices/);
  assert.match(guide, /   - Same quality as your last video: .*it always comes first and is the default\.\n   - Our best, cinema quality: Seedance 2\.5, 720p\n   - High quality, lower price: Kling 4\.0, 720p\n   - Good quality, budget: Wan 3\.0, 720p\n/);
  assert.match(guide, /list it only once, first, as "Same quality as your last video"\. If the last model cannot do this request .*leave it out and say why in one short line\. Without a last video, add \(recommended\) to Seedance 2\.5\./);
  assert.match(guide, /1080p \(sharpest, only when the user asks for 1080p or the best possible quality; never pick it on your own\)/);
  assert.match(guide, /Wan 3\.0 15 seconds, Seedance 2\.0 15 seconds, Seedance 2\.5 30 seconds/);
  assert.match(guide, /Gemini Omni uses only the first 10 seconds of a video/);
  assert.match(guide, /answers vaguely \("ok", "go", "yes"\), start the first option that fits without asking again \(the last video's model when it is listed\)/);
  assert.match(guide, /12\. Quality: never ask about resolution\. If the user did not say a quality, use the one named above \(Seedance 2\.5: 720p\)/);
  assert.match(guide, /Video edits .*: use Henshin Lite directly, without asking which version, at 720p unless the user asks for 1080p \(it costs 220 credits per 10 seconds of their video at 720p, 340 at 1080p\)/);
  assert.match(guide, /After a Henshin Lite result, only if the user is not satisfied, offer to redo it with Henshin, the stronger version \(per 10 seconds of video: 480p 175, 720p 380, 1080p 900 credits\)/);
  assert.match(guide, /For every other model, use the default quality without asking\./);
  assert.match(guide, /13\. Sexual or NSFW requests: Hansora does not create them with any model\. Do not submit them\./);
  assert.match(guide, /11\. Reference videos: .*a short clip of just the part that matters usually gives a better and more affordable result\. Keep it a tip only: do not explain how video length affects the price/);
  assert.match(guide, /person or character to place into new scenes .*Gemini Omni Flash, 1080p, up to 10 seconds; Wan 3\.0, 720p, for longer/);
  assert.match(guide, /8\. Stay with the model\. .*also when Hansora started their first video on a model their free credits cover\. Keep using it and its resolution for the next simple videos without asking; for complex videos ask step 4 with it listed first\. Never move to a model that costs more on your own.*start only after they agree\./);
  assert.ok(list.result.structuredContent.models.every((model) => !('video_selection_guide' in model)));

  const seedance = await callTool('get_model', { model_id: 'seedance25' }, { credits: 30 });
  assert.equal(seedance.result.structuredContent.video_selection_guide, guide);
  const image = await callTool('get_model', { model_id: 'nano-banana-pro' }, { credits: 30 });
  assert.equal('video_selection_guide' in image.result.structuredContent, false);
});

test('failures are explained by kind: temporary issues switch to another model, refusals do not', async () => {
  const row = (meta, provider = 'veo3.1lite', kind = 'video') => ({ id: 'f', provider, kind, prompt: 'garden', result_url: null,
    created_at: new Date().toISOString(), meta: { run_id: 'u-mcp-f', status: 'failed', failed: true, ...meta } });
  const ask = async (generation) => (await callTool('get_generation', { run_id: 'u-mcp-f' }, { credits: 30, generations: [generation] })).result.structuredContent;

  const veo = await ask(row({ model: 'veo3_lite', error: 'Internal Error, Please try again later.', error_code: 500, charged: 'true', refunded: true, refunded_cost: 2 }));
  assert.equal(veo.failure_kind, 'temporary');
  assert.equal(veo.failure_title, 'Veo 3.1 Lite is having a temporary issue');
  assert.equal(veo.card_message, "Veo 3.1 Lite is having a temporary issue right now. It wasn't caused by your prompt or image. Your 20 credits were refunded.");
  assert.deepEqual([veo.alternative.model_id, veo.alternative.credits], ['grok-video', 18]);
  // The backup costs no more than the failed run, so ChatGPT switches once without asking.
  assert.equal(veo.auto_switch, true);
  assert.match(veo.message, /Trying Grok Video instead \(18 credits\)\.$/);
  assert.match(veo.next_step, /^Start Grok Video \(18 credits\) now with the same prompt and inputs, without asking the user\./);
  assert.match(veo.next_step, /Switch only once: if the backup also fails, stop and ask the user\./);

  // A pricier backup still needs the user's yes.
  const omni = await ask(row({ model_id: 'gemini-omni-flash-1-1', error: 'Internal Error', charged: 'true', refunded: true, refunded_cost: 0.4 }, 'Gemini Omni 1.1 Flash'));
  assert.equal(omni.alternative.model_id, 'veo31-lite');
  assert.equal(omni.auto_switch, false);
  assert.match(omni.next_step, /Start it only after they agree/);

  // Kling's "playground task" errors are a provider problem: switch to Veo 3.1 Lite.
  const kling = await ask(row({ engine: 'kling25', error: 'playground task error', charged: 'true', refunded: true, refunded_cost: 3 }, 'Kling-5s'));
  assert.equal(kling.failure_kind, 'temporary');
  assert.equal(kling.alternative.model_id, 'veo31-lite');
  assert.equal(kling.auto_switch, true);

  // Too much reference audio is an input problem: fix the input, never switch models.
  const audio = await ask(row({ engine: 'wan-3', error: { msg: 'reference_audio_urls total duration must be less than or equal to 15 seconds', code: 422 } }, 'Wan 3.0'));
  assert.equal(audio.failure_kind, 'input');
  assert.equal(audio.failure_title, "Wan 3.0 can't use these inputs");
  assert.equal('alternative' in audio, false);
  assert.match(audio.next_step, /shorten the audio/);

  // reAPI rows: Seedance 2.0 is recognised, and reference video limits are input problems.
  const video = await ask(row({ source: 'reapi', engine: 'seedance-2.0', error: { msg: 'reference_video_urls duration must be between 1 and 15 seconds', code: 422 } }, 'Seedance 2.0'));
  assert.equal(video.failure_kind, 'input');
  assert.equal(video.failure_title, "Seedance 2.0 can't use these inputs");
  const invalid = await ask(row({ source: 'reapi', engine: 'wan-3', error: 'Invalid Wan 3.0 video duration.' }, 'Wan 3.0'));
  assert.equal(invalid.failure_kind, 'input');

  // A strict filter (not sexual content, minors, real people or violence): the user picks one of three choices.
  const policy = await ask(row({ model: 'veo3_lite', error: 'Request blocked: The input content was flagged by safety filters for involving restricted third-party content.', charged: 'true', refunded: true, refunded_cost: 2 }));
  assert.equal(policy.failure_kind, 'content');
  assert.equal(policy.failure_title, "Veo 3.1 Lite's safety filter blocked this");
  assert.equal(policy.alternative.model_id, 'grok-video');
  assert.match(policy.message, /^Veo 3\.1 Lite's safety filter blocked this\. Your 20 credits were refunded\. You can try again, change the image or prompt, or try Grok Video \(18 credits\), which is less strict\.$/);
  assert.match(policy.next_step, /ask one question with these choices: try again with Veo 3\.1 Lite, change the image or prompt, or try Grok Video \(18 credits\), which is less strict\. If people in the video must speak a language other than English, add that Grok Video speaks it with some mistakes\. Start nothing until they choose\./);
  for (const error of ['Request blocked: The input content was flagged for containing a prominent public figure.', 'Sexual content detected', 'Content involving a minor is not allowed']) {
    const hard = await ask(row({ model: 'veo3_lite', error, charged: 'true', refunded: true, refunded_cost: 2 }));
    assert.equal(hard.failure_kind, 'content', error);
    assert.equal('alternative' in hard, false, error);
    assert.match(hard.next_step, /do not switch to another model to get around the refusal/, error);
  }

  const file = await ask(row({ engine: 'kling25', error_summary: 'provider_rejected', provider_message: 'image_input file type not supported', refund_skipped_reason: 'not_charged' }, 'Kling-5s'));
  assert.equal(file.failure_kind, 'input');
  assert.match(file.card_message, /No credits were used\. Please send a JPG or PNG under 10 MB\./);

  const image = await ask(row({ model: 'nano-banana-pro', error: 'kie_failed', charged: 'true', refunded: true, refunded_cost: 1.2 }, 'Nano Banana Pro', 'image'));
  assert.equal(image.failure_kind, 'unknown');
  assert.equal(image.failure_title, "Nano Banana Pro couldn't finish this image");
  assert.equal(image.alternative.model_id, 'seedream-4-5');
});

test('a model failing for everyone is set aside, then comes back on its own', async () => {
  const now = Date.parse('2026-10-19T20:30:00Z');
  const run = (minutesAgo, meta, result_url = null) => ({ provider: 'veo3.1lite', created_at: new Date(now - minutesAgo * 60000).toISOString(), result_url, meta: { model: 'veo3_lite', ...meta } });
  const failed = (minutesAgo) => run(minutesAgo, { status: 'failed', error: 'Internal Error, Please try again later.', error_code: 500 });
  assert.deepEqual([...unavailableFromRuns([failed(1), failed(2), failed(3)], now)], ['veo31-lite']);
  assert.equal(unavailableFromRuns([failed(1), failed(2)], now).size, 0); // two errors are not enough
  assert.equal(unavailableFromRuns([run(0.5, { status: 'done' }, 'https://x/v.mp4'), failed(1), failed(2), failed(3)], now).size, 0); // a success lifts it
  assert.equal(unavailableFromRuns([failed(11), failed(12), failed(13)], now).size, 0); // retried 10 minutes after the last error
  const refused = (minutesAgo) => run(minutesAgo, { status: 'failed', error: 'flagged by content policy' });
  assert.equal(unavailableFromRuns([refused(1), refused(2), refused(3)], now).size, 0); // refusals say nothing about the model

  const recent = [1, 2, 3].map((minutes) => ({ ...failed(0), created_at: new Date(Date.now() - minutes * 60000).toISOString() }));
  const model = await callTool('get_model', { model_id: 'veo31-lite' }, { credits: 30, generations: recent });
  assert.equal(model.result.structuredContent.current_status, 'temporarily_unavailable');
  assert.match(model.result.structuredContent.status_note, /Use Grok Video \(grok-video\) instead/);

  const { result, submitted } = await callTool('create_generation', { model_id: 'veo31-lite', prompt: 'office', resolution: '1080p' }, { credits: 30, generations: recent });
  assert.equal(submitted.length, 0);
  assert.equal(result.structuredContent.error, 'model_temporarily_unavailable');
  assert.equal(result.structuredContent.credits_used, 0);
  assert.equal(result.structuredContent.alternative.model_id, 'grok-video');
  assert.equal(result.structuredContent.auto_switch, true);
  assert.match(result.structuredContent.next_step, /no credits were used/);
});

test('a temporary error at submit time switches to the backup instead of a bare error', async () => {
  const { result } = await callTool('create_generation', { model_id: 'kling25', prompt: 'car', duration: 5 }, {
    credits: 30, runner: () => ({ status: 502, body: { ok: false, error: 'kie_create_failed', details: { code: 500, msg: 'playground task failed' } } })
  });
  assert.equal(result.structuredContent.error, 'model_temporarily_unavailable');
  assert.equal(result.structuredContent.alternative.model_id, 'veo31-lite');
  assert.match(result.structuredContent.message, /playground task failed/);
});

test('a Grok prompt over 5000 characters is sent back to be shortened before anything is charged', async () => {
  const { result, submitted } = await callTool('create_generation', { model_id: 'grok-video', prompt: 'x'.repeat(5439), duration: 10 }, { credits: 30 });
  assert.equal(submitted.length, 0);
  assert.equal(result.structuredContent.error, 'prompt_too_long');
  assert.equal(result.structuredContent.max_prompt_characters, 5000);
  assert.match(result.structuredContent.next_step, /Shorten it to under 5000 characters/);
  const model = await callTool('get_model', { model_id: 'grok-video' }, { credits: 30 });
  assert.equal(model.result.structuredContent.input.max_prompt_chars, 5000);
});

test('Wan MCP source quote reaches the runner and a measured mismatch is shown without retrying',async()=>{
 const args={model_id:'wan-3',prompt:'A cat playing',duration:10,resolution:'720p',video_urls:['https://s.test/v.mp4'],source_video_duration:5};
 const quoted=await callTool('quote_generation',{model_id:'wan-3',duration:10,resolution:'720p',has_video_input:true,source_video_duration:5},{credits:100});
 assert.equal(quoted.result.structuredContent.credits,150);
 const {result,submitted}=await callTool('create_generation',args,{credits:100,runner:()=>({status:409,body:{input_seconds:5.1,displayed_credits:151}})});
 assert.equal(submitted.length,1);assert.equal(submitted[0].payload.expected_credits,150);assert.equal(result.structuredContent.credits_used,0);assert.equal(result.structuredContent.credits_required,151);assert.equal(result.structuredContent.source_video_duration,5.1);assert.match(result.structuredContent.next_step,/only after they accept/);
});

test('a Seedance reference video longer than ChatGPT guessed is never charged at a price the user did not see', async () => {
  const video = 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/video/ref.mp4';
  const request = { model_id: 'seedance25', prompt: 'the girl from the video dances', duration: 10, resolution: '720p', video_urls: [video] };
  const first = await callTool('create_generation', request, {
    credits: 100, runner: () => ({ status: 409, body: { ok: false, error: 'The verified media duration changed the price.', displayed_credits: 665, input_seconds: 25 } })
  });
  assert.equal(first.submitted[0].payload.expected_credits, 380); // the price ChatGPT quoted (video assumed 10 s)
  const value = first.result.structuredContent;
  assert.equal(value.error, 'quote_changed');
  assert.equal(value.credits_used, 0);
  assert.equal(value.credits_required, 665);
  assert.match(value.next_step, /With this reference video the price is 665 credits, not the 380 you quoted\./);
  assert.match(value.next_step, /also counts the video's length; it works the same way on every platform that offers this model\. The price is 665 credits\. Should I start it, or would you like to send a shorter clip\?/);
  assert.match(value.next_step, /ask the user once about all the held ones together \(each price and the total\), not once per video/);
  assert.match(value.next_step, /source_video_duration: 25\.$/);

  const retry = await callTool('create_generation', { ...request, source_video_duration: 25 }, { credits: 100 });
  assert.equal(retry.submitted[0].payload.expected_credits, 665);
  assert.equal(retry.result.structuredContent.credits, 665);
});

test('a Seedance video job that turns out cheaper than quoted starts right away at the real price', async () => {
  let calls = 0;
  const { result, submitted } = await callTool('create_generation', {
    model_id: 'seedance25', prompt: 'the girl from the clip waves', duration: 10, resolution: '720p',
    video_urls: ['https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/video/short.mp4']
  }, {
    credits: 100,
    runner: () => (++calls === 1
      ? { status: 409, body: { ok: false, displayed_credits: 323, input_seconds: 4.8 } }
      : { status: 201, body: { ok: true, submitted: true } })
  });
  assert.deepEqual(submitted.map((call) => call.payload.expected_credits), [380, 323]);
  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent.credits, 323);
  assert.match(result.structuredContent.credits_note, /final price is 323 credits, lower than the 380 quoted/);
});

test('Henshin never asks about price: it starts and reports what the uploaded video really cost', async () => {
  const { result, submitted } = await callTool('create_generation', {
    model_id: 'henshin', prompt: 'put the woman from the photo into the video', duration: 10, resolution: '720p',
    source_video_url: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/video/dance.mp4',
    image_urls: ['https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/video/woman.png']
  }, { credits: 100, runner: () => ({ status: 201, body: { ok: true, submitted: true, debited: 41.8 } }) });
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].payload.expected_credits, undefined); // no price check, so no extra question
  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent.credits, 418);
  assert.match(result.structuredContent.credits_note, /final price is 418 credits, based on the length of the uploaded video/);
});

test('a sexual request is refused once, with no model switching, and ChatGPT offers a clean version', async () => {
  const { result, submitted } = await callTool('create_generation', { model_id: 'grok-video', prompt: 'she will suck me off', duration: 6 }, {
    credits: 30, runner: () => ({ status: 422, body: { ok: false, code: 'CONTENT_POLICY_BLOCKED', category: 'nsfw_sexual_content', message: 'blocked' } })
  });
  assert.equal(submitted.length, 1);
  const value = result.structuredContent;
  assert.equal(value.error, 'content_blocked');
  assert.equal(value.credits_used, 0);
  assert.equal('alternative' in value, false);
  assert.match(value.message, /does not create sexual or NSFW content with any model, so trying another model will not help/);
  assert.match(value.next_step, /Offer to make a non-sexual version of their idea/);
  assert.match(value.next_step, /Do not submit this request or a reworded sexual version to any model\./);
});

test('the model health check makes no database query unless switched on', async () => {
  const { unavailableModels } = await import('../../lib/hansora-mcp/health.mjs');
  const originalFetch = globalThis.fetch;
  let queried = false;
  globalThis.fetch = async () => { queried = true; throw new Error('should not query'); };
  delete process.env.HANSORA_MODEL_HEALTH;
  try {
    resetHealthCache();
    assert.equal((await unavailableModels()).size, 0);
    assert.equal(queried, false);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HANSORA_MODEL_HEALTH = 'on';
  }
});

test('a Supabase outage never logs users out: sign-in checks that cannot run answer 503, not 401', async () => {
  const originalFetch = globalThis.fetch;
  const call = async (authReply) => {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/auth/v1/user')) return authReply();
      throw new Error(`unexpected fetch ${url}`);
    };
    try {
      return await hansoraMcp(new Request('https://hansora.test/mcp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
      }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  };
  const down = await call(() => { throw new Error('connect timeout'); });
  assert.equal(down.status, 503);
  assert.equal(down.headers.get('www-authenticate'), null); // ChatGPT keeps the login
  assert.equal((await call(() => new Response('upstream', { status: 504 }))).status, 503);
  const invalid = await call(() => new Response(JSON.stringify({ msg: 'invalid JWT' }), { status: 401 }));
  assert.equal(invalid.status, 401); // a really invalid token still asks the user to sign in
  assert.match(invalid.headers.get('www-authenticate'), /resource_metadata=/);
});

test('a database hiccup is retried once, so the user never notices', async () => {
  let calls = 0;
  const { result } = await callTool('get_account', {}, {
    credits: 30,
    rest: (href) => (href.includes('/rest/v1/profiles') && ++calls === 1 ? new Response('busy', { status: 503 }) : undefined)
  });
  assert.equal(calls, 2);
  assert.equal(result.structuredContent.credits, 300);
});

test('when the database stays down, the user gets a calm message instead of a raw error', async () => {
  const down = () => new Response('timeout', { status: 504 });
  const account = (await callTool('get_account', {}, { credits: 30, rest: down })).result;
  assert.equal(account.isError, true);
  assert.equal(account.structuredContent.error, 'temporarily_unavailable');
  assert.match(account.structuredContent.next_step, /Wait a few seconds and call the same tool once more/);
  const check = (await callTool('get_generation', { run_id: 'user-1-mcp-1792338247134-03250856' }, { credits: 30, rest: down })).result;
  assert.equal(check.structuredContent.message, 'Hansora could not check this right now. Your generation keeps running.');
});

test('a slow submission answers in time with the run id instead of letting ChatGPT show server error', async () => {
  const { result } = await callTool('create_generation', { model_id: 'grok-video', prompt: 'waves at sunset', duration: 6 }, {
    credits: 30, runner: () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }
  });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.status, 'queued');
  assert.match(result.structuredContent.run_id, /^user-1-mcp-\d{13}-/);
  assert.match(result.structuredContent.next_step, /Do not start it again/);
});

test('a run that has only just started is shown as starting, not as missing', async () => {
  const fresh = `user-1-mcp-${Date.now()}-abcd1234`;
  const starting = (await callTool('get_generation', { run_id: fresh }, { credits: 30, generations: [] })).result;
  assert.equal(starting.structuredContent.status, 'processing');
  const old = (await callTool('get_generation', { run_id: 'user-1-mcp-1700000000000-abcd1234' }, { credits: 30, generations: [] })).result;
  assert.equal(old.isError, true);
  assert.match(old.content[0].text, /generation_not_found/);
});

test('Henshin Lite is offered for video edits and starts at the measured price without asking again', async () => {
  const list = await callTool('list_models', { category: 'video' }, { credits: 100 });
  const lite = list.result.structuredContent.models.find((model) => model.id === 'henshin-lite');
  assert.equal(lite.name, 'Henshin Lite');
  assert.deepEqual(lite.input.resolutions, ['720p', '1080p']);
  assert.match(lite.recommendation, /Default for video edits: use it directly/);

  // After a Lite result ChatGPT may offer the stronger Henshin, but only if the user is unhappy.
  const ready = { id: 'g', provider: 'Hansora Henshin Lite', kind: 'video', prompt: 'edit', result_url: 'https://qmaealblegvcwodlmeht.supabase.co/r.mp4', created_at: new Date().toISOString(), meta: { run_id: 'user-1-mcp-1-x', status: 'done', henshin_model: 'lite', source_feature: 'henshin' } };
  const shown = await callTool('get_generation', { run_id: 'user-1-mcp-1-x' }, { credits: 100, generations: [ready] });
  assert.match(shown.result.structuredContent.next_step, /Only if they are not satisfied, offer to redo it with Henshin, the stronger version/);

  let calls = 0;
  const { result, submitted } = await callTool('create_generation', {
    model_id: 'henshin-lite', prompt: 'put the woman from the photo into the video', duration: 10, resolution: '1080p',
    source_video_url: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/video/dance.mp4',
    image_urls: ['https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/video/woman.png']
  }, {
    credits: 100,
    runner: () => (++calls === 1
      ? { status: 409, body: { ok: false, input_seconds: 12.3, displayed_credits: 442 } }
      : { status: 201, body: { ok: true, submitted: true, debited: 44.2 } })
  });
  assert.equal(submitted[0].target_endpoint, '/.netlify/functions/run-henshin');
  assert.equal(submitted[0].payload.henshin_model, 'lite');
  assert.deepEqual(submitted.map((call) => call.payload.expected_credits), [340, 442]); // higher, but no question for edits
  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent.credits, 442);
  assert.match(result.structuredContent.credits_note, /based on the length of the uploaded video/);
});

test('Kling 4.0 is offered right after Seedance 2.5 and always sends the quoted price its launcher requires', async () => {
  const model = (await callTool('get_model', { model_id: 'kling-4.0' }, { credits: 100 })).result.structuredContent;
  assert.equal(model.id, 'kling40');
  assert.match(model.pricing, /^190 \/ 284 Hansora credits per 10 seconds/);
  const { result, submitted } = await callTool('create_generation', {
    model_id: 'kling40', prompt: 'the samurai from @image1 fights in the rain', duration: 10, aspect_ratio: '9:16',
    image_urls: ['https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/video/samurai.png']
  }, { credits: 100, runner: () => ({ status: 201, body: { ok: true, submitted: true, debited: 19 } }) });
  assert.equal(submitted[0].target_endpoint, '/.netlify/functions/run-kling-40');
  assert.equal(submitted[0].payload.expected_credits, 190); // required even without video input
  assert.equal(submitted[0].payload.prompt, 'the samurai from @image_1 fights in the rain');
  assert.equal(result.structuredContent.credits, 190);
});

test('the balance names the model of the user\'s last video, so ChatGPT can offer it first', async () => {
  const grok = { id: 'g1', provider: 'Grok', kind: 'video', created_at: '2026-10-25T10:00:00Z', meta: { model: 'grok-imagine/text-to-video' } };
  const account = (await callTool('get_account', {}, { credits: 200, generations: [grok] })).result.structuredContent;
  assert.deepEqual(account.last_video, { model_id: 'grok-video', model_name: 'Grok Video' });
  assert.match(account.last_video_note, /offer it first as "Same quality as your last video"/);

  // Every video model is found from what its runner saves, not only Grok.
  const saved = [
    [{ provider: 'veo3.1lite', meta: { model: 'veo3_lite' } }, 'veo31-lite'],
    [{ provider: 'Wan 3.0', meta: { model: 'wan/3-0-video', engine: 'wan-3' } }, 'wan-3'],
    [{ provider: 'Kling-5s', meta: { model: 'kling/v2-5-turbo-image-to-video-pro' } }, 'kling25'],
    [{ provider: 'Seedance 2.5', meta: { model: 'bytedance/seedance-2-5', engine: 'seedance-2.5' } }, 'seedance25'],
    [{ provider: 'Gemini Omni 1.1 Flash', meta: { model: 'gemini-omni-flash-1-1', engine: 'gemini-omni-flash-1-1' } }, 'gemini-omni-flash-1-1'],
    [{ provider: 'Kling 3 Turbo', meta: { model: 'kling/v3-turbo-text-to-video', engine: 'kling-v3-turbo' } }, 'kling3-turbo']
  ];
  for (const [row, modelId] of saved) {
    const value = (await callTool('get_account', {}, { credits: 200, generations: [{ id: 'v', kind: 'video', ...row }] })).result.structuredContent;
    assert.equal(value.last_video?.model_id, modelId, row.provider);
  }

  // Video edits are a different job (Henshin Lite runs on Kling 4.0), and Motion Control needs a source
  // video, so none of them is offered for a new video.
  const notOffered = [
    { provider: 'Hansora Henshin Lite', meta: { model: 'kling-4.0/reference-to-video', engine: 'kling4' } },
    { provider: 'Hansora Henshin', meta: { model: 'bytedance/seedance-2-5', engine: 'henshin' } },
    { provider: 'Video Edit', meta: { model: 'gemini-omni-video', engine: 'video-edit-gemini-omni' } },
    { provider: 'kling-motion-control', meta: { model: 'kling-motion-control' } },
    { provider: 'Hansora Captions', meta: {} }
  ];
  for (const row of notOffered) {
    const value = (await callTool('get_account', {}, { credits: 200, generations: [{ id: 'e', kind: 'video', ...row }] })).result.structuredContent;
    assert.equal('last_video' in value, false, row.provider);
  }

  // No video yet, or the lookup fails: the balance is still answered, without last_video.
  const none = (await callTool('get_account', {}, { credits: 200 })).result.structuredContent;
  assert.equal('last_video' in none, false);
  const down = (href) => (href.includes('/rest/v1/user_generations') ? new Response('busy', { status: 503 }) : undefined);
  const failed = (await callTool('get_account', {}, { credits: 200, rest: down })).result.structuredContent;
  assert.equal(failed.credits, 2000);
  assert.equal('last_video' in failed, false);
});

test('Henshin before its video is chosen gets the rate per 10 seconds instead of a price error', async () => {
  // The upload card opens before the user picks a video, so there is no length to price yet.
  const card = (await callTool('start_video_generation', { model_id: 'henshin-lite', prompt: 'Put me in the video', resolution: '720p' }, { credits: 100 })).result;
  assert.equal(card.isError, undefined);
  const value = card.structuredContent;
  assert.equal(value.mode, 'video_upload');
  assert.equal(value.price_by_video_length, true);
  assert.equal(value.credits_per_10_seconds, 220);
  assert.equal(value.min_video_seconds, 4);
  assert.equal(value.max_video_seconds, 30);
  assert.equal(value.quote, null);

  const rate = (await callTool('quote_generation', { model_id: 'henshin-lite', resolution: '720p' }, { credits: 100 })).result;
  assert.equal(rate.isError, undefined);
  assert.equal(rate.structuredContent.credits_per_10_seconds, 220);
  assert.match(rate.structuredContent.next_step, /priced by the length of the user's video: 220 credits per 10 seconds at 720p/);

  // With the length (the card reads it from the chosen file) the exact price comes back as before.
  const exact = (await callTool('quote_generation', { model_id: 'henshin-lite', duration: 19, resolution: '720p' }, { credits: 100 })).result.structuredContent;
  assert.equal(exact.credits, 418);
  const henshin = (await callTool('start_video_generation', { model_id: 'henshin', prompt: 'Restyle it', resolution: '720p' }, { credits: 100 })).result.structuredContent;
  assert.equal(henshin.price_by_video_length, true);
  // Models with a fixed price are unchanged.
  const seedance = (await callTool('start_video_generation', { model_id: 'seedance25', prompt: 'Follow this motion', duration: 10, resolution: '720p' }, { credits: 100 })).result.structuredContent;
  assert.equal(seedance.price_by_video_length, undefined);
  assert.ok(seedance.quote.credits > 0);
});

test('an iPhone (HEIC) photo attached in ChatGPT is read too, and the video is made tall', async () => {
  const box = (type, payload) => { const head = Buffer.alloc(8); head.writeUInt32BE(8 + payload.length, 0); head.write(type, 4, 'latin1'); return Buffer.concat([head, payload]); };
  const ispe = (width, height) => { const body = Buffer.alloc(12); body.writeUInt32BE(width, 4); body.writeUInt32BE(height, 8); return box('ispe', body); };
  const heic = (boxes) => Buffer.concat([box('ftyp', Buffer.from('heic\0\0\0\0mif1heic', 'latin1')), ...boxes]);
  const { imageSize } = await import('../../lib/hansora-mcp/image-shape.mjs');
  // A thumbnail and tiles are smaller than the main picture; irot 90 degrees turns a stored-wide photo upright.
  assert.deepEqual(imageSize(heic([ispe(320, 240), ispe(1080, 1920), ispe(512, 512)])), { width: 1080, height: 1920 });
  assert.deepEqual(imageSize(heic([ispe(4032, 3024), box('irot', Buffer.from([1]))])), { width: 3024, height: 4032 });

  const photo = 'https://files.oaiusercontent.test/file-heic';
  const { result, submitted } = await callTool('create_generation', {
    model_id: 'veo31-lite', prompt: 'The cub swims', duration: 8, resolution: '1080p', aspect_ratio: '16:9',
    image_files: [{ download_url: photo, file_id: 'file-heic', mime_type: 'image/heic' }]
  }, { credits: 3, veoChosen: true, files: { [photo]: heic([ispe(4032, 3024), box('irot', Buffer.from([1]))]) } });
  assert.equal(submitted[0].payload.aspectRatio, '9:16');
  assert.equal(result.structuredContent.aspect_ratio, '9:16');
  assert.equal(result.structuredContent.photo_shape, '9:16');
  const { eventRow } = await import('../../lib/hansora-mcp/events.mjs');
  assert.deepEqual(
    [eventRow('u', 'create_generation', {}, result).details.aspect_ratio, eventRow('u', 'create_generation', {}, result).details.photo_shape],
    ['9:16', '9:16']
  );
});


test('a new user\'s first video that fails on the provider\'s side is started once on another model, under the same card', async () => {
  const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const old = 'user-1-mcp-1793055600192-552a0520';
  const photo = 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/video/images/user-uploads/poster.png';

  // 1. Starting a first video keeps its recipe.
  const saved = [];
  const started = await callTool('create_generation', { model_id: 'veo31-lite', prompt: 'The poster comes alive', duration: 8, resolution: '720p', image_urls: [photo] }, {
    credits: 3, veoChosen: true,
    rest: (href, options) => {
      if (href.includes('/rest/v1/chatgpt_events') && options?.method === 'POST') { saved.push(JSON.parse(options.body)); return reply({}); }
      return undefined;
    }
  });
  assert.equal(started.result.structuredContent.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const recipe = saved.find((row) => row.tool === 'first_video_recipe');
  assert.ok(recipe, 'recipe saved');
  assert.equal(recipe.model_id, 'veo31-lite');
  assert.equal(recipe.details.prompt, 'The poster comes alive');
  assert.deepEqual(recipe.details.image_urls, [photo]);

  // 2. The video then fails with a provider outage: the next check starts it once on Grok.
  const failedRow = { id: 'g-old', kind: 'video', provider: 'veo3.1lite', created_at: '2026-10-26T23:00:03Z', result_url: null,
    meta: { run_id: old, model: 'veo3_lite', status: 'failed', error: 'Internal Error, Please try again later.', charged_cost: 2, refund_amount: 2 } };
  const world = ({ retryRow = null, firstUser = true, failure = failedRow } = {}) => (href) => {
    if (href.includes('/rest/v1/chatgpt_events') && href.includes('first_video_recipe')) return reply([{ model_id: 'veo31-lite', details: recipe.details }]);
    if (href.includes('result_url=not.is.null')) return reply(firstUser ? [] : [{ id: 'earlier' }]);
    if (href.includes('/rest/v1/user_generations') && href.includes(encodeURIComponent(`${old}-retry`))) return reply(retryRow ? [retryRow] : []);
    if (href.includes('/rest/v1/user_generations') && href.includes(`eq.${encodeURIComponent(old)}`)) return reply([failure]);
    if (href.includes('/rest/v1/user_generations')) return reply([]);
    return undefined;
  };
  const first = await callTool('get_generation', { run_id: old }, { credits: 3, rest: world() });
  assert.equal(first.submitted.length, 1);
  assert.equal(first.submitted[0].model_id, 'grok-video');
  assert.equal(first.submitted[0].payload.run_id, `${old}-retry`);
  assert.equal(first.submitted[0].payload.prompt, 'The poster comes alive');
  assert.deepEqual(first.submitted[0].payload.image_urls, [photo]);
  const shown = first.result.structuredContent;
  assert.equal(shown.run_id, old, 'the card keeps following the same run');
  assert.equal(shown.status, 'processing');
  assert.equal(shown.retry_run_id, `${old}-retry`);
  assert.equal(shown.message, "Veo 3.1 Lite had a temporary issue on the provider's side, so this video was made with Grok Video instead. The Veo 3.1 Lite try was refunded.");
  assert.equal(shown.switch_note, shown.message);

  // 3. Later checks follow the new run and never start another one.
  const retryRow = { id: 'g-new', kind: 'video', provider: 'Grok', created_at: '2026-10-26T23:02:00Z',
    result_url: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/generation-history/user-1/new.mp4',
    meta: { run_id: `${old}-retry`, engine: 'grok', status: 'done' } };
  const later = await callTool('get_generation', { run_id: old }, { credits: 3, rest: world({ retryRow, firstUser: false }) });
  assert.equal(later.submitted.length, 0);
  assert.equal(later.result.structuredContent.run_id, old);
  assert.equal(later.result.structuredContent.status, 'ready');
  assert.equal(later.result.structuredContent.result_url, retryRow.result_url);

  // 4. No retry for a returning user on another model than Veo, for a content refusal, or for a retry that
  // failed itself.
  const klingFailed = { ...failedRow, provider: 'Kling-5s', meta: { ...failedRow.meta, model: 'kling/v2-5-turbo-image-to-video-pro' } };
  const returning = await callTool('get_generation', { run_id: old }, { credits: 3, rest: (href) => (href.includes('first_video_recipe') ? reply([{ model_id: 'kling25', details: recipe.details }]) : world({ firstUser: false, failure: klingFailed })(href)) });
  assert.equal(returning.submitted.length, 0);
  assert.equal(returning.result.structuredContent.status, 'failed');
  const blocked = { ...failedRow, meta: { ...failedRow.meta, error: 'Request blocked: The input content was flagged for containing a prominent public figure.' } };
  const content = await callTool('get_generation', { run_id: old }, { credits: 3, rest: world({ failure: blocked }) });
  assert.equal(content.submitted.length, 0);
  assert.equal(content.result.structuredContent.failure_kind, 'content');
  const retryFailed = { ...failedRow, meta: { ...failedRow.meta, run_id: `${old}-retry` } };
  // Grok failing on the provider's side: remade with Veo 3.1 Lite 720p at Veo's own price (20 credits), as the owner decided.
  const grokFailed = { ...failedRow, provider: 'Grok', meta: { ...failedRow.meta, model: 'grok-imagine/image-to-video', engine: 'grok', charged_cost: 1.8, refund_amount: 1.8 } };
  const toVeo = await callTool('get_generation', { run_id: old }, { credits: 3, rest: (href) => (href.includes('first_video_recipe') ? reply([{ model_id: 'grok-video', details: recipe.details }]) : world({ failure: grokFailed })(href)) });
  assert.equal(toVeo.submitted.length, 1);
  assert.equal(toVeo.submitted[0].model_id, 'veo31-lite');
  assert.match(JSON.stringify(toVeo.submitted[0]), /720p/);
  assert.match(toVeo.result.structuredContent.switch_note, /^Grok Video had a temporary issue on the provider's side, so this video was made with Veo 3\.1 Lite instead\./);
  assert.match(toVeo.result.structuredContent.next_step, /This switch was only for this video: for the user's next videos the model in use stays Grok Video\./);
  const twice = await callTool('get_generation', { run_id: `${old}-retry` }, { credits: 3, rest: (href) => (href.includes('/rest/v1/user_generations') && !href.includes('not.is.null') ? reply([retryFailed]) : world()(href)) });
  assert.equal(twice.submitted.length, 0);
});

test('an over-long Seedance prompt comes back to ChatGPT to shorten, before anything starts', async () => {
  for (const modelId of ['seedance20-mini', 'seedance20', 'seedance25']) {
    const { result, submitted } = await callTool('create_generation', { model_id: modelId, prompt: 'x'.repeat(23556), duration: 10, resolution: '720p' }, { credits: 1000 });
    assert.equal(submitted.length, 0, modelId);
    assert.equal(result.structuredContent.error, 'prompt_too_long', modelId);
    assert.equal(result.structuredContent.max_prompt_characters, 20000, modelId);
    assert.match(result.structuredContent.next_step, /Shorten it to under 20000 characters/);
  }
});

test('Nano Banana 2.1 is in ChatGPT as the top image model, at the website\'s prices and on its runner', async () => {
  const list = (await callTool('list_models', { category: 'image' }, { credits: 30 })).result.structuredContent.models;
  assert.equal(list[0].id, 'nano-banana-2-1');
  assert.equal(list[0].name, 'Nano Banana 2.1');
  assert.match(list[0].recommendation, /^Default image model/);
  for (const [resolution, credits] of [['1K', 3], ['2K', 5], ['4K', 7]]) {
    const price = (await callTool('quote_generation', { model_id: 'nano-banana-2-1', resolution }, { credits: 30 })).result.structuredContent;
    assert.equal(price.credits, credits, resolution);
  }
  assert.equal((await callTool('get_model', { model_id: 'nano-banana-2.1' }, { credits: 30 })).result.structuredContent.id, 'nano-banana-2-1');
  const photo = 'https://cdn.test/cat.png';
  const { result, submitted } = await callTool('create_generation', { model_id: 'nano-banana-2-1', prompt: 'The cat as a knight', aspect_ratio: '9:16', resolution: '2K', image_urls: [photo] }, { credits: 30 });
  assert.equal(result.structuredContent.ok, true);
  assert.equal(submitted[0].target_endpoint, '/.netlify/functions/run-nano-banana-2-1');
  assert.deepEqual([submitted[0].payload.urls, submitted[0].payload.size, submitted[0].payload.resolution], [[photo], '9:16', '2K']);
});

test('a Veo video Google could not make the sound for is made with Grok instead, for any user, once', async () => {
  const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const old = 'user-1-mcp-1793126174728-d2f6ce69';
  const prompt = 'A silent listener reaction close-up. No speech or vocal sounds, no music.';

  // A returning user's Veo and Grok videos keep their recipe.
  const saved = [];
  const keep = (href, options) => {
    if (href.includes('/rest/v1/chatgpt_events') && options?.method === 'POST') { saved.push(JSON.parse(options.body)); return reply({}); }
    return returningUser(href);
  };
  await callTool('create_generation', { model_id: 'veo31-lite', prompt, duration: 8, resolution: '720p' }, { credits: 100, rest: keep });
  await callTool('create_generation', { model_id: 'grok-video', prompt, duration: 6, resolution: '720p' }, { credits: 100, rest: keep });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const recipes = saved.filter((row) => /recipe/.test(row.tool));
  assert.deepEqual(recipes.map((row) => [row.tool, row.model_id]), [['video_recipe', 'veo31-lite'], ['video_recipe', 'grok-video']]);

  const failed = (error) => ({ id: 'g-old', kind: 'video', provider: 'veo3.1lite', created_at: '2026-10-27T18:36:16Z', result_url: null,
    meta: { run_id: old, model: 'veo3_lite', status: 'failed', error, charged_cost: 2, refund_amount: 2, refunded: true } });
  const world = (failure) => (href) => {
    if (href.includes('/rest/v1/chatgpt_events') && href.includes('recipe')) return reply([{ model_id: 'veo31-lite', details: recipes[0].details }]);
    if (href.includes('result_url=not.is.null')) return reply([{ id: 'earlier' }]); // a returning, paying user
    if (href.includes('/rest/v1/user_generations') && href.includes(encodeURIComponent(`${old}-retry`))) return reply([]);
    if (href.includes('/rest/v1/user_generations') && href.includes(`eq.${encodeURIComponent(old)}`)) return reply([failure]);
    if (href.includes('/rest/v1/user_generations')) return reply([]);
    return undefined;
  };
  const audio = await callTool('get_generation', { run_id: old }, { credits: 100, rest: world(failed('The Google model was unable to generate audio for this request. Please try a different prompt.')) });
  assert.equal(audio.submitted.length, 1);
  assert.equal(audio.submitted[0].model_id, 'grok-video');
  assert.equal(audio.submitted[0].payload.run_id, `${old}-retry`);
  assert.equal(audio.submitted[0].payload.prompt, prompt);
  assert.equal(audio.result.structuredContent.run_id, old);
  assert.equal(audio.result.structuredContent.status, 'processing');
  assert.equal(audio.result.structuredContent.message, 'Veo 3.1 Lite could not make the sound, so this video was made with Grok Video instead. The Veo 3.1 Lite try was refunded.');

  // A Veo "Internal Error" also goes to Grok for a returning user: a video is better than none.
  const outage = await callTool('get_generation', { run_id: old }, { credits: 100, rest: world(failed('Internal Error, Please try again later.')) });
  assert.equal(outage.submitted.length, 1);
  assert.equal(outage.submitted[0].model_id, 'grok-video');
  assert.match(outage.result.structuredContent.switch_note, /^Veo 3\.1 Lite had a temporary issue on the provider's side, so this video was made with Grok Video instead\./);

  // A refusal Google gives for the photo is not an outage, so a returning user's video is not switched.
  const refused = await callTool('get_generation', { run_id: old }, { credits: 100, rest: world(failed('public error unsafe image upload.')) });
  assert.equal(refused.submitted.length, 0);
  assert.equal(refused.result.structuredContent.status, 'failed');
});

test('names ChatGPT sometimes uses for Kling 3.0 and the voice tool are understood', async () => {
  assert.equal((await callTool('get_model', { model_id: 'kling-3.0' }, { credits: 30 })).result.structuredContent.id, 'kling30');
  for (const name of ['elevenlabs-tts', 'eleven_multilingual_v2']) {
    const price = (await callTool('quote_generation', { model_id: name, character_count: 120 }, { credits: 30 })).result;
    assert.notEqual(price.isError, true, name);
  }
});

test('one user can have at most 50 Wan or Seedance videos running at once, and a provider "too many at once" waits instead of failing', async () => {
  const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const running = (count) => (href) => {
    if (href.includes('meta-%3E%3Eengine=eq.') || href.includes('meta->>engine=eq.')) return reply(Array.from({ length: count }, (_, i) => ({ id: `r${i}` })));
    return returningUser(href);
  };
  const scene = { model_id: 'wan-3', prompt: 'Scene 4: the hero enters the station', duration: 5, resolution: '720p' };
  const full = await callTool('create_generation', scene, { credits: 1000, rest: running(50) });
  assert.equal(full.submitted.length, 0);
  assert.equal(full.result.structuredContent.error, 'too_many_running');
  assert.equal(full.result.structuredContent.running, 50);
  assert.match(full.result.structuredContent.next_step, /do not switch model.*one video at a time/s);

  const room = await callTool('create_generation', scene, { credits: 1000, rest: running(49) });
  assert.equal(room.submitted.length, 1);

  const seedance = await callTool('create_generation', { ...scene, model_id: 'seedance25' }, { credits: 1000, rest: running(50) });
  assert.equal(seedance.result.structuredContent.error, 'too_many_running');

  const limited = await callTool('create_generation', scene, {
    credits: 1000, rest: running(0),
    runner: () => ({ status: 422, body: { ok: false, error: "Concurrent task limit (10) reached for model 'wan3.0-video'" } })
  });
  const value = limited.result.structuredContent;
  assert.equal(value.error, 'too_many_running');
  assert.equal(value.credits_used, 0);
  assert.match(value.next_step, /Do not switch model\..*wait about a minute, then call create_generation again with the same settings/);
  assert.equal('alternative' in value, false);
});

test('Veo rests after two Internal Errors in a row: new ChatGPT Veo videos are made with Grok, and the user is told', async () => {
  const { veoRestingFromRuns, resetVeoRestCache } = await import('../../lib/hansora-mcp/veo-rest.mjs');
  const at = (minutes) => new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const outage = (minutes) => ({ created_at: at(minutes), result_url: null, status: 'failed', error: 'Internal Error, Please try again later.' });
  const done = (minutes) => ({ created_at: at(minutes), result_url: 'https://cdn.test/v.mp4', status: 'done', error: null });
  const blocked = (minutes) => ({ created_at: at(minutes), result_url: null, status: 'failed', error: 'Request blocked: prominent public figure' });
  const pending = (minutes) => ({ created_at: at(minutes), result_url: null, status: 'processing', error: null });
  assert.equal(veoRestingFromRuns([outage(1), outage(3)]), true);
  assert.equal(veoRestingFromRuns([pending(0), outage(2), blocked(3), outage(5)]), true, 'refusals and running videos do not count');
  assert.equal(veoRestingFromRuns([outage(1)]), false, 'one random failure is not an outage');
  assert.equal(veoRestingFromRuns([done(1), outage(3), outage(4)]), false, 'a Veo success ends the rest');
  assert.equal(veoRestingFromRuns([outage(1), done(2)]), false);
  assert.equal(veoRestingFromRuns([]), false);

  const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const veoRuns = (rows) => (href) => {
    if (href.includes('/rest/v1/user_generations') && href.includes('provider=in.')) return reply(rows);
    return returningUser(href);
  };
  const photo = 'https://cdn.test/portrait.png';
  const files = { [photo]: Buffer.alloc(8) };
  const request = { model_id: 'veo31-lite', prompt: 'She smiles and waves', duration: 8, resolution: '1080p', image_urls: [photo] };

  resetVeoRestCache();
  const switched = await callTool('create_generation', request, { credits: 100, rest: veoRuns([outage(1), outage(4)]), files });
  assert.equal(switched.submitted.length, 1);
  assert.equal(switched.submitted[0].model_id, 'grok-video');
  assert.equal(switched.submitted[0].payload.duration, 6);
  assert.equal(switched.submitted[0].payload.resolution, '720p');
  assert.equal(switched.submitted[0].payload.prompt, 'She smiles and waves');
  assert.deepEqual(switched.submitted[0].payload.image_urls, [photo]);
  const value = switched.result.structuredContent;
  assert.equal(value.model_name, 'Grok Video');
  assert.equal(value.switched_from, 'Veo 3.1 Lite');
  assert.equal(value.switch_note, "Veo 3.1 Lite is having a temporary issue on the provider's side right now, so this video was made with Grok Video instead. You were charged the Grok Video price (18 credits).");
  assert.match(value.next_step, /Tell the user this in one short line, without asking anything\./);

  // Two photos are more than Grok takes, so that request still goes to Veo.
  resetVeoRestCache();
  const twoPhotos = await callTool('create_generation', { ...request, image_urls: [photo, 'https://cdn.test/second.png'] }, { credits: 100, rest: veoRuns([outage(1), outage(4)]), files });
  assert.equal(twoPhotos.submitted[0].model_id, 'veo31-lite');

  // No outage: Veo as asked, and no notice.
  resetVeoRestCache();
  const normal = await callTool('create_generation', request, { credits: 100, rest: veoRuns([outage(1), done(3)]), files });
  assert.equal(normal.submitted[0].model_id, 'veo31-lite');
  assert.equal('switch_note' in normal.result.structuredContent, false);
  resetVeoRestCache();
});

test('a new user\'s first video sent to Veo is made with Grok, unless ChatGPT then chooses Veo on purpose', async () => {
  const request = { model_id: 'veo31-lite', prompt: 'My dog runs on the beach', duration: 8, resolution: '1080p' };
  const steered = await callTool('create_generation', request, { credits: 3 });
  assert.equal(steered.submitted.length, 0);
  const value = steered.result.structuredContent;
  assert.equal(value.error, 'first_video_on_grok');
  assert.equal(value.credits_used, 0);
  assert.deepEqual(value.next_option, { model_id: 'grok-video', model_name: 'Grok Video', settings: { duration: 6, resolution: '720p' }, credits: 18 });
  assert.match(value.next_step, /do not ask anything: call create_generation right now with model_id grok-video, duration 6, resolution 720p/);
  assert.match(value.next_step, /If the user themselves asked for 7 or 8 seconds, use duration 8 instead \(24 credits\)/);
  assert.match(value.next_step, /only if people in the video must speak a language other than English \(Chinese included\), call create_generation again exactly as before with veo31-lite/);
  const { eventRow } = await import('../../lib/hansora-mcp/events.mjs');
  assert.equal(eventRow('u', 'create_generation', request, steered.result).outcome, 'first_video_on_grok');

  // ChatGPT sends Veo again on purpose (the user asked for 8 seconds): it starts, no loop.
  const chosen = await callTool('create_generation', request, { credits: 3, veoChosen: true });
  assert.equal(chosen.submitted.length, 1);
  assert.equal(chosen.submitted[0].model_id, 'veo31-lite');

  // Right after this user's Grok video failed, Veo goes through instead of being sent back to Grok.
  const grokJustFailed = await callTool('create_generation', request, { credits: 3, rest: (href) => (href.includes('provider=eq.Grok') && href.includes('meta->>status=eq.failed') ? new Response(JSON.stringify([{ id: 'g' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) : undefined) });
  assert.equal(grokJustFailed.submitted.length, 1);
  assert.equal(grokJustFailed.submitted[0].model_id, 'veo31-lite');

  // Returning users, and requests Grok cannot take as they are, keep Veo.
  const returning = await callTool('create_generation', request, { credits: 100, rest: returningUser });
  assert.equal(returning.submitted[0].model_id, 'veo31-lite');
  const twoPhotos = await callTool('create_generation', { ...request, image_urls: ['https://cdn.test/a.png', 'https://cdn.test/b.png'] }, { credits: 3, files: { 'https://cdn.test/a.png': Buffer.alloc(8), 'https://cdn.test/b.png': Buffer.alloc(8) } });
  assert.equal(twoPhotos.submitted[0].model_id, 'veo31-lite');
});

test('a new user\'s first video from a photo explains how to put the person into a new scene within the free credits', async () => {
  const photo = 'https://cdn.test/me.png';
  const files = { [photo]: Buffer.alloc(8) };
  const scene = 'Me in a tuxedo receiving the Ballon d\'Or trophy on stage';
  const viaSwitch = (await callTool('create_generation', { model_id: 'seedance25', prompt: scene, duration: 10, resolution: '720p', image_urls: [photo] }, { credits: 3, files })).result.structuredContent;
  const viaSteer = (await callTool('create_generation', { model_id: 'veo31-lite', prompt: scene, duration: 8, resolution: '720p', image_urls: [photo] }, { credits: 3, files })).result.structuredContent;
  for (const value of [viaSwitch, viaSteer]) {
    assert.match(value.next_step, /If the user wants their photo changed \(a new outfit, place, atmosphere or style, or added people or things\), not just animated as it is, do this instead: first call create_generation with model_id nano-banana-2-1, resolution 1K, the user's photo and a prompt describing the changed picture \(3 credits\)\. When the picture is ready \(get_generation\), call create_generation with the video model and settings above, that picture as the photo and a prompt for the motion, without asking\./);
  }
  // Without a photo there is nothing to place, so no such instruction.
  const noPhoto = (await callTool('create_generation', { model_id: 'seedance25', prompt: 'A knight at sunset', duration: 10, resolution: '720p' }, { credits: 3 })).result.structuredContent;
  assert.doesNotMatch(noPhoto.next_step, /nano-banana-2-1/);
  const list = await callTool('list_models', { category: 'video' }, { credits: 30 });
  assert.match(list.result.structuredContent.video_selection_guide, /first make the changed picture with Nano Banana 2\.1 \(1K, 3 credits\) from the user's photo, then animate that picture with the video model/);
});

test('a ChatGPT video over 10 MB for Henshin Lite or Kling 4.0 gets a clear way on instead of a raw error', async () => {
  const video = 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/video/big.mp4';
  for (const [modelId, alternative] of [['henshin-lite', /Henshin, the stronger version, which takes videos up to 100 MB/], ['kling40', /Seedance 2\.5, which takes reference videos up to 200 MB/]]) {
    const { result } = await callTool('create_generation', { model_id: modelId, prompt: 'Put me in this dance', duration: 10, resolution: '720p', video_urls: [video], image_urls: ['https://cdn.test/me.png'] }, {
      credits: 1000, rest: returningUser, runner: () => ({ status: 400, body: { ok: false, error: 'Media exceeds 10 MB.' } })
    });
    const value = result.structuredContent;
    assert.equal(value.error, 'video_too_large', modelId);
    assert.equal(value.credits_used, 0);
    assert.match(value.next_step, /send a shorter or smaller clip/);
    assert.match(value.next_step, alternative);
    assert.match(value.next_step, /start only after they choose/);
  }
});

test('a mistyped Hansora picture link is replaced by the saved picture before the video starts', async () => {
  const base = 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/generation-history/';
  const real = `${base}e2099428-36e4-4c4a-a42c-b1a8bb698d8a/2f89142f-99d4-8112-b105-b02b9cd39b23.png`;
  const typed = `${base}e2099428-36e4-4c4a-a42c-b1a8bb698a/2f89142f-99d4-8112-b105-b02b9cd39b23.png`;
  const saved = (href) => (href.includes('select=result_url,meta->result_urls')
    ? new Response(JSON.stringify([{ result_url: real }]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    : returningUser(href));
  const fixed = await callTool('create_generation', { model_id: 'grok-video', prompt: 'animate', duration: 6, resolution: '720p', aspect_ratio: '9:16', image_urls: [typed] }, { credits: 300, rest: saved });
  assert.equal(fixed.submitted.length, 1);
  const sent = JSON.stringify(fixed.submitted[0]);
  assert.ok(sent.includes(real), 'the saved picture is sent');
  assert.ok(!sent.includes(typed), 'the mistyped link is never sent');

  const unknown = `${base}aaaaaaaa-0000-4000-8000-000000000000/ffffffff-0000-4000-8000-000000000000.png`;
  const missing = await callTool('create_generation', { model_id: 'grok-video', prompt: 'animate', duration: 6, resolution: '720p', aspect_ratio: '9:16', image_urls: [unknown] }, { credits: 300, rest: saved });
  assert.equal(missing.submitted.length, 0, 'nothing starts or is charged');
  assert.equal(missing.result.structuredContent.error, 'file_link_not_found');
  assert.match(missing.result.structuredContent.next_step, /copy its result_url exactly/);
});

test('model names ChatGPT writes its own way still find the model', async () => {
  const { getModel } = await import('../../lib/hansora-mcp/registry.mjs');
  for (const [name, id] of [['kling-4', 'kling40'], ['seedance-2-5', 'seedance25'], ['veo3.1lite', 'veo31-lite'], ['elevenlabs_tts_multilingual_v2', 'voice'], ['Nano Banana 2.1', 'nano-banana-2-1'], ['wan 3', 'wan-3']])
    assert.equal(getModel(name)?.id, id, name);
  assert.equal(getModel('made-up-model'), null);
});

test('the last video ChatGPT keeps using ignores a video Hansora remade after a temporary issue', async () => {
  const { getLastVideo } = await import('../../lib/hansora-mcp/data.mjs');
  let asked = '';
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => { asked = decodeURIComponent(String(url)); return new Response('[]', { status: 200 }); };
  try { await getLastVideo('u'); } finally { globalThis.fetch = original; }
  assert.match(asked, /or=\(meta->>run_id\.is\.null,meta->>run_id\.not\.like\.\*-retry\)/);
  const { VIDEO_SELECTION_GUIDE } = await import('../../lib/hansora-mcp/registry.mjs');
  assert.match(VIDEO_SELECTION_GUIDE, /does not change the model in use: the next videos use the model the user had before/);
});

test('a video from a picture Hansora made that the video model refuses is tried once on the other model, then the user is told and gets the picture', async () => {
  const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const old = 'user-1-mcp-1793529277293-5bf9776c';
  const picture = 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/generation-history/user-1/2b767f9d.png';
  const prompt = 'The boy juggles the ball, then two footballers greet him.';

  // 1. The picture is the first frame: the recipe keeps it and knows Hansora made it.
  const saved = [];
  const created = await callTool('create_generation', { model_id: 'veo31-lite', prompt, duration: 8, resolution: '720p', first_frame_url: picture }, {
    credits: 100, veoChosen: true,
    rest: (href, options) => {
      if (href.includes('/rest/v1/chatgpt_events') && options?.method === 'POST') { saved.push(JSON.parse(options.body)); return reply({}); }
      if (href.includes('result_url=not.is.null')) return reply([{ id: 'the-picture', result_url: picture }]);
      return undefined;
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const recipe = saved.find((row) => /recipe/.test(row.tool));
  assert.ok(recipe, `recipe saved ${JSON.stringify(created.result.structuredContent).slice(0, 400)}`);
  assert.equal(recipe.details.first_frame_url, picture);
  assert.equal(recipe.details.from_picture, true);

  const refused = (error, extra = {}) => ({ id: 'g-old', kind: 'video', provider: 'veo3.1lite', created_at: '2026-11-01T10:34:40Z', result_url: null,
    meta: { run_id: old, model: 'veo3_lite', status: 'failed', error, charged_cost: 2, refund_amount: 2, refunded: true, ...extra } });
  const world = ({ failure, retryRow = null, details = recipe.details, modelId = 'veo31-lite' }) => (href) => {
    if (href.includes('/rest/v1/chatgpt_events') && href.includes('recipe')) return reply([{ model_id: modelId, details }]);
    if (href.includes('result_url=not.is.null')) return reply([{ id: 'the-picture' }]);
    if (href.includes('/rest/v1/user_generations') && href.includes(encodeURIComponent(`${old}-retry`))) return reply(retryRow ? [retryRow] : []);
    if (href.includes('/rest/v1/user_generations') && href.includes(`eq.${encodeURIComponent(old)}`)) return reply([failure]);
    if (href.includes('/rest/v1/user_generations')) return reply([]);
    return undefined;
  };
  const publicFigure = refused('Request blocked: The input content was flagged for containing a prominent public figure.');

  // 2. Veo refuses it: started once on Grok, with the picture as the first frame, under the same card.
  const first = await callTool('get_generation', { run_id: old }, { credits: 100, rest: world({ failure: publicFigure }) });
  assert.equal(first.submitted.length, 1);
  assert.equal(first.submitted[0].model_id, 'grok-video');
  assert.equal(first.submitted[0].payload.run_id, `${old}-retry`);
  assert.match(JSON.stringify(first.submitted[0].payload), new RegExp(picture.replace(/[.]/g, '\\.')));
  assert.equal(first.result.structuredContent.run_id, old);
  assert.match(first.result.structuredContent.switch_note, /^Veo 3\.1 Lite refused to animate the picture, so this video was made with Grok Video instead\./);

  // 3. Grok makes it: the video is shown.
  const made = { id: 'g-new', kind: 'video', provider: 'Grok', created_at: '2026-11-01T10:37:00Z',
    result_url: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/generation-history/user-1/new.mp4',
    meta: { run_id: `${old}-retry`, engine: 'grok', status: 'done' } };
  const ok = await callTool('get_generation', { run_id: old }, { credits: 100, rest: world({ failure: publicFigure, retryRow: made }) });
  assert.equal(ok.submitted.length, 0);
  assert.equal(ok.result.structuredContent.status, 'ready');

  // 4. Grok refuses it too: the user is told plainly and gets the picture.
  const grokRefused = { id: 'g-new', kind: 'video', provider: 'Grok', created_at: '2026-11-01T10:37:00Z', result_url: null,
    meta: { run_id: `${old}-retry`, engine: 'grok', status: 'failed', error: 'Content flagged by moderation', charged_cost: 1.8, refund_amount: 1.8, refunded: true } };
  const both = (await callTool('get_generation', { run_id: old }, { credits: 100, rest: world({ failure: publicFigure, retryRow: grokRefused }) })).result.structuredContent;
  assert.equal(both.status, 'failed');
  assert.equal(both.run_id, old);
  assert.equal(both.picture_url, picture);
  assert.equal(both.card_message, 'I made the picture first so I could animate it, but Veo 3.1 Lite and Grok Video both refused to turn it into a video. Here is the picture. The video\'s credits were refunded.');
  assert.ok(both.next_step.includes(picture));

  // 5. Grok fails for another reason: said as it is.
  const grokBroke = { ...grokRefused, meta: { ...grokRefused.meta, error: 'Internal Error, Please try again later.' } };
  const broke = (await callTool('get_generation', { run_id: old }, { credits: 100, rest: world({ failure: publicFigure, retryRow: grokBroke }) })).result.structuredContent;
  assert.match(broke.card_message, /Veo 3\.1 Lite refused to turn it into a video and Grok Video couldn't make it either\./);

  // 6. Grok refuses first: Veo 3.1 Lite (20 credits) is tried.
  const grokFirst = refused('Content flagged by moderation', { model: 'grok-imagine/image-to-video', engine: 'grok', charged_cost: 1.8, refund_amount: 1.8 });
  const toVeo = await callTool('get_generation', { run_id: old }, { credits: 100, rest: world({ failure: { ...grokFirst, provider: 'Grok' }, modelId: 'grok-video' }) });
  assert.equal(toVeo.submitted.length, 1);
  assert.equal(toVeo.submitted[0].model_id, 'veo31-lite');

  // 7. Not enough credits for the other model: the picture message straight away, nothing started.
  const poor = (await callTool('get_generation', { run_id: old }, { credits: 0, rest: world({ failure: publicFigure }) }));
  assert.equal(poor.submitted.length, 0);
  assert.match(poor.result.structuredContent.card_message, /^I made the picture first so I could animate it, but Veo 3\.1 Lite refused to turn it into a video\./);

  // 8. Never retried: sexual content or minors, or a photo the user sent (not a Hansora picture).
  const sexual = await callTool('get_generation', { run_id: old }, { credits: 100, rest: world({ failure: refused('Flagged: sexual content') }) });
  assert.equal(sexual.submitted.length, 0);
  assert.equal(sexual.result.structuredContent.picture_url, undefined);
  const ownPhoto = { ...recipe.details, from_picture: undefined, first_frame_url: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/video/images/user-uploads/me.jpg' };
  const photo = await callTool('get_generation', { run_id: old }, { credits: 100, rest: world({ failure: publicFigure, details: ownPhoto }) });
  assert.equal(photo.submitted.length, 0);
  assert.equal(photo.result.structuredContent.failure_kind, 'content');
});

test('a video is not started while the user\'s ChatGPT picture is still being made, so it is made from the picture', async () => {
  const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const pictureRun = 'user-1-mcp-1793328296061-9f44ffd5';
  const pictures = (rows) => (href) => (href.includes('/rest/v1/user_generations') && href.includes('kind=eq.image') ? reply(rows) : undefined);

  const waiting = await callTool('create_generation', { model_id: 'grok-video', prompt: 'The four friends press the buttons', duration: 6, resolution: '720p' }, { credits: 100, rest: pictures([{ run_id: pictureRun, status: 'processing' }]) });
  assert.equal(waiting.submitted.length, 0);
  assert.equal(waiting.result.structuredContent.error, 'picture_not_ready');
  assert.equal(waiting.result.structuredContent.credits_used, 0);
  assert.ok(waiting.result.structuredContent.next_step.includes(`get_generation with run_id ${pictureRun}`));

  // A failed picture does not hold the video back, and pictures themselves are never held back.
  const failed = await callTool('create_generation', { model_id: 'grok-video', prompt: 'The four friends press the buttons', duration: 6, resolution: '720p' }, { credits: 100, rest: pictures([{ run_id: pictureRun, status: 'failed' }]) });
  assert.equal(failed.result.structuredContent.error, undefined);
  assert.equal(failed.submitted.length, 1);
  const picture = await callTool('create_generation', { model_id: 'nano-banana-2-1', prompt: 'A second picture', resolution: '1K' }, { credits: 100, rest: pictures([{ run_id: pictureRun, status: 'processing' }]) });
  assert.equal(picture.submitted.length, 1);
});
