'use strict';
const crypto = require('node:crypto');
const { BASE, KEY, auth, db, json } = require('../henshin/common.cjs');
const { transition, callbackToken } = require('../reapi/billing.cjs');
const client = require('../kling4/client.cjs');
const videoPricing = require('../../public/video-upscale-pricing.js');
const imagePricing = require('../../public/image-upscale-pricing.js');

const CHECKER = 'kling4-check';
const UPLOAD_BUCKET = encodeURIComponent(String(process.env.SUPABASE_BUCKET || '').trim());
const UPLOAD_PREFIX = `/storage/v1/object/public/${UPLOAD_BUCKET}/images/user-uploads/`;

function generationId(uid, runId, kind) {
  const hash = crypto.createHash('sha256').update(`${kind}-upscale:${uid}:${runId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function imageFormat(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return { extension: 'png', contentType: 'image/png' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { extension: 'jpg', contentType: 'image/jpeg' };
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { extension: 'webp', contentType: 'image/webp' };
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return { extension: 'gif', contentType: 'image/gif' };
  if (bytes.toString('ascii', 0, 2) === 'BM') return { extension: 'bmp', contentType: 'image/bmp' };
  throw Error('Upload a JPG, PNG, WebP, BMP or GIF image.');
}

async function inspectSource(url, body, kind) {
  const media = require('../henshin/server-media.cjs');
  const pricing = kind === 'image' ? imagePricing : videoPricing;
  const bytes = await media.readMedia(url, 10000, pricing.maxBytes / 1024 ** 2);
  const source = new URL(url);
  const extension = /\.(mp4|mov|webm|m4v|mkv)$/i.exec(source.pathname)?.[1]?.toLowerCase() || 'mp4';
  const contentType = { mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska' }[extension] || 'video/mp4';
  const format = kind === 'image' ? imageFormat(bytes) : { extension, contentType };
  const quote = await media.withCore(core => {
    core.FS.writeFile('source', bytes);
    const report = media.probe(core, 'source');
    const visual = report.streams?.find(stream => stream.codec_type === 'video' && stream.width && stream.height);
    if (!visual) throw Error(`Upload a valid ${kind} file.`);
    if (kind === 'image') {
      return imagePricing.quote({ factor: Number(body.upscale_factor), width: visual.width, height: visual.height });
    }
    const resolution = body.videoResolution || body.resolution || (String(body.videoScale) === '4' ? '4K' : '2K');
    return videoPricing.quote({ resolution, seconds: Number(report.format?.duration || visual.duration) });
  });
  return { bytes, format, quote };
}

async function storeVerifiedSource(bytes, { extension, contentType }) {
  // The original signed upload remains writable. KIE gets a separate copy
  // of the verified bytes so the file cannot change after pricing.
  const path = `${UPLOAD_BUCKET}/images/user-uploads/${new Date().toISOString().slice(0, 10).replaceAll('-', '/')}/${crypto.randomUUID()}-upscale.${extension}`;
  const response = await fetch(`${BASE}/storage/v1/object/${path}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': contentType },
    body: bytes,
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw Error('Could not prepare the uploaded file. Please try again.');
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

async function launch(event, body, kind) {
  const model = kind === 'image' ? 'kie/image-upscale' : 'video/upscale';
  const toolFeature = kind + '-upscale';
  let user, id, reserved, acceptedTask, submissionStarted = false;
  try {
    if (!BASE || !KEY || !UPLOAD_BUCKET || !(process.env.KIE_API_KEY || process.env.KIEAI_API_KEY)) {
      throw Object.assign(Error('Upscale is not configured.'), { status: 503 });
    }
    user = await auth(event);
    if ((body.uid || body.user_id) !== user.id) throw Object.assign(Error('Account mismatch.'), { status: 403 });
    if (typeof body.run_id !== 'string' || body.run_id.length < 8 || body.run_id.length > 160) throw Error('Invalid run identifier.');
    id = generationId(user.id, body.run_id, kind);
    const existing = (await db(`user_generations?id=eq.${id}&user_id=eq.${user.id}&select=id,meta`))?.[0];
    if (existing) return json(200, submission(existing));

    const source = new URL(body.fileUrl || body.file_url || '', BASE);
    if (source.origin !== BASE || !source.pathname.startsWith(UPLOAD_PREFIX)) throw Error(`Upload an original ${kind} file first.`);
    if (kind === 'image' && body.upscale_factor == null) {
      return json(409, { submitted: false, error: 'Refresh the Image Upscale page for the new scale and pricing options.' });
    }
    const inputUrl = source.href;
    const { bytes, format, quote } = await inspectSource(inputUrl, body, kind);
    if (Number(body.expected_credits) !== quote.displayedCredits) {
      return json(409, {
        submitted: false,
        error: `Review the verified ${kind} price and try again.`,
        displayed_credits: quote.displayedCredits,
        ...(kind === 'image' ? { width: quote.width, height: quote.height } : { duration_seconds: quote.seconds })
      });
    }

    const verifiedUrl = await storeVerifiedSource(bytes, format);
    const input = kind === 'image'
      ? { image_url: verifiedUrl, upscale_factor: String(quote.factor) }
      : { video_url: verifiedUrl, resolution: quote.resolution };
    const meta = {
      // The existing KIE Market billing and recovery path uses this source.
      source: 'kie-kling4',
      tool_feature: toolFeature,
      provider_api: 'market',
      model,
      run_id: body.run_id,
      status: 'pending',
      checker: CHECKER,
      media_type: kind,
      input_url: inputUrl,
      file_name: String(body.fileName || kind).slice(0, 180),
      resolution: quote.resolution,
      refund_amount: quote.internalCredits,
      ...(kind === 'image'
        ? { image_url: verifiedUrl, upscale_factor: quote.factor, output_width: quote.outputWidth, output_height: quote.outputHeight }
        : { video_url: verifiedUrl, duration: quote.seconds, billed_seconds: quote.seconds })
    };
    reserved = await transition('reserve', id, user.id, {
      provider: kind === 'image' ? 'KIE Image Upscale' : 'KIE Video Upscale',
      prompt: kind === 'image' ? `Image upscale · ${quote.factor}×` : `Video upscale to ${quote.resolution}`,
      meta
    });
    if (!reserved.created) return json(200, submission(reserved.row));

    const site = (process.env.DEPLOY_PRIME_URL || process.env.SITE_BASE || process.env.URL || 'https://hansora.co').replace(/\/+$/, '');
    const params = new URLSearchParams({ uid: user.id, run_id: body.run_id, token: callbackToken(user.id, id) });
    submissionStarted = true;
    const task = await client.submit({
      model,
      callBackUrl: `${site}/.netlify/functions/${CHECKER}?${params}`,
      input
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
