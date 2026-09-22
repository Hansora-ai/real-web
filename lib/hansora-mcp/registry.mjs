import catalog from '../hansora-catalog/catalog.cjs';

const { CATALOG_VERSION, CREDIT_DISPLAY_MULTIPLIER, MODELS, normalizeModelId, quoteModel } = catalog;

const AUDIO_MODELS = Object.freeze({
  voice: {
    id: 'voice',
    name: 'Text to speech',
    category: 'audio',
    provider: 'ElevenLabs',
    description: 'Generate natural spoken dialogue from one or more text lines.',
    input: {
      common: ['dialogue', 'text', 'voice_id', 'language_code', 'stability'],
      note: 'Use dialogue for multiple speakers, or text and voice_id for one speaker. Call list_audio_voices to discover voice IDs.',
      pricing: '10 displayed credits per started 1,000 characters.'
    }
  },
  isolation: {
    id: 'isolation',
    name: 'Voice isolator',
    category: 'audio',
    provider: 'ElevenLabs',
    description: 'Remove background sound and isolate the voice in an audio recording.',
    input: {
      common: ['audio_url', 'audio_duration_seconds'],
      note: 'audio_url must be a public HTTPS URL to an MP3, WAV, M4A, AAC, OGG, or FLAC file.',
      pricing: '10 displayed credits per minute, rounded up to the next 30 seconds.'
    }
  },
  'voice-change': {
    id: 'voice-change',
    name: 'Voice changer',
    category: 'audio',
    provider: 'ElevenLabs',
    description: 'Transform uploaded speech into a selected voice while retaining the performance.',
    input: {
      common: ['audio_url', 'audio_duration_seconds', 'voice_id', 'remove_background_noise'],
      note: 'audio_url must be a public HTTPS audio URL. Call list_audio_voices to discover voice IDs.',
      pricing: '10 displayed credits per minute, rounded up to the next 30 seconds.'
    }
  },
  music: {
    id: 'music',
    name: 'Song creation',
    category: 'audio',
    provider: 'Suno',
    description: 'Create a song or instrumental track from a prompt, lyrics, and style controls.',
    input: {
      common: ['prompt', 'instrumental', 'style', 'title', 'vocal_gender', 'music_model'],
      note: 'Music uses custom mode. Provide a style and a prompt containing lyrics, a song idea, or an instrumental description.',
      pricing: '15 displayed credits per generation.'
    }
  }
});

const RUNNERS = Object.freeze({
  'wan-3': '/.netlify/functions/run-wan-3',
  'grok-video': '/.netlify/functions/run-grok-video',
  'gemini-omni-video': '/.netlify/functions/run-gemini-omni-video',
  'gemini-omni-flash-1-1': '/.netlify/functions/run-gemini-omni-flash-1-1',
  'veo31-lite': '/.netlify/functions/run-veo31',
  'veo31-fast': '/.netlify/functions/run-veo31',
  veo31: '/.netlify/functions/run-veo31',
  seedance25: '/.netlify/functions/run-seedance-25',
  kling25: '/.netlify/functions/run-kling',
  kling30: '/.netlify/functions/run-kling-30',
  'nano-banana-2-lite': '/.netlify/functions/run-nano-banana-2-lite',
  'nano-banana-2': '/.netlify/functions/run-nano-banana-2',
  'gpt-image-2-5': '/.netlify/functions/run-gpt-image-2-5',
  'seedream-5-pro': '/.netlify/functions/run-seedream-5-pro',
  'nano-banana': '/.netlify/functions/run-nano-banana',
  'nano-banana-pro': '/.netlify/functions/run-nano-banana-pro',
  'seedream-4-5': '/.netlify/functions/run-seedream-4-5',
  'gpt-image-1.5': '/.netlify/functions/run-gpt-image-1-5',
  'gpt-image-2': '/.netlify/functions/run-gpt-image-2',
  'seedream-5-lite': '/.netlify/functions/run-seedream-5-lite',
  'grok-image': '/.netlify/functions/run-grok-image',
  'wan-2-7-image': '/.netlify/functions/run-wan-2-7-image',
  'qwen-2': '/.netlify/functions/run-qwen-2',
  'z-image': '/.netlify/functions/run-z-image',
  seedance20: '/.netlify/functions/run-seedance-2',
  'seedance20-mini': '/.netlify/functions/run-seedance-2-mini',
  'wan27-video': '/.netlify/functions/run-wan-27-video',
  happyhorse10: '/.netlify/functions/run-happyhorse-1',
  kling26: '/.netlify/functions/run-kling-26',
  'kling3-turbo': '/.netlify/functions/run-kling-3-turbo',
  'kling-motion-control': '/.netlify/functions/run-kling-motion-control',
  aleph: '/.netlify/functions/run-aleph'
});

const MODEL_INPUTS = Object.freeze({
  image: {
    common: ['prompt', 'aspect_ratio', 'resolution', 'image_urls'],
    note: 'image_urls must be public HTTPS URLs. Models that do not support an option safely ignore it.'
  },
  video: {
    common: ['prompt', 'aspect_ratio', 'duration', 'resolution', 'first_frame_url', 'last_frame_url', 'image_urls', 'source_video_url', 'video_urls', 'audio_urls', 'sound', 'generate_audio'],
    note: 'All media inputs must be public HTTPS URLs. Use get_model before submitting to see model-specific controls.'
  }
});

const MODEL_LIMITS = Object.freeze({
  'nano-banana': { requires_image: true, max_images: 4, aspect_ratios: ['auto', '1:1', '3:4', '4:3', '9:16', '16:9'] },
  'nano-banana-pro': { max_images: 8, resolutions: ['1K', '2K', '4K'], aspect_ratios: ['1:1', '3:4', '4:3', '9:16', '16:9'] },
  'nano-banana-2': { max_images: 14, resolutions: ['1K', '2K', '4K'] },
  'nano-banana-2-lite': { max_images: 10, resolutions: ['1K'] },
  'gpt-image-1.5': { max_images: 3, aspect_ratios: ['1:1', '2:3', '3:2'] },
  'gpt-image-2-5': { max_images: 16, resolutions: ['1K', '2K', '4K'] },
  'gpt-image-2': { max_images: 4, resolutions: ['1K', '2K', '4K'] },
  'seedream-4-5': { max_images: 8 },
  'seedream-5-lite': { max_images: 8 },
  'seedream-5-pro': { max_images: 10, resolutions: ['1K', '2K'] },
  'grok-image': { max_images: 4, resolutions: ['720p'] },
  'wan-2-7-image': { max_images: 4, qualities: ['normal', 'pro'] },
  'qwen-2': { max_images: 4 },
  'z-image': { max_images: 0 },
  'grok-video': { max_images: 1, durations: [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30], resolutions: ['720p', '1080p'] },
  'gemini-omni-video': { max_images: 10, max_videos: 1, durations: [4, 6, 8, 10], resolutions: ['1080p', '4K'] },
  'gemini-omni-flash-1-1': { max_images: 10, max_videos: 1, durations: [4, 6, 8, 10], resolutions: ['720p', '1080p', '4K'] },
  'veo31-lite': { durations: [8], resolutions: ['720p', '1080p'], first_last_frames: true },
  'veo31-fast': { durations: [8], resolutions: ['1080p', '4K'], first_last_frames: true },
  veo31: { durations: [8], resolutions: ['1080p', '4K'], first_last_frames: true },
  seedance25: { durations: { min: 4, max: 30 }, resolutions: ['480p', '720p'], first_last_frames: true, image_video_audio_references: true },
  seedance20: { durations: { min: 4, max: 15 }, resolutions: ['720p', '1080p', '4K'], first_last_frames: true, image_video_audio_references: true },
  'seedance20-mini': { durations: { min: 4, max: 15 }, resolutions: ['480p', '720p'], first_last_frames: true, image_video_audio_references: true },
  'wan27-video': { durations: [5, 10], resolutions: ['720p', '1080p'], first_last_frames: true, image_video_audio_references: true },
  'wan-3': { durations: { min: 2, max: 30 }, resolutions: ['480p', '720p', '1080p'], aspect_ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'], first_last_frames: true, image_video_audio_references: true, max_images: 10, max_videos: 5, max_audio: 5 },
  happyhorse10: { durations: [5, 10], resolutions: ['720p', '1080p'], first_frame: true, image_references: true },
  kling25: { durations: [5, 10], resolutions: ['1080p'], first_last_frames: true },
  kling26: { durations: [5, 10], resolutions: ['1080p'], sound: true, max_images: 1 },
  kling30: { durations: { min: 3, max: 15 }, resolutions: ['720p', '1080p', '4K'], sound: true, first_last_frames: true },
  'kling3-turbo': { durations: { min: 3, max: 15 }, resolutions: ['720p', '1080p'], max_images: 1 },
  'kling-motion-control': { requires_video: true, requires_image: true, resolutions: ['720p', '1080p'] },
  aleph: { requires_video: true, max_images: 1, durations: [5] }
});

const WAN3_MODEL = Object.freeze({
  id: 'wan-3',
  name: 'Wan 3.0',
  category: 'video',
  provider: 'Kie AI',
  description: 'Advanced video generation with first/last frames and image, video, or audio references.'
});

function normalizedModelId(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'wan-3' || raw === 'wan-3.0' || raw === 'wan30') return 'wan-3';
  if (raw === 'text-to-speech' || raw === 'tts') return 'voice';
  if (raw === 'voice-isolation' || raw === 'voice-isolator') return 'isolation';
  if (raw === 'voice-changer' || raw === 'voice_change') return 'voice-change';
  if (raw === 'song' || raw === 'song-creation' || raw === 'suno') return 'music';
  if (AUDIO_MODELS[raw]) return raw;
  return normalizeModelId(raw);
}

function publicModel(model) {
  const limits = MODEL_LIMITS[model.id] || {};
  return {
    ...model,
    availability: RUNNERS[model.id] ? 'available' : 'unavailable',
    input: { ...(MODEL_INPUTS[model.category] || {}), ...limits }
  };
}

export function listModels({ category, includeUnavailable = true } = {}) {
  const normalizedCategory = String(category || '').trim().toLowerCase();
  const models = Object.values(MODELS)
    .map(publicModel)
    .filter((model) => !normalizedCategory || model.category === normalizedCategory);
  if (!normalizedCategory || normalizedCategory === 'audio') {
    models.push(...Object.values(AUDIO_MODELS).map((model) => ({ ...model, availability: 'available' })));
  }
  if (!normalizedCategory || normalizedCategory === 'video') {
    models.push(publicModel(WAN3_MODEL));
  }
  return models;
}

export function getModel(modelId) {
  const id = normalizedModelId(modelId);
  if (id === 'wan-3') return publicModel(WAN3_MODEL);
  if (AUDIO_MODELS[id]) return { ...AUDIO_MODELS[id], availability: 'available' };
  if (!id || !MODELS[id]) return null;
  return publicModel(MODELS[id]);
}

export function getRunner(modelId) {
  const id = normalizedModelId(modelId);
  return id ? RUNNERS[id] || '' : '';
}

export function quote(modelId, options = {}) {
  const id = normalizedModelId(modelId);
  if (id === 'wan-3') {
    const quantity = Math.max(1, Math.min(50, Math.round(Number(options.quantity) || 1)));
    const duration = Math.max(2, Math.min(30, Math.round(Number(options.duration) || 5)));
    const resolution = first(options.resolution, '1080p').toLowerCase();
    const rate = resolution === '480p' ? 0.6 : resolution === '720p' ? 1 : 2;
    const internalCredits = Number((duration * rate * quantity).toFixed(2));
    return {
      modelId: id,
      quantity,
      duration,
      resolution,
      internalCredits,
      displayedCredits: Number((internalCredits * CREDIT_DISPLAY_MULTIPLIER).toFixed(2)),
      displayMultiplier: CREDIT_DISPLAY_MULTIPLIER
    };
  }
  if (AUDIO_MODELS[id]) {
    const quantity = Math.max(1, Math.min(50, Math.round(Number(options.quantity) || 1)));
    let internalCredits;
    if (id === 'music') internalCredits = 1.5;
    else if (id === 'voice') internalCredits = Math.max(1, Math.ceil(Math.max(Number(options.character_count) || 1, 1) / 1000));
    else {
      const seconds = Math.max(0, Math.min(86400, Number(options.duration || options.audio_duration_seconds) || 0));
      internalCredits = seconds ? Math.max(0.5, Math.ceil((seconds / 60) * 2) / 2) : 1;
    }
    internalCredits *= quantity;
    return {
      modelId: id,
      quantity,
      internalCredits,
      displayedCredits: Number((internalCredits * CREDIT_DISPLAY_MULTIPLIER).toFixed(2)),
      displayMultiplier: CREDIT_DISPLAY_MULTIPLIER
    };
  }
  return quoteModel(id, options);
}

function cleanUrls(values, max = 30) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value || '').trim()).filter((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:';
    } catch {
      return false;
    }
  }).slice(0, max);
}

function first(value, fallback = '') {
  return String(value || fallback).trim();
}

export function buildGenerationPayload(modelId, request, userId, runId) {
  const model = getModel(modelId);
  if (!model) throw new Error('unsupported_model');
  if (model.availability !== 'available') throw new Error('model_not_available');

  const prompt = first(request.prompt);
  const aspect = first(request.aspect_ratio, model.category === 'image' ? '1:1' : '16:9');
  const resolution = first(request.resolution, model.category === 'image' ? '1K' : '720p');
  const duration = Number(request.duration) || (model.category === 'video' ? 5 : undefined);
  const images = cleanUrls(request.image_urls, 30);
  const videos = cleanUrls(request.video_urls, 10);
  const audios = cleanUrls(request.audio_urls, 5);
  const firstFrame = first(request.first_frame_url, images[0]);
  const lastFrame = first(request.last_frame_url);
  const explicitSourceVideo = first(request.source_video_url);
  const sourceVideo = explicitSourceVideo || videos[0] || '';
  const common = { uid: userId, user_id: userId, prompt, run_id: runId };

  if (!prompt && model.id !== 'kling-motion-control') throw new Error('prompt_required');
  if (model.input?.requires_image && !images.length && !firstFrame) throw new Error('image_required');
  if (model.input?.requires_video && !sourceVideo) throw new Error('video_required');

  if (model.category === 'image') {
    const body = {
      ...common,
      urls: images,
      input_urls: images,
      image_urls: images,
      format: 'png',
      output_format: 'png',
      aspect_ratio: aspect,
      size: aspect,
      resolution
    };
    if (model.id === 'wan-2-7-image') {
      body.quality = first(request.quality, 'normal');
      body.tier = body.quality;
      body.enable_sequential = true;
    }
    if (model.id === 'seedream-5-pro') body.quality = resolution.toUpperCase() === '2K' ? 'high' : 'basic';
    if (model.id === 'seedream-5-lite') body.quality = 'high';
    if (model.id === 'nano-banana-2') body.google_search = request.enable_web_search !== false;
    return body;
  }

  if (['veo31-lite', 'veo31-fast', 'veo31'].includes(model.id)) {
    return {
      ...common,
      aspectRatio: aspect,
      duration: 8,
      firstFrameUrl: firstFrame,
      lastFrameUrl: lastFrame,
      imageUrls: [firstFrame, lastFrame].filter(Boolean),
      referenceImageUrls: images.filter((url) => url !== firstFrame && url !== lastFrame),
      resolution,
      quality: resolution,
      imageUrl: '',
      model: model.id === 'veo31-lite' ? 'veo3_lite' : model.id === 'veo31-fast' ? 'veo3_fast' : 'veo3'
    };
  }

  if (['seedance25', 'seedance20', 'seedance20-mini'].includes(model.id)) {
    return {
      ...common,
      variant: model.id === 'seedance20-mini' ? 'mini' : 'standard',
      model: model.id === 'seedance20-mini' ? 'bytedance/seedance-2-mini' : undefined,
      aspect_ratio: model.id === 'seedance25' && (firstFrame || lastFrame || sourceVideo) ? 'adaptive' : aspect,
      duration,
      resolution,
      generate_audio: Boolean(request.generate_audio),
      enable_web_search: Boolean(request.enable_web_search),
      web_search: Boolean(request.enable_web_search),
      first_frame_url: firstFrame || undefined,
      last_frame_url: lastFrame || undefined,
      reference_image_urls: images.filter((url) => url !== firstFrame && url !== lastFrame),
      reference_video_urls: explicitSourceVideo ? videos.filter((url) => url !== explicitSourceVideo) : videos,
      reference_audio_urls: audios
    };
  }

  if (['gemini-omni-video', 'gemini-omni-flash-1-1'].includes(model.id)) {
    return {
      ...common,
      aspect_ratio: aspect,
      duration,
      resolution: resolution.toLowerCase() === '4k' ? '4k' : resolution,
      image_urls: images,
      video_url: sourceVideo || undefined,
      video_start: sourceVideo ? Math.max(0, Number(request.video_start) || 0) : undefined,
      video_end: sourceVideo ? Number(request.video_end) || duration : undefined,
      audio_ids: Array.isArray(request.audio_ids) ? request.audio_ids.map(String).slice(0, 10) : []
    };
  }

  if (model.id === 'wan-3') {
    const explicitFirstFrame = first(request.first_frame_url);
    const explicitLastFrame = first(request.last_frame_url);
    if (explicitLastFrame && !explicitFirstFrame) throw new Error('last_frame_requires_first_frame');
    if (explicitFirstFrame && (images.length || videos.length || audios.length)) throw new Error('frames_cannot_mix_with_references');
    return {
      ...common,
      aspect_ratio: first(request.aspect_ratio, 'adaptive'),
      duration: Math.max(2, Math.min(30, Math.round(duration))),
      resolution: ['480p', '720p', '1080p'].includes(resolution.toLowerCase()) ? resolution.toLowerCase() : '1080p',
      audio: request.generate_audio !== false && request.sound !== false,
      first_frame_url: explicitFirstFrame || undefined,
      last_frame_url: explicitLastFrame || undefined,
      reference_image_urls: images.slice(0, 10),
      reference_video_urls: videos.slice(0, 5),
      reference_audio_urls: audios.slice(0, 5)
    };
  }

  if (model.id === 'wan27-video') {
    return {
      ...common,
      aspect_ratio: aspect,
      duration,
      resolution,
      prompt_extend: request.prompt_extend !== false,
      watermark: false,
      first_frame_url: firstFrame || undefined,
      last_frame_url: lastFrame || undefined,
      video_url: sourceVideo || undefined,
      first_clip_url: sourceVideo || undefined,
      image_url: firstFrame || images[0] || undefined,
      image_urls: images,
      reference_image_urls: images.filter((url) => url !== firstFrame && url !== lastFrame),
      reference_video_urls: sourceVideo ? videos.filter((url) => url !== sourceVideo) : videos,
      reference_audio_urls: audios,
      audio_url: audios[0] || undefined
    };
  }

  if (model.id === 'happyhorse10') return { ...common, aspect_ratio: aspect, duration, resolution, image_url: firstFrame || images[0], image_urls: images, reference_image_urls: images, video_url: sourceVideo || undefined };
  if (model.id === 'grok-video') return { ...common, aspect_ratio: aspect, duration, resolution, mode: 'normal', image_url: images[0], image_urls: images.slice(0, 1) };
  if (model.id === 'kling25') return { ...common, aspect_ratio: aspect, duration, image_url: firstFrame || images[0], tail_image_url: lastFrame || images[1] };
  if (model.id === 'kling26') return { ...common, aspect_ratio: aspect, duration, sound: Boolean(request.sound), image_url: images[0] };
  if (model.id === 'kling3-turbo') return { ...common, aspect_ratio: aspect, duration, resolution, image_url: images[0], image_urls: images.slice(0, 1) };
  if (model.id === 'kling30') {
    return {
      ...common,
      aspect_ratio: aspect,
      duration,
      resolution,
      mode: resolution.toUpperCase() === '4K' ? '4K' : resolution === '1080p' ? 'pro' : 'std',
      sound: Boolean(request.sound),
      multi_shots: false,
      first_frame_url: firstFrame || undefined,
      last_frame_url: lastFrame || undefined,
      image_urls: [firstFrame, lastFrame].filter(Boolean),
      element_input_urls: images.filter((url) => url !== firstFrame && url !== lastFrame)
    };
  }
  if (model.id === 'kling-motion-control') return { ...common, videoUrl: sourceVideo, imageUrl: images[0], resolution, mode: resolution, motionModel: first(request.motion_model, 'kling26'), duration_seconds: Math.max(1, Math.ceil(duration)) };
  if (model.id === 'aleph') return { ...common, videoUrl: sourceVideo, imageUrl: images[0], aspectRatio: aspect };

  throw new Error('payload_adapter_unavailable');
}

function requiredHttpsUrl(value, field) {
  const raw = first(value);
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') throw new Error();
    return url.href;
  } catch {
    throw new Error(`${field}_must_be_public_https_url`);
  }
}

function audioFileDetails(url) {
  const pathname = new URL(url).pathname;
  const rawName = decodeURIComponent(pathname.split('/').pop() || 'audio.mp3');
  const fileName = rawName.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 90) || 'audio.mp3';
  const extension = (fileName.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
  const mime = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac' }[extension];
  if (!mime) throw new Error('unsupported_audio_file_type');
  return { fileName, fileType: mime };
}

export function buildAudioPayload(audioModelId, request, userId, runId) {
  const id = normalizedModelId(audioModelId);
  if (!AUDIO_MODELS[id]) throw new Error('unsupported_audio_tool');
  const common = { uid: userId, user_id: userId, run_id: runId, kind: id };

  if (id === 'voice') {
    const supplied = Array.isArray(request.dialogue) ? request.dialogue : [];
    const fallbackText = first(request.text || request.prompt);
    const fallbackVoice = first(request.voice_id, 'Rachel');
    const dialogue = (supplied.length ? supplied : fallbackText ? [{ text: fallbackText, voice: fallbackVoice }] : [])
      .map((item) => ({ text: first(item?.text).slice(0, 4200), voice: first(item?.voice || item?.voice_id, fallbackVoice) }))
      .filter((item) => item.text);
    if (!dialogue.length) throw new Error('text_required');
    return {
      ...common,
      dialogue,
      prompt: dialogue.map((item) => item.text).join('\n'),
      stability: Math.max(0, Math.min(1, Number(request.stability) || 0.5)),
      language_code: first(request.language_code)
    };
  }

  if (id === 'isolation' || id === 'voice-change') {
    const audioUrl = requiredHttpsUrl(request.audio_url, 'audio_url');
    const details = audioFileDetails(audioUrl);
    const payload = {
      ...common,
      audio_url: audioUrl,
      durationSeconds: Math.max(0, Math.min(86400, Number(request.audio_duration_seconds) || 0)),
      ...details,
      prompt: id === 'isolation' ? `Voice isolation: ${details.fileName}` : `Voice changer: ${details.fileName}`
    };
    if (id === 'voice-change') {
      payload.voice = first(request.voice_id);
      if (!payload.voice) throw new Error('voice_id_required');
      payload.remove_background_noise = request.remove_background_noise !== false;
    }
    return payload;
  }

  const prompt = first(request.prompt);
  const style = first(request.style);
  if (!prompt) throw new Error('prompt_required');
  if (!style) throw new Error('style_required');
  return {
    ...common,
    customMode: true,
    instrumental: Boolean(request.instrumental),
    model: first(request.music_model, 'V5_5'),
    title: first(request.title, 'SONG').slice(0, 80),
    style: style.slice(0, 1000),
    prompt: prompt.slice(0, 5000),
    vocalGender: first(request.vocal_gender).toLowerCase(),
    styleWeight: request.style_weight,
    weirdnessConstraint: request.weirdness_constraint,
    audioWeight: request.audio_weight
  };
}

export { CATALOG_VERSION, CREDIT_DISPLAY_MULTIPLIER };
