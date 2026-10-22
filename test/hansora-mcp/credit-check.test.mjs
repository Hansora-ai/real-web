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
  assert.match(guide, /Seedance 2\.5, 1080p \(sharpest, highest price\): offer only when the user asks for 1080p/);
  assert.match(guide, /Seedance 2\.0, 720p: very strong for complex scenes \(up to 15 seconds only\)/);
  assert.match(guide, /pick the first option that fits/);
  assert.match(guide, /Wan 3\.0 15 seconds, Seedance 2\.0 15 seconds, Seedance 2\.5 30 seconds/);
  assert.match(guide, /Gemini Omni uses only the first 10 seconds of a video/);
  assert.match(guide, /12\. Seedance 2\.5 and Henshin: if the user wants one of these but did not say a quality, ask one short question/);
  assert.match(guide, /per 10 seconds of video: 480p 175, 720p 380, 1080p 900 credits/);
  assert.match(guide, /For every other model, use the default quality without asking\./);
  assert.match(guide, /13\. Sexual or NSFW requests: Hansora does not create them with any model\. Do not submit them\./);
  assert.match(guide, /11\. Reference videos: .*a short clip of just the part that matters usually gives a better and more affordable result\. Keep it a tip only: do not explain how video length affects the price/);
  assert.match(guide, /person or character to place into new scenes .*Gemini Omni Flash, 1080p, up to 10 seconds; Wan 3\.0, 720p, for longer/);
  assert.match(guide, /8\. Stay with the model\..*Do not switch on your own\..*start only after they agree\./);
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

  const policy = await ask(row({ model: 'veo3_lite', error: 'Your prompt was flagged by the content policy', charged: 'true', refunded: true, refunded_cost: 2 }));
  assert.equal(policy.failure_kind, 'content');
  assert.equal('alternative' in policy, false);
  assert.match(policy.next_step, /do not switch to another model to get around the refusal/);

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
