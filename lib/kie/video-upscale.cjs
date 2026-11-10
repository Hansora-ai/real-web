'use strict';
const crypto = require('node:crypto');
const { BASE, KEY, auth, db, json } = require('../henshin/common.cjs');
const { transition, callbackToken } = require('../reapi/billing.cjs');
const client = require('../kling4/client.cjs');
const pricing = require('../../public/video-upscale-pricing.js');

const MODEL = 'video/upscale';
const CHECKER = 'kling4-check';
const UPLOAD_BUCKET = encodeURIComponent(String(process.env.SUPABASE_BUCKET || '').trim());
const UPLOAD_PREFIX = `/storage/v1/object/public/${UPLOAD_BUCKET}/images/user-uploads/`;

function generationId(uid, runId) {
  const hash = crypto.createHash('sha256').update(`video-upscale:${uid}:${runId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

async function inspectSource(url) {
  const media = require('../henshin/server-media.cjs');
  const bytes = await media.readMedia(url, 10000, pricing.maxBytes / 1024 ** 2);
  const seconds = await media.withCore(core => {
    core.FS.writeFile('source', bytes);
    const report = media.probe(core, 'source');
    const video = report.streams?.find(stream => stream.codec_type === 'video' && stream.width && stream.height);
    if (!video) throw Error('Upload a valid video file.');
    return Number(report.format?.duration || video.duration);
  });
  return { bytes, seconds };
}

async function storeVerifiedSource(url, bytes) {
  // Copy the verified bytes to a new upload path. The original signed upload
  // can be reused by its holder while KIE is still waiting to read the source.
  const source = new URL(url);
  const extension = /\.(mp4|mov|webm|m4v|mkv)$/i.exec(source.pathname)?.[1]?.toLowerCase() || 'mp4';
  const contentType = { mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska' }[extension] || 'video/mp4';
  const path = `${UPLOAD_BUCKET}/images/user-uploads/${new Date().toISOString().slice(0, 10).replaceAll('-', '/')}/${crypto.randomUUID()}-upscale.${extension}`;
  const response = await fetch(`${BASE}/storage/v1/object/${path}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': contentType },
    body: bytes,
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw Error('Could not prepare the uploaded video. Please try again.');
  return `${BASE}/storage/v1/object/public/${path}`;
}

function submission(row, extra = {}) {
  const meta = row.meta;
  const failed = meta.status === 'failed';
  return {
    submitted: !failed,
    run_id: meta.run_id,
    taskId: meta.task_id,
    status: meta.status,
    error: failed ? meta.error : undefined,
    ...extra
  };
}

async function launch(event, body) {
  let user, id, reserved, acceptedTask, submissionStarted = false;
  try {
    if (!BASE || !KEY || !UPLOAD_BUCKET || !(process.env.KIE_API_KEY || process.env.KIEAI_API_KEY)) {
      throw Object.assign(Error('Video upscale is not configured.'), { status: 503 });
    }
    user = await auth(event);
    if ((body.uid || body.user_id) !== user.id) throw Object.assign(Error('Account mismatch.'), { status: 403 });
    if (typeof body.run_id !== 'string' || body.run_id.length < 8 || body.run_id.length > 160) throw Error('Invalid run identifier.');
    id = generationId(user.id, body.run_id);
    const existing = (await db(`user_generations?id=eq.${id}&user_id=eq.${user.id}&select=id,meta`))?.[0];
    if (existing) return json(200, submission(existing));

    const source = new URL(body.fileUrl || body.file_url || '', BASE);
    if (source.origin !== BASE || !source.pathname.startsWith(UPLOAD_PREFIX)) throw Error('Upload a video first.');
    const inputUrl = source.href;
    const resolution = body.videoResolution || body.resolution || (String(body.videoScale) === '4' ? '4K' : '2K');
    const { bytes, seconds } = await inspectSource(inputUrl);
    const quote = pricing.quote({ resolution, seconds });
    if (Number(body.expected_credits) !== quote.displayedCredits) {
      return json(409, {
        submitted: false,
        error: 'Review the verified video price and try again.',
        displayed_credits: quote.displayedCredits,
        duration_seconds: quote.seconds
      });
    }

    const videoUrl = await storeVerifiedSource(inputUrl, bytes);
    const meta = {
      // This source identifies the existing protected KIE Market billing
      // and recovery path. The model and feature identify the actual job.
      source: 'kie-kling4',
      tool_feature: 'video-upscale',
      provider_api: 'market',
      model: MODEL,
      run_id: body.run_id,
      status: 'pending',
      checker: CHECKER,
      media_type: 'video',
      input_url: inputUrl,
      video_url: videoUrl,
      file_name: String(body.fileName || 'video').slice(0, 180),
      resolution: quote.resolution,
      duration: quote.seconds,
      billed_seconds: quote.seconds,
      refund_amount: quote.internalCredits
    };
    reserved = await transition('reserve', id, user.id, {
      provider: 'KIE Video Upscale',
      prompt: `Video upscale to ${quote.resolution}`,
      meta
    });
    if (!reserved.created) return json(200, submission(reserved.row));

    const site = (process.env.DEPLOY_PRIME_URL || process.env.SITE_BASE || process.env.URL || 'https://hansora.co').replace(/\/+$/, '');
    const params = new URLSearchParams({ uid: user.id, run_id: body.run_id, token: callbackToken(user.id, id) });
    submissionStarted = true;
    const task = await client.submit({
      model: MODEL,
      callBackUrl: `${site}/.netlify/functions/${CHECKER}?${params}`,
      input: { video_url: videoUrl, resolution: quote.resolution }
    });
    acceptedTask = task.id;
    const saved = await transition('attach', id, user.id, { task_id: acceptedTask });
    return json(201, submission(saved.row));
  } catch (error) {
    if (reserved?.created) {
      if (submissionStarted && !error.rejected) {
        const saved = await transition(acceptedTask ? 'attach' : 'uncertain', id, user.id, acceptedTask ? { task_id: acceptedTask } : {}).catch(() => null);
        return json(202, submission(saved?.row || reserved.row, acceptedTask ? { taskId: acceptedTask } : {}));
      }
      await transition('fail', id, user.id, { error: error.message }).catch(() => {});
    }
    return json(error.status || 400, { submitted: false, error: error.message });
  }
}

module.exports = { launch };
