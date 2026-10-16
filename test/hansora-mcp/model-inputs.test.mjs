import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGenerationPayload, getModel, getRunner, quote } from '../../lib/hansora-mcp/registry.mjs';
import { optionsWithinBalance } from '../../lib/hansora-mcp/credits.mjs';

const img = (name) => `https://s.test/${name}.png`;

test('several images for Seedance are sent as references, not a first frame', () => {
  const tagged = buildGenerationPayload('seedance25', { prompt: '@image1 eats @image3 next to @image2', image_urls: [img('a'), img('b'), img('c')] }, 'u', 'r');
  assert.equal(tagged.first_frame_url, undefined);
  assert.deepEqual(tagged.reference_image_urls, [img('a'), img('b'), img('c')]);
  const explicit = buildGenerationPayload('seedance25', { prompt: '@image1 with @image2', first_frame_url: img('a'), image_urls: [img('b')] }, 'u', 'r');
  assert.deepEqual(explicit.reference_image_urls, [img('a'), img('b')]);
  const single = buildGenerationPayload('seedance25', { prompt: 'animate this photo', image_urls: [img('a')] }, 'u', 'r');
  assert.equal(single.first_frame_url, img('a'));
  const frames = buildGenerationPayload('seedance20', { prompt: 'go', first_frame_url: img('a'), last_frame_url: img('b') }, 'u', 'r');
  assert.deepEqual([frames.first_frame_url, frames.last_frame_url], [img('a'), img('b')]);
});

test('Henshin is available through create_generation with the website price', () => {
  assert.equal(getModel('henshin').name, 'Henshin');
  assert.equal(getRunner('henshin'), '/.netlify/functions/run-henshin');
  const payload = buildGenerationPayload('henshin', { prompt: 'replace the bottle with my product', video_urls: ['https://s.test/v.mp4'], image_urls: [img('p')] }, 'u', 'u-mcp-1');
  assert.deepEqual([payload.mode, payload.video_url, payload.resolution, payload.keep_audio], ['swap', 'https://s.test/v.mp4', '720p', true]);
  assert.equal(buildGenerationPayload('henshin', { prompt: 'put her into this dance', video_urls: ['https://s.test/v.mp4'], image_urls: [img('w')] }, 'u', 'r').mode, 'motion');
  assert.equal(quote('henshin', { duration: 7.2, resolution: '480p' }).displayedCredits, 160);
  assert.throws(() => buildGenerationPayload('henshin', { prompt: 'x', image_urls: [img('p')] }, 'u', 'r'), /video_required/);
});

test('cheaper options never suggest clips shorter than 5 seconds', () => {
  const options = optionsWithinBalance('kling30', { prompt: 'x' }, 3, 10);
  assert.ok(options.length > 0);
  for (const option of options) assert.ok(!(option.settings.duration < 5), `${option.model_name} ${option.settings.duration}s`);
});
