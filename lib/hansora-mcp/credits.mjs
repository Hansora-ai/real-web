import { getModel, getRunner, listModels, quote } from './registry.mjs';

// Hansora bills in internal credits but every user-facing screen shows them x10. Anything the
// assistant can read must use the displayed number, or it quotes prices users never see.
export function publicQuote(price) {
  if (!price || typeof price !== 'object') return price;
  const { internalCredits, unitInternalCredits, displayMultiplier, ...rest } = price;
  return { ...rest, credits: price.displayedCredits, displayedCredits: price.displayedCredits };
}

export function quoteOptionsFromRequest(input = {}) {
  const sound = input.sound ?? input.generate_audio;
  return {
    duration: input.duration,
    resolution: input.resolution || input.quality,
    sound: sound === undefined ? undefined : Boolean(sound),
    quantity: 1,
    source_video_duration: input.source_video_duration,
    has_video_input: Boolean(input.source_video_url || (Array.isArray(input.video_urls) && input.video_urls.length))
  };
}

function requestedInputKinds(input = {}) {
  const hasList = (value) => Array.isArray(value) && value.length > 0;
  return {
    image: Boolean(input.first_frame_url || input.last_frame_url || hasList(input.image_urls)),
    video: Boolean(input.source_video_url || hasList(input.video_urls)),
    audio: hasList(input.audio_urls)
  };
}

function fitsRequestedInputs(model, needs) {
  const limits = model.input || {};
  const supports = {
    image: Boolean(Number(limits.max_images) > 0 || limits.requires_image || limits.first_frame || limits.first_last_frames || limits.image_references || limits.image_video_audio_references),
    video: Boolean(Number(limits.max_videos) > 0 || limits.requires_video || limits.image_video_audio_references),
    audio: Boolean(Number(limits.max_audio) > 0 || limits.image_video_audio_references)
  };
  if (limits.requires_image && !needs.image) return false;
  if (limits.requires_video && !needs.video) return false;
  return ['image', 'video', 'audio'].every((kind) => !needs[kind] || supports[kind]);
}

// Suggested options are what users actually receive, so never offer clips shorter than 5 seconds
// even when a model allows 2-3 second runs; a 2-second video at a 5-second price feels broken.
const MIN_SUGGESTED_SECONDS = 5;

function candidateDurations(limits) {
  if (Array.isArray(limits.durations)) {
    const usable = limits.durations.filter((seconds) => seconds >= MIN_SUGGESTED_SECONDS);
    return usable.length ? usable : limits.durations.slice(-1);
  }
  if (limits.durations && Number.isFinite(limits.durations.min)) {
    const max = Number.isFinite(limits.durations.max) ? limits.durations.max : MIN_SUGGESTED_SECONDS;
    return [Math.min(Math.max(limits.durations.min, MIN_SUGGESTED_SECONDS), max)];
  }
  return [undefined];
}

function quoteSettings(price) {
  if (price?.settings) return price.settings;
  const settings = {};
  if (price?.duration != null) settings.duration = price.duration;
  if (price?.resolution != null) settings.resolution = price.resolution;
  return settings;
}

function cheapestQuote(model, hasVideoInput) {
  const limits = model.input || {};
  const resolutions = Array.isArray(limits.resolutions) && limits.resolutions.length ? limits.resolutions : [undefined];
  let best = null;
  for (const duration of candidateDurations(limits)) {
    for (const resolution of resolutions) {
      let price;
      try { price = quote(model.id, { duration, resolution, sound: false, quantity: 1, has_video_input: hasVideoInput }); } catch { continue; }
      if (!best || price.internalCredits < best.internalCredits) best = price;
    }
  }
  return best;
}

// Options the account can pay for right now, for the same kind of media and the same inputs the
// user supplied. The requested model comes first when a shorter or lower-resolution run of it fits.
export function optionsWithinBalance(modelId, input, balanceInternal, limit = 4) {
  const requested = getModel(modelId);
  if (!requested) return [];
  const needs = requestedInputKinds(input);
  const candidates = listModels({ category: requested.category, includeUnavailable: false })
    .filter((model) => model.availability === 'available' && getRunner(model.id) && fitsRequestedInputs(model, needs));
  const options = [];
  for (const model of candidates) {
    const price = cheapestQuote(model, needs.video);
    if (!price || price.internalCredits > balanceInternal) continue;
    options.push({
      model_id: model.id,
      model_name: model.name,
      settings: quoteSettings(price),
      credits: price.displayedCredits,
      same_model: model.id === requested.id
    });
  }
  options.sort((a, b) => (b.same_model - a.same_model) || (b.credits - a.credits));
  return options.slice(0, limit);
}

function sameRequest(option, model, input = {}) {
  if (!option || option.model_id !== model.id) return false;
  const settings = option.settings || {};
  const resolution = input.resolution || input.quality;
  return (settings.duration == null || Number(input.duration) === Number(settings.duration))
    && (settings.resolution == null || String(resolution || '') === String(settings.resolution));
}

export function insufficientCreditsResult({ model, price, balanceInternal, input, firstGeneration = false }) {
  const available = Number((Number(balanceInternal || 0) * 10).toFixed(2));
  const options = optionsWithinBalance(model.id, input, balanceInternal);
  // A brand-new user's free credits rarely cover the model ChatGPT picked. Make their first result
  // right away with the best option that fits instead of asking them to choose. Only once: if the
  // option itself was refused, fall back to asking.
  const startFirst = firstGeneration && options.length > 0 && !sameRequest(options[0], model, input);
  if (startFirst) {
    const first = options[0];
    const settings = Object.entries(first.settings || {}).map(([key, value]) => `${key} ${value}`).join(', ');
    const value = {
      ok: false,
      error: 'insufficient_credits',
      generated: false,
      credits_used: 0,
      first_generation: true,
      model_id: model.id,
      model_name: model.name,
      credits_required: price ? price.displayedCredits : null,
      credits_available: available,
      options_within_balance: options,
      next_step: [
        'Nothing was generated and no credits were used.',
        `This is the user's first generation and their free credits (${available}) do not cover this request, so do not ask the user to choose.`,
        `Call create_generation right now with model_id ${first.model_id}${settings ? ` and ${settings}` : ''}, keeping the same prompt and files (fit the prompt to that model if needed).`,
        `When it starts, tell the user in one short, friendly line that their first video is being made with ${first.model_name} so it fits their free credits.`
      ].join(' ')
    };
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
  }
  const value = {
    ok: false,
    error: 'insufficient_credits',
    generated: false,
    credits_used: 0,
    model_id: model.id,
    model_name: model.name,
    requested_settings: quoteSettings(price),
    credits_required: price ? price.displayedCredits : null,
    credits_available: available,
    options_within_balance: options,
    next_step: [
      'Nothing was generated and no credits were used.',
      'Do not call create_generation again on your own and do not switch to another model or setting without the user choosing it.',
      `Tell the user that this request needs ${price ? price.displayedCredits : 'more'} Hansora credits and their balance is ${available} credits. Always use these numbers as given.`,
      options.length
        ? 'Offer the options in options_within_balance (model, settings and credits) and wait for the user to pick one.'
        : 'No model of this type fits the current balance; tell the user that plainly.'
    ].join(' ')
  };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

export function accountSummary(account) {
  const balanceInternal = Number(account?.internal_credits || 0);
  const fitting = (category) => listModels({ category, includeUnavailable: false })
    .filter((model) => model.availability === 'available' && getRunner(model.id))
    .map((model) => {
      const price = cheapestQuote(model, false);
      return price && price.internalCredits <= balanceInternal
        ? { model_id: model.id, model_name: model.name, settings: quoteSettings(price), credits: price.displayedCredits }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.credits - b.credits);
  return {
    credits: Number((balanceInternal * 10).toFixed(2)),
    credits_note: 'Hansora credits exactly as the user sees them on Hansora. Quote prices and balances only in these credits.',
    subscription: account?.subscription || null,
    video_options_within_balance: fitting('video'),
    image_models_within_balance: fitting('image').length
  };
}
