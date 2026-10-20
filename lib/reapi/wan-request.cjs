'use strict';
const pricing = require('../../public/wan-pricing.js');
const {urls} = require('./request.cjs');
function build(body, _version, {inputSeconds = 0} = {}) {
  const prompt = String(body.prompt || '').trim();
  if (!prompt || prompt.length > 20000) throw Error('Use a Wan 3.0 prompt of 1–20,000 characters.');
  const images = urls(body, 'reference_image_urls', 'image_urls');
  const videos = urls(body, 'reference_video_urls', 'video_urls');
  const audio = urls(body, 'reference_audio_urls', 'audio_urls');
  if (images.length > 10 || videos.length > 5 || audio.length > 5) throw Error('Wan 3.0 accepts up to 10 images, 5 videos and 5 audio references.');
  const first = body.first_frame_url, last = body.last_frame_url;
  if (last && !first) throw Error('A last frame requires a first frame.');
  const frames = [first && {url:first, role:'first_frame'}, last && {url:last, role:'last_frame'}].filter(Boolean);
  if (frames.some(frame => typeof frame.url !== 'string' || !/^https:\/\//.test(frame.url))) throw Error('Invalid frame URL.');
  if (frames.length && (images.length || videos.length || audio.length)) throw Error('First/last frames cannot be combined with reference images, videos, or audio.');
  const quality = String(body.resolution || '1080p').toLowerCase();
  const size = String(body.aspect_ratio || body.size || 'adaptive');
  if (!['adaptive','16:9','4:3','1:1','3:4','9:16'].includes(size)) throw Error('Unsupported Wan 3.0 aspect ratio.');
  const quote = pricing.quote({resolution:quality, duration:body.duration ?? 5, inputSeconds});
  const payload = {
    model:'wan3.0-video', prompt, resolution:quality.toUpperCase(), duration:quote.duration, size,
    audio:body.audio !== false && body.generate_audio !== false, content_filter:true,
    prompt_extend:body.prompt_extend !== false, watermark:false,
    ...(frames.length ? {image_with_roles:frames, generation_type:'frame'} : {}),
    ...(images.length ? {image_urls:images, generation_type:'reference'} : {}),
    ...(videos.length ? {video_urls:videos} : {}), ...(audio.length ? {audio_urls:audio} : {})
  };
  if (body.seed != null) {
    const seed = Number(body.seed);
    if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) throw Error('Invalid Wan 3.0 seed.');
    payload.seed = seed;
  }
  return {payload, quote, edit:false};
}
module.exports = {build};
