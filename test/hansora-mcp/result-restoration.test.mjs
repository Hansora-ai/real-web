import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { GENERATION_APP_HTML } from '../../lib/hansora-mcp/generation-app.mjs';

const flush = async () => { for (let n = 0; n < 16; n++) await Promise.resolve(); };
const envelope = (value) => ({ structuredContent: value });
const queued = (run_id = 'run-1') => ({ run_id, status: 'queued', model_name: 'Test model' });
const complete = (kind = 'image', run_id = 'run-1') => ({ ...queued(run_id), status: 'ready', kind,
  result_url: `https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/history/${run_id}.${kind === 'audio' ? 'mp3' : kind === 'video' ? 'mp4' : 'png'}` });

// Execute the real card script, including initialization, bridge messages and timers.
// Only the browser/host boundary is simulated; no generation tools are run.
function host({ output, input, widgetState, get = () => envelope(complete()), native = true, initialize = true } = {}) {
  const nodes = new Map(), listeners = new Map(), timers = new Map(), calls = [], messages = [];
  let now = 100000, timerId = 0, intersection, initializationAttempts = 0;
  const listen = (name, fn) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); };
  const emit = (name, value = {}) => { for (const fn of listeners.get(name) || []) fn(value); };
  function element(tag = 'div') {
    const classes = new Set();
    return { tag, children: [], listeners: {}, attributes: {}, textContent: '', style: {},
      classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, contains: (name) => classes.has(name), add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
      appendChild(node) { this.children.push(node); }, replaceChildren() { this.children = []; },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, fn) { this.listeners[name] = fn; }, getBoundingClientRect: () => ({ height: 300 }) };
  }
  const document = { hidden: false, getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    createElement: element, querySelector: () => element(), addEventListener: listen };
  const setTimer = (fn, delay, interval = false) => { const id = ++timerId; timers.set(id, { fn, time: now + delay, delay, interval }); return id; };
  const window = { addEventListener: listen, requestAnimationFrame: (fn) => setTimer(fn, 16),
    setTimeout: (fn, delay) => setTimer(fn, delay), clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, delay) => setTimer(fn, delay, true), clearInterval: (id) => timers.delete(id),
    openai: { toolInput: input, toolOutput: output, widgetState, setWidgetState(value) { this.widgetState = structuredClone(value); } },
    parent: { postMessage(message) {
      messages.push(message);
      if (message.method === 'ui/initialize') {
        initializationAttempts++;
        const respond = typeof initialize === 'function' ? initialize(initializationAttempts) : initialize;
        if (respond) Promise.resolve().then(() => emit('message', { source: window.parent, data: { jsonrpc: '2.0', id: message.id, result: {} } }));
      }
      if (message.method === 'tools/call') invoke(message.params).then((result) => emit('message', { source: window.parent, data: { jsonrpc: '2.0', id: message.id, result } }));
    } } };
  async function invoke(params) { calls.push(params); return get(params); }
  if (native) window.openai.callTool = (name, args) => invoke({ name, arguments: args });
  vm.runInNewContext(GENERATION_APP_HTML.match(/<script>([\s\S]*?)<\/script>/)[1], {
    window, document, URL, Map, Set, Date: class extends Date { static now() { return now; } },
    IntersectionObserver: class { constructor(fn) { intersection = fn; } observe() {} }
  });
  return { nodes, calls, messages, window, document, emit,
    async tick(ms) {
      const end = now + ms;
      await flush();
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.time <= end).sort((a, b) => a[1].time - b[1].time)[0];
        if (!next) break;
        const [id, timer] = next; now = timer.time;
        if (timer.interval) timer.time += timer.delay; else timers.delete(id);
        timer.fn(); await flush();
      }
      now = end; await flush();
    },
    globals(values) { Object.assign(window.openai, values); emit('openai:set_globals', { detail: { globals: values } }); },
    result(value) { emit('message', { source: window.parent, data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: value } }); },
    visible(value) { intersection([{ isIntersecting: value }]); },
    snapshot: () => structuredClone(window.openai.widgetState),
    section: () => ['ready', 'processing', 'batch', 'failed', 'unavailable', 'upload', 'multiUpload'].find((id) => nodes.has(id) && !nodes.get(id).classList.contains('hidden'))
  };
}

for (const [label, kind, tag] of [['image', 'image', 'img'], ['video', 'video', 'video'], ['music', 'audio', 'audio'], ['speech', 'audio', 'audio']]) {
  test(`${label}: returning to an old queued card fetches its finished result and restores it on reload`, async () => {
    const card = host({ output: queued(), get: () => envelope(complete(kind)) });
    await flush();
    assert.equal(card.section(), 'ready');
    assert.equal(card.nodes.get('media').children[0].tag, tag);
    assert.deepEqual(structuredClone(card.calls), [{ name: 'get_generation', arguments: { run_id: 'run-1' } }]);
    const restored = host({ output: queued(), widgetState: card.snapshot(), get: () => new Promise(() => {}) });
    assert.equal(restored.section(), 'ready'); // available before any network response
    await restored.tick(31000);
    assert.equal(restored.section(), 'ready');
    assert.equal(restored.nodes.get('media').children[0].src, complete(kind).result_url);
    assert.match(restored.nodes.get('actionStatus').textContent, /saved result/);
    assert.ok(restored.calls.every((call) => call.name === 'get_generation'));
  });
}

test('standard MCP result and delayed ChatGPT globals both recover missing initial output', async () => {
  for (const native of [true, false]) {
    const card = host({ native }); await flush();
    if (native) card.globals({ toolResponseMetadata: { status: 'success', call_tool_result: { mcp_tool_result: { content: [{ type: 'text', text: JSON.stringify(queued()) }] } } } });
    else card.result({ content: [{ type: 'text', text: JSON.stringify(queued()) }] });
    await flush();
    assert.equal(card.section(), 'ready');
    assert.equal(card.calls.length, 1);
  }
});

test('scrolling a pending card back into view refreshes the same generation without creating anything', async () => {
  let done = false;
  const card = host({ output: queued(), get: () => envelope(done ? complete('video') : queued()) });
  await flush(); assert.equal(card.section(), 'processing');
  card.visible(false); done = true;
  await card.tick(7000); assert.equal(card.calls.length, 1);
  card.visible(true); await flush();
  assert.equal(card.section(), 'ready');
  card.result(envelope(queued())); await flush(); // replayed original queued response
  assert.equal(card.section(), 'ready');
  assert.ok(card.calls.every((call) => call.name === 'get_generation' && call.arguments.run_id === 'run-1'));
});

test('status refreshes do not replace an audio/video element or interrupt playback', async () => {
  for (const kind of ['audio', 'video']) {
    const card = host({ output: complete(kind), get: () => envelope(complete(kind)) });
    await flush(); const media = card.nodes.get('media').children[0];
    await card.tick(2100); card.emit('focus'); await flush();
    card.globals({ widgetState: card.snapshot() }); await flush();
    assert.equal(card.nodes.get('media').children[0], media);
  }
});

test('selected song version survives remount and no provider internals enter widget state', async () => {
  const result = { ...complete('audio'), result_urls: [complete('audio').result_url, complete('audio', 'other').result_url], provider: { secret: 'not-for-widget-state' }, meta: { upload_token: 'private' } };
  const card = host({ output: result, get: () => envelope(result) }); await flush();
  card.nodes.get('audioVersions').children[1].listeners.click();
  const saved = card.snapshot();
  assert.doesNotMatch(JSON.stringify(saved), /secret|upload_token|not-for-widget-state/);
  const restored = host({ output: queued(), widgetState: saved, get: () => envelope(result) }); await flush();
  assert.equal(restored.nodes.get('media').children[0].src, result.result_urls[1]);
});

test('a new run cannot display a different run’s cached result or accept a late old status response', async () => {
  let finishOld;
  const card = host({ output: queued(), get: () => new Promise((resolve) => { finishOld = resolve; }) }); await flush();
  card.globals({ toolOutput: queued('run-2') });
  finishOld(envelope(complete('image'))); await flush();
  assert.equal(card.section(), 'processing');
  assert.equal(card.nodes.get('badge').textContent, 'Generating');
  assert.equal(card.snapshot().privateContent.hansoraGeneration.result.run_id, 'run-2');
});

test('three failed or malformed status checks stop the spinner and Check again can recover', async () => {
  for (const broken of [() => Promise.reject(new Error('offline')), () => ({ isError: true, content: [{ type: 'text', text: 'generation_not_found' }] }), () => ({ content: [{ type: 'text', text: 'not JSON' }] })]) {
    let recovered = false;
    const card = host({ output: queued(), get: () => recovered ? envelope(complete()) : broken() });
    await card.tick(13000);
    assert.equal(card.section(), 'unavailable');
    assert.match(card.nodes.get('statusText').textContent, /does not mean the generation failed/);
    recovered = true; card.nodes.get('refresh').listeners.click(); await flush();
    assert.equal(card.section(), 'ready');
  }
});

test('unresolved native calls time out, and a genuinely long-running job stops animating after 15 minutes', async () => {
  const hung = host({ output: queued(), get: () => new Promise(() => {}) });
  await hung.tick(110000);
  assert.equal(hung.section(), 'unavailable');
  const slow = host({ output: queued(), get: () => envelope(queued()) });
  await slow.tick(16 * 60 * 1000);
  assert.equal(slow.section(), 'unavailable');
  assert.match(slow.nodes.get('statusTitle').textContent, /Still waiting/);
});

test('missing generation references, failed jobs, and missing completed files never animate forever', async () => {
  const missing = host(); await missing.tick(16000);
  assert.equal(missing.section(), 'unavailable'); assert.equal(missing.calls.length, 0);
  const noFile = host({ output: queued(), get: () => envelope({ ...queued(), status: 'ready' }) }); await flush();
  assert.equal(noFile.section(), 'unavailable'); assert.match(noFile.nodes.get('statusTitle').textContent, /file unavailable/);
  const failed = host({ output: queued(), get: () => envelope({ ...queued(), status: 'failed' }) }); await flush();
  assert.equal(failed.section(), 'failed');
  for (const kind of ['image', 'audio', 'video']) {
    const card = host({ output: complete(kind), get: () => envelope(complete(kind)) }); await flush();
    card.nodes.get('media').children[0].listeners.error();
    assert.equal(card.section(), 'ready'); assert.match(card.nodes.get('actionStatus').textContent, /preview could not load/);
  }
});

test('upload cards restore a submitted run rather than asking users to upload and pay again', async () => {
  const saved = host({ output: complete('video') }); await flush();
  const card = host({ output: { mode: 'video_upload', model_name: 'Video editor' }, widgetState: saved.snapshot() }); await flush();
  assert.equal(card.section(), 'ready');
  assert.ok(card.calls.every((call) => call.name === 'get_generation'));
});

test('reference inputs cannot be mistaken for a finished generated file', async () => {
  const card = host({ input: { audio_tool_id: 'voice-change', audio_url: 'https://example.com/input.mp3' } });
  await card.tick(16000);
  assert.equal(card.section(), 'unavailable');
  assert.equal(card.nodes.get('badge').textContent, 'Check status');
  assert.equal(card.calls.length, 0);
});

test('bridge initialization failures preserve saved results and provide a non-spinning fallback', async () => {
  const disconnected = host({ output: queued(), native: false, initialize: false });
  await disconnected.tick(31000);
  assert.equal(disconnected.section(), 'unavailable');
  const nativeOnly = host({ output: queued(), initialize: false });
  await nativeOnly.tick(5100);
  assert.equal(nativeOnly.section(), 'ready');
  assert.deepEqual(structuredClone(nativeOnly.messages.filter((message) => message.method === 'ui/notifications/initialized')), [
    { jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }
  ]);
  const attempts = nativeOnly.messages.filter((message) => message.method === 'ui/initialize').length;
  await nativeOnly.tick(30000);
  assert.equal(nativeOnly.messages.filter((message) => message.method === 'ui/initialize').length, attempts);
});

test('a cold parent that misses the first handshake messages can still open the card', async () => {
  for (const native of [true, false]) {
    const card = host({ output: queued(), native, initialize: (attempt) => attempt >= 3 });
    await card.tick(1100);
    assert.equal(card.section(), 'ready');
    const attempts = card.messages.filter((message) => message.method === 'ui/initialize');
    assert.equal(attempts.length, 3);
    assert.equal(new Set(attempts.map((message) => message.id)).size, 1);
    assert.equal(card.messages.filter((message) => message.method === 'ui/notifications/initialized').length, 1);
    assert.deepEqual(structuredClone(card.calls), [{ name: 'get_generation', arguments: { run_id: 'run-1' } }]);
    await card.tick(30000);
    assert.equal(card.messages.filter((message) => message.method === 'ui/initialize').length, 3);
  }
});

test('several generations started together show as one gallery that fills in as each finishes', async () => {
  const item = (run_id, done) => ({ run_id, status: done ? 'ready' : 'processing', media_type: 'image', model_name: 'Nano Banana 2',
    result_url: done ? `https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/history/${run_id}.png` : null });
  let secondDone = false;
  const card = host({
    output: { ...queued('run-2'), batch: [item('run-1', true), item('run-2', false)] },
    get: () => envelope({ ...queued('run-2'), status: secondDone ? 'ready' : 'processing', batch: [item('run-1', true), item('run-2', secondDone)] })
  });
  await flush();
  assert.equal(card.section(), 'batch');
  assert.equal(card.nodes.get('gallery').children.length, 2);
  const tile = card.nodes.get('gallery').children[0];
  assert.equal(tile.children[0].className, 'tile-open');
  assert.equal(tile.children[0].children[0].tag, 'img');
  assert.equal(tile.children[1].className, 'tile-dl'); // each ready result has its own download button
  tile.children[1].listeners.click();
  await flush();
  const opened = card.messages.filter((message) => message.method === 'ui/open-link').map((message) => message.params.url);
  assert.deepEqual(opened, ['https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/history/run-1.png?download=']);
  assert.match(card.nodes.get('batchText').textContent, /1 ready · 1 generating/);
  assert.equal(card.nodes.get('badge').textContent, 'Generating');

  secondDone = true;
  await card.tick(7000);
  assert.equal(card.section(), 'batch');
  assert.match(card.nodes.get('batchText').textContent, /^2 ready/);
  assert.equal(card.nodes.get('badge').textContent, 'Ready');
  assert.ok(card.calls.every((call) => call.name === 'get_generation' && call.arguments.run_id === 'run-2'));
  const calls = card.calls.length;
  await card.tick(30000);
  assert.equal(card.calls.length, calls); // nothing left to check, so polling stops
});
