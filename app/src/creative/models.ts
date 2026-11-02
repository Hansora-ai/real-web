import raw from '../data/models.json';

// The website's own model list (public/search-models.html → scripts/sync-models.mjs).
export type Model = {
  id: string; name: string; emoji: string; subtitle: string; category: 'image' | 'video' | string;
  description?: string; endpoint?: string; needsImage?: boolean; maxFiles?: number;
  aspectOptions?: string[]; defaultAspect?: string; durations?: number[] | null;
  resolutionOptions?: string[]; defaultResolution?: string; costLabel?: string; minCredits?: number;
  uploadMaxMB?: number; isNew?: boolean; isTop?: boolean; hidden?: boolean; useFrames?: boolean; startOptional?: boolean;
  specificUpload?: string; allowOptionalImage?: boolean; __navTo?: string;
};

export const ALL_MODELS = raw as Model[];
export const MODELS = ALL_MODELS.filter(model => !model.hidden && !model.__navTo && model.endpoint);

/**
 * Models whose inputs are prompt + photos (+ start/last frame) + aspect / quality / length.
 * The others need special editors (reference videos and audio, multi-shot, motion video, video editing)
 * that come next; until then they show as "next update" in preview builds only.
 */
const READY = new Set([
  'nano-banana', 'nano-banana-pro', 'nano-banana-2-1', 'nano-banana-2', 'nano-banana-2-lite', 'seedream-4-5',
  'gpt-image-1.5', 'gpt-image-2-5', 'gpt-image-2', 'seedream-5-lite', 'seedream-5-flash', 'seedream-5-pro',
  'grok-image', 'wan-2-7-image', 'qwen-2', 'z-image', 'midjourney',
  'mj-video', 'veo3-fast', 'veo3', 'veo31-lite', 'veo31-fast', 'veo31', 'kling25', 'kling26', 'kling21', 'kling3-turbo', 'grok-video',
]);
export const isReady = (model: Model) => READY.has(model.id);

// Same logos as getModelLogoUrl() on the website.
const LOGO = 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/';
export function modelLogo(model: Model): string {
  const id = model.id.toLowerCase();
  if (id.includes('gpt-image')) return LOGO + '2.png';
  if (id.includes('nano-banana')) return LOGO + '13.png';
  if (id.includes('seedream')) return LOGO + '5.png';
  if (id.includes('grok')) return LOGO + '4.png';
  if (id.includes('wan') || id.includes('qwen') || id.includes('z-image')) return LOGO + '6.png';
  if (id.includes('seedance20') || id === 'seedance25') return LOGO + '5.png';
  if (id.includes('gemini-omni') || id.includes('veo')) return LOGO + '3.png';
  if (id.includes('happyhorse')) return LOGO + '15.png';
  if (id.includes('kling')) return LOGO + '14.png';
  if (id.includes('aleph')) return LOGO + '16.png';
  return '';
}

// Extra choices some models have on the website (Sora tier, Kling sound, Wan tier).
export type Options = { aspect: string; resolution: string; duration: number; sound: boolean; tier: string; quantity: number };

export function defaultOptions(model: Model): Options {
  return {
    aspect: model.defaultAspect || model.aspectOptions?.[0] || '',
    resolution: model.defaultResolution || model.resolutionOptions?.[0] || '',
    duration: model.durations?.[0] ?? 0,
    sound: false,
    tier: model.id === 'wan-2-7-image' ? 'normal' : 'base',
    quantity: 1,
  };
}

export function frameSlots(model: Model): number {
  if (model.useFrames || ['kling25', 'kling21'].includes(model.id)) return 2;
  return 0;
}

export function maxUploads(model: Model): number {
  if (frameSlots(model)) return 2;
  if (['mj-video', 'kling26', 'kling3-turbo', 'grok-video', 'midjourney'].includes(model.id)) return 1;
  return Math.max(0, Number(model.maxFiles || 0));
}
