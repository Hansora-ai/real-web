import type { Model, Options } from './models';

/**
 * Credits for one generation, exactly like getModelUnitCreditValue() in public/search-models.html
 * (stored credits; shown ×10 with ⚡). The server re-checks and charges; this is what the user sees first.
 * Keep in step with the website — see docs/mobile-app/SYNC.md.
 */
export function unitCredits(model: Model, o: Options): number | null {
  const r = o.resolution, d = Number(o.duration);
  switch (model.id) {
    case 'nano-banana-pro': return r === '4K' ? 1.5 : 1.2;
    case 'nano-banana-2': return r === '4K' ? 1.3 : r === '2K' ? 0.8 : 0.5;
    case 'nano-banana-2-1': return r === '4K' ? 0.7 : r === '2K' ? 0.5 : 0.3;
    case 'seedream-5-flash': case 'nano-banana-2-lite': return 0.3;
    case 'gpt-image-2': case 'gpt-image-2-5': return r === '4K' ? 1.2 : r === '2K' ? 0.7 : 0.5;
    case 'seedream-5-pro': return r === '2K' ? 1 : 0.5;
    case 'wan-2-7-image': return o.tier === 'pro' ? 1 : 0.5;
    case 'veo31-lite': return r === '1080p' ? 2.5 : 2;
    case 'veo31-fast': return r === '4K' ? 12 : 5;
    case 'veo31': return r === '4K' ? 22 : 17;
    case 'grok-video': return Number((Math.max(1, d || 6) * (r === '1080p' ? 0.6 : 0.3)).toFixed(1));
    case 'kling3-turbo': return Number((Math.max(1, d || 5) * (r === '1080p' ? 1.5 : 1.2)).toFixed(1));
    case 'kling26': { const ten = d === 10; return o.sound ? (ten ? 15 : 8) : (ten ? 8 : 4); }
    case 'kling25': return d === 10 ? 6 : 3;
    case 'sora2': return o.tier === 'pro' ? 20 : 3;
  }
  if (typeof model.minCredits === 'number') return model.minCredits;
  const match = String(model.costLabel || '').match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

export function totalCredits(model: Model, o: Options): number | null {
  const unit = unitCredits(model, o);
  return unit === null ? null : Number((unit * Math.max(1, o.quantity)).toFixed(2));
}
