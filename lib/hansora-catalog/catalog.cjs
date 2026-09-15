'use strict';

const CATALOG_VERSION = '2026-09-15.2';
const CREDIT_DISPLAY_MULTIPLIER = 10;

const MODELS = Object.freeze({
  'grok-video': {
    id: 'grok-video',
    name: 'Grok Video',
    category: 'video',
    route: 'grok-video',
    bestFor: ['affordable short videos', 'frequent social content', 'testing ideas with lower credit risk'],
    notBestFor: ['the most complex cinematic direction', 'Armenian speech as a primary requirement'],
    recommendation: 'Use as the default affordable and commonly used Hansora video option.'
  },
  'gemini-omni-video': {
    id: 'gemini-omni-video',
    name: 'Gemini Omni',
    category: 'video',
    route: 'gemini-omni-video',
    bestFor: ['Armenian-speaking video', 'cinematic or complex work', 'video with integrated voice'],
    notBestFor: ['the lowest-cost experimentation'],
    recommendation: 'Prefer when Armenian speech or a complex multimodal result matters.'
  },
  'gemini-omni-flash-1-1': {
    id: 'gemini-omni-flash-1-1',
    name: 'Gemini Omni 1.1 Flash',
    category: 'video',
    route: 'gemini-omni-flash-1-1',
    bestFor: ['faster Armenian-speaking video', 'short multimodal videos'],
    notBestFor: ['the highest-complexity cinematic work'],
    recommendation: 'Use as the faster Gemini Omni option when speed matters.'
  },
  'veo31-lite': {
    id: 'veo31-lite',
    name: 'Veo 3.1 Lite',
    category: 'video',
    route: 'veo31-lite',
    bestFor: ['Armenian-speaking video', 'affordable Veo output', 'eight-second social videos'],
    notBestFor: ['long variable-duration clips'],
    recommendation: 'Use for an affordable Veo-based Armenian-speaking clip.'
  },
  'veo31-fast': {
    id: 'veo31-fast',
    name: 'Veo 3.1 Fast',
    category: 'video',
    route: 'veo31-fast',
    bestFor: ['Armenian-speaking video', 'fast high-quality eight-second video'],
    notBestFor: ['long variable-duration clips'],
    recommendation: 'Use when Armenian speech and stronger Veo quality are more important than the lowest cost.'
  },
  'veo31': {
    id: 'veo31',
    name: 'Veo 3.1 Quality',
    category: 'video',
    route: 'veo31',
    bestFor: ['premium Armenian-speaking video', 'quality-focused eight-second results'],
    notBestFor: ['budget-first testing'],
    recommendation: 'Use only when the user prioritizes premium quality and accepts the higher cost.'
  },
  seedance25: {
    id: 'seedance25',
    name: 'Seedance 2.5',
    category: 'video',
    route: 'seedance25',
    bestFor: ['cinematic videos', 'complex direction', 'image, video or audio references', 'first and last frame control'],
    notBestFor: ['the cheapest quick test'],
    recommendation: 'Prefer for cinematic or complex work when Armenian speech is not the main requirement.'
  },
  kling25: {
    id: 'kling25',
    name: 'Kling 2.5 Turbo',
    category: 'video',
    route: 'kling25',
    bestFor: ['straightforward image-to-video', 'five or ten second clips'],
    notBestFor: ['Armenian speech', 'long or highly complex multimodal direction'],
    recommendation: 'Offer as a practical alternative when the use case fits its simple duration options.'
  },
  kling30: {
    id: 'kling30',
    name: 'Kling 3.0',
    category: 'video',
    route: 'kling30',
    bestFor: ['multi-shot video', 'sound-enabled video', 'higher-resolution Kling work'],
    notBestFor: ['the cheapest short test'],
    recommendation: 'Use for more advanced Kling workflows after clarifying duration, resolution and sound.'
  },
  'nano-banana-2-lite': {
    id: 'nano-banana-2-lite',
    name: 'Nano Banana 2 Lite',
    category: 'image',
    route: 'nano-banana-2-lite',
    bestFor: ['affordable image creation', 'fast image edits', 'beginner image generation'],
    notBestFor: ['video creation'],
    recommendation: 'Use as the affordable image starting point.'
  },
  'nano-banana-2': {
    id: 'nano-banana-2',
    name: 'Nano Banana 2',
    category: 'image',
    route: 'nano-banana-2',
    bestFor: ['higher-quality image creation', 'image editing', 'multiple reference images'],
    notBestFor: ['video creation'],
    recommendation: 'Use when image quality or more flexible input matters.'
  },
  'gpt-image-2-5': {
    id: 'gpt-image-2-5',
    name: 'GPT Image 2.5',
    category: 'image',
    route: 'gpt-image-2.5',
    bestFor: ['prompt-following image generation', 'image editing', 'quality-focused image work'],
    notBestFor: ['video creation'],
    recommendation: 'Use for quality-focused image generation after clarifying style and intended use.'
  },
  'seedream-5-pro': {
    id: 'seedream-5-pro',
    name: 'Seedream 5.0 Pro',
    category: 'image',
    route: 'seedream-5-pro',
    bestFor: ['creative image generation', 'quality-focused 2K images'],
    notBestFor: ['video creation'],
    recommendation: 'Use for creative or polished image work when the use case fits.'
  },
  'nano-banana': {
    id: 'nano-banana', name: 'Nano Banana', category: 'image', route: 'nano-banana',
    bestFor: ['fast image-to-image edits', 'edits using up to four images'], notBestFor: ['video creation'],
    recommendation: 'Use for straightforward image edits when the customer already has source images.'
  },
  'nano-banana-pro': {
    id: 'nano-banana-pro', name: 'Nano Banana Pro', category: 'image', route: 'nano-banana-pro',
    bestFor: ['studio-quality images', 'multi-image fusion', 'high-resolution image work'], notBestFor: ['lowest-cost image tests'],
    recommendation: 'Use when polished image quality matters more than minimum cost.'
  },
  'seedream-4-5': {
    id: 'seedream-4-5', name: 'Seedream 4.5', category: 'image', route: 'seedream-4-5',
    bestFor: ['creative image generation', 'image-guided generation'], notBestFor: ['video creation'],
    recommendation: 'Offer for creative image work when the customer asks for Seedream 4.5.'
  },
  'gpt-image-1.5': {
    id: 'gpt-image-1.5', name: 'GPT Image 1.5', category: 'image', route: 'gpt-image-1.5',
    bestFor: ['sharp detailed visuals', 'prompt-led images'], notBestFor: ['video creation'],
    recommendation: 'Use for detailed image work when its higher fixed cost fits the request.'
  },
  'gpt-image-2': {
    id: 'gpt-image-2', name: 'GPT Image 2.0', category: 'image', route: 'gpt-image-2',
    bestFor: ['prompt-following images', 'image editing', 'multiple resolution choices'], notBestFor: ['video creation'],
    recommendation: 'Use for quality image generation or editing with resolution control.'
  },
  'seedream-5-lite': {
    id: 'seedream-5-lite', name: 'Seedream 5.0 Lite', category: 'image', route: 'seedream-5-lite',
    bestFor: ['affordable creative images', 'high-quality image generation'], notBestFor: ['video creation'],
    recommendation: 'Use as the affordable Seedream image option.'
  },
  'grok-image': {
    id: 'grok-image', name: 'Grok Image', category: 'image', route: 'grok-image',
    bestFor: ['fixed 720p image generation', 'simple image edits'], notBestFor: ['high-resolution output', 'video creation'],
    recommendation: 'Use for simple fixed-resolution image work.'
  },
  'wan-2-7-image': {
    id: 'wan-2-7-image', name: 'Wan 2.7 Image', category: 'image', route: 'wan-2-7-image',
    bestFor: ['image generation with normal or pro quality', 'PNG output'], notBestFor: ['video creation'],
    recommendation: 'Use when the customer wants Wan image generation or a pro quality tier.'
  },
  'qwen-2': {
    id: 'qwen-2', name: 'Qwen 2', category: 'image', route: 'qwen-2',
    bestFor: ['affordable PNG image generation', 'image-guided creation'], notBestFor: ['video creation'],
    recommendation: 'Use for affordable general image generation with PNG output.'
  },
  'z-image': {
    id: 'z-image', name: 'Z-Image', category: 'image', route: 'z-image',
    bestFor: ['lowest-cost text-to-image tests', 'simple prompt-only images'], notBestFor: ['image-reference editing', 'video creation'],
    recommendation: 'Use for the lowest-cost text-to-image starting point.'
  },
  seedance20: {
    id: 'seedance20', name: 'Seedance 2.0', category: 'video', route: 'seedance20',
    bestFor: ['cinematic reference-driven video', '720p, 1080p or 4K workflows', 'first and last frame control'], notBestFor: ['lowest-cost tests'],
    recommendation: 'Use when the customer needs Seedance controls but does not specifically require Seedance 2.5.'
  },
  'seedance20-mini': {
    id: 'seedance20-mini', name: 'Seedance 2.0 Mini', category: 'video', route: 'seedance20-mini',
    bestFor: ['lower-cost Seedance video', 'reference-driven short video'], notBestFor: ['highest resolution'],
    recommendation: 'Use as the lower-cost Seedance option.'
  },
  'wan27-video': {
    id: 'wan27-video', name: 'Wan 2.7 Video', category: 'video', route: 'wan27-video',
    bestFor: ['video with mixed image, video or audio references', 'variable-duration clips'], notBestFor: ['lowest-cost Reels'],
    recommendation: 'Use when mixed reference media is central to the workflow.'
  },
  happyhorse10: {
    id: 'happyhorse10', name: 'HappyHorse 1.1', category: 'video', route: 'happyhorse10',
    bestFor: ['first-frame video', 'reference-image video'], notBestFor: ['Armenian speech as a primary requirement'],
    recommendation: 'Use for reference-image video when its simple workflow fits.'
  },
  kling26: {
    id: 'kling26', name: 'Kling 2.6', category: 'video', route: 'kling26',
    bestFor: ['high-quality five or ten second video', 'optional generated sound'], notBestFor: ['long clips'],
    recommendation: 'Use for a controlled five or ten second Kling video with optional sound.'
  },
  'kling3-turbo': {
    id: 'kling3-turbo', name: 'Kling 3 Turbo', category: 'video', route: 'kling3-turbo',
    bestFor: ['fast text-to-video', 'fast image-to-video', '720p or 1080p'], notBestFor: ['reference-heavy workflows'],
    recommendation: 'Use when speed matters and the customer does not need reference elements.'
  },
  'kling-motion-control': {
    id: 'kling-motion-control', name: 'Kling Motion Control', category: 'video', route: 'kling-motion-control',
    bestFor: ['transferring motion from a source video', 'animating a reference image'], notBestFor: ['text-only generation'],
    recommendation: 'Use specifically when the customer wants a character or image to follow existing video motion.'
  },
  aleph: {
    id: 'aleph', name: 'Aleph', category: 'video', route: 'aleph',
    bestFor: ['video-to-video transformation', 'video edits with an optional image'], notBestFor: ['text-only video'],
    recommendation: 'Use when the customer already has a video that must be transformed.'
  }
});

// Hansora product features are kept separate from the model catalog so the
// sales agent does not confuse website functions with AI models or with its
// own account/support tools.
const FEATURES = Object.freeze({
  canvas: {
    id: 'canvas', name: 'Canvas', category: 'workspace', status: 'active',
    description: 'Use one visual workspace for moodboards, chained workflows, and image or video creation.'
  },
  'hook-analyse': {
    id: 'hook-analyse', name: 'Hook Analyse', category: 'analysis', status: 'active',
    description: 'Analyze hooks and improve videos.'
  },
  'product-card': {
    id: 'product-card', name: 'Product Card', category: 'image', status: 'active',
    description: 'Create product selling cards.'
  },
  'lipsync-avatar': {
    id: 'lipsync-avatar', name: 'Lipsync Avatar', category: 'video', status: 'active',
    description: 'Synchronize a voice track with an avatar video.'
  },
  'kid-cartoon': {
    id: 'kid-cartoon', name: 'Kid Cartoon', category: 'image', status: 'active',
    description: 'Add a child to a cartoon scene.'
  },
  'video-edit': {
    id: 'video-edit', name: 'Video Edit', category: 'video', status: 'active',
    description: 'Edit uploaded videos by describing the requested changes.'
  },
  'full-angles': {
    id: 'full-angles', name: 'Full Angles', category: 'image', status: 'active',
    description: 'Create additional angle views from an image.'
  },
  'video-background-change': {
    id: 'video-background-change', name: 'Video Background Change', category: 'video', status: 'active',
    description: 'Replace or change a video background.'
  },
  'cartoon-prompt-builder': {
    id: 'cartoon-prompt-builder', name: 'Cartoon Prompt Builder', category: 'creative', status: 'active',
    description: 'Turn a short idea into a detailed cartoon prompt.'
  },
  character: {
    id: 'character', name: 'Character', category: 'creative', status: 'active',
    description: 'Build consistent AI characters.'
  },
  'suno-music': {
    id: 'suno-music', name: 'Suno Music', category: 'audio', status: 'active',
    description: 'Create songs and music tracks.'
  },
  ugc: {
    id: 'ugc', name: 'UGC', category: 'video', status: 'coming_soon',
    description: 'UGC creation is announced and coming soon.'
  },
  'relight-video': {
    id: 'relight-video', name: 'Relight Video', category: 'video', status: 'active',
    description: 'Change the lighting in a video.'
  },
  'motion-sync': {
    id: 'motion-sync', name: 'Motion Sync', category: 'video', status: 'active',
    description: 'Make a reference image follow the movement of a source video.'
  },
  upscale: {
    id: 'upscale', name: 'Upscale', category: 'image', status: 'active',
    description: 'Enhance image quality and detail.'
  }
});

const CREDIT_PACKAGES = Object.freeze([
  { id: 'credits_100', internalCredits: 100, usd: 9.99, rub: 750, sale: true },
  { id: 'credits_210', internalCredits: 210, usd: 19.99, rub: 1500, sale: true },
  { id: 'credits_535', internalCredits: 535, usd: 49.99, rub: 3700, sale: true },
  { id: 'credits_1100', internalCredits: 1100, usd: 99.99, rub: 7400, sale: true }
].map((entry) => Object.freeze({
  ...entry,
  displayedCredits: entry.internalCredits * CREDIT_DISPLAY_MULTIPLIER
})));

const SUBSCRIPTIONS = Object.freeze([
  { id: 'premium_monthly', monthlyInternalCredits: 250, usd: 40 },
  { id: 'pro_monthly', monthlyInternalCredits: 450, usd: 64 },
  { id: 'pro_max_monthly', monthlyInternalCredits: 1000, usd: 120 }
].map((entry) => Object.freeze({
  ...entry,
  monthlyDisplayedCredits: entry.monthlyInternalCredits * CREDIT_DISPLAY_MULTIPLIER
})));

function normalizeModelId(value) {
  const raw = String(value || '').trim().toLowerCase();
  const aliases = {
    grok: 'grok-video',
    'gemini-omni': 'gemini-omni-video',
    'seedance-2.5': 'seedance25',
    'veo-3.1-lite': 'veo31-lite',
    'veo-3.1-fast': 'veo31-fast',
    'veo-3.1-quality': 'veo31',
    'kling-2.5': 'kling25',
    'kling-3': 'kling30',
    'gpt-image-2.5': 'gpt-image-2-5'
  };
  const id = aliases[raw] || raw;
  return MODELS[id] ? id : '';
}

function toDisplayedCredits(internalCredits) {
  return Number((Number(internalCredits || 0) * CREDIT_DISPLAY_MULTIPLIER).toFixed(2));
}

function quoteModel(modelId, options = {}) {
  const id = normalizeModelId(modelId);
  if (!id) throw new Error('unsupported_model');
  const quantity = Math.max(1, Math.min(50, Math.round(Number(options.quantity) || 1)));
  const duration = Number(options.duration);
  const resolution = String(options.resolution || '').trim().toLowerCase();
  let unit;
  let normalized = {};

  if (id === 'grok-video') {
    const seconds = Math.max(6, Math.min(30, Math.round(Number.isFinite(duration) ? duration : 6)));
    const quality = resolution === '1080p' ? '1080p' : '720p';
    unit = seconds * (quality === '1080p' ? 0.6 : 0.3);
    normalized = { duration: seconds, resolution: quality };
  } else if (id === 'seedance25') {
    const seconds = Math.max(4, Math.min(30, Math.ceil(Number.isFinite(duration) ? duration : 5)));
    const quality = resolution === '480p' ? '480p' : '720p';
    unit = seconds * (quality === '480p' ? 1.7 : 3.8);
    normalized = { duration: seconds, resolution: quality };
  } else if (id === 'gemini-omni-video' || id === 'gemini-omni-flash-1-1') {
    const allowed = [4, 6, 8, 10];
    const seconds = allowed.includes(duration) ? duration : 4;
    const quality = resolution === '4k' ? '4K' : '1080p';
    const hasVideoInput = Boolean(options.has_video_input);
    if (hasVideoInput) unit = quality === '4K' ? 16 : 11;
    else if (id === 'gemini-omni-video') unit = (quality === '4K' ? { 4: 9, 6: 11, 8: 12, 10: 13 } : { 4: 4.5, 6: 6, 8: 7.5, 10: 9 })[seconds];
    else unit = (quality === '4K' ? { 4: 10, 6: 11, 8: 12, 10: 14 } : { 4: 4, 6: 5.5, 8: 6.9, 10: 8.3 })[seconds];
    normalized = { duration: seconds, resolution: quality, hasVideoInput };
  } else if (id === 'veo31-lite' || id === 'veo31-fast' || id === 'veo31') {
    const quality = resolution === '4k' ? '4K' : (resolution === '720p' ? '720p' : '1080p');
    if (id === 'veo31-lite') unit = quality === '1080p' ? 2.5 : 2;
    else if (id === 'veo31-fast') unit = quality === '4K' ? 12 : 5;
    else unit = quality === '4K' ? 22 : 17;
    normalized = { duration: 8, resolution: quality };
  } else if (id === 'kling25') {
    const seconds = duration === 10 ? 10 : 5;
    unit = seconds === 10 ? 6 : 3;
    normalized = { duration: seconds, resolution: '1080p' };
  } else if (id === 'kling30') {
    const seconds = Math.max(3, Math.min(15, Math.round(Number.isFinite(duration) ? duration : 5)));
    const quality = resolution === '4k' ? '4K' : (resolution === '1080p' ? '1080p' : '720p');
    const sound = Boolean(options.sound);
    const rate = quality === '4K' ? 4 : quality === '1080p' ? (sound ? 1.8 : 1.3) : (sound ? 1.3 : 1);
    unit = seconds * rate;
    normalized = { duration: seconds, resolution: quality, sound };
  } else if (id === 'nano-banana-2-lite') {
    unit = 0.3;
    normalized = { resolution: '1K' };
  } else if (id === 'nano-banana-2') {
    const quality = resolution === '4k' ? '4K' : resolution === '2k' ? '2K' : '1K';
    unit = quality === '4K' ? 1.3 : quality === '2K' ? 0.8 : 0.5;
    normalized = { resolution: quality };
  } else if (id === 'gpt-image-2-5') {
    const quality = resolution === '4k' ? '4K' : resolution === '2k' ? '2K' : '1K';
    unit = quality === '4K' ? 1.2 : quality === '2K' ? 0.7 : 0.5;
    normalized = { resolution: quality };
  } else if (id === 'seedream-5-pro') {
    const quality = resolution === '2k' ? '2K' : '1K';
    unit = quality === '2K' ? 1 : 0.5;
    normalized = { resolution: quality };
  } else if (id === 'nano-banana') {
    unit = 0.5;
  } else if (id === 'nano-banana-pro') {
    const quality = resolution === '4k' ? '4K' : (resolution === '2k' ? '2K' : '1K');
    unit = quality === '4K' ? 1.5 : 1.2;
    normalized = { resolution: quality };
  } else if (id === 'seedream-4-5') {
    unit = 0.5;
  } else if (id === 'gpt-image-1.5') {
    unit = 1.5;
  } else if (id === 'gpt-image-2') {
    const quality = resolution === '4k' ? '4K' : (resolution === '2k' ? '2K' : '1K');
    unit = quality === '4K' ? 1.2 : quality === '2K' ? 0.7 : 0.5;
    normalized = { resolution: quality };
  } else if (['seedream-5-lite', 'grok-image', 'qwen-2'].includes(id)) {
    unit = 0.5;
  } else if (id === 'wan-2-7-image') {
    unit = resolution === 'pro' ? 1 : 0.5;
    normalized = { quality: resolution === 'pro' ? 'pro' : 'normal' };
  } else if (id === 'z-image') {
    unit = 0.2;
  } else if (id === 'seedance20') {
    const seconds = Math.max(4, Math.min(15, Math.round(Number.isFinite(duration) ? duration : 5)));
    const quality = resolution === '4k' ? '4K' : (resolution === '1080p' ? '1080p' : '720p');
    unit = seconds * (quality === '4K' ? 12 : quality === '1080p' ? 5.5 : 2.5);
    normalized = { duration: seconds, resolution: quality, variant: 'standard' };
  } else if (id === 'seedance20-mini') {
    const seconds = Math.max(4, Math.min(15, Math.round(Number.isFinite(duration) ? duration : 5)));
    unit = seconds * 1.3;
    normalized = { duration: seconds, resolution: resolution === '480p' ? '480p' : '720p' };
  } else if (id === 'wan27-video' || id === 'happyhorse10' || id === 'kling3-turbo') {
    const seconds = Math.max(1, Math.min(15, Math.round(Number.isFinite(duration) ? duration : 5)));
    const quality = resolution === '1080p' ? '1080p' : '720p';
    const rate = id === 'wan27-video' ? (quality === '1080p' ? 2 : 1.5)
      : id === 'happyhorse10' ? (quality === '1080p' ? 1.8 : 1.5)
        : (quality === '1080p' ? 1.5 : 1.2);
    unit = seconds * rate;
    normalized = { duration: seconds, resolution: quality };
  } else if (id === 'kling26') {
    const seconds = duration === 10 ? 10 : 5;
    unit = options.sound ? (seconds === 10 ? 15 : 8) : (seconds === 10 ? 8 : 4);
    normalized = { duration: seconds, resolution: '1080p', sound: Boolean(options.sound) };
  } else if (id === 'kling-motion-control') {
    const seconds = Math.max(1, Math.min(30, Math.ceil(Number.isFinite(duration) ? duration : 5)));
    const quality = resolution === '1080p' ? '1080p' : '720p';
    unit = seconds * (quality === '1080p' ? 1.2 : 0.7);
    normalized = { duration: seconds, resolution: quality, engine: 'kling26' };
  } else if (id === 'aleph') {
    unit = 8;
    normalized = { requiresVideoInput: true };
  } else {
    throw new Error('price_unavailable');
  }

  const internalCredits = Number((unit * quantity).toFixed(2));
  return {
    catalogVersion: CATALOG_VERSION,
    model: MODELS[id],
    quantity,
    settings: normalized,
    unitInternalCredits: Number(unit.toFixed(2)),
    internalCredits,
    displayedCredits: toDisplayedCredits(internalCredits)
  };
}

function getPackages({ currency = 'USD', requiredInternalCredits = 0 } = {}) {
  const normalizedCurrency = String(currency).toUpperCase() === 'RUB' ? 'RUB' : 'USD';
  const required = Math.max(0, Number(requiredInternalCredits) || 0);
  return CREDIT_PACKAGES.map((entry) => ({
    id: entry.id,
    internalCredits: entry.internalCredits,
    displayedCredits: entry.displayedCredits,
    currency: normalizedCurrency,
    price: normalizedCurrency === 'RUB' ? entry.rub : entry.usd,
    sale: entry.sale,
    sufficient: entry.internalCredits >= required
  }));
}

module.exports = {
  CATALOG_VERSION,
  CREDIT_DISPLAY_MULTIPLIER,
  MODELS,
  FEATURES,
  CREDIT_PACKAGES,
  SUBSCRIPTIONS,
  normalizeModelId,
  quoteModel,
  getPackages,
  toDisplayedCredits
};
