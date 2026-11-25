'use strict';
// MAGI-2 (reAPI, https://reapi.ai/docs/magi-2, checked 2026-11-25): three models on /videos/generations.
//   text-to-video       prompt required
//   image-to-video      image_urls = [first] or [first, last]
//   reference-to-video  up to 10 images, 5 videos, 5 audio clips (each 2–30 s, combined ≤ 30 s per kind)
// 1080p only, 4–30 s, six aspect ratios, generated audio by default. Billed per output second; references are free.
const pricing = require('../../public/magi-pricing.js');
const {urls} = require('./request.cjs');
const ASPECTS = ['16:9','9:16','1:1','4:3','3:4','21:9'];
function build(body) {
  const prompt = String(body.prompt || '').trim();
  if (prompt.length > 15000) throw Error('Use a MAGI-2 prompt of up to 15,000 characters.');
  const images = urls(body, 'reference_image_urls', 'image_urls');
  const videos = urls(body, 'reference_video_urls', 'video_urls');
  const audio = urls(body, 'reference_audio_urls', 'audio_urls');
  if (images.length > 10 || videos.length > 5 || audio.length > 5) throw Error('MAGI-2 accepts up to 10 images, 5 videos and 5 audio references.');
  const first = body.first_frame_url || null, last = body.last_frame_url || null;
  if (last && !first) throw Error('A last frame requires a first frame.');
  const frames = [first, last].filter(Boolean);
  if (frames.some(url => typeof url !== 'string' || !/^https:\/\//.test(url))) throw Error('Invalid frame URL.');
  if (frames.length && (images.length || videos.length || audio.length)) throw Error('MAGI-2 frames cannot be combined with reference images, videos or audio.');
  const references = images.length || videos.length || audio.length;
  if (!frames.length && !references && !prompt) throw Error('Enter a prompt for MAGI-2.');
  let aspect = String(body.aspect_ratio || body.size || '16:9');
  if (aspect === 'adaptive' || aspect === 'auto') aspect = '16:9';
  if (!ASPECTS.includes(aspect)) throw Error('Unsupported MAGI-2 aspect ratio.');
  const quote = pricing.quote({duration: body.duration ?? 5, resolution: body.resolution || '1080p'});
  const payload = {
    model: frames.length ? 'magi-2-image-to-video' : references ? 'magi-2-reference-to-video' : 'magi-2-text-to-video',
    ...(prompt ? {prompt} : {}), duration: quote.duration, quality: '1080p', aspect_ratio: aspect,
    generate_audio: body.generate_audio !== false && body.audio !== false,
    ...(frames.length ? {image_urls: frames} : {}),
    ...(images.length ? {image_urls: images} : {}), ...(videos.length ? {video_urls: videos} : {}), ...(audio.length ? {audio_urls: audio} : {})
  };
  if (body.seed != null) {
    const seed = Number(body.seed);
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw Error('Invalid MAGI-2 seed.');
    payload.seed = seed;
  }
  return {payload, quote, edit: false, media: {image_urls: images, video_urls: videos, audio_urls: audio}};
}
module.exports = {build, ASPECTS};
