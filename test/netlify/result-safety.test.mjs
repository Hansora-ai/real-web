import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const { checkResults } = createRequire(import.meta.url)('../../lib/content-safety/result-check.cjs');
const reply = (sexual, minors = false) => async () => ({ ok: true, json: async () => ({ results: [{ categories: { sexual: sexual > 0.5, 'sexual/minors': minors }, category_scores: { sexual } }] }) });

test('a suggestive result image is blocked, a normal one passes, videos are not sent', async () => {
  process.env.OPENAI_API_KEY = 'test';
  assert.equal((await checkResults(['https://x/a.png'], 'image', reply(0.7))).blocked, true);
  assert.equal((await checkResults(['https://x/a.png'], 'image', reply(0.1))).blocked, false);
  assert.equal((await checkResults(['https://x/a.png'], 'image', reply(0.1, true))).category, 'sexual_content_involving_minors');
  let called = false;
  assert.equal((await checkResults(['https://x/a.mp4'], 'video', async () => { called = true; })).checked, 0);
  assert.equal(called, false);
});

test('if moderation is unreachable the result is allowed (generations never hang on it)', async () => {
  process.env.OPENAI_API_KEY = 'test';
  const result = await checkResults(['https://x/a.png'], 'image', async () => { throw new Error('down'); });
  assert.equal(result.blocked, false);
});
