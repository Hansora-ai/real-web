import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGenerationPayload, getModel, getRunner, quote } from '../../lib/hansora-mcp/registry.mjs';
import { optionsWithinBalance } from '../../lib/hansora-mcp/credits.mjs';

const img = (name) => `https://s.test/${name}.png`;

test('several images for Seedance are sent as references, not a first frame', () => {
  const tagged = buildGenerationPayload('seedance25', { prompt: '@image1 eats @image3 next to @image2', image_urls: [img('a'), img('b'), img('c')] }, 'u', 'r');
  assert.equal(tagged.first_frame_url, undefined);
  assert.deepEqual(tagged.reference_image_urls, [img('a'), img('b'), img('c')]);
  const explicit = buildGenerationPayload('seedance25', { prompt: 'start on this shot', first_frame_url: img('a'), image_urls: [img('b')] }, 'u', 'r');
  assert.equal(explicit.first_frame_url, img('a'));
  // A single photo is a reference too; frames only when the assistant sets them.
  const single = buildGenerationPayload('seedance25', { prompt: 'make a trend video of this guy dancing', image_urls: [img('a')] }, 'u', 'r');
  assert.equal(single.first_frame_url, undefined);
  assert.deepEqual(single.reference_image_urls, [img('a')]);
  const frame = buildGenerationPayload('seedance25', { prompt: 'Usa questa foto come primo fotogramma', first_frame_url: img('a') }, 'u', 'r');
  assert.deepEqual([frame.first_frame_url, frame.reference_image_urls], [img('a'), []]);
  const both = buildGenerationPayload('seedance20', { prompt: 'go', first_frame_url: img('a'), last_frame_url: img('b') }, 'u', 'r');
  assert.deepEqual([both.first_frame_url, both.last_frame_url], [img('a'), img('b')]);
  assert.match(getModel('seedance25').image_handling, /Only when the user explicitly asks/);
});

test('Henshin is available through create_generation with the website price', () => {
  assert.equal(getModel('henshin').name, 'Henshin');
  assert.equal(getRunner('henshin'), '/.netlify/functions/run-henshin');
  const payload = buildGenerationPayload('henshin', { prompt: 'replace the bottle with my product', video_urls: ['https://s.test/v.mp4'], image_urls: [img('p')] }, 'u', 'u-mcp-1');
  assert.deepEqual([payload.mode, payload.video_url, payload.resolution, payload.keep_audio], ['swap', 'https://s.test/v.mp4', '720p', true]);
  assert.equal(buildGenerationPayload('henshin', { prompt: 'put her into this dance', video_urls: ['https://s.test/v.mp4'], image_urls: [img('w')] }, 'u', 'r').mode, 'motion');
  assert.equal(quote('henshin', { duration: 7.2, resolution: '480p' }).displayedCredits, 140);
  assert.throws(() => buildGenerationPayload('henshin', { prompt: 'x', image_urls: [img('p')] }, 'u', 'r'), /video_required/);
});

test('cheaper options never suggest clips shorter than 5 seconds', () => {
  const options = optionsWithinBalance('kling30', { prompt: 'x' }, 3, 10);
  assert.ok(options.length > 0);
  for (const option of options) assert.ok(!(option.settings.duration < 5), `${option.model_name} ${option.settings.duration}s`);
});

test('every video model uses images by its kind: frames, frames + references, references, or one image', () => {
  const build = (id, request) => buildGenerationPayload(id, { prompt: 'p', ...request }, 'u', 'r');
  // Frames only: one image is the first frame, two are first and last.
  assert.deepEqual([build('kling25', { image_urls: [img('a')] }).image_url, build('kling25', { image_urls: [img('a')] }).tail_image_url], [img('a'), undefined]);
  const kling = build('kling25', { image_urls: [img('a'), img('b')] });
  assert.deepEqual([kling.image_url, kling.tail_image_url], [img('a'), img('b')]);
  const kling30 = build('kling30', { image_urls: [img('a'), img('b')] });
  assert.deepEqual([kling30.first_frame_url, kling30.last_frame_url], [img('a'), img('b')]);
  const veo = build('veo31-lite', { image_urls: [img('a'), img('b')] });
  assert.deepEqual([veo.firstFrameUrl, veo.lastFrameUrl, veo.referenceImageUrls], [img('a'), img('b'), []]);
  // Frames + references: references unless a frame is passed explicitly.
  for (const id of ['seedance25', 'wan27-video', 'happyhorse10', 'wan-3']) {
    const one = build(id, { image_urls: [img('a')] });
    assert.equal(one.first_frame_url, undefined, id);
    assert.deepEqual(one.reference_image_urls, [img('a')], id);
  }
  const wanFrames = build('wan27-video', { first_frame_url: img('a'), last_frame_url: img('b') });
  assert.deepEqual([wanFrames.first_frame_url, wanFrames.last_frame_url, wanFrames.reference_image_urls], [img('a'), img('b'), []]);
  const horseFrame = build('happyhorse10', { first_frame_url: img('a') });
  assert.deepEqual([horseFrame.image_urls, horseFrame.reference_image_urls], [[img('a')], []]);
  // References only: a frame passed by the host is still a reference.
  assert.deepEqual(build('gemini-omni-video', { first_frame_url: img('a'), image_urls: [img('b')] }).image_urls, [img('a'), img('b')]);
  // One image: the first one is the starting image.
  assert.deepEqual(build('grok-video', { image_urls: [img('a'), img('b')] }).image_urls, [img('a')]);
  assert.equal(build('kling26', { image_urls: [img('a'), img('b')] }).image_url, img('a'));
  // ChatGPT is told the rule for each kind.
  assert.match(getModel('kling25').image_handling, /two images are the first and last frame/);
  assert.match(getModel('wan27-video').image_handling, /reference images .* by default/);
  assert.match(getModel('gemini-omni-flash-1-1').image_handling, /no first or last frame/);
  assert.match(getModel('kling26').image_handling, /one image/);
});

test('Wan MCP quotes, explicit source clips and all reference types match the website pricing',()=>{
 assert.equal(getModel('wan-3').provider,'reAPI');assert.equal(getModel('wan-3').input.max_prompt_chars,20000);
 assert.equal(quote('wan-3',{duration:10,resolution:'480p'}).displayedCredits,60);
 assert.equal(quote('wan-3',{duration:10,resolution:'720p',has_video_input:true,source_video_duration:5}).displayedCredits,150);
 assert.throws(()=>quote('wan-3',{has_video_input:true}),/source_video_duration/);
 const request={prompt:'Follow Video 1 with Image 1 and Audio 1',source_video_url:'https://s.test/a.mp4',video_urls:['https://s.test/a.mp4','https://s.test/b.mp4'],audio_urls:['https://s.test/a.mp3'],image_urls:[img('a')],duration:10,resolution:'720p',source_video_duration:5,generate_audio:false,prompt_extend:false};
 const payload=buildGenerationPayload('wan-3',request,'u','r');
 assert.deepEqual(payload.reference_video_urls,request.video_urls);assert.deepEqual(payload.reference_audio_urls,request.audio_urls);assert.equal(payload.expected_credits,150);assert.equal(payload.audio,false);assert.equal(payload.prompt_extend,false);
 const bare=buildGenerationPayload('wan-3',{prompt:'Text only'},'u','r');assert.equal(bare.resolution,'1080p');assert.equal(bare.expected_credits,quote('wan-3').displayedCredits);
 assert.throws(()=>buildGenerationPayload('wan-3',{...request,first_frame_url:img('first')},'u','r'),/frames_cannot_mix/);
});
