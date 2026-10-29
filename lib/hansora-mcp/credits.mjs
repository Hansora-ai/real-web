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
// The sharpest resolution the balance covers at the model's shortest usable length.
function bestQuoteWithin(model, hasVideoInput, balanceInternal) {
  const limits = model.input || {};
  const resolutions = Array.isArray(limits.resolutions) && limits.resolutions.length ? limits.resolutions : [undefined];
  const [duration] = candidateDurations(limits);
  let best = null;
  for (const resolution of resolutions) {
    let price;
    try { price = quote(model.id, { duration, resolution, sound: false, quantity: 1, has_video_input: hasVideoInput }); } catch { continue; }
    if (price.internalCredits > balanceInternal) continue;
    if (!best || price.internalCredits > best.internalCredits) best = price;
  }
  return best;
}

// Which affordable video to suggest first: the newest models ahead of older ones that merely cost more.
const VIDEO_PREFERENCE = ['veo31-lite', 'grok-video', 'wan-3'];
const GROK_FIRST = ['grok-video', 'veo31-lite', 'wan-3'];
function preferenceRank(modelId, order = VIDEO_PREFERENCE) {
  const index = order.indexOf(modelId);
  return index === -1 ? order.length : index;
}

// A new user's first video starts on Grok (6 seconds, 720p): the cheapest good first video, and the one most
// buyers tried before paying. The requested duration is not used here: ChatGPT often picks 10 seconds on its
// own. Only ChatGPT knows whether the user asked for a length, so the next_step tells it when to use
// Veo 3.1 Lite (8 seconds, 720p) instead.
export function firstVideoOrder() {
  return GROK_FIRST;
}

export function optionsWithinBalance(modelId, input, balanceInternal, limit = 4, order = VIDEO_PREFERENCE, cheapest = false) {
  const requested = getModel(modelId);
  if (!requested) return [];
  const needs = requestedInputKinds(input);
  const candidates = listModels({ category: requested.category, includeUnavailable: false })
    .filter((model) => model.availability === 'available' && getRunner(model.id) && fitsRequestedInputs(model, needs));
  const options = [];
  for (const model of candidates) {
    const best = cheapest ? cheapestQuote(model, needs.video) : bestQuoteWithin(model, needs.video, balanceInternal);
    const price = best && best.internalCredits <= balanceInternal ? best : null;
    if (!price) continue;
    options.push({
      model_id: model.id,
      model_name: model.name,
      settings: quoteSettings(price),
      credits: price.displayedCredits,
      same_model: model.id === requested.id
    });
  }
  options.sort((a, b) => (b.same_model - a.same_model) || (preferenceRank(a.model_id, order) - preferenceRank(b.model_id, order)) || (b.credits - a.credits));
  return options.slice(0, limit);
}

// A new user's first video was refused by its model (for example a photo the provider rejects). The next
// model further down the preference list, so a chain of refusals always ends.
export function nextFirstVideoOption(model, input, balanceInternal, order = VIDEO_PREFERENCE) {
  const rank = preferenceRank(model.id, order);
  return optionsWithinBalance(model.id, input, balanceInternal, 4, order, true)
    .filter((option) => option.model_id !== model.id && preferenceRank(option.model_id, order) > rank)
    .sort((a, b) => preferenceRank(a.model_id, order) - preferenceRank(b.model_id, order))[0] || null;
}

function sameRequest(option, model, input = {}) {
  if (!option || option.model_id !== model.id) return false;
  const settings = option.settings || {};
  const resolution = input.resolution || input.quality;
  return (settings.duration == null || Number(input.duration) === Number(settings.duration))
    && (settings.resolution == null || String(resolution || '') === String(settings.resolution));
}

// When no video fits (often the free credits are partly used), an image of the same idea usually still does.
function imageWithinBalance(balanceInternal) {
  let best = null;
  for (const model of listModels({ category: 'image', includeUnavailable: false })) {
    if (model.availability !== 'available' || !getRunner(model.id) || !fitsRequestedInputs(model, { image: false, video: false, audio: false })) continue;
    const price = cheapestQuote(model, false);
    if (!price || price.internalCredits > balanceInternal) continue;
    if (!best || price.internalCredits > best.price.internalCredits) best = { model, price };
  }
  return best ? { model_id: best.model.id, model_name: best.model.name, settings: quoteSettings(best.price), credits: best.price.displayedCredits } : null;
}

export function insufficientCreditsResult({ model, price, balanceInternal, input, firstGeneration = false }) {
  const available = Number((Number(balanceInternal || 0) * 10).toFixed(2));
  const firstVideo = firstGeneration && model.category === 'video' ? firstVideoOrder(input) : undefined;
  const options = firstVideo
    ? optionsWithinBalance(model.id, input, balanceInternal, 4, firstVideo, true)
    : optionsWithinBalance(model.id, input, balanceInternal);
  const imageInstead = !options.length && model.category === 'video' ? imageWithinBalance(balanceInternal) : null;
  // A brand-new user's free credits rarely cover the model ChatGPT picked. Make their first result
  // right away with the best option that fits instead of asking them to choose. Only once: if the
  // option itself was refused, fall back to asking.
  const startFirst = firstGeneration && options.length > 0 && !sameRequest(options[0], model, input);
  if (startFirst) {
    const first = options[0];
    const settings = Object.entries(first.settings || {}).map(([key, value]) => `${key} ${value}`).join(', ');
    const veoOption = options.find((option) => option.model_id === 'veo31-lite');
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
        `When it starts, tell the user in one short, friendly line that their first video is being made with ${first.model_name} (${first.credits} credits) so it fits their free credits.`,
        'The model that makes this video is the model in use for the user\'s next videos (video_selection_guide step 8).',
        // Grok makes 6 seconds within the free credits and cannot speak languages other than English and
        // Chinese; Veo makes 8 seconds and speaks every language.
        first.model_id === 'grok-video' && veoOption
          ? `Exception: use model_id veo31-lite with ${Object.entries(veoOption.settings || {}).map(([key, value]) => `${key} ${value}`).join(', ')} (${veoOption.credits} credits) instead only if the user themselves asked for a video longer than 6 seconds, or if people in the video must speak a language other than English or Chinese. A length you picked yourself does not count. In that case name Veo 3.1 Lite and its credits in your line.`
          : ''
      ].filter(Boolean).join(' ')
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
    ...(imageInstead ? { image_instead: imageInstead } : {}),
    next_step: [
      'Nothing was generated and no credits were used.',
      'Do not call create_generation again on your own and do not switch to another model or setting without the user choosing it.',
      `Tell the user that this request needs ${price ? price.displayedCredits : 'more'} Hansora credits and their balance is ${available} credits. Always use these numbers as given.`,
      options.length
        ? 'Offer the options in options_within_balance (model, settings and credits) and wait for the user to pick one.'
        : imageInstead
          ? `No video fits the current balance, but an image does: offer once, in one short line, to make an image of the same idea with ${imageInstead.model_name} for ${imageInstead.credits} credits, and start it only if they agree.`
          : 'Nothing fits the current balance; tell the user that plainly, once.',
      options.length ? '' : 'Do not call create_generation again for this request.'
    ].filter(Boolean).join(' ')
  };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

export function accountSummary(account, lastVideo = null) {
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
    image_models_within_balance: fitting('image').length,
    ...(lastVideo ? {
      last_video: lastVideo,
      last_video_note: 'The model of the user\'s last video. For a new video, offer it first as "Same quality as your last video" (see video_selection_guide steps 4 and 8).'
    } : {})
  };
}
