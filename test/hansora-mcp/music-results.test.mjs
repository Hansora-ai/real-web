import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { normalizeGenerationResult } from '../../lib/hansora-mcp/generation-results.mjs';
import suno from '../../lib/hansora-mcp/suno-results.cjs';
import { GENERATION_APP_HTML } from '../../lib/hansora-mcp/generation-app.mjs';

const tracks = [1, 2].map((n) => ({
  audioUrl: `https://tempfile.aiquickdraw.com/song-${n}.mp3`,
  audio_url: `https://tempfile.aiquickdraw.com/song-${n}.mp3`,
  streamAudioUrl: `https://audiostream.kie.ai/stream/song-${n}.mp3`,
  imageUrl: `https://musicfile.kie.ai/song-${n}.jpeg`
}));
const callback = (callbackType = 'complete') => ({ code: 200, msg: 'All generated successfully.', data: { callbackType, task_id: 'task-1', data: tracks } });
const savedRow = (body = callback()) => ({ id: 'song-1', kind: 'audio', result_url: null, meta: { run_id: 'run-1', audio_kind: 'music', status: 'processing', callback: body } });

test('completed callbacks recover both final songs without changing the stored row', () => {
  const row = savedRow();
  const before = structuredClone(row);
  const result = normalizeGenerationResult(row);
  assert.equal(result.status, 'ready');
  assert.equal(result.meta.status, 'ready');
  assert.equal(result.result_url, tracks[0].audioUrl);
  assert.deepEqual(result.meta.audio_urls, tracks.map((track) => track.audioUrl));
  assert.deepEqual(row, before);
});

test('partial, failed, refunded, and stream-only results are not promoted to ready', () => {
  for (const stage of ['text', 'first', 'error']) {
    const row = savedRow(callback(stage));
    assert.equal(normalizeGenerationResult(row), row);
  }
  for (const patch of [{ status: 'failed' }, { refunded: true }, { failed: true }]) {
    const row = savedRow(); Object.assign(row.meta, patch);
    assert.equal(normalizeGenerationResult(row), row);
  }
  const row = savedRow({ code: 200, data: { callbackType: 'complete', data: [{ streamAudioUrl: tracks[0].streamAudioUrl }] } });
  assert.equal(normalizeGenerationResult(row), row);
  assert.equal(suno.normalizeSunoStatus({ code: 500, data: { callbackType: 'complete' } }), 'failed');
});

test('callback persists complete events and does not regress on a late partial event', async (t) => {
  const require = createRequire(import.meta.url);
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://storage.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  const modulePath = require.resolve('../../netlify/functions/audio-kie-callback.js');
  delete require.cache[modulePath];
  t.after(() => {
    delete require.cache[modulePath];
    for (const [name, value] of [['SUPABASE_URL', previousUrl], ['SUPABASE_SERVICE_ROLE_KEY', previousKey]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  const { handler } = require(modulePath);
  let row = savedRow(); const patches = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    assert.match(String(url), /storage\.example\/rest\/v1\/user_generations/);
    if (options.method === 'PATCH') {
      const patch = JSON.parse(options.body); patches.push(patch); row = { ...row, ...patch };
      return new Response(null, { status: 204 });
    }
    return Response.json([row]);
  });
  const event = { httpMethod: 'POST', queryStringParameters: { uid: 'user-1', run_id: 'run-1', kind: 'music' }, body: JSON.stringify(callback()) };
  assert.equal(JSON.parse((await handler(event)).body).status, 'ready');
  assert.equal(patches[0].result_url, tracks[0].audioUrl);
  assert.deepEqual(patches[0].meta.audio_urls, tracks.map((track) => track.audioUrl));
  await handler({ ...event, body: JSON.stringify(callback('first')) });
  assert.equal(patches.length, 1);
});

function cardHarness() {
  const nodes = new Map(); const messages = [];
  function node() {
    const classes = new Set();
    return { children: [], listeners: {}, attributes: {},
      classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains: (name) => classes.has(name), add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
      replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); },
      addEventListener(name, callback) { this.listeners[name] = callback; },
      setAttribute(name, value) { this.attributes[name] = value; } };
  }
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }, createElement(tag) { return { ...node(), tag }; }, addEventListener() {} };
  const window = { addEventListener() {}, clearInterval() {}, clearTimeout() {}, setTimeout() {}, parent: { postMessage(message) { messages.push(message); } } };
  const script = GENERATION_APP_HTML.match(/<script>([\s\S]*?)<\/script>/)[1].replace('    initializeApp();', '    window.cardTest = { render, openResult };');
  vm.runInNewContext(script, { window, document, URL, Map, Set });
  return { ...window.cardTest, nodes, messages };
}

test('card routes provider audio through the allowed preview cache and selects both versions', () => {
  const card = cardHarness(); card.render(normalizeGenerationResult(savedRow()));
  assert.equal(card.nodes.get('badge').textContent, 'Ready');
  assert.equal(card.nodes.get('processing').classList.contains('hidden'), true);
  const versions = card.nodes.get('audioVersions').children;
  assert.equal(versions.length, 2);
  versions[1].listeners.click();
  assert.equal(card.nodes.get('audioVersions').children[1].attributes['aria-pressed'], 'true');
  assert.equal(card.nodes.get('media').children[0].tag, 'audio');
  assert.equal(card.nodes.get('media').children[0].src, 'https://hansora.co/.netlify/functions/audio-download?preview=1&url=' + encodeURIComponent(tracks[1].audioUrl));
  card.nodes.get('media').children[0].listeners.error();
  assert.match(card.nodes.get('actionStatus').textContent, /preview could not load/);
  card.openResult(false);
  assert.equal(card.messages.at(-1).params.url, tracks[1].audioUrl);
});

test('card retains inline playback for archived audio and existing image results', () => {
  for (const [kind, extension, tag] of [['audio', 'mp3', 'audio'], ['image', 'png', 'img']]) {
    const card = cardHarness();
    const url = `https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/history/result.${extension}`;
    card.render({ kind, result_url: url, status: 'ready' });
    assert.equal(card.nodes.get('media').children[0].tag, tag);
    assert.equal(card.nodes.get('media').children[0].src, url);
    assert.equal(card.nodes.get('audioVersions').classList.contains('hidden'), true);
  }
});
