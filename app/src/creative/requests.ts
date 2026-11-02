import type { Model, Options } from './models';

type Ctx = { uid: string; runId: string; urls: string[]; prompt: string; o: Options; frameCount: number; genId?: string | null };

/** Request body per model — copied case by case from buildBodyForModel() in public/search-models.html. */
export function buildBody(model: Model, ctx: Ctx): Record<string, unknown> {
  const body = baseBody(model, ctx);
  // Same GPT-Image safeguard as the website: always send the aspect and every uploaded image URL.
  if (model.id.startsWith('gpt-image')) {
    if (!body.aspect_ratio) body.aspect_ratio = ctx.o.aspect || '1:1';
    if (ctx.urls.length) Object.assign(body, { urls: ctx.urls, image_urls: ctx.urls, input_urls: ctx.urls });
  }
  return body;
}

function baseBody(model: Model, { uid, runId, urls, prompt, o, frameCount, genId }: Ctx): Record<string, unknown> {
  const aspect = o.aspect, resolution = o.resolution, duration = o.duration;
  switch (model.id) {
    case 'nano-banana': return { urls, prompt: prompt || '.', format: 'png', size: aspect || 'auto', run_id: runId };
    case 'nano-banana-pro': return { urls, prompt: prompt || '.', format: 'png', size: aspect || '1:1', resolution: resolution || '1K', run_id: runId };
    case 'nano-banana-2-1': return { urls, prompt: prompt || '.', format: 'png', size: aspect || 'auto', resolution: resolution || '1K', run_id: runId };
    case 'seedream-5-flash': return { urls, prompt: prompt || '.', format: 'png', size: aspect || '1:1', resolution: resolution || '1K', run_id: runId };
    case 'nano-banana-2': return { urls, prompt: prompt || '.', format: 'png', size: aspect || 'auto', resolution: resolution || '1K', google_search: true, run_id: runId };
    case 'nano-banana-2-lite': return { urls, prompt: prompt || '.', format: 'png', size: aspect || 'auto', resolution: '1K', run_id: runId };
    case 'seedream-4-5': return { urls, prompt: prompt || '.', format: 'png', size: aspect || '1:1', run_id: runId };
    case 'seedream-5-lite': return { urls, prompt: prompt || '.', format: 'png', size: aspect || '1:1', quality: 'high', run_id: runId };
    case 'seedream-5-pro': return { urls, prompt: prompt || '.', format: 'png', size: aspect || '1:1', resolution: resolution || '1K', quality: resolution === '2K' ? 'high' : 'basic', run_id: runId };
    case 'gpt-image-2': case 'gpt-image-2-5':
      return { urls, prompt: prompt || '.', format: 'png', aspect_ratio: aspect || 'auto', size: aspect || 'auto', resolution: resolution || '1K', run_id: runId };
    case 'grok-image': return { urls, prompt: prompt || '.', aspect_ratio: aspect || '1:1', resolution: '720p', run_id: runId };
    case 'wan-2-7-image':
      return { urls, prompt: prompt || '.', format: 'png', output_format: 'png', aspect_ratio: aspect || '1:1', size: aspect || '1:1', quality: o.tier || 'normal', tier: o.tier || 'normal', enable_sequential: true, run_id: runId };
    case 'qwen-2': return { urls, prompt: prompt || '.', format: 'png', output_format: 'png', aspect_ratio: aspect || '1:1', size: aspect || '1:1', run_id: runId };
    case 'z-image': return { prompt: prompt || '.', format: 'png', output_format: 'png', aspect_ratio: aspect || '1:1', size: aspect || '1:1', run_id: runId };
    case 'midjourney': return { prompt, image_url: urls[0] || undefined, aspect_ratio: aspect || '2:3', aspectRatio: aspect || '2:3', run_id: runId };
    case 'mj-video': return { uid, prompt, imageUrl: urls[0] || '', aspectRatio: aspect || '1:1', run_id: runId };
    case 'veo3-fast': case 'veo3':
      return { uid, user_id: uid, prompt, aspectRatio: aspect || '16:9', duration: duration ? Number(duration) : 8, imageUrl: urls[0] || '', model: model.id === 'veo3-fast' ? 'veo3_fast' : 'veo3', run_id: runId };
    case 'veo31-lite': case 'veo31-fast': case 'veo31': {
      const frameUrls = urls.slice(0, frameCount), referenceUrls = urls.slice(frameCount);
      return {
        uid, prompt, aspectRatio: aspect || '16:9', duration: duration ? Number(duration) : 8,
        firstFrameUrl: frameUrls[0] || '', lastFrameUrl: frameUrls[1] || '', imageUrls: frameUrls, referenceImageUrls: referenceUrls,
        resolution: resolution || '1080p', quality: resolution || '1080p', imageUrl: '',
        model: model.id === 'veo31-lite' ? 'veo3_lite' : model.id === 'veo31-fast' ? 'veo3_fast' : 'veo3', run_id: runId,
      };
    }
    case 'grok-video':
      return { uid, user_id: uid, prompt, aspect_ratio: aspect || '16:9', duration: duration ? Number(duration) : 6, resolution: resolution || '720p', mode: 'normal', image_url: urls[0] || undefined, image_urls: urls.slice(0, 1), run_id: runId };
    case 'kling25': return { prompt, aspect_ratio: aspect || '1:1', duration: duration ? Number(duration) : 5, image_url: urls[0] || undefined, tail_image_url: urls[1] || undefined, run_id: runId };
    case 'kling26': return { prompt, aspect_ratio: aspect || '1:1', duration: duration ? Number(duration) : 5, sound: !!o.sound, image_url: urls[0] || undefined, run_id: runId };
    case 'kling3-turbo':
      return { uid, user_id: uid, prompt, aspect_ratio: aspect || '16:9', duration: duration ? Number(duration) : 5, resolution: resolution || '720p', image_url: urls[0] || undefined, image_urls: urls[0] ? [urls[0]] : [], run_id: runId };
    case 'kling21': return { prompt, duration: duration ? Number(duration) : 5, firstFrameUrl: urls[0] || undefined, lastFrameUrl: urls[1] || undefined, run_id: runId };
    case 'sora2': {
      const aspectRatio = aspect || '16:9';
      return { uid, run_id: runId, id: genId || null, tier: o.tier || 'base', prompt, image_urls: urls[0] ? [urls[0]] : [], orientation: aspectRatio === '9:16' ? 'portrait' : 'landscape', aspectRatio, duration: duration || 10, quality: 'high' };
    }
    default: return { prompt, run_id: runId };
  }
}
