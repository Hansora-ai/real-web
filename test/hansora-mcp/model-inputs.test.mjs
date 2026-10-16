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
  // One photo is a reference too, even if the host put it in first_frame_url.
  const single = buildGenerationPayload('seedance25', { prompt: 'make a trend video of this guy dancing', image_urls: [img('a')] }, 'u', 'r');
  assert.equal(single.first_frame_url, undefined);
  assert.deepEqual(single.reference_image_urls, [img('a')]);
  const hostFrame = buildGenerationPayload('seedance25', { prompt: 'dancing video', first_frame_url: img('a') }, 'u', 'r');
  assert.equal(hostFrame.first_frame_url, undefined);
  assert.deepEqual(hostFrame.reference_image_urls, [img('a')]);
  // Frames only when the request asks for them.
  const asked = buildGenerationPayload('seedance25', { prompt: 'Use this photo as the first frame and animate it', image_urls: [img('a')] }, 'u', 'r');
  assert.deepEqual([asked.first_frame_url, asked.reference_image_urls], [img('a'), []]);
  const both = buildGenerationPayload('seedance20', { prompt: 'Start frame is image 1, end frame is image 2', first_frame_url: img('a'), last_frame_url: img('b') }, 'u', 'r');
  assert.deepEqual([both.first_frame_url, both.last_frame_url], [img('a'), img('b')]);
  const russian = buildGenerationPayload('seedance20-mini', { prompt: 'Сделай это фото первый кадр видео', image_urls: [img('a')] }, 'u', 'r');
  assert.equal(russian.first_frame_url, img('a'));
  assert.equal(buildGenerationPayload('seedance25', { prompt: 'Usa questa foto come primo fotogramma', image_urls: [img('a')] }, 'u', 'r').first_frame_url, img('a'));
  assert.equal(buildGenerationPayload('seedance25', { prompt: 'Այս նկարը դարձրու առաջին կադր', image_urls: [img('a')] }, 'u', 'r').first_frame_url, img('a'));
  assert.match(getModel('seedance25').image_handling, /Whatever language the user writes in/);
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
