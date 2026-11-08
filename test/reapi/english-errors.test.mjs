import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { englishMessage, imageState } = require('../../lib/reapi/client.cjs');
const { classifyFailure } = await import('../../lib/hansora-mcp/failures.mjs');

test('Chinese safety-filter messages become English and sort as content refusals', () => {
  for (const raw of [
    '非常抱歉，该提示可能违反了关于裸露、色情或情色内容的防护限制。如果你认为此判断有误，请重试或修改提示语。',
    '非常抱歉，生成的图片可能违反了我们的内容政策。如果你认为此判断有误，请重试或修改提示语。'
  ]) {
    const text = englishMessage(raw, 'Generation failed.');
    assert.doesNotMatch(text, /[㐀-鿿]/);
    assert.match(text, /safety filter/);
    assert.equal(classifyFailure({ error: text }), 'content');
  }
});

test('other Chinese messages become a plain English provider error', () => {
  const text = englishMessage('服务器繁忙，请稍后再试', 'Generation failed.');
  assert.equal(text, 'Generation failed at the provider. Please try again later.');
  assert.equal(classifyFailure({ error: text }), 'temporary');
});

test('English messages and empty messages are unchanged or fall back', () => {
  assert.equal(englishMessage('The input or output was flagged as sensitive.', 'x'), 'The input or output was flagged as sensitive.');
  assert.equal(englishMessage('', 'Generation failed.'), 'Generation failed.');
  assert.equal(englishMessage(undefined, 'Generation failed.'), 'Generation failed.');
});

test('imageState returns the English message for a failed GPT Image 2.6 task', async () => {
  const realFetch = globalThis.fetch;
  process.env.REAPI_API_KEY = 'test-key';
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ id: 'task_1', status: 'failed', error: { message: '非常抱歉，生成的图片可能违反了我们的内容政策。', code: 'content_policy' } }) });
  try {
    const state = await imageState('task_1');
    assert.equal(state.failed, true);
    assert.match(state.error, /safety filter/);
    assert.equal(state.code, 'content_policy');
  } finally {
    globalThis.fetch = realFetch;
  }
});
