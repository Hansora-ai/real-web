'use strict';
const pricing = require('../../public/seedance-pricing.js');
function urls(body, key, alias) {
  const list = body[key] ?? body[alias] ?? [];
  if (!Array.isArray(list) || !list.every(x => typeof x === 'string' && /^https?:\/\//.test(x))) throw Error('Invalid reference URLs.');
  return list;
}
function build(body, version, { inputSeconds = 0, henshin = false } = {}) {
  const is25 = version === '2.5';
  const fast = !is25 && ['fast','lite'].includes(body.variant);
  const prompt = String(body.prompt || '').trim();
  const images = urls(body, 'reference_image_urls', 'image_urls');
  const videos = urls(body, 'reference_video_urls', 'video_urls');
  const audio = urls(body, 'reference_audio_urls', 'audio_urls');
  const first = body.first_frame_url, last = body.last_frame_url;
  const frames = [first && { url: first, role: 'first_frame' }, last && { url: last, role: 'last_frame' }].filter(Boolean);
  if (last && !first) throw Error('A last frame requires a first frame.');
  if (frames.some(f => typeof f.url !== 'string' || !/^https?:\/\//.test(f.url))) throw Error('Invalid frame URL.');
  if (frames.length && images.length) throw Error('Use frame images or reference images, not both.');
  if (!is25 && frames.length && (videos.length || audio.length)) throw Error('Seedance 2.0 frames cannot be combined with video or audio references.');
  if (!is25 && audio.length && !images.length && !videos.length) throw Error('Seedance 2.0 audio requires an image or video reference.');
  if (images.length + frames.length > (is25 ? 30 : 9) || videos.length > (is25 ? 10 : 3) || audio.length > (is25 ? 10 : 3)) throw Error('Too many Seedance references.');
  if (prompt.length > 20000 || ((!is25 || !(images.length || frames.length || videos.length || audio.length)) && prompt.length < 3)) throw Error('Use a prompt of 3–20,000 characters.');
  const edit = is25 && (henshin || (videos.length === 1 && Number(body.duration) === -1));
  if (edit && (videos.length !== 1 || inputSeconds < 4 || inputSeconds > 30)) throw Error('Video editing requires one source video of 4–30 seconds.');
  const quality = String(body.resolution || '720p').toLowerCase();
  const duration = edit ? -1 : Number(body.duration ?? 5);
  const size = frames.length || edit ? 'adaptive' : String(body.aspect_ratio || body.size || '16:9');
  if (!['16:9','9:16','1:1','4:3','3:4','21:9','adaptive'].includes(size)) throw Error('Unsupported aspect ratio.');
  const quote = pricing.quote({ model: is25 ? 'seedance25' : 'seedance20', variant: fast ? 'fast' : 'standard', resolution: quality, duration, inputSeconds, edit });
  return { quote, edit, payload: {
    model: is25 ? 'doubao-seedance-2.5-face' : (fast ? 'doubao-seedance-2.0-fast-face' : 'doubao-seedance-2.0-face'),
    prompt, resolution: quality, duration, size, generate_audio: body.generate_audio !== false,
    watermark: false, bitrate_mode: 'default', return_last_frame: !!body.return_last_frame, content_filter: true,
    ...(is25 ? { output_format: 'mp4', ...((images.length || frames.length || videos.length || audio.length) ? {omni_reference_task_type: edit ? 'edit' : 'reference'} : {}) } : {}),
    ...(frames.length ? { image_with_roles: frames } : images.length ? { image_urls: images } : {}),
    ...(videos.length ? { video_urls: videos } : {}), ...(audio.length ? { audio_urls: audio } : {}),
    ...((body.enable_web_search || body.web_search) ? { tools: [{type:'web_search'}] } : {})
  } };
}
module.exports = { build, urls };
