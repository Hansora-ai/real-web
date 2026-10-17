import { getModel, getRunner, quote } from './registry.mjs';

// Sorts a failed generation into what the user should hear: a temporary model issue (offer another
// model), a content refusal (change the prompt or image), an unusable input file, or unknown.
const CONTENT = /polic|flagged|sensitive|safety|nsfw|nud|sexual|copyright|trademark|celebrit|public figure|real person|minor|child|violat|prohibit|not allowed|moderation|inappropriate|harmful|guideline/i;
const INPUT = /file type|format not|unsupported (image|file|format)|image size|too large|too small|resolution|dimension|aspect ratio|corrupt|could not (read|download|load)|invalid (image|file|url)|image_input/i;
const TEMPORARY = /internal|server error|timeout|timed out|try again|temporar|unavailable|busy|overload|capacity|rate limit|too many requests|network|upstream|service error/i;

export function classifyFailure(meta = {}) {
  const reason = [meta.provider_message, meta.error, meta.error_summary, meta.fail_reason, meta.submit_error]
    .map((value) => (typeof value === 'string' ? value : value && typeof value === 'object' ? JSON.stringify(value) : ''))
    .join(' ');
  const code = Number(meta.error_code ?? meta.provider_code);
  if (/not_enough_credits|insufficient_credits/i.test(reason)) return 'credits';
  if (CONTENT.test(reason)) return 'content';
  if (INPUT.test(reason)) return 'input';
  if ([429, 500, 501, 502, 503, 504].includes(code) || TEMPORARY.test(reason)) return 'temporary';
  return 'unknown';
}

// Another model to offer when one has a temporary issue.
const ALTERNATIVES = Object.freeze({
  'veo31-lite': 'grok-video', 'veo31-fast': 'grok-video', veo31: 'grok-video',
  'gemini-omni-video': 'grok-video', 'gemini-omni-flash-1-1': 'grok-video',
  kling25: 'grok-video', kling26: 'grok-video', kling30: 'grok-video', 'kling3-turbo': 'grok-video',
  seedance25: 'grok-video', seedance20: 'grok-video', 'seedance20-mini': 'grok-video',
  'wan-3': 'grok-video', 'wan27-video': 'grok-video', happyhorse10: 'grok-video',
  'grok-video': 'veo31-lite',
  'nano-banana': 'seedream-4-5', 'nano-banana-2': 'seedream-4-5', 'nano-banana-2-lite': 'seedream-4-5', 'nano-banana-pro': 'seedream-4-5',
  'gpt-image-2': 'seedream-4-5', 'gpt-image-2-5': 'seedream-4-5', 'gpt-image-1.5': 'seedream-4-5',
  'seedream-4-5': 'nano-banana-2', 'seedream-5-lite': 'nano-banana-2', 'seedream-5-pro': 'nano-banana-2',
  'grok-image': 'seedream-4-5', 'qwen-2': 'seedream-4-5', 'wan-2-7-image': 'seedream-4-5', 'z-image': 'seedream-4-5'
});

// Runners save their own provider names; map them back to Hansora model ids.
const RUNNER_NAMES = Object.freeze({
  veo3_lite: 'veo31-lite', veo3_fast: 'veo31-fast', veo3: 'veo31', 'veo3.1lite': 'veo31-lite', 'veo3.1fast': 'veo31-fast', 'veo3.1': 'veo31',
  kling: 'kling25', 'kling-5s': 'kling25', 'kling-10s': 'kling25', 'kling2.6': 'kling26', 'kling-2.6/image-to-video': 'kling26', 'kling-2.6/text-to-video': 'kling26',
  'kling 2.6 no sound5s': 'kling26', 'kling 2.6 no sound10s': 'kling26', 'kling2.6-5s': 'kling26', 'kling2.6-10s': 'kling26',
  'kling-3.0': 'kling30', 'wan/3-0-video': 'wan-3', 'wan 3.0': 'wan-3', 'wan 2.7': 'wan27-video', 'happyhorse-1.1': 'happyhorse10',
  grok: 'grok-video', 'gemini omni': 'gemini-omni-video', 'gemini omni 1.1 flash': 'gemini-omni-flash-1-1'
});

function modelIdOf(generation) {
  const meta = generation?.meta && typeof generation.meta === 'object' ? generation.meta : {};
  for (const id of [meta.model_id, meta.engine, meta.model, generation?.provider]) {
    if (typeof id !== 'string' || !id) continue;
    const mapped = RUNNER_NAMES[id.toLowerCase()];
    const model = getModel(mapped || id);
    if (model) return model.id;
  }
  return '';
}

function alternativeFor(modelId) {
  const id = ALTERNATIVES[modelId];
  const model = id ? getModel(id) : null;
  if (!model || !getRunner(model.id)) return null;
  let price = null;
  try { price = quote(model.id, {}); } catch { price = null; }
  return { model_id: model.id, model_name: model.name, settings: price?.settings || {}, credits: price ? price.displayedCredits : null };
}

function creditsLine(meta) {
  const refunded = meta.refunded === true || String(meta.refunded) === 'true';
  const amount = Number(meta.refunded_cost ?? meta.refund_amount);
  if (refunded && Number.isFinite(amount) && amount > 0) {
    const displayed = Number((amount * 10).toFixed(2));
    return { text: `Your ${displayed} credits were refunded.`, refunded: displayed };
  }
  if (meta.refund_skipped_reason === 'not_charged' || String(meta.charged || '') !== 'true') return { text: 'No credits were used.', refunded: 0 };
  return { text: 'Your credits will be refunded.', refunded: null };
}

// What the card and ChatGPT show for a failed generation. Returns null for credit refusals, which
// have their own message.
export function failureView(generation, fallbackName = 'This model') {
  const meta = generation?.meta && typeof generation.meta === 'object' ? generation.meta : {};
  const kind = classifyFailure(meta);
  if (kind === 'credits') return null;
  const modelId = modelIdOf(generation);
  const name = (modelId && getModel(modelId)?.name) || fallbackName;
  const reasonText = String(meta.provider_message || (typeof meta.error === 'string' ? meta.error : '') || '').trim().slice(0, 200);
  const reason = reasonText && !/^(kie_failed|provider_rejected|missing_task_id_timeout|failed)$/i.test(reasonText) ? reasonText : '';
  const credits = creditsLine(meta);
  const kindLabel = generation?.kind === 'image' ? 'image' : generation?.kind === 'audio' ? 'audio' : 'video';
  const alternative = kind === 'temporary' || kind === 'unknown' ? alternativeFor(modelId) : null;
  const offer = alternative
    ? ` Do you want me to try ${alternative.model_name} instead?${alternative.credits != null ? ` It costs ${alternative.credits} credits.` : ''}`
    : '';

  let title;
  let message;
  let next;
  if (kind === 'temporary') {
    title = `${name} is having a temporary issue`;
    message = `${name} is having a temporary issue right now. It wasn't caused by your prompt or image. ${credits.text}`;
    next = alternative
      ? `Tell the user this in their language and ask whether to try ${alternative.model_name}${alternative.credits != null ? ` (${alternative.credits} credits)` : ''}. Start it only after they agree, with the same prompt and inputs.`
      : 'Tell the user this in their language and offer to try again later.';
  } else if (kind === 'content') {
    title = `${name} can't create this content`;
    message = `${name} can't create this content${reason ? ` (${reason})` : ''}. ${credits.text} Try changing the prompt or image.`;
    next = 'Tell the user this in their language and help them change the prompt or image. Do not switch to another model to get around the refusal.';
  } else if (kind === 'input') {
    title = 'This image can\'t be used';
    message = `This image can't be used${reason ? ` (${reason})` : ''}. ${credits.text} Please send a JPG or PNG under 10 MB.`;
    next = 'Tell the user this in their language and ask for a JPG or PNG image under 10 MB.';
  } else {
    title = `${name} couldn't finish this ${kindLabel}`;
    message = `${name} couldn't finish this ${kindLabel}${reason ? ` (${reason})` : ''}. ${credits.text}`;
    next = alternative
      ? `Tell the user this in their language and ask whether to try again or try ${alternative.model_name}${alternative.credits != null ? ` (${alternative.credits} credits)` : ''}. Start nothing until they choose.`
      : 'Tell the user this in their language and ask whether to try again.';
  }
  return {
    failure_kind: kind,
    failure_title: title,
    message: message + offer,
    card_message: message,
    credits_refunded: credits.refunded,
    ...(reason ? { failure_reason: reason } : {}),
    ...(alternative ? { alternative } : {}),
    next_step: next
  };
}
