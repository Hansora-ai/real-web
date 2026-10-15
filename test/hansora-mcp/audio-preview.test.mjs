import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function loadHandler(t) {
  const path = require.resolve('../../netlify/functions/audio-download.js');
  const previous = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET: process.env.SUPABASE_BUCKET };
  Object.assign(process.env, { SUPABASE_URL:'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY:'test-only', SUPABASE_BUCKET:'downloads' });
  delete require.cache[path];
  const { handler } = require(path);
  t.after(() => { delete require.cache[path]; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  return handler;
}
const event = (url, preview = true) => ({ httpMethod:'GET', queryStringParameters:{ url, ...(preview ? { preview:'1' } : {}) } });

test('preview caches provider audio and redirects to allowed storage without forcing download', async (t) => {
  const handler = loadHandler(t); const calls = [];
  const bytes = new Uint8Array([73, 68, 51, 1, 2]);
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push({ url, options });
    return options.method === 'POST' ? new Response(null, {status:200}) : new Response(bytes, { headers:{ 'content-type':'audio/mpeg' } });
  });
  const source = 'https://tempfile.aiquickdraw.com/r/song.mp3';
  const result = await handler(event(source));
  assert.equal(result.statusCode, 302);
  const location = new URL(result.headers.Location);
  assert.equal(location.origin, 'https://project.supabase.co');
  assert.match(location.pathname, /storage\/v1\/object\/public\/downloads/);
  assert.equal(location.searchParams.has('download'), false);
  assert.deepEqual(new Uint8Array(calls[1].options.body), bytes);
  const download = await handler(event(source, false));
  assert.equal(new URL(download.headers.Location).searchParams.has('download'), true);
});

test('preview strips attachment mode for existing project storage audio', async (t) => {
  const handler = loadHandler(t);
  t.mock.method(globalThis, 'fetch', () => { throw new Error('existing storage should not be copied'); });
  const result = await handler(event('https://project.supabase.co/storage/v1/object/public/audio/song.mp3?download=song.mp3'));
  assert.equal(result.statusCode, 302);
  assert.equal(new URL(result.headers.Location).searchParams.has('download'), false);
});

test('preview errors never redirect to a provider blocked by the widget CSP', async (t) => {
  const handler = loadHandler(t);
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => options.method === 'POST' ? new Response(null, { status:500 }) : new Response('audio', { headers:{ 'content-type':'audio/mpeg' } }));
  const failed = await handler(event('https://tempfile.aiquickdraw.com/r/song.mp3'));
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.headers.Location, undefined);
  const blocked = await handler(event('https://untrusted.example/song.mp3'));
  assert.equal(blocked.statusCode, 400);
  assert.equal(blocked.headers.Location, undefined);
});
