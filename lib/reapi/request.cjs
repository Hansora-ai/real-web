'use strict';
const pricing = require('../../public/seedance-pricing.js');
function urls(body, key, alias) {
  const list = body[key] ?? body[alias] ?? [];
  if (!Array.isArray(list) || !list.every(x => typeof x === 'string' && /^https?:\/\//.test(x))) throw Error('Invalid reference URLs.');
  return list;
}
// Seedance 2.5 Flash (reAPI model seedance-2-5-flash, docs checked 2026-11-18): a separate model with a content-block
// request body. 480p/720p, 4-30 s, up to 10 images, 5 videos and 5 audio clips; frames are not mixed with references.
// It has no draft mode, web search, watermark or last-frame options, and unknown fields can fail the task, so only
// documented fields are sent.
const FLASH_MODEL = 'seedance-2-5-flash';
function buildFlash(body, { inputSeconds = 0, henshin = false } = {}) {
  if (henshin) throw Error('Henshin does not use Seedance 2.5 Flash.');
  const prompt = String(body.prompt || '').trim();
  const images = urls(body, 'reference_image_urls', 'image_urls');
  const videos = urls(body, 'reference_video_urls', 'video_urls');
  const audio = urls(body, 'reference_audio_urls', 'audio_urls');
  const first = body.first_frame_url, last = body.last_frame_url;
  const frames = [first && { url: first, role: 'first_frame' }, last && { url: last, role: 'last_frame' }].filter(Boolean);
  if (last && !first) throw Error('A last frame requires a first frame.');
  if (frames.some(f => typeof f.url !== 'string' || !/^https?:\/\//.test(f.url))) throw Error('Invalid frame URL.');
  if (frames.length && (images.length || videos.length || audio.length)) throw Error('Seedance 2.5 Flash frames cannot be combined with reference images, videos or audio.');
  if (images.length > 10 || videos.length > 5 || audio.length > 5) throw Error('Seedance 2.5 Flash accepts up to 10 images, 5 videos and 5 audio references.');
  if (!prompt || prompt.length > 20000) throw Error('Use a prompt of 1–20,000 characters.');
  if (body.draft === true) throw Error('Seedance 2.5 Flash has no draft mode.');
  const edit = videos.length === 1 && Number(body.duration) === -1;
  if (edit && (inputSeconds < 4 || inputSeconds > 30)) throw Error('Video editing requires one source video of 4–30 seconds.');
  const quality = String(body.resolution || '720p').toLowerCase();
  if (!['480p', '720p'].includes(quality)) throw Error('Seedance 2.5 Flash makes 480p or 720p videos.');
  const duration = edit ? -1 : Number(body.duration ?? 5);
  let ratio = String(body.aspect_ratio || body.size || '16:9');
  if (frames.length || edit) ratio = 'adaptive';
  else if (ratio === 'adaptive') ratio = '16:9';
  if (!['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'].includes(ratio)) throw Error('Unsupported aspect ratio.');
  const quote = pricing.quote({ model: 'seedance25', variant: 'flash', resolution: quality, duration, inputSeconds, edit });
  const block = (type, url, role) => ({ type, [type]: { url }, role });
  const content = [
    { type: 'text', text: prompt },
    ...frames.map(f => block('image_url', f.url, f.role)),
    ...images.map(url => block('image_url', url, 'reference_image')),
    ...videos.map(url => block('video_url', url, 'reference_video')),
    ...audio.map(url => block('audio_url', url, 'reference_audio'))
  ];
  return { quote, edit, media: { video_urls: videos, image_urls: images, audio_urls: audio }, payload: {
    model: FLASH_MODEL, content, resolution: quality, duration, ratio,
    generate_audio: body.generate_audio !== false, omni_reference_task_type: edit ? 'edit' : 'generate', content_filter: true
  } };
}
function build(body, version, { inputSeconds = 0, henshin = false } = {}) {
  if (version === '2.5' && body.variant === 'flash') return buildFlash(body, { inputSeconds, henshin });
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
  const draft = body.draft === true;
  if (draft && (!is25 || henshin || quality !== '480p' || prompt.length < 3)) throw Error('Drafts require Seedance 2.5, 480p, and a prompt of 3–20,000 characters.');
  const duration = edit ? -1 : Number(body.duration ?? 5);
  const size = frames.length || edit ? 'adaptive' : String(body.aspect_ratio || body.size || '16:9');
  if (!['16:9','9:16','1:1','4:3','3:4','21:9','adaptive'].includes(size)) throw Error('Unsupported aspect ratio.');
  const quote = pricing.quote({ model: is25 ? 'seedance25' : 'seedance20', variant: fast ? 'fast' : 'standard', resolution: quality, duration, inputSeconds, edit });
  return { quote, edit, payload: {
    model: is25 ? 'doubao-seedance-2.5-face' : (fast ? 'doubao-seedance-2.0-fast-face' : 'doubao-seedance-2.0-face'),
    prompt, resolution: quality, duration, size, generate_audio: body.generate_audio !== false,
    watermark: false, bitrate_mode: 'default', return_last_frame: !!body.return_last_frame, content_filter: true,
    ...(draft ? { draft: true, return_last_frame: false } : {}),
    ...(is25 ? { output_format: 'mp4', ...((images.length || frames.length || videos.length || audio.length) ? {omni_reference_task_type: edit ? 'edit' : 'reference'} : {}) } : {}),
    ...(frames.length ? { image_with_roles: frames } : images.length ? { image_urls: images } : {}),
    ...(videos.length ? { video_urls: videos } : {}), ...(audio.length ? { audio_urls: audio } : {}),
    ...((body.enable_web_search || body.web_search) ? { tools: [{type:'web_search'}] } : {})
  } };
}
module.exports = { build, urls, FLASH_MODEL };
