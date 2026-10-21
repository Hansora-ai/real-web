import catalog from '../hansora-catalog/catalog.cjs';
import seedancePricing from '../../public/seedance-pricing.js';
import wanPricing from '../../public/wan-pricing.js';

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
  henshin: '/.netlify/functions/run-henshin',
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
  'grok-video': { max_images: 1, durations: [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30], resolutions: ['720p', '1080p'], max_prompt_chars: 5000 },
  'gemini-omni-video': { max_images: 10, max_videos: 1, durations: [4, 6, 8, 10], resolutions: ['1080p', '4K'], max_video_seconds: 10 },
  'gemini-omni-flash-1-1': { max_images: 10, max_videos: 1, durations: [4, 6, 8, 10], resolutions: ['720p', '1080p', '4K'], max_video_seconds: 10 },
  'veo31-lite': { durations: [8], resolutions: ['720p', '1080p'], first_last_frames: true },
  'veo31-fast': { durations: [8], resolutions: ['1080p', '4K'], first_last_frames: true },
  veo31: { durations: [8], resolutions: ['1080p', '4K'], first_last_frames: true },
  seedance25: { durations: { min: 4, max: 30 }, resolutions: ['480p', '720p', '1080p'], first_last_frames: true, image_video_audio_references: true, max_video_total_seconds: 30, max_audio_total_seconds: 30 },
  seedance20: { durations: { min: 4, max: 15 }, resolutions: ['480p', '720p', '1080p', '4K'], first_last_frames: true, image_video_audio_references: true, max_video_total_seconds: 15, max_audio_total_seconds: 15 },
  'seedance20-mini': { durations: { min: 4, max: 15 }, resolutions: ['480p', '720p'], first_last_frames: true, image_video_audio_references: true },
  'wan27-video': { durations: [5, 10], resolutions: ['720p', '1080p'], first_last_frames: true, image_video_audio_references: true },
  henshin: { requires_video: true, max_images: 30, max_videos: 1, image_references: true, resolutions: ['480p', '720p', '1080p'], source_video_seconds: { min: 4, max: 30 } },
  'wan-3': { durations: { min: 2, max: 30 }, resolutions: ['480p', '720p', '1080p'], aspect_ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'], first_last_frames: true, image_video_audio_references: true, max_images: 10, max_videos: 5, max_audio: 5, max_prompt_chars: 20000, max_video_total_seconds: 15, max_audio_total_seconds: 15, max_input_plus_output_seconds: 30 },
  happyhorse10: { durations: [5, 10], resolutions: ['720p', '1080p'], first_frame: true, image_references: true },
  kling25: { durations: [5, 10], resolutions: ['1080p'], first_last_frames: true },
  kling26: { durations: [5, 10], resolutions: ['1080p'], sound: true, max_images: 1 },
  kling30: { durations: { min: 3, max: 15 }, resolutions: ['720p', '1080p', '4K'], sound: true, first_last_frames: true },
  'kling3-turbo': { durations: { min: 3, max: 15 }, resolutions: ['720p', '1080p'], max_images: 1 },
  'kling-motion-control': { requires_video: true, requires_image: true, resolutions: ['720p', '1080p'] },
  aleph: { requires_video: true, max_images: 1, durations: [5] }
});

// Henshin transforms a source video with reference images (people, objects or style) while keeping
// its camera, motion and timing. Price follows the source video length, measured on the server.
const HENSHIN_RATES = seedancePricing.henshinRates;
const HENSHIN_MODEL = Object.freeze({
  id: 'henshin',
  name: 'Henshin',
  category: 'video',
  provider: 'Hansora',
  description: 'Transform an existing video: put the person or character from the reference images into it (motion transfer), swap an object or product, or restyle it, while keeping the original camera, movement and timing. Needs one source video of 4–30 seconds plus reference images.',
  bestFor: ['putting a person or character into an existing video', 'replacing a product or object in a video', 'restyling a video while keeping its motion'],
  pricing: '175, 380 or 900 Hansora credits per 10 seconds of source video at 480p, 720p or 1080p (rounded up to whole seconds and whole displayed credits).',
  recommendation: 'Pass the source video and the reference images. Describe what to replace or change in the prompt; mention whether it is a person, an object or a style change.'
});

function henshinMode(prompt, imageCount) {
  const text = String(prompt || '').toLowerCase();
  if (!imageCount) return 'edit';
  if (/\b(person|people|character|man|woman|girl|boy|guy|face|me|myself|actor|dancer|avatar|influencer)\b/.test(text)) return 'motion';
  if (/\b(object|product|item|bottle|bag|logo|car|phone|can|cup|shoe|shoes|package|packaging|box|drink|watch)\b/.test(text)) return 'swap';
  if (/\b(style|restyle|color|colour|outfit|clothes|clothing|look)\b/.test(text)) return 'edit';
  return 'motion';
}

const WAN3_MODEL = Object.freeze({
  id: 'wan-3',
  name: 'Wan 3.0',
  category: 'video',
  provider: 'reAPI',
  description: 'Advanced video generation with first/last frames and image, video, or audio references.',
  pricing: '6 / 10 / 20 Hansora credits per billable second at 480p / 720p / 1080p. Billable seconds include all reference video seconds plus output seconds. Images, audio references and generated sound add no extra seconds. For video input, pass source_video_duration as the combined reference video duration; the server verifies it before charging.',
  bestFor: ['simple videos from 11 to 30 seconds at 720p', 'complex scenes at 1080p', 'image, video or audio references'],
  notBestFor: ['speech in languages other than English and Chinese', 'the very best quality for complex cinematic work (Seedance 2.5, then Seedance 2.0)'],
  recommendation: 'Default for simple videos from 11 to 30 seconds (720p) and an option for complex videos (1080p). See video_selection_guide.'
});

// Henshin's displayed credits for 10 seconds of source video, from the shared rate card.
function henshinPer10(resolution) {
  return seedancePricing.quote({ model: 'seedance25', resolution, inputSeconds: 10, edit: true }).displayedCredits;
}

// How ChatGPT should choose a video model. Returned with the model list and every video model.
export const VIDEO_SELECTION_GUIDE = [
  'Choosing a video model. Follow these steps in order.',
  '0. Spoken language. If people in the video must speak, check the language.',
  '   - English or Chinese: continue with the steps below.',
  '   - Any other language (Armenian, Russian, Italian and so on): only Veo 3.1 Lite (8 seconds), Gemini Omni Flash and Gemini Omni (up to 10 seconds) can speak it. Seedance, Wan 3.0, Kling and Grok cannot.',
  '     If the request fits in 10 seconds, use Veo 3.1 Lite or Gemini Omni Flash for simple videos and Gemini Omni for complex ones.',
  '     If the user wants it longer, do not generate yet. Tell the user that long videos cannot speak this language, and offer to split the speech into parts of up to 10 seconds, one video per part, with the price per part and the total. Start only after they agree.',
  '1. Length. Read how long the user wants the video. If they did not say, pick a fitting length.',
  '2. Meaning. Decide whether the request is simple or complex from what the user actually asked for, not from how long or detailed your own prompt is.',
  '   - Simple: one shot in one place with small motion, such as a person talking or reacting, a zoom, a pan or camera turn, animating a photo, or a product turning.',
  '   - Complex: a story or several shots, action or fights, dancing, several characters interacting, transformations or heavy effects, fast cinematic camera work, trailers or ads.',
  '   - If you are not sure, ask the user.',
  '3. Simple: generate directly, do not ask.',
  '   - Up to 8 seconds: Veo 3.1 Lite, 1080p.',
  '   - 9 to 10 seconds: Gemini Omni Flash, 1080p. If the exact person from the user\'s photo must stay identical, use Wan 3.0 with the photo as the first frame instead.',
  '   - 11 to 30 seconds: Wan 3.0, 720p.',
  '   - If the user\'s photo is a person or character to place into new scenes (not the starting picture), use a model that takes reference images: Gemini Omni Flash, 1080p, up to 10 seconds; Wan 3.0, 720p, for longer. Veo 3.1 Lite only uses a photo as the first frame.',
  '4. Complex: ask the user before generating, at any length. Show each option\'s model, its resolution in plain words and its credit price from quote_generation:',
  '   - Seedance 2.5, 720p (sharper): recommended, the best model for complex videos',
  '   - Seedance 2.5, 480p (good quality, lower price)',
  '   - Seedance 2.5, 1080p (sharpest, highest price): offer only when the user asks for 1080p or the best possible quality; never pick it on your own',
  '   - Seedance 2.0, 720p: very strong for complex scenes (up to 15 seconds only)',
  '   - Wan 3.0, 1080p: good for complex scenes',
  '5. Only offer options the user\'s balance covers. If the user says it does not matter, or asks you to choose, pick the first option that fits.',
  '6. If the user already named a model, quality or length, use it without asking (except step 12).',
  '7. Always tell the user the resolution of the video you start.',
  '8. Stay with the model. Once you have generated with a model in this conversation, keep using it and its resolution for the next videos. Do not switch on your own. Switch only if the user asks, or if the model cannot do what the next video needs (its length, its spoken language, or placing a reference person into a new scene). In that case tell the user why, name the other model and its price, and start only after they agree. After a temporary issue, follow the next_step of that result instead.',
  '9. Limits: Grok Video prompts must be at most 5000 characters (shorten longer prompts and keep the key details). Reference videos the user gives you, all together, may be at most: Wan 3.0 15 seconds, Seedance 2.0 15 seconds, Seedance 2.5 30 seconds; the same totals apply to reference audio. Gemini Omni uses only the first 10 seconds of a video. If the user\'s video or audio is longer, tell them before generating and offer to trim it or split the work into parts.',
  '10. If a model has current_status temporarily_unavailable, do not use it; use the backup named in its status_note and tell the user why.',
  '11. Reference videos: when the user gives a video only as a reference (a person, object, style or motion to follow, not a video to edit) and it is longer than about 10 seconds, give one short, friendly tip before generating: a short clip of just the part that matters usually gives a better and more affordable result. Keep it a tip only: do not explain how video length affects the price, do not show price comparisons, and if the user wants to keep their video, go ahead with it.',
  `12. Seedance 2.5 and Henshin: if the user wants one of these but did not say a quality, ask one short question before starting, with each quality's price. Seedance 2.5: 480p, 720p and 1080p, prices from quote_generation for their length. Henshin: the price follows their video's length, so give it per 10 seconds of video: 480p ${henshinPer10('480p')}, 720p ${henshinPer10('720p')}, 1080p ${henshinPer10('1080p')} credits. If they already said the quality, start without asking. For every other model, use the default quality without asking.`,
  '13. Sexual or NSFW requests: Hansora does not create them with any model. Do not submit them. Tell the user kindly that no model will make this, and offer a non-sexual version of their idea (romantic, playful or stylish) with a concrete suggestion.'
].join('\n');

function normalizedModelId(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'wan-3' || raw === 'wan-3.0' || raw === 'wan30') return 'wan-3';
  if (raw === 'henshin' || raw === 'hansora-henshin') return 'henshin';
  if (raw === 'text-to-speech' || raw === 'tts') return 'voice';
  if (raw === 'voice-isolation' || raw === 'voice-isolator') return 'isolation';
  if (raw === 'voice-changer' || raw === 'voice_change') return 'voice-change';
  if (raw === 'song' || raw === 'song-creation' || raw === 'suno') return 'music';
  if (AUDIO_MODELS[raw]) return raw;
  return normalizeModelId(raw);
}

// How each video model uses the images it is given. Frames-only models read images as first/last
// frame; models that also take references use them as references unless the assistant explicitly
// passes a frame (it does so only when the user asks for one); reference-only models never use
// frames; single-image models take one starting image.
const IMAGE_ROLES = Object.freeze({
  frames: ['kling25', 'kling30', 'veo31-lite', 'veo31-fast', 'veo31'],
  framesRefs: ['seedance25', 'seedance20', 'seedance20-mini', 'wan27-video', 'wan-3', 'happyhorse10'],
  refs: ['gemini-omni-video', 'gemini-omni-flash-1-1', 'henshin'],
  single: ['grok-video', 'kling26', 'kling3-turbo', 'kling-motion-control', 'aleph']
});
const IMAGE_HANDLING = Object.freeze({
  frames: 'Images become frames: one image is the first frame, two images are the first and last frame. This model has no reference images.',
  framesRefs: 'Images are reference images (@image1, @image2...) by default. Only when the user explicitly asks for an image to be the first or last frame of the video, pass that image as first_frame_url / last_frame_url instead.',
  refs: 'All images are reference images; this model has no first or last frame.',
  single: 'Uses one image as the starting image of the video; extra images are ignored.'
});

function imageRole(modelId) {
  return Object.keys(IMAGE_ROLES).find((role) => IMAGE_ROLES[role].includes(modelId)) || '';
}

function imageRoles(modelId, request, images) {
  const explicitFirst = first(request.first_frame_url);
  const explicitLast = first(request.last_frame_url);
  const role = imageRole(modelId);
  if (role === 'frames') {
    const start = explicitFirst || images[0] || '';
    return { firstFrame: start, lastFrame: explicitLast || images.find((url) => url !== start) || '', references: [] };
  }
  if (role === 'framesRefs') {
    if (explicitFirst || explicitLast) {
      return { firstFrame: explicitFirst, lastFrame: explicitLast, references: images.filter((url) => url !== explicitFirst && url !== explicitLast) };
    }
    return { firstFrame: '', lastFrame: '', references: images };
  }
  if (role === 'refs') {
    return { firstFrame: '', lastFrame: '', references: [...new Set([explicitFirst, ...images, explicitLast].filter(Boolean))] };
  }
  return { firstFrame: explicitFirst || images[0] || '', lastFrame: '', references: [] };
}

function publicModel(model) {
  const limits = MODEL_LIMITS[model.id] || {};
  return {
    ...model,
    ...(model.category === 'video' ? { video_selection_guide: VIDEO_SELECTION_GUIDE } : {}),
    ...(imageRole(model.id) ? { image_handling: IMAGE_HANDLING[imageRole(model.id)] } : {}),
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
    models.push(publicModel(WAN3_MODEL), publicModel(HENSHIN_MODEL));
  }
  return models;
}

export function getModel(modelId) {
  const id = normalizedModelId(modelId);
  if (id === 'wan-3') return publicModel(WAN3_MODEL);
  if (id === 'henshin') return publicModel(HENSHIN_MODEL);
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
  if (id === 'henshin') {
    // Without the source length the server measures the video and charges for its real duration.
    const seconds = Number(options.duration);
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('price_unavailable');
    const resolution = Object.hasOwn(HENSHIN_RATES, first(options.resolution).toLowerCase()) ? first(options.resolution).toLowerCase() : '720p';
    const internalCredits = seedancePricing.quote({model:'seedance25',resolution,inputSeconds:seconds,edit:true}).internalCredits;
    return {
      modelId: id,
      quantity: 1,
      settings: { duration: Math.ceil(seconds), resolution },
      internalCredits,
      displayedCredits: Number((internalCredits * CREDIT_DISPLAY_MULTIPLIER).toFixed(2)),
      displayMultiplier: CREDIT_DISPLAY_MULTIPLIER
    };
  }
  if (id === 'wan-3') {
    const quantity = Math.max(1, Math.min(50, Math.round(Number(options.quantity) || 1)));
    const duration = options.duration ?? 5;
    const resolution = first(options.resolution, '1080p').toLowerCase();
    if (options.has_video_input && options.source_video_duration == null) throw new Error('Wan 3.0 video quotes require source_video_duration (combined reference video seconds).');
    const unit = wanPricing.quote({resolution, duration, inputSeconds: options.has_video_input ? options.source_video_duration : 0});
    const internalCredits = Number((unit.internalCredits * quantity).toFixed(1));
    return {
      modelId: id,
      quantity,
      duration,
      resolution,
      inputSeconds: unit.inputSeconds,
      billedSeconds: unit.billedSeconds,
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
  const { firstFrame, lastFrame, references: referenceImages } = imageRoles(model.id, request, images);
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
      referenceImageUrls: referenceImages,
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
      reference_image_urls: referenceImages,
      reference_video_urls: explicitSourceVideo ? [explicitSourceVideo,...videos.filter((url) => url !== explicitSourceVideo)] : videos,
      reference_audio_urls: audios
    };
  }

  if (['gemini-omni-video', 'gemini-omni-flash-1-1'].includes(model.id)) {
    return {
      ...common,
      aspect_ratio: aspect,
      duration,
      resolution: resolution.toLowerCase() === '4k' ? '4k' : resolution,
      image_urls: referenceImages,
      video_url: sourceVideo || undefined,
      video_start: sourceVideo ? Math.max(0, Number(request.video_start) || 0) : undefined,
      video_end: sourceVideo ? Number(request.video_end) || duration : undefined,
      audio_ids: Array.isArray(request.audio_ids) ? request.audio_ids.map(String).slice(0, 10) : []
    };
  }

  if (model.id === 'henshin') {
    const henshinResolution = Object.hasOwn(HENSHIN_RATES, resolution.toLowerCase()) ? resolution.toLowerCase() : '720p';
    const sourceSeconds = Number(request.duration);
    return {
      run_id: runId,
      prompt,
      mode: henshinMode(prompt, images.length),
      video_url: sourceVideo,
      image_urls: referenceImages.slice(0, 30),
      resolution: henshinResolution,
      // The server measures the real length before charging; this only has to pass the 4-30 s check.
      source_video_duration: sourceSeconds >= 4 && sourceSeconds <= 30 ? sourceSeconds : 10,
      keep_audio: request.generate_audio !== true && request.sound !== true
    };
  }
  if (model.id === 'wan-3') {
    const explicitFirstFrame = first(request.first_frame_url);
    const explicitLastFrame = first(request.last_frame_url);
    if (explicitLastFrame && !explicitFirstFrame) throw new Error('last_frame_requires_first_frame');
    const videoRefs = explicitSourceVideo ? [explicitSourceVideo, ...videos.filter(url => url !== explicitSourceVideo)] : videos;
    if (explicitFirstFrame && (images.length || videoRefs.length || audios.length)) throw new Error('frames_cannot_mix_with_references');
    if (images.length > 10 || videoRefs.length > 5 || audios.length > 5) throw new Error('too_many_wan_references');
    const wanResolution = first(request.resolution, '1080p').toLowerCase();
    const price = !videoRefs.length || request.source_video_duration != null
      ? wanPricing.quote({resolution:wanResolution, duration, inputSeconds:videoRefs.length ? request.source_video_duration : 0}) : null;
    return {
      ...common,
      aspect_ratio: first(request.aspect_ratio, 'adaptive'),
      duration,
      resolution: wanResolution,
      audio: request.generate_audio !== false && request.sound !== false,
      prompt_extend: request.prompt_extend !== false,
      expected_credits: price?.displayedCredits,
      first_frame_url: explicitFirstFrame || undefined,
      last_frame_url: explicitLastFrame || undefined,
      reference_image_urls: images.slice(0, 10),
      reference_video_urls: videoRefs,
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
      image_url: firstFrame || undefined,
      image_urls: [firstFrame, lastFrame].filter(Boolean),
      reference_image_urls: referenceImages,
      reference_video_urls: sourceVideo ? videos.filter((url) => url !== sourceVideo) : videos,
      reference_audio_urls: audios,
      audio_url: audios[0] || undefined
    };
  }

  if (model.id === 'happyhorse10') return { ...common, aspect_ratio: aspect, duration, resolution, image_url: firstFrame || undefined, image_urls: firstFrame ? [firstFrame] : [], reference_image_urls: referenceImages, video_url: sourceVideo || undefined };
  if (model.id === 'grok-video') return { ...common, aspect_ratio: aspect, duration, resolution, mode: 'normal', image_url: firstFrame || undefined, image_urls: firstFrame ? [firstFrame] : [] };
  if (model.id === 'kling25') return { ...common, aspect_ratio: aspect, duration, image_url: firstFrame || undefined, tail_image_url: lastFrame || undefined };
  if (model.id === 'kling26') return { ...common, aspect_ratio: aspect, duration, sound: Boolean(request.sound), image_url: firstFrame || undefined };
  if (model.id === 'kling3-turbo') return { ...common, aspect_ratio: aspect, duration, resolution, image_url: firstFrame || undefined, image_urls: firstFrame ? [firstFrame] : [] };
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
      image_urls: [firstFrame, lastFrame].filter(Boolean)
    };
  }
  if (model.id === 'kling-motion-control') return { ...common, videoUrl: sourceVideo, imageUrl: firstFrame, resolution, mode: resolution, motionModel: first(request.motion_model, 'kling26'), duration_seconds: Math.max(1, Math.ceil(duration)) };
  if (model.id === 'aleph') return { ...common, videoUrl: sourceVideo, imageUrl: firstFrame, aspectRatio: aspect };

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
