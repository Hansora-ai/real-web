import crypto from 'node:crypto';
import { McpServer, createMcpHandler, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { AuthUnavailableError, authenticateToken, getAccount, getGeneration, countRunning, getFirstVideoRecipe, hadRecentOutcome, getGenerationBatch, getLastVideo, isFirstGeneration, listGenerations } from '../../lib/hansora-mcp/data.mjs';
import {
  GENERATION_APP_MIME,
  GENERATION_APP_URI,
  GENERATION_TOOL_META,
  generationAppResource
} from '../../lib/hansora-mcp/generation-app.mjs';
import { OPENAI_FILE_PARAMS, normalizeGenerationFiles, openAIFileSchema, storeGenerationFiles } from '../../lib/hansora-mcp/file-inputs.mjs';
import { PHOTO_SHAPED_MODELS, VIDEO_SELECTION_GUIDE, buildAudioPayload, buildGenerationPayload, getModel, getRunner, listModels, quote, startingFrame } from '../../lib/hansora-mcp/registry.mjs';
import { photoShape } from '../../lib/hansora-mcp/image-shape.mjs';
import { alternativeFor, classifyFailure, failureView, modelIdOf, switchStep } from '../../lib/hansora-mcp/failures.mjs';
import { unavailableModels } from '../../lib/hansora-mcp/health.mjs';
import { veoResting } from '../../lib/hansora-mcp/veo-rest.mjs';
import { recordToolEvent, recordVideoRecipe } from '../../lib/hansora-mcp/events.mjs';
import { accountSummary, firstVideoOrder, insufficientCreditsResult, nextFirstVideoOption, optionsWithinBalance, publicQuote, quoteOptionsFromRequest } from '../../lib/hansora-mcp/credits.mjs';

const PUBLIC_ORIGIN = String(process.env.URL || 'https://hansora.co').replace(/\/+$/, '');
const MCP_URL = new URL('/mcp', PUBLIC_ORIGIN);
// Models that add a reference video's length to the price (on every platform that offers them).
const REFERENCE_VIDEO_MODELS = new Set(['seedance25', 'seedance20', 'wan-3', 'kling40']);
// Launchers that report the real charge, measured from the uploaded files.
const EDIT_MODELS = new Set(['henshin', 'henshin-lite']);
const MEASURED_CHARGE_MODELS = new Set(['seedance25', 'seedance20', 'wan-3', 'henshin', 'henshin-lite', 'kling40']);
// Launchers that refuse any request without the quoted price, even without video input.
const PRICE_CHECKED_MODELS = new Set(['henshin-lite', 'kling40']);
// ChatGPT gives up on a tool call after roughly a minute; answer well before that.
const SUBMIT_BUDGET_MS = 25000;
const PUBLIC_GENERATION_FAILURE = 'Generation failed. Please try again and make sure your prompt and image do not violate any policy.';

function jsonText(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

// The model of the user's last video, offered first when they ask for a new one. Video edits are a
// different job (Henshin runs on Kling 4.0 or Seedance, so it is read from the provider and engine), and
// a model that needs a source video or that ChatGPT can no longer start is left out.
const EDIT_RUN = /henshin|video-edit/i;
function lastVideoModel(generation) {
  if (!generation || EDIT_RUN.test(`${generation.provider || ''} ${generation.meta?.engine || ''}`)) return null;
  const model = getModel(modelIdOf(generation));
  if (!model || model.category !== 'video' || EDIT_MODELS.has(model.id) || model.input?.requires_video) return null;
  if (model.availability !== 'available' || !getRunner(model.id)) return null;
  return { model_id: model.id, model_name: model.name };
}

// Henshin and Henshin Lite are priced by the length of the user's video. Before that length is known, the
// rate per 10 seconds stands in for the price instead of an error.
function videoLengthRate(model, resolution) {
  if (!model || !EDIT_MODELS.has(model.id)) return null;
  const limits = model.input?.source_video_seconds || {};
  const per10 = quote(model.id, { duration: 10, resolution });
  return {
    price_by_video_length: true,
    credits_per_10_seconds: per10.displayedCredits,
    resolution: per10.settings.resolution,
    min_video_seconds: Number(limits.min) || null,
    max_video_seconds: Number(limits.max) || null
  };
}

// Database or network trouble on Hansora's side. The user gets a calm explanation instead of a raw
// error code, and ChatGPT knows nothing was charged and what to do next.
const INFRASTRUCTURE_ERROR = /data_request_failed|server_misconfigured|abort|timeout|timed out|fetch failed|network|socket|ECONN|ENOTFOUND|upload_sign_failed_5|generation_submit_failed_5/i;
const BUSY_STEPS = {
  read: 'Tell the user, in their language, that Hansora could not check this for a moment. Any generation keeps running and nothing extra was charged. Wait a few seconds and call the same tool once more; if it still fails, ask them to check again in a minute.',
  create: 'Tell the user, in their language, that Hansora is busy for a moment and nothing was charged. Wait a few seconds and try the same request once more; if it fails again, ask them to try again in a minute.'
};

// Each get_generation call draws another card, so after a start the assistant should leave updates to the
// card unless the user asks.
const CARD_FOLLOWS_RUN = 'Tell the user briefly that it has started. The card shows progress and the result by itself, so do not call get_generation on your own; call it only when the user asks about the status or the result, or says they cannot see it.';

function toolError(error, kind = 'read') {
  const message = error instanceof Error ? error.message : String(error || 'unknown_error');
  if (!INFRASTRUCTURE_ERROR.test(message)) return { isError: true, content: [{ type: 'text', text: message }] };
  console.warn('hansora_mcp_busy', JSON.stringify({ kind, reason: message.slice(0, 200) }));
  const value = {
    ok: false,
    error: 'temporarily_unavailable',
    message: kind === 'create' ? 'Hansora is busy for a moment. Nothing was charged.' : 'Hansora could not check this right now. Your generation keeps running.',
    credits_used: 0,
    next_step: BUSY_STEPS[kind] || BUSY_STEPS.read
  };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

// A run started a moment ago may not have its row yet (slow submit or database); it is starting, not missing.
function startingRun(runId) {
  const startedAt = Number((String(runId).match(/-mcp-(?:audio-)?(\d{13})-/) || [])[1]);
  if (!Number.isFinite(startedAt) || Date.now() - startedAt > 5 * 60 * 1000) return null;
  return { run_id: runId, status: 'processing', message: 'Starting. This card updates automatically.', next_step: 'The generation is starting. Check again with get_generation in a little while.' };
}

function generationToolMeta(invoking, invoked) {
  return {
    ...GENERATION_TOOL_META,
    'openai/toolInvocation/invoking': invoking,
    'openai/toolInvocation/invoked': invoked
  };
}

function creditFailureMessage(meta) {
  const reason = [meta.error_summary, meta.error, meta.fail_reason].map((value) => (typeof value === 'string' ? value : '')).join(' ');
  if (!/not_enough_credits|insufficient_credits/i.test(reason)) return '';
  const need = Number(meta.need);
  const credits = Number(meta.credits);
  const amounts = Number.isFinite(need) && Number.isFinite(credits)
    ? ` It needed ${Number((need * 10).toFixed(2))} Hansora credits and the balance was ${Number((credits * 10).toFixed(2))}.`
    : '';
  return `Not enough credits for this generation.${amounts} Nothing was generated and no credits were used. Do not retry on your own; tell the user and let them choose how to continue.`;
}

function presentGeneration(generation, runId, unavailable = new Set()) {
  const meta = generation?.meta && typeof generation.meta === 'object' ? generation.meta : {};
  const status = generation?.result_url ? 'ready' : String(meta.status || 'processing');
  if (/(fail|error|refund|cancel)/i.test(status)) {
    const view = creditFailureMessage(meta) ? null : failureView(generation, displayModelName(generation) || 'This model', { unavailable });
    const failure = creditFailureMessage(meta) || view?.message || PUBLIC_GENERATION_FAILURE;
    return {
      ...(view ? {
        failure_kind: view.failure_kind,
        failure_title: view.failure_title,
        card_message: view.card_message,
        credits_refunded: view.credits_refunded,
        ...(view.failure_reason ? { failure_reason: view.failure_reason } : {}),
        ...(view.alternative ? { alternative: view.alternative } : {}),
        ...('auto_switch' in view ? { auto_switch: view.auto_switch } : {}),
        next_step: view.next_step
      } : {}),
      model_name: displayModelName(generation),
      id: generation?.id,
      provider: generation?.provider,
      kind: generation?.kind,
      prompt: generation?.prompt,
      result_url: null,
      created_at: generation?.created_at,
      run_id: String(meta.run_id || runId || ''),
      status: 'failed',
      media_type: String(meta.media_type || generation?.kind || ''),
      error: failure,
      message: failure,
      meta: {
        run_id: String(meta.run_id || runId || ''),
        status: 'failed',
        media_type: String(meta.media_type || generation?.kind || ''),
        error: failure,
        fail_reason: failure
      }
    };
  }
  return {
    ...generation,
    model_name: displayModelName(generation),
    run_id: String(meta.run_id || runId || ''),
    status,
    media_type: String(meta.media_type || generation?.kind || ''),
    ...(status === 'ready' ? {
      // Some ChatGPT apps cannot show the card; then the assistant once built a download link itself and
      // got it wrong. Hand it the exact link to pass on.
      link_for_user: generation.result_url,
      next_step: [
        `The result is ready. Give the user this exact link to open or download it, copied character for character: ${generation.result_url} . Never build, shorten or change a link yourself.`,
        meta.henshin_model === 'lite' ? 'Only if they are not satisfied, offer to redo it with Henshin, the stronger version, and tell them its price from quote_generation; do not offer it otherwise.' : ''
      ].filter(Boolean).join(' ')
    } : {})
  };
}

// Marks a model that is failing for everyone right now (see health.mjs) and names its backup.
function withHealth(model, unavailable) {
  if (!model || !unavailable.has(model.id)) return model;
  const backup = alternativeFor(model.id, unavailable);
  return {
    ...model,
    current_status: 'temporarily_unavailable',
    status_note: `${model.name} is having temporary issues right now.${backup ? ` Use ${backup.model_name} (${backup.model_id}) instead.` : ' Try again in about 10 minutes.'}`
  };
}

// A model with a temporary issue at submit time, or already set aside: nothing is charged, and
// ChatGPT switches to the backup on its own when it costs no more.
function temporaryIssueResult(model, price, unavailable, reason = '') {
  const backup = alternativeFor(model.id, unavailable);
  const credits = price ? price.displayedCredits : NaN;
  const step = backup ? switchStep(model.name, backup, credits, { refunded: false }) : null;
  const value = {
    ok: false,
    error: 'model_temporarily_unavailable',
    failure_kind: 'temporary',
    generated: false,
    credits_used: 0,
    model_id: model.id,
    model_name: model.name,
    message: `${model.name} is having a temporary issue right now${reason ? ` (${reason})` : ''}. It wasn't caused by the prompt or image. Nothing was generated and no credits were used.`,
    ...(backup ? { alternative: backup, auto_switch: step.auto } : {}),
    next_step: step ? step.text : 'Tell the user this in their language and offer to try again in about 10 minutes.'
  };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

// reAPI runs a limited number of tasks at once for the whole account (150, shared by images and videos). Each
// user may have up to 50 running per engine, so no single user or runaway series can take them all.
const RUNNING_ENGINES = Object.freeze({ 'wan-3': 'wan-3', seedance25: 'seedance-2.5', seedance20: 'seedance-2.0' });
const MAX_RUNNING_PER_USER = 50;
function busyResult(model, { running = null, provider = false } = {}) {
  const value = {
    ok: false, error: 'too_many_running', generated: false, credits_used: 0, model_id: model.id, model_name: model.name,
    ...(running != null ? { running } : {}),
    message: provider
      ? `${model.name} is making too many videos at once right now. Nothing was charged.`
      : `${running} of the user's ${model.name} videos are still being made, and up to ${MAX_RUNNING_PER_USER} can run at once. Nothing was charged.`,
    next_step: provider
      ? `Nothing was started or charged. Do not switch model. Tell the user in one short line that ${model.name} is busy for a moment, wait about a minute, then call create_generation again with the same settings.`
      : `Do not start this one yet and do not switch model. Tell the user in one short line that it will start as soon as one of their videos finishes. When one is done (get_generation), call create_generation again with the same settings, one video at a time.`
  };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

// Hansora's own safety check refused the prompt before anything ran. Every model gets the same check,
// so ChatGPT must not try another one; it offers a clean version of the idea instead.
const NO_MODEL_WILL = 'Hansora does not create sexual or NSFW content with any model, so trying another model will not help.';
function contentBlockedResult(model, result) {
  const sexual = /sexual|nsfw/i.test(String(result.category || ''));
  const value = {
    ok: false, error: 'content_blocked', generated: false, credits_used: 0, model_id: model.id, model_name: model.name,
    category: result.category || null,
    blocked_by: result.source || 'filter',
    message: sexual ? `This request was blocked: ${NO_MODEL_WILL}` : String(result.message || 'This request was blocked by the content policy.'),
    next_step: sexual
      ? `Nothing was generated or charged. Tell the user briefly and kindly, in their language, that every model refuses sexual or NSFW content, so switching models will not help. Offer to make a non-sexual version of their idea instead (for example romantic, playful or stylish), and suggest a concrete rewrite. Do not submit this request or a reworded sexual version to any model.`
      : 'Nothing was generated or charged. Tell the user why in their language and offer to change the request. Do not submit it to another model.'
  };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

// A new user's first video should still happen when its model refuses it (a photo Kling rejects, Google's
// safety review on Veo): offer the next model their free credits cover. Null when this is not a first
// video or nothing further fits; lookups that fail mean "no fallback", never an error.
async function firstVideoFallback(userId, model, input) {
  if (model?.category !== 'video') return null;
  try {
    if (!(await isFirstGeneration(userId))) return null;
    const account = await getAccount(userId);
    return nextFirstVideoOption(model, input, Number(account?.internal_credits || 0), firstVideoOrder(input));
  } catch {
    return null;
  }
}

function firstVideoFallbackResult(model, option, reason) {
  const settings = Object.entries(option.settings || {}).map(([key, value]) => `${key} ${value}`).join(', ');
  const value = {
    ok: false, error: 'first_video_refused', generated: false, credits_used: 0,
    model_id: model.id, model_name: model.name, reason: reason || null, next_option: option,
    next_step: [
      `${model.name} could not make this video and nothing was charged. This is the user's first video, so do not stop or ask:`,
      `call create_generation right now with model_id ${option.model_id}${settings ? ` and ${settings}` : ''}, keeping the same prompt and files (fit the prompt to that model if needed).`,
      `Then tell the user in one short line that their first video is being made with ${option.model_name}.`
    ].join(' ')
  };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

// Sends a run to Hansora's runner (safe-run checks content and credits first).
async function submitRun({ origin, token, userId, endpoint, model, prompt, usageMode, payload, timeoutMs = SUBMIT_BUDGET_MS }) {
  const reply = await fetch(`${origin}/.netlify/functions/safe-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-USER-ID': userId },
    body: JSON.stringify({ target_endpoint: endpoint, model_id: model.id, model_name: model.name, kind: model.category, prompt, usage_mode: usageMode, payload }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await reply.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { message: text }; }
  return { response: reply, result: body };
}

// A video that failed on the provider's side (an outage, not the prompt or photo) is started once more on
// another model, under a fixed run id so it can never start twice: a new user's first video after any such
// failure, and anyone's Veo video after a temporary Google problem ("Internal Error", or Veo could not make
// the sound). A video is better than none, so this holds for every language. The card keeps following the
// original run id, shows the new video and says which model made it. Content blocks, unusable inputs and
// retries of a retry are left as they are. Null means "no retry".
const RETRY_SUFFIX = '-retry';
const VEO_MODELS = new Set(['veo31-lite', 'veo31-fast', 'veo31']);
const VEO_AUDIO_FAILURE = /unable to generate audio/i;
async function providerRetry({ userId, token, origin, runId, presented, generation }) {
  if (presented.status !== 'failed' || runId.endsWith(RETRY_SUFFIX)) return null;
  if (!['temporary', 'unknown'].includes(presented.failure_kind)) return null;
  const failedMeta = generation?.meta && typeof generation.meta === 'object' ? generation.meta : {};
  const audioFailure = VEO_AUDIO_FAILURE.test([failedMeta.error, failedMeta.provider_message, failedMeta.error_summary].map((value) => (typeof value === 'string' ? value : '')).join(' '));
  const retryId = `${runId}${RETRY_SUFFIX}`;
  let retry = await getGeneration(userId, retryId).catch(() => null);
  let startedModel = null;
  if (!retry) {
    const recipe = await getFirstVideoRecipe(userId, runId);
    const failed = recipe ? getModel(recipe.model_id) : null;
    if (!failed || failed.category !== 'video') return null;
    const veoOutage = VEO_MODELS.has(failed.id) && presented.failure_kind === 'temporary';
    if (!veoOutage && !(await isFirstGeneration(userId))) return null;
    const account = await getAccount(userId).catch(() => null);
    if (!account) return null;
    const request = {
      prompt: String(recipe.prompt || ''),
      image_urls: Array.isArray(recipe.image_urls) ? recipe.image_urls : [],
      ...(recipe.aspect_ratio ? { aspect_ratio: recipe.aspect_ratio } : {}),
      ...(typeof recipe.generate_audio === 'boolean' ? { generate_audio: recipe.generate_audio } : {}),
      ...(typeof recipe.sound === 'boolean' ? { sound: recipe.sound } : {})
    };
    if (!request.prompt) return null;
    // Never more than the user's first try cost (it was refunded), so the retry needs no new consent.
    const meta = generation?.meta && typeof generation.meta === 'object' ? generation.meta : {};
    const firstTry = Number(meta.charged_cost ?? meta.charge_cost ?? meta.refund_amount) * 10;
    if (!(firstTry > 0)) return null;
    const option = optionsWithinBalance(failed.id, request, Number(account.internal_credits || 0), 4, firstVideoOrder(), true)
      .find((candidate) => candidate.model_id !== failed.id && candidate.credits <= firstTry);
    const model = option ? getModel(option.model_id) : null;
    const endpoint = model ? getRunner(model.id) : '';
    if (!model || !endpoint) return null;
    const payload = buildGenerationPayload(model.id, { ...request, ...option.settings }, userId, retryId);
    try {
      const { response } = await submitRun({ origin, token, userId, endpoint, model, prompt: request.prompt, usageMode: 'credits', payload, timeoutMs: 15000 });
      if (!response.ok) return null;
    } catch (error) {
      // Still submitting on Hansora's side: the next check finds the new run.
      if (!/abort|timeout/i.test(String(error?.name) + String(error?.message))) return null;
    }
    console.warn('hansora_mcp_first_video_retry', JSON.stringify({ runId, from: failed.id, to: model.id }));
    startedModel = model;
    retry = await getGeneration(userId, retryId).catch(() => null);
  } else {
    if (await refreshFromProvider(userId, [retry], origin).catch(() => false)) {
      retry = (await getGeneration(userId, retryId).catch(() => null)) || retry;
    }
  }
  const view = retry ? presentGeneration(retry, retryId) : {
    status: 'processing', media_type: 'video', kind: 'video', model_name: startedModel?.name || '', prompt: presented.prompt
  };
  const retryMeta = retry?.meta && typeof retry.meta === 'object' ? retry.meta : {};
  const credits = Number(retryMeta.charged_cost ?? retryMeta.charge_cost ?? retryMeta.refund_amount) * 10;
  const failedName = getModel(modelIdOf(generation))?.name || presented.model_name || 'The first model';
  const note = switchNote({
    from: failedName,
    to: view.model_name || startedModel?.name || 'another model',
    credits: credits > 0 ? Number(credits.toFixed(2)) : null,
    reason: audioFailure ? 'audio' : 'outage'
  });
  return {
    ...view,
    run_id: runId,
    retry_run_id: retryId,
    switch_note: note,
    meta: { ...(view.meta && typeof view.meta === 'object' ? view.meta : {}), run_id: runId },
    ...(view.status === 'processing' ? {
      message: note,
      next_step: `${note} The card shows this and the new video by itself. In your next reply, tell the user this in one short line.`
    } : {})
  };
}

// While Veo rests (see veo-rest.mjs), a ChatGPT Veo request is made with Grok, 6 seconds at 720p (18 credits,
// never more than Veo), with the same prompt, photo and shape. Requests Grok cannot take as they are (a
// source video, more than one photo, a last frame, a prompt over its 5,000 characters) still go to Veo.
async function veoRestSwitch(input) {
  const model = getModel(input.model_id);
  if (!model || !VEO_MODELS.has(model.id) || input.usage_mode === 'unlimited') return null;
  const files = normalizeGenerationFiles(input);
  const photos = (files.image_urls || []).length + (input.first_frame_url ? 1 : 0);
  if (files.video_urls?.length || input.source_video_url || input.last_frame_url || photos > 1) return null;
  if (String(input.prompt || '').length > 5000) return null;
  if (!(await veoResting().catch(() => false))) return null;
  const { quality: _quality, ...rest } = input;
  return { from: model.name, input: { ...rest, model_id: 'grok-video', duration: 6, resolution: '720p' } };
}

// A new user's first video should be Grok (6 s, 720p, 18 credits): the cheapest good first video, and the one
// buyers liked most. ChatGPT sends simple clips to Veo, which the free credits also cover, so a first video
// sent to Veo comes back once with "use Grok". Veo stays right when the user themselves asked for more than 6
// seconds or for speech in a language other than English or Chinese: ChatGPT then sends Veo again, and a
// recent steer (this one, or the free-credit switch) lets it through, so it never loops.
const FIRST_VIDEO_STEERED = ['first_video_on_grok', 'switched_to_affordable'];
async function firstVideoOnGrok(userId, input, balanceInternal) {
  const model = getModel(input.model_id);
  if (!model || !VEO_MODELS.has(model.id) || input.usage_mode === 'unlimited') return null;
  const files = normalizeGenerationFiles(input);
  const photos = (files.image_urls || []).length + (input.first_frame_url ? 1 : 0);
  if (files.video_urls?.length || input.source_video_url || input.last_frame_url || photos > 1) return null;
  if (String(input.prompt || '').length > 5000) return null;
  const grok = quote('grok-video', { duration: 6, resolution: '720p' });
  if (Number(balanceInternal) < grok.internalCredits) return null;
  if (!(await isFirstGeneration(userId))) return null;
  if (await hadRecentOutcome(userId, FIRST_VIDEO_STEERED, new Date(Date.now() - 10 * 60 * 1000).toISOString())) return null;
  const value = {
    ok: false, error: 'first_video_on_grok', generated: false, credits_used: 0,
    model_id: model.id, model_name: model.name,
    next_option: { model_id: 'grok-video', model_name: 'Grok Video', settings: { duration: 6, resolution: '720p' }, credits: grok.displayedCredits },
    next_step: [
      `Nothing was generated or charged. This is the user's first video, so do not ask anything:`,
      `call create_generation right now with model_id grok-video, duration 6, resolution 720p, keeping the same prompt, photo and aspect_ratio.`,
      `Exception: only if the user themselves asked for a video longer than 6 seconds, or people in it must speak a language other than English or Chinese, call create_generation again exactly as before with ${model.id}.`,
      `When it starts, tell the user in one short, friendly line which model is making their first video and its credits.`
    ].join(' ')
  };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

// What the user reads when a video was made with another model than the one they asked for.
function switchNote({ from, to, credits, reason }) {
  const cause = reason === 'audio' ? `${from} could not make the sound`
    : reason === 'resting' ? `${from} is having a temporary issue on the provider's side right now`
      : `${from} had a temporary issue on the provider's side`;
  const sentences = [`${cause}, so this video was made with ${to} instead.`];
  if (credits != null) sentences.push(`You were charged the ${to} price (${credits} credits).`);
  if (reason !== 'resting') sentences.push(`The ${from} try was refunded.`);
  return sentences.join(' ');
}

function displayModelName(generation) {
  const meta = generation?.meta && typeof generation.meta === 'object' ? generation.meta : {};
  for (const id of [meta.model_id, meta.engine, meta.model]) {
    const model = typeof id === 'string' && id ? getModel(id) : null;
    if (model?.name) return model.name;
  }
  return String(generation?.provider || meta.model || '');
}

function batchItem(generation) {
  const meta = generation?.meta && typeof generation.meta === 'object' ? generation.meta : {};
  const presented = presentGeneration(generation, meta.run_id);
  const status = presented.status === 'failed' ? 'failed' : generation?.result_url ? 'ready' : 'processing';
  return {
    run_id: String(meta.run_id || ''),
    status,
    result_url: status === 'ready' ? generation.result_url : null,
    media_type: String(meta.media_type || generation?.kind || ''),
    model_name: displayModelName(generation),
    created_at: generation?.created_at
  };
}

// Every generation ChatGPT started in the same burst, so one card (and the assistant) sees all of them.
// The website asks KIE directly while it waits, which also repairs a missed or unreadable callback.
// ChatGPT cards only read the row, so do the same check here for runs that stay "processing".
const PROVIDER_CHECK_AFTER_MS = 60 * 1000;
const PROVIDER_CHECK_EVERY_MS = 20 * 1000;
const lastProviderCheck = new Map();

function needsProviderCheck(generation) {
  const meta = generation?.meta && typeof generation.meta === 'object' ? generation.meta : {};
  if (generation?.result_url || !(meta.task_id || meta.taskId)) return false;
  if (!/^(processing|pending|queued|running|)$/i.test(String(meta.status || ''))) return false;
  if (meta.checker && meta.checker !== 'kie-check') return false;
  if (meta.source_feature === 'henshin') return false;
  const age = Date.now() - Date.parse(generation.created_at || '');
  return Number.isFinite(age) && age > PROVIDER_CHECK_AFTER_MS;
}

async function refreshFromProvider(userId, generations, origin) {
  const due = generations.filter((generation) => {
    const runId = String(generation?.meta?.run_id || '');
    if (!runId || !needsProviderCheck(generation)) return false;
    if (Date.now() - (lastProviderCheck.get(runId) || 0) < PROVIDER_CHECK_EVERY_MS) return false;
    lastProviderCheck.set(runId, Date.now());
    return true;
  }).slice(0, 4);
  if (lastProviderCheck.size > 2000) lastProviderCheck.clear();
  await Promise.all(due.map((generation) => fetch(
    `${origin}/.netlify/functions/kie-check?uid=${encodeURIComponent(userId)}&run_id=${encodeURIComponent(generation.meta.run_id)}`,
    { signal: AbortSignal.timeout(8000) }
  ).catch(() => null)));
  return due.length > 0;
}

async function batchFields(userId, runId) {
  const rows = await getGenerationBatch(userId, runId).catch(() => []);
  if (rows.length < 2) return {};
  const batch = rows.map(batchItem);
  const count = (status) => batch.filter((item) => item.status === status).length;
  const ready = batch.map((item, index) => ({ ...item, number: index + 1 })).filter((item) => item.status === 'ready');
  return {
    batch,
    batch_summary: [
      `${batch.length} generations were started together in this request: ${count('ready')} ready, ${count('processing')} still generating, ${count('failed')} failed.`,
      ready.length ? `Ready results: ${ready.map((item) => `#${item.number} ${item.result_url}`).join(' ; ')}.` : '',
      'The card shows all of them as a gallery; in your reply also give the user a link to every ready result above, numbered in this order, so none is missed.',
      count('processing') ? 'Results that are still generating are not missing: call get_generation again with any of these run_ids in a little while to refresh all of them.' : ''
    ].filter(Boolean).join(' ')
  };
}

function bearerToken(request) {
  return (String(request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i) || [])[1] || '';
}

function authenticationRequired() {
  return new Response(JSON.stringify({ error: 'invalid_token', error_description: 'Connect your Hansora account to continue.' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'WWW-Authenticate': `Bearer resource_metadata="${getOAuthProtectedResourceMetadataUrl(MCP_URL)}"`
    }
  });
}

// Sign-in could not be checked because Supabase is unreachable; the user's login is still valid.
function temporarilyUnavailable() {
  return new Response(JSON.stringify({ error: 'temporarily_unavailable', error_description: 'Hansora is temporarily unavailable. Please try again in a minute.' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '30' }
  });
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate');
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function signUploadForApp(ctx, token, { filename, mime, size }) {
  const origin = ctx.requestInfo ? new URL(ctx.requestInfo.url).origin : PUBLIC_ORIGIN;
  const response = await fetch(`${origin}/.netlify/functions/sign-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ filename, mime, size }),
    signal: AbortSignal.timeout(30000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.uploadUrl || !result.publicUrl) {
    throw new Error(result.error || result.detail || `upload_sign_failed_${response.status}`);
  }
  return jsonText({
    ok: true,
    upload_url: result.uploadUrl,
    public_url: result.publicUrl,
    mime: result.mime || mime,
    size
  });
}

export function createHansoraServer(ctx) {
  const userId = String(ctx.authInfo?.extra?.userId || '');
  const token = String(ctx.authInfo?.token || '');
  const server = new McpServer({ name: 'Hansora AI', version: '1.0.0' }, { capabilities: { tools: {} } });
  // Record each tool call (tool, model, outcome, price) without changing any tool definition.
  const waitUntil = ctx.authInfo?.extra?.waitUntil;
  const registerTool = server.registerTool.bind(server);
  server.registerTool = (name, config, callback) => registerTool(name, config, async (input, extra) => {
    const result = await callback(input, extra);
    recordToolEvent(userId, name, input, result, waitUntil);
    return result;
  });

  server.registerResource('hansora-generation-app', GENERATION_APP_URI, {
    title: 'Hansora generation',
    description: 'Animated progress and inline media result for a Hansora generation.',
    mimeType: GENERATION_APP_MIME
  }, async () => generationAppResource());

  server.registerTool('list_models', {
    title: 'List Hansora models',
    description: 'List every public Hansora image, video, and audio model or tool, including availability and supported inputs.',
    inputSchema: z.object({
      category: z.enum(['image', 'video', 'audio']).optional().describe('Optional category filter.'),
      include_unavailable: z.boolean().default(true).describe('Include announced models whose generation runner is not deployed yet.')
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ category, include_unavailable }) => {
    const unavailable = await unavailableModels();
    const models = listModels({ category, includeUnavailable: include_unavailable }).map((model) => withHealth(model, unavailable));
    const listed = models.map(({ video_selection_guide: _guide, ...model }) => model);
    const hasVideo = listed.some((model) => model.category === 'video');
    return jsonText({ ...(hasVideo ? { video_selection_guide: VIDEO_SELECTION_GUIDE } : {}), models: listed, count: listed.length });
  });

  server.registerTool('get_model', {
    title: 'Get Hansora model',
    description: 'Get capabilities, media requirements, allowed settings, availability and recommendations for one Hansora model.',
    inputSchema: z.object({ model_id: z.string().min(1) }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ model_id }) => {
    const model = getModel(model_id);
    return model ? jsonText(withHealth(model, await unavailableModels())) : toolError(new Error('unsupported_model'));
  });

  server.registerTool('quote_generation', {
    title: 'Quote a Hansora generation',
    description: 'Calculate the exact Hansora credit quote before submitting. Displayed credits are 10 times internal billing credits.',
    inputSchema: z.object({
      model_id: z.string().min(1),
      duration: z.number().positive().optional(),
      character_count: z.number().int().min(1).max(100000).optional(),
      audio_duration_seconds: z.number().positive().max(86400).optional(),
      resolution: z.string().optional(),
      quantity: z.number().int().min(1).max(50).default(1),
      sound: z.boolean().optional(),
      has_video_input: z.boolean().optional(),
      source_video_duration: z.number().nonnegative().optional().describe('For Wan 3.0 video input, combined duration in seconds of all reference videos. Verified by the server before charging.')
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] }, 'openai/widgetAccessible': true }
  }, async ({ model_id, ...options }) => {
    try {
      const rate = !(Number(options.duration) > 0) ? videoLengthRate(getModel(model_id), options.resolution) : null;
      if (rate) {
        return jsonText({
          model_id: getModel(model_id).id,
          model_name: getModel(model_id).name,
          ...rate,
          next_step: `${getModel(model_id).name} is priced by the length of the user's video: ${rate.credits_per_10_seconds} credits per 10 seconds at ${rate.resolution}. If you know the video's length, quote again with it as duration for the exact price. Otherwise give the user this rate and go ahead: Hansora measures the video and shows or charges the exact price for its real length.`
        });
      }
      const price = quote(model_id, options);
      const value = publicQuote(price);
      // ChatGPT sometimes quotes before reading the balance and then shows prices the user cannot pay.
      // A failed balance lookup just leaves the quote as it is.
      if (getModel(model_id)?.category === 'video') {
        const account = await Promise.race([
          getAccount(userId).catch(() => null),
          new Promise((resolve) => setTimeout(() => resolve(null), 2500))
        ]);
        if (account && Number(account.internal_credits || 0) < price.internalCredits) {
          value.fits_balance = false;
          value.credits_available = Number((Number(account.internal_credits || 0) * 10).toFixed(2));
          value.next_step = 'The user\'s balance does not cover this price, so do not show it to them or ask them to choose it. If you were about to offer options, call create_generation with the first option instead and follow the next_step it returns: it starts a video their credits cover or says what fits.';
        }
      }
      return jsonText(value);
    } catch (error) { return toolError(error); }
  });

  server.registerTool('get_account', {
    title: 'Get Hansora balance',
    description: 'Read the connected Hansora account credit balance and active subscription.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => {
    try {
      // The last video is extra: a slow or failed lookup leaves it out instead of delaying the balance.
      const [account, lastVideo] = await Promise.all([
        getAccount(userId),
        Promise.race([getLastVideo(userId), new Promise((resolve) => setTimeout(() => resolve(null), 2500))])
      ]);
      return jsonText(accountSummary(account, lastVideoModel(lastVideo)));
    } catch (error) { return toolError(error); }
  });

  server.registerTool('open_image_to_video_upload_card', {
    title: 'Open image-to-video upload card',
    description: 'Open Hansora’s in-chat upload card only when the host cannot pass the user’s attached image directly to create_generation. The card uploads the file, shows the credit quote, and starts the selected Hansora video model after the user confirms.',
    inputSchema: z.object({
      model_id: z.string().min(1).describe('Available Hansora video model that accepts an image input.'),
      prompt: z.string().min(1),
      aspect_ratio: z.string().optional(),
      duration: z.number().positive().optional(),
      resolution: z.string().optional(),
      quality: z.string().optional(),
      sound: z.boolean().optional(),
      generate_audio: z.boolean().optional(),
      prompt_extend: z.boolean().optional(),
      usage_mode: z.enum(['credits', 'unlimited']).default('credits')
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: generationToolMeta('Opening Hansora image upload…', 'Hansora image upload ready')
  }, async (input) => {
    try {
      const model = getModel(input.model_id);
      const limits = model?.input || {};
      const acceptsImage = Boolean(
        Number(limits.max_images) > 0 || limits.first_frame || limits.first_last_frames ||
        limits.image_references || limits.image_video_audio_references
      );
      if (!model) throw new Error('unsupported_model');
      if (model.category !== 'video' || limits.requires_video || !acceptsImage) throw new Error('model_does_not_support_image_animation');
      if (model.availability !== 'available' || !getRunner(model.id)) throw new Error('model_not_available');
      const price = quote(model.id, {
        duration: input.duration,
        resolution: input.resolution || input.quality,
        sound: input.sound,
        quantity: 1,
        has_video_input: false
      });
      return jsonText({
        mode: 'image_upload',
        status: 'awaiting_upload',
        model_id: model.id,
        model_name: model.name,
        media_type: 'video',
        prompt: input.prompt,
        aspect_ratio: input.aspect_ratio || null,
        duration: input.duration || null,
        resolution: input.resolution || input.quality || null,
        quality: input.quality || null,
        sound: input.sound,
        generate_audio: input.generate_audio,
        prompt_extend: input.prompt_extend,
        usage_mode: input.usage_mode,
        quote: publicQuote(price)
      });
    } catch (error) { return toolError(error); }
  });

  server.registerTool('start_video_generation', {
    title: 'Transform an uploaded video',
    description: 'Open Hansora’s in-chat upload card only when the host cannot pass the user’s attached video directly to create_generation. The card accepts MP4, MOV, or WebM, shows the credit quote, and starts the selected compatible Hansora model after the user confirms.',
    inputSchema: z.object({
      model_id: z.string().min(1).describe('Available Hansora video model that accepts a source or reference video.'),
      prompt: z.string().min(1),
      aspect_ratio: z.string().optional(),
      duration: z.number().positive().optional(),
      resolution: z.string().optional(),
      quality: z.string().optional(),
      sound: z.boolean().optional(),
      generate_audio: z.boolean().optional(),
      prompt_extend: z.boolean().optional(),
      video_start: z.number().min(0).optional(),
      video_end: z.number().positive().optional(),
      motion_model: z.enum(['kling26', 'kling30']).optional(),
      image_url: z.string().url().optional().describe('Optional public image URL for a model that also requires an image.'),
      usage_mode: z.enum(['credits', 'unlimited']).default('credits')
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: generationToolMeta('Opening Hansora video upload…', 'Hansora video upload ready')
  }, async (input) => {
    try {
      const model = getModel(input.model_id);
      const limits = model?.input || {};
      const acceptsVideo = Boolean(Number(limits.max_videos) > 0 || limits.image_video_audio_references || limits.requires_video);
      if (!model) throw new Error('unsupported_model');
      if (model.category !== 'video' || !acceptsVideo) throw new Error('model_does_not_support_video_input');
      if (limits.requires_image && !input.image_url) throw new Error('model_also_requires_image_url');
      if (model.availability !== 'available' || !getRunner(model.id)) throw new Error('model_not_available');
      // The video is not chosen yet, so a Henshin price waits for its length: the card reads it and quotes.
      const rate = !(Number(input.duration) > 0) ? videoLengthRate(model, input.resolution || input.quality) : null;
      const price = rate ? null : quote(model.id, {
        duration: input.duration,
        resolution: input.resolution || input.quality,
        sound: input.sound,
        quantity: 1,
        has_video_input: true
      });
      return jsonText({
        ...(rate || {}),
        mode: 'video_upload',
        status: 'awaiting_upload',
        model_id: model.id,
        model_name: model.name,
        media_type: 'video',
        prompt: input.prompt,
        aspect_ratio: input.aspect_ratio || null,
        duration: input.duration || null,
        resolution: input.resolution || input.quality || null,
        quality: input.quality || null,
        sound: input.sound,
        generate_audio: input.generate_audio,
        prompt_extend: input.prompt_extend,
        video_start: input.video_start,
        video_end: input.video_end,
        motion_model: input.motion_model,
        image_url: input.image_url || null,
        usage_mode: input.usage_mode,
        quote: publicQuote(price)
      });
    } catch (error) { return toolError(error); }
  });

  server.registerTool('start_multimedia_generation', {
    title: 'Create with uploaded reference media',
    description: 'Open one Hansora upload card only when the host cannot pass attached reference files directly to create_generation. Select only the input types the request needs; Hansora checks them against the chosen model and the card shows exactly those supported upload choices.',
    inputSchema: z.object({
      model_id: z.string().min(1).describe('Available Hansora image or video model.'),
      prompt: z.string().min(1),
      required_inputs: z.array(z.enum(['image', 'video', 'audio'])).min(1).max(3).describe('Local media types needed for this request. Use every required type once; the card supports multiple files per type when the model allows it.'),
      aspect_ratio: z.string().optional(),
      duration: z.number().positive().optional(),
      resolution: z.string().optional(),
      quality: z.string().optional(),
      sound: z.boolean().optional(),
      generate_audio: z.boolean().optional(),
      enable_web_search: z.boolean().optional(),
      prompt_extend: z.boolean().optional(),
      video_start: z.number().min(0).optional(),
      video_end: z.number().positive().optional(),
      motion_model: z.enum(['kling26', 'kling30']).optional(),
      usage_mode: z.enum(['credits', 'unlimited']).default('credits')
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: generationToolMeta('Opening Hansora media upload…', 'Hansora media upload ready')
  }, async (input) => {
    try {
      const model = getModel(input.model_id);
      if (!model) throw new Error('unsupported_model');
      if (!['image', 'video'].includes(model.category)) throw new Error('model_does_not_support_reference_media');
      if (model.availability !== 'available' || !getRunner(model.id)) throw new Error('model_not_available');
      const limits = model.input || {};
      const supported = {
        image: Boolean(Number(limits.max_images) > 0 || limits.requires_image || limits.first_frame || limits.first_last_frames || limits.image_references || limits.image_video_audio_references),
        video: Boolean(Number(limits.max_videos) > 0 || limits.requires_video || limits.image_video_audio_references),
        audio: Boolean(Number(limits.max_audio) > 0 || limits.image_video_audio_references)
      };
      const requested = [...new Set(input.required_inputs)];
      if (limits.requires_image && !requested.includes('image')) requested.push('image');
      if (limits.requires_video && !requested.includes('video')) requested.push('video');
      for (const kind of requested) {
        if (!supported[kind]) throw new Error(`model_does_not_support_${kind}_input`);
      }
      const defaultCounts = limits.image_video_audio_references
        ? { image: 9, video: 3, audio: 3 }
        : { image: limits.first_last_frames ? 2 : 1, video: 1, audio: 1 };
      const uploadLimits = {
        image: { max_files: Number(limits.max_images) || defaultCounts.image, max_mb: 30 },
        video: { max_files: Number(limits.max_videos) || defaultCounts.video, max_mb: 200 },
        audio: { max_files: Number(limits.max_audio) || defaultCounts.audio, max_mb: model.id === 'seedance25' ? 15 : 200 }
      };
      const price = quote(model.id, {
        duration: input.duration,
        resolution: input.resolution || input.quality,
        sound: input.sound,
        quantity: 1,
        has_video_input: requested.includes('video')
      });
      return jsonText({
        mode: 'multi_upload',
        status: 'awaiting_upload',
        model_id: model.id,
        model_name: model.name,
        media_type: model.category,
        prompt: input.prompt,
        required_inputs: requested,
        supported_inputs: Object.keys(supported).filter((kind) => supported[kind]),
        upload_limits: Object.fromEntries(requested.map((kind) => [kind, uploadLimits[kind]])),
        aspect_ratio: input.aspect_ratio || null,
        duration: input.duration || null,
        resolution: input.resolution || input.quality || null,
        quality: input.quality || null,
        sound: input.sound,
        generate_audio: input.generate_audio,
        enable_web_search: input.enable_web_search,
        prompt_extend: input.prompt_extend,
        video_start: input.video_start,
        video_end: input.video_end,
        motion_model: input.motion_model,
        usage_mode: input.usage_mode,
        quote: publicQuote(price)
      });
    } catch (error) { return toolError(error); }
  });

  server.registerTool('start_audio_generation', {
    title: 'Process an uploaded audio file',
    description: 'Open Hansora’s in-chat audio upload card for Voice Isolation or Voice Changer. Use this instead of asking the user to host a local audio file. The card accepts MP3, WAV, M4A, AAC, OGG, or FLAC, reads its duration, calculates the credit quote, and starts processing after the user confirms.',
    inputSchema: z.object({
      audio_tool_id: z.enum(['isolation', 'voice-change']),
      voice_id: z.string().optional().describe('Required for Voice Changer. Call list_audio_voices first.'),
      remove_background_noise: z.boolean().default(true)
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: generationToolMeta('Opening Hansora audio upload…', 'Hansora audio upload ready')
  }, async (input) => {
    try {
      const model = getModel(input.audio_tool_id);
      if (!model || model.category !== 'audio' || !['isolation', 'voice-change'].includes(model.id)) throw new Error('audio_tool_does_not_accept_uploads');
      if (model.id === 'voice-change' && !input.voice_id) throw new Error('voice_id_required');
      return jsonText({
        mode: 'audio_upload',
        status: 'awaiting_upload',
        audio_tool_id: model.id,
        model_id: model.id,
        model_name: model.name,
        media_type: 'audio',
        voice_id: input.voice_id || null,
        remove_background_noise: input.remove_background_noise !== false,
        quote: null
      });
    } catch (error) { return toolError(error); }
  });

  server.registerTool('prepare_image_upload', {
    title: 'Prepare Hansora image upload',
    description: 'Internal app-only tool that creates a short-lived upload URL for the authenticated Hansora user.',
    inputSchema: z.object({
      filename: z.string().min(1).max(255),
      mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif']),
      size: z.number().int().positive().max(30 * 1024 * 1024)
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    _meta: { ui: { visibility: ['app'] }, 'openai/visibility': 'private' }
  }, async ({ filename, mime, size }) => {
    try { return await signUploadForApp(ctx, token, { filename, mime, size }); }
    catch (error) { return toolError(error); }
  });

  server.registerTool('prepare_video_upload', {
    title: 'Prepare Hansora video upload',
    description: 'Internal app-only tool that creates a short-lived video upload URL for the authenticated Hansora user.',
    inputSchema: z.object({
      filename: z.string().min(1).max(255),
      mime: z.enum(['video/mp4', 'video/quicktime', 'video/webm']),
      size: z.number().int().positive().max(200 * 1024 * 1024)
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    _meta: { ui: { visibility: ['app'] }, 'openai/visibility': 'private' }
  }, async ({ filename, mime, size }) => {
    try { return await signUploadForApp(ctx, token, { filename, mime, size }); }
    catch (error) { return toolError(error); }
  });

  server.registerTool('prepare_audio_upload', {
    title: 'Prepare Hansora audio upload',
    description: 'Internal app-only tool that creates a short-lived audio upload URL for the authenticated Hansora user.',
    inputSchema: z.object({
      filename: z.string().min(1).max(255),
      mime: z.enum(['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/flac']),
      size: z.number().int().positive().max(200 * 1024 * 1024)
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    _meta: { ui: { visibility: ['app'] }, 'openai/visibility': 'private' }
  }, async ({ filename, mime, size }) => {
    try { return await signUploadForApp(ctx, token, { filename, mime, size }); }
    catch (error) { return toolError(error); }
  });

  server.registerTool('list_audio_voices', {
    title: 'List Hansora audio voices',
    description: 'List the current voices available for text to speech and voice changing.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
  }, async () => {
    try {
      const origin = ctx.requestInfo ? new URL(ctx.requestInfo.url).origin : PUBLIC_ORIGIN;
      const response = await fetch(`${origin}/.netlify/functions/run-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind: 'voice-list' }),
        signal: AbortSignal.timeout(30000)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.submitted) throw new Error(result.error || `voice_list_failed_${response.status}`);
      return jsonText({ voices: result.voices || [], count: Array.isArray(result.voices) ? result.voices.length : 0 });
    } catch (error) { return toolError(error); }
  });

  server.registerTool('create_generation', {
    title: 'Create with Hansora',
    description: 'Submit an image or video generation to any available Hansora model. When the user attaches media in chat, pass it through image_files, video_files, or audio_files and start generation directly without opening an upload card. URL fields remain available for existing public HTTPS media. Call get_model and quote_generation first.',
    inputSchema: z.object({
      model_id: z.string().min(1),
      prompt: z.string().min(1),
      aspect_ratio: z.string().optional(),
      duration: z.number().positive().optional(),
      resolution: z.string().optional(),
      quality: z.string().optional(),
      image_urls: z.array(z.string().url()).max(30).default([]),
      video_urls: z.array(z.string().url()).max(10).default([]),
      audio_urls: z.array(z.string().url()).max(5).default([]),
      image_files: z.array(openAIFileSchema).max(30).optional().describe('Images attached by the user in ChatGPT.'),
      video_files: z.array(openAIFileSchema).max(10).optional().describe('Videos attached by the user in ChatGPT.'),
      audio_files: z.array(openAIFileSchema).max(5).optional().describe('Audio files attached by the user in ChatGPT.'),
      first_frame_url: z.string().url().optional(),
      last_frame_url: z.string().url().optional(),
      source_video_url: z.string().url().optional(),
      source_video_duration: z.number().nonnegative().optional().describe('Combined reference video seconds for a Wan 3.0 quote. The server measures the actual files before charging.'),
      sound: z.boolean().optional(),
      generate_audio: z.boolean().optional(),
      enable_web_search: z.boolean().optional(),
      prompt_extend: z.boolean().optional(),
      video_start: z.number().min(0).optional(),
      video_end: z.number().positive().optional(),
      audio_ids: z.array(z.string()).max(10).optional(),
      motion_model: z.enum(['kling26', 'kling30']).optional(),
      usage_mode: z.enum(['credits', 'unlimited']).default('credits')
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    _meta: {
      ...generationToolMeta('Starting Hansora generation…', 'Hansora generation started'),
      'openai/fileParams': OPENAI_FILE_PARAMS
    }
  }, async (requested) => {
    try {
      const resting = await veoRestSwitch(requested);
      const input = resting ? resting.input : requested;
      // Said in the card and by ChatGPT, so nobody is misled about which model made the video.
      const restingNote = (credits) => (resting ? switchNote({ from: resting.from, to: 'Grok Video', credits: credits ?? null, reason: 'resting' }) : '');
      const restingFields = (credits) => (resting ? { switched_from: resting.from, switch_note: restingNote(credits) } : {});
      const restingStep = (credits) => (resting ? `${restingNote(credits)} Tell the user this in one short line, without asking anything. ` : '');
      const model = getModel(input.model_id);
      const endpoint = getRunner(input.model_id);
      if (!model) throw new Error('unsupported_model');
      if (!endpoint || model.availability !== 'available') throw new Error('model_not_available');
      const maxPrompt = Number(model.input?.max_prompt_chars);
      if (maxPrompt && input.prompt.length > maxPrompt) {
        const value = {
          ok: false, error: 'prompt_too_long', generated: false, credits_used: 0,
          model_id: model.id, model_name: model.name, prompt_characters: input.prompt.length, max_prompt_characters: maxPrompt,
          next_step: `${model.name} accepts prompts up to ${maxPrompt} characters and this one has ${input.prompt.length}. Shorten it to under ${maxPrompt} characters, keeping the key details, and call create_generation again. No need to ask the user.`
        };
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
      }

      const normalizedInput = normalizeGenerationFiles(input);
      let price = null;
      try { price = quote(model.id, quoteOptionsFromRequest(normalizedInput)); } catch { price = null; }
      const unavailable = await unavailableModels();
      if (unavailable.has(model.id)) return temporaryIssueResult(model, price, unavailable);
      const checkBalance = normalizedInput.usage_mode !== 'unlimited' && price;
      if (checkBalance) {
        // The runner re-checks the balance, so a failed lookup here should not block the request.
        const account = await getAccount(userId).catch(() => null);
        if (account && Number(account.internal_credits || 0) < price.internalCredits) {
          return insufficientCreditsResult({ model, price, balanceInternal: account.internal_credits, input: normalizedInput, firstGeneration: await isFirstGeneration(userId) });
        }
        if (account) {
          const steer = await firstVideoOnGrok(userId, normalizedInput, account.internal_credits);
          if (steer) return steer;
        }
      }
      if (RUNNING_ENGINES[model.id] && normalizedInput.usage_mode !== 'unlimited') {
        const running = await countRunning(userId, RUNNING_ENGINES[model.id]);
        if (running >= MAX_RUNNING_PER_USER) return busyResult(model, { running });
      }
      const storedInput = await storeGenerationFiles(input);
      // A tall photo animated at 16:9 gets its top and bottom cut off. Match the photo when no shape was given,
      // and also when ChatGPT sent the opposite of the photo's shape (it often fills in 16:9 on its own). Any
      // other shape, such as 1:1, is kept as asked.
      const askedShape = String(storedInput.aspect_ratio || '').trim();
      // Logged with the call, so a video in the wrong shape can be traced to a photo Hansora could not read.
      let photoShapeFound = null;
      if ((!askedShape || askedShape === '16:9' || askedShape === '9:16') && PHOTO_SHAPED_MODELS.has(model.id)) {
        const frame = startingFrame(model.id, storedInput);
        const shape = frame ? await photoShape(frame) : null;
        if (frame) photoShapeFound = shape || 'unknown';
        if (shape) storedInput.aspect_ratio = shape;
      }
      const runId = `${userId}-mcp-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const payload = buildGenerationPayload(input.model_id, storedInput, userId, runId);
      // ChatGPT can't see how long a reference video is, so its quote guesses. These launchers measure
      // the real files and refuse (charging nothing) when the measured length changes the quoted price.
      const hasVideoInput = Boolean(normalizedInput.source_video_url || normalizedInput.video_urls?.length);
      if (((REFERENCE_VIDEO_MODELS.has(model.id) && hasVideoInput) || PRICE_CHECKED_MODELS.has(model.id)) && price && payload.expected_credits == null) {
        payload.expected_credits = price.displayedCredits;
      }
      const origin = ctx.requestInfo ? new URL(ctx.requestInfo.url).origin : PUBLIC_ORIGIN;
      const submit = () => submitRun({ origin, token, userId, endpoint, model, prompt: normalizedInput.prompt, usageMode: normalizedInput.usage_mode, payload });
      // A new user's first video, and any Veo video, keeps what it was made from in case the provider fails
      // (providerRetry).
      const retryable = model.category === 'video' && !hasVideoInput && normalizedInput.usage_mode !== 'unlimited';
      const firstVideo = retryable ? isFirstGeneration(userId).catch(() => false) : Promise.resolve(false);
      const keepRecipe = async () => {
        const first = await firstVideo;
        if (!retryable || (!first && !VEO_MODELS.has(model.id))) return;
        recordVideoRecipe(userId, runId, model.id, {
          prompt: String(normalizedInput.prompt || '').slice(0, 5000),
          image_urls: Array.isArray(storedInput.image_urls) ? storedInput.image_urls.slice(0, 4) : [],
          ...(storedInput.aspect_ratio ? { aspect_ratio: storedInput.aspect_ratio } : {}),
          ...(typeof storedInput.generate_audio === 'boolean' ? { generate_audio: storedInput.generate_audio } : {}),
          ...(typeof storedInput.sound === 'boolean' ? { sound: storedInput.sound } : {})
        }, waitUntil, { first });
      };
      let submitted;
      try {
        submitted = await submit();
      } catch (error) {
        if (!/abort|timeout/i.test(String(error?.name) + String(error?.message))) throw error;
        // The submission is still running on Hansora's side; answer before ChatGPT gives up. The card and
        // get_generation follow the run by its id, and charging only happens if it really starts.
        console.warn('hansora_mcp_submit_slow', JSON.stringify({ runId, model: model.id }));
        await keepRecipe();
        return jsonText({
          ...(await batchFields(userId, runId).catch(() => ({}))),
          ok: true, run_id: runId, model_id: model.id, model_name: model.name, media_type: model.category,
          credits: price ? price.displayedCredits : undefined, status: 'queued', prompt: normalizedInput.prompt,
          aspect_ratio: storedInput.aspect_ratio || null, duration: normalizedInput.duration || null,
          resolution: normalizedInput.resolution || normalizedInput.quality || null,
          ...restingFields(price ? price.displayedCredits : null),
          next_step: `${restingStep(price ? price.displayedCredits : null)}${CARD_FOLLOWS_RUN} Do not start it again.`
        });
      }
      let { response, result } = submitted;
      let charged = price ? price.displayedCredits : undefined;
      // The measured video made it no more expensive than the price ChatGPT gave (or ChatGPT gave none):
      // start right away at the real price. Only a higher price goes back to the user.
      const verified = Number(result?.displayed_credits);
      const quoted = payload.expected_credits;
      if (result?.code === 'CONTENT_POLICY_BLOCKED') return contentBlockedResult(model, result);
      // Video edits (Henshin) are priced by the uploaded video itself, so they never ask again.
      if (response.status === 409 && Number.isFinite(result.input_seconds) && Number.isFinite(verified) && (quoted == null || verified <= Number(quoted) || EDIT_MODELS.has(model.id))) {
        payload.expected_credits = verified;
        ({ response, result } = await submit());
        charged = verified;
      }
      if (response.status === 409 && Number.isFinite(result.input_seconds)) {
        return jsonText({ok:false, generated:false, credits_used:0, error:'quote_changed', model_id:model.id,
          source_video_duration:result.input_seconds, credits_required:result.displayed_credits,
          next_step:[
            `Nothing was generated or charged. With this reference video the price is ${result.displayed_credits} credits${quoted != null ? `, not the ${quoted} you quoted` : ''}.`,
            `Tell the user briefly, in their language, something like: "With a reference video, ${model.name} also counts the video's length; it works the same way on every platform that offers this model. The price is ${result.displayed_credits} credits. Should I start it, or would you like to send a shorter clip?"`,
            'If you are starting several generations in this request, submit all of them first: the ones that cost no more start right away and the others come back like this one. Then ask the user once about all the held ones together (each price and the total), not once per video.',
            `Start it only after they accept: call create_generation again with the same inputs plus source_video_duration: ${result.input_seconds}.`
          ].join(' ')});
      }
      // Most runners refuse with 402; Veo 3.1, Motion Control and Aleph answer 200 with submitted:false.
      const creditRefusal = response.status === 402
        || (result?.submitted === false && /insufficient|not_enough_credits/i.test(String(result?.error || '')));
      if (creditRefusal && normalizedInput.usage_mode !== 'unlimited') {
        const account = await getAccount(userId).catch(() => ({ internal_credits: result.credits ?? result.have }));
        const need = Number(result.need ?? result.details?.need);
        const charged = Number.isFinite(need) && need > 0
          ? { ...(price || {}), displayedCredits: Number((need * 10).toFixed(2)) }
          : price;
        return insufficientCreditsResult({ model, price: charged, balanceInternal: account.internal_credits, input: normalizedInput, firstGeneration: await isFirstGeneration(userId) });
      }
      // Henshin and reference-video launchers measure the uploaded files and report the real charge.
      const debited = Number(result?.debited);
      if (response.ok && MEASURED_CHARGE_MODELS.has(model.id) && Number.isFinite(debited) && debited > 0) {
        charged = Number((debited * 10).toFixed(2));
      }
      if (!response.ok) {
        // Pass the provider's own reason (e.g. a content refusal) so the assistant can explain it
        // instead of retrying the same request.
        const providerReason = String(result.details?.msg || result.details?.message || '').slice(0, 300);
        const reason = result.message || result.error || `generation_submit_failed_${response.status}`;
        if (/concurrent task limit|too many (running|concurrent)/i.test(`${reason} ${providerReason}`)) return busyResult(model, { provider: true });
        const submitKind = classifyFailure({ provider_message: providerReason, error: String(reason), error_code: result.details?.code ?? response.status });
        if (submitKind === 'temporary') return temporaryIssueResult(model, price, unavailable, providerReason || String(reason).slice(0, 200));
        const fallback = await firstVideoFallback(userId, model, normalizedInput);
        if (fallback) return firstVideoFallbackResult(model, fallback, providerReason || String(reason).slice(0, 200));
        throw new Error(providerReason && providerReason !== reason ? `${reason}: ${providerReason}. Nothing was generated and no credits were used.` : reason);
      }
      await keepRecipe();
      return jsonText({
        ...(await batchFields(userId, runId)),
        ok: true,
        run_id: runId,
        model_id: model.id,
        model_name: model.name,
        media_type: model.category,
        credits: charged,
        ...(price && charged != null && charged !== price.displayedCredits ? { credits_note: `The final price is ${charged} credits${model.id === 'henshin' || model.id === 'henshin-lite' ? ', based on the length of the uploaded video' : charged < price.displayedCredits ? `, lower than the ${price.displayedCredits} quoted` : ''}. Tell the user the final amount.` } : {}),
        status: response.status === 202 ? 'queued' : 'submitted',
        prompt: normalizedInput.prompt,
        aspect_ratio: storedInput.aspect_ratio || null,
        ...(photoShapeFound ? { photo_shape: photoShapeFound } : {}),
        duration: normalizedInput.duration || null,
        resolution: normalizedInput.resolution || normalizedInput.quality || null,
        ...restingFields(charged),
        next_step: `${restingStep(charged)}${CARD_FOLLOWS_RUN}`,
        provider: result
      });
    } catch (error) {
      return toolError(error, 'create');
    }
  });

  server.registerTool('create_audio', {
    title: 'Create audio with Hansora',
    description: 'Create speech, isolate a voice, change a voice, or generate music with Hansora. For file-based tools, audio_url must be a public HTTPS audio URL. Call quote_generation first.',
    inputSchema: z.object({
      audio_tool_id: z.enum(['voice', 'isolation', 'voice-change', 'music']),
      text: z.string().max(4200).optional(),
      dialogue: z.array(z.object({
        text: z.string().min(1).max(4200),
        voice_id: z.string().optional(),
        voice: z.string().optional()
      })).max(20).optional(),
      voice_id: z.string().optional(),
      language_code: z.string().max(8).optional(),
      stability: z.number().min(0).max(1).optional(),
      audio_url: z.string().url().optional(),
      audio_duration_seconds: z.number().positive().max(86400).optional(),
      remove_background_noise: z.boolean().default(true),
      prompt: z.string().max(5000).optional(),
      instrumental: z.boolean().default(false),
      style: z.string().max(1000).optional(),
      title: z.string().max(80).optional(),
      vocal_gender: z.enum(['m', 'f']).optional(),
      music_model: z.enum(['V5_5', 'V5', 'V4_5PLUS', 'V4_5', 'V4', 'V4_5ALL']).optional(),
      style_weight: z.number().min(0).max(1).optional(),
      weirdness_constraint: z.number().min(0).max(1).optional(),
      audio_weight: z.number().min(0).max(1).optional()
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    _meta: generationToolMeta('Starting Hansora audio…', 'Hansora audio started')
  }, async (input) => {
    try {
      const model = getModel(input.audio_tool_id);
      if (!model || model.category !== 'audio') throw new Error('unsupported_audio_tool');
      const runId = `${userId}-mcp-audio-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const payload = buildAudioPayload(input.audio_tool_id, input, userId, runId);
      const origin = ctx.requestInfo ? new URL(ctx.requestInfo.url).origin : PUBLIC_ORIGIN;
      const response = await fetch(`${origin}/.netlify/functions/safe-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-USER-ID': userId },
        body: JSON.stringify({
          target_endpoint: '/.netlify/functions/run-audio',
          model_id: model.id,
          model_name: model.name,
          kind: 'audio',
          prompt: payload.prompt,
          usage_mode: 'credits',
          payload
        }),
        signal: AbortSignal.timeout(58000)
      });
      const raw = await response.text();
      let result;
      try { result = JSON.parse(raw); } catch { result = { message: raw }; }
      if (!response.ok || !result.submitted) throw new Error(result.message || result.error || `audio_submit_failed_${response.status}`);
      return jsonText({
        ok: true,
        run_id: runId,
        model_id: model.id,
        model_name: model.name,
        media_type: 'audio',
        status: 'queued',
        prompt: payload.prompt || input.text || input.title || '',
        provider: result
      });
    } catch (error) { return toolError(error, 'create'); }
  });

  server.registerTool('get_generation', {
    title: 'Get Hansora generation',
    description: 'Check one Hansora image, video, or audio generation by the run_id returned from a create tool.',
    inputSchema: z.object({ run_id: z.string().min(1) }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: generationToolMeta('Checking Hansora generation…', 'Hansora generation updated')
  }, async ({ run_id }) => {
    try {
      let generation = await getGeneration(userId, run_id);
      if (!generation) {
        const starting = startingRun(run_id);
        return starting ? jsonText(starting) : toolError(new Error('generation_not_found'));
      }
      // The card refreshes through this tool every few seconds; never query model health here.
      const unavailable = new Set();
      const origin = ctx.requestInfo ? new URL(ctx.requestInfo.url).origin : PUBLIC_ORIGIN;
      const siblings = await getGenerationBatch(userId, run_id).catch(() => []);
      if (await refreshFromProvider(userId, [generation, ...siblings], origin)) {
        generation = (await getGeneration(userId, run_id)) || generation;
      }
      const presented = presentGeneration(generation, run_id, unavailable);
      const retried = await providerRetry({ userId, token, origin, runId: run_id, presented, generation }).catch(() => null);
      if (retried) return jsonText(retried);
      // A refused first video (temporary issues already switch model on their own).
      if (presented.status === 'failed' && presented.failure_kind && presented.failure_kind !== 'temporary') {
        const meta = generation.meta && typeof generation.meta === 'object' ? generation.meta : {};
        const model = [meta.model_id, meta.engine, meta.model].map((id) => (typeof id === 'string' && id ? getModel(id) : null)).find(Boolean);
        const fallback = model && await firstVideoFallback(userId, model, {
          duration: meta.duration,
          image_urls: Array.isArray(meta.reference_image_urls) ? meta.reference_image_urls : [],
          video_urls: Array.isArray(meta.reference_video_urls) ? meta.reference_video_urls : []
        });
        if (fallback) {
          const step = firstVideoFallbackResult(model, fallback).structuredContent.next_step;
          presented.next_option = fallback;
          presented.next_step = step.replace(' could not make this video and nothing was charged.', ' could not make this video; its credits were refunded.');
        }
      }
      return jsonText({ ...presented, ...(await batchFields(userId, run_id)) });
    } catch (error) { return toolError(error); }
  });

  server.registerTool('list_generations', {
    title: 'List Hansora generations',
    description: 'List recent image, video, and audio generations for the connected Hansora account.',
    inputSchema: z.object({
      limit: z.number().int().min(1).max(50).default(10),
      status: z.string().optional()
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ limit, status }) => {
    try { return jsonText({ generations: await listGenerations(userId, limit, status) }); } catch (error) { return toolError(error); }
  });

  return server;
}

const handler = createMcpHandler(createHansoraServer, { legacy: 'stateless', responseMode: 'auto', onerror: (error) => console.error('hansora_mcp_error', error?.message || error) });

// Who a token belongs to, read without verifying it: only used to record a failed connection.
function tokenClaims(token) {
  try {
    const claims = JSON.parse(Buffer.from(String(token || '').split('.')[1] || '', 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' ? claims : {};
  } catch {
    return {};
  }
}

// Failures before any tool runs (login, Hansora down, a crash) never reach the tool log, yet ChatGPT
// shows them to the user as "internal error". Record them under the user so we can see how often.
function recordConnectionEvent(token, outcome, waitUntil, details = {}) {
  const claims = tokenClaims(token);
  if (typeof claims.sub !== 'string' || !claims.sub) return;
  recordToolEvent(claims.sub, 'connection', {}, { isError: true, structuredContent: { error: outcome, ...details } }, waitUntil);
}

export default async function hansoraMcp(request, context) {
  const startedAt = Date.now();
  const requestId = String(request.headers.get('x-nf-request-id') || 'unknown');
  const protocolVersion = String(request.headers.get('mcp-protocol-version') || 'unspecified');
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id' } });
  }
  const token = bearerToken(request);
  const waitUntil = typeof context?.waitUntil === 'function' ? context.waitUntil.bind(context) : undefined;
  let user = null;
  try {
    user = await authenticateToken(token);
  } catch (error) {
    if (error instanceof AuthUnavailableError) {
      recordConnectionEvent(token, 'auth_unavailable', waitUntil);
      console.warn('hansora_mcp_request', JSON.stringify({ requestId, method: request.method, protocolVersion, tokenProvided: true, authenticated: null, status: 503, durationMs: Date.now() - startedAt }));
      return withCors(temporarilyUnavailable());
    }
    user = null;
  }
  if (!user) {
    console.warn('hansora_mcp_request', JSON.stringify({
      requestId,
      method: request.method,
      protocolVersion,
      tokenProvided: Boolean(token),
      authenticated: false,
      status: 401,
      durationMs: Date.now() - startedAt
    }));
    // An expired token is normal (ChatGPT refreshes it); a rejected one that has not expired is a broken login.
    if (token) {
      const expiresAt = Number(tokenClaims(token).exp) * 1000;
      recordConnectionEvent(token, Number.isFinite(expiresAt) && expiresAt < Date.now() ? 'token_expired' : 'login_rejected', waitUntil);
    }
    return withCors(authenticationRequired());
  }
  const authInfo = { token, clientId: user.clientId, scopes: user.scopes, extra: { userId: user.id, email: user.email, waitUntil } };
  let response;
  try {
    response = withCors(await handler.fetch(request, { authInfo }));
  } catch (error) {
    recordConnectionEvent(token, 'server_error', waitUntil, { reason: String(error?.message || error) });
    throw error;
  }
  if (response.status >= 500) recordConnectionEvent(token, 'server_error', waitUntil, { reason: `status ${response.status}` });
  console.info('hansora_mcp_request', JSON.stringify({
    requestId,
    method: request.method,
    protocolVersion,
    authenticated: true,
    status: response.status,
    contentType: response.headers.get('content-type') || 'unspecified',
    durationMs: Date.now() - startedAt
  }));
  return response;
}

export const config = { path: '/mcp' };
