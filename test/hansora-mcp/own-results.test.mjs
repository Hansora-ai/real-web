import test from 'node:test';
import assert from 'node:assert/strict';
import { matchSavedFile, useSavedFiles } from '../../lib/hansora-mcp/own-results.mjs';

const base = 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/generation-history/';
const real = `${base}e2099428-36e4-4c4a-a42c-b1a8bb698d8a/2f89142f-99d4-8112-b105-b02b9cd39b23.png`;
const other = `${base}e2099428-36e4-4c4a-a42c-b1a8bb698d8a/7fcb8fd4-2e51-453c-94b4-149b494d0961.png`;

test('a Hansora link ChatGPT mistyped is replaced by the saved file it meant', async () => {
  // The real case from 31 Oct: two characters of the user id were dropped.
  const typed = `${base}e2099428-36e4-4c4a-a42c-b1a8bb698a/2f89142f-99d4-8112-b105-b02b9cd39b23.png`;
  assert.equal(matchSavedFile(typed, [other, real]), real);
  const result = await useSavedFiles({ model_id: 'veo31-lite', image_urls: [typed] }, async () => [other, real]);
  assert.deepEqual(result.input.image_urls, [real]);
  assert.deepEqual(result.fixed, [{ from: typed, to: real }]);
  assert.deepEqual(result.missing, []);
});

test('exact links, first frames and other sites stay as they are', async () => {
  const upload = 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/video/images/user-uploads/2026/10/31/baf7.png';
  let loads = 0;
  const none = await useSavedFiles({ image_urls: [upload, 'https://example.com/a.jpg'] }, async () => { loads += 1; return []; });
  assert.deepEqual(none.input.image_urls, [upload, 'https://example.com/a.jpg']);
  assert.equal(loads, 0, 'no lookup when no Hansora result link is used');
  const exact = await useSavedFiles({ first_frame_url: real }, async () => [other, real]);
  assert.equal(exact.input.first_frame_url, real);
  assert.deepEqual(exact.fixed, []);
});

test('a link that matches nothing, or matches two files equally, is reported, never guessed', async () => {
  const unrelated = `${base}aaaaaaaa-0000-4000-8000-000000000000/ffffffff-0000-4000-8000-000000000000.png`;
  const result = await useSavedFiles({ image_urls: [unrelated] }, async () => [real, other]);
  assert.deepEqual(result.missing, [unrelated]);
  const twins = [`${base}u/aaaa1.png`, `${base}u/aaaa2.png`];
  assert.equal(matchSavedFile(`${base}u/aaaa3.png`, twins), null);
});
