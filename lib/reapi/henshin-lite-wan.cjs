'use strict';
// Henshin Lite on Wan 3.0 (reAPI) for source videos up to 15 seconds. Longer videos stay on Kling 4.0, because Wan 3.0
// accepts at most 15 seconds of reference video. Customers see no difference: the same Henshin Lite price (kling4-
// pricing, lite), the same 4–30 s limit and the same flow: silent footage is sent, the original soundtrack is saved and
// put back by the Henshin completion worker (finish_video), and results are checked by henshin-check → reapi check.
const crypto = require('node:crypto');
const { BASE, KEY, auth, db, json, validate } = require('../henshin/common.cjs');
const { transition, callbackToken } = require('./billing.cjs');
const client = require('./client.cjs');
const { generationId } = require('./launch.cjs');
const pricing = require('../../public/kling4-pricing.js');
const prompts = require('../henshin/prompts.cjs');

const WAN_MAX_SOURCE_SECONDS = 15;
const WAN_MODEL = 'wan3.0-video';

// The client's own measurement decides the route; the server measures again and hands longer videos to Kling.
function fitsWan(body) {
  const seconds = Number(body?.source_video_duration);
  return Number.isFinite(seconds) && seconds > 0 && seconds <= WAN_MAX_SOURCE_SECONDS;
}

// Henshin's built-in instructions refer to "@Video 1" / "@Image 1"; Wan 3.0 calls them "Video 1" / "Image 1".
function wanPrompt(body) {
  return prompts.build({ mode: body.mode, imageCount: body.image_urls.length, prompt: body.prompt })
    .replace(/@Video\s+(\d+)/gi, 'Video $1').replace(/@Image\s+(\d+)/gi, 'Image $1');
}

function wanPayload({ prompt, resolution, seconds, videoURL, imageURLs }) {
  return {
    model: WAN_MODEL, prompt, resolution: String(resolution).toUpperCase(), duration: Math.min(WAN_MAX_SOURCE_SECONDS, Math.max(2, Math.ceil(seconds - 1e-7))),
    size: 'adaptive', audio: false, content_filter: true, prompt_extend: false, watermark: false,
    image_urls: imageURLs, generation_type: 'reference', video_urls: [videoURL]
  };
}

class TooLongForWan extends Error { constructor(seconds) { super('henshin_lite_source_over_wan_limit'); this.seconds = seconds; this.tooLongForWan = true; } }

function responseFor(row, extra = {}) {
  const m = row.meta;
  return { ok: m.status !== 'failed', submitted: true, already_submitted: true, taskId: m.task_id, checker: m.checker, run_id: m.run_id, row_id: row.id, status: m.status, result_url: row.result_url, debited: m.charged_cost, refunded: !!m.refunded, ...extra };
}

// Returns the response, or throws TooLongForWan (before anything is charged) when the measured video is over 15 s.
function handler(deps = {}) {
  const d = { auth, db, transition, submit: payload => client.submit(payload), prepareSource: (...args) => require('../henshin/server-media.cjs').prepareSource(...args), ...deps };
  return async event => {
    if (event.httpMethod === 'OPTIONS') return json(204, {});
    if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Use POST.' });
    let id, user, reserved, acceptedTask, submissionStarted = false;
    try {
      if (!BASE || !KEY || !process.env.REAPI_API_KEY) throw Object.assign(Error('reAPI service is not configured.'), { status: 503 });
      user = await d.auth(event);
      const body = JSON.parse(event.body || '{}');
      if ((body.uid && body.uid !== user.id) || (body.user_id && body.user_id !== user.id)) throw Object.assign(Error('Account mismatch.'), { status: 403 });
      if (typeof body.run_id !== 'string' || body.run_id.length < 8 || body.run_id.length > 160) throw Error('Invalid run identifier.');
      id = generationId(user.id, body.run_id);
      // The same run never starts twice, whichever model it went to.
      const existing = (await d.db(`user_generations?user_id=eq.${user.id}&meta->>run_id=eq.${encodeURIComponent(body.run_id)}&select=id,meta,result_url`))?.[0];
      if (existing) return json(200, responseFor(existing));
      validate(body);
      if (body.image_urls.length > 10) throw Error('Henshin Lite accepts up to 10 reference images.');
      if (!['720p', '1080p'].includes(body.resolution)) throw Error('Henshin Lite supports 720p and 1080p.');
      const prepared = await d.prepareSource(body.video_url, { uid: user.id, id: id + '-' + crypto.randomUUID(), keepAudio: body.keep_audio !== false, maxMB: 100, maxVideoMB: 95 });
      const seconds = prepared.seconds;
      if (seconds > WAN_MAX_SOURCE_SECONDS + 1e-4) throw new TooLongForWan(seconds);
      const quote = pricing.quote({ resolution: body.resolution, inputSeconds: seconds, lite: true });
      if (Number(body.expected_credits) !== quote.displayedCredits) return json(409, { ok: false, error: 'The verified duration changed the price. Review the updated quote and generate again.', input_seconds: seconds, displayed_credits: quote.displayedCredits });
      const userPrompt = prompts.extra(body.prompt);
      const payload = wanPayload({ prompt: wanPrompt(body), resolution: body.resolution, seconds, videoURL: prepared.videoURL, imageURLs: body.image_urls });
      const meta = {
        source: 'reapi', engine: 'henshin-lite-wan', model: WAN_MODEL, model_id: 'wan-3', run_id: body.run_id, status: 'pending', checker: 'henshin-check',
        resolution: quote.resolution, duration: payload.duration, aspect_ratio: payload.size, source_video_duration: seconds, charged_duration: quote.duration,
        billed_seconds: seconds + payload.duration, refund_amount: quote.internalCredits, reference_video_urls: payload.video_urls, reference_image_urls: payload.image_urls, reference_audio_urls: [],
        source_feature: 'henshin', henshin_model: 'lite', audio_strategy: 'original', mode: body.mode, user_prompt: userPrompt, keep_audio: body.keep_audio !== false,
        video_url: body.video_url, source_audio_url: prepared.audioURL, generate_audio: false, finish_video: true, source_width: prepared.width, source_height: prepared.height
      };
      reserved = await d.transition('reserve', id, user.id, { provider: 'Hansora Henshin Lite', prompt: userPrompt || 'Henshin Lite · ' + body.mode, meta });
      if (!reserved.created) return json(200, responseFor(reserved.row));
      const site = (process.env.DEPLOY_PRIME_URL || process.env.SITE_BASE || process.env.URL || 'https://hansora.co').replace(/\/+$/, '');
      payload.webhook_url = `${site}/.netlify/functions/henshin-check?uid=${encodeURIComponent(user.id)}&run_id=${encodeURIComponent(body.run_id)}&token=${callbackToken(user.id, id)}`;
      submissionStarted = true;
      const task = await d.submit(payload);
      acceptedTask = task.id;
      const saved = await d.transition('attach', id, user.id, { task_id: task.id });
      return json(201, responseFor(saved.row, { already_submitted: false, credits: reserved.credits }));
    } catch (error) {
      if (error.tooLongForWan) throw error;
      if (reserved?.created) {
        if (submissionStarted && !error.rejected) {
          const latest = await d.transition(acceptedTask ? 'attach' : 'uncertain', id, user.id, acceptedTask ? { task_id: acceptedTask } : {}).catch(() => null);
          return json(202, responseFor(latest?.row || reserved.row, { ...(acceptedTask ? { taskId: acceptedTask } : {}), already_submitted: false, submission_uncertain: !latest?.row?.meta?.task_id, message: 'Submission is being confirmed. Check this generation before submitting another request.' }));
        }
        await d.transition('fail', id, user.id, { error: error.message }).catch(() => {});
      }
      return json(error.status || 400, { ok: false, error: error.message });
    }
  };
}

module.exports = { handler, fitsWan, wanPrompt, wanPayload, WAN_MAX_SOURCE_SECONDS, TooLongForWan };
