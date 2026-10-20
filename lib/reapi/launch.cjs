'use strict';
const crypto = require('node:crypto');
const { BASE, KEY, auth, db, json, validate, promptFor } = require('../henshin/common.cjs');
const { transition, callbackToken } = require('./billing.cjs');
const client = require('./client.cjs');
const { build, urls } = require('./request.cjs');
function generationId(uid, run) {
  const hash = crypto.createHash('sha256').update(`reapi:${uid}:${run}`).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
}
async function inspectReferences(videos, audio, version) {
  if (!videos.length && !audio.length) return 0;
  const media = require('../henshin/server-media.cjs');
  const max = version === '2.5' ? 30 : 15;
  const wan = version === 'wan-3';
  let total = 0, audioTotal = 0;
  await media.withCore(async core => {
    for (const [type, list] of [['video', videos], ['audio', audio]]) {
      for (const url of list) {
        // Only our public object storage is fetched server-side (no redirects).
        core.FS.writeFile('reference', await media.readMedia(url, 10000, type === 'audio' ? 15 : wan ? 100 : version === '2.5' ? 200 : 50));
        const report = media.probe(core, 'reference');
        const seconds = Number(report.format?.duration);
        if (!report.streams?.some(s => s.codec_type === type) || !Number.isFinite(seconds) || seconds <= 0 || seconds > max + .0001 || (version === '2.5' && seconds < 2) || (wan && seconds < 1)) throw Error(`Invalid ${wan ? 'Wan 3.0' : 'Seedance'} ${type} duration.`);
        if (type === 'video') total += seconds; else audioTotal += seconds;
        core.FS.unlink('reference');
      }
    }
  });
  if (total > max + .0001 || audioTotal > max + .0001) throw Error(`Reference videos and audio may each total at most ${max} seconds.`);
  return total;
}
function responseFor(row, extra = {}) {
  const m = row.meta;
  return { ok: m.status !== 'failed', submitted: true, already_submitted: true, taskId: m.task_id, checker:m.checker || (m.source === 'reapi' ? 'reapi-check' : 'kie-check'), run_id: m.run_id, row_id: row.id, status: m.status, result_url: row.result_url, debited: m.charged_cost, refunded: !!m.refunded, ...extra };
}
function handler(version, henshin = false) {
 const wan = version === 'wan-3', buildRequest = wan ? require('./wan-request.cjs').build : build;
 return async event => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { ok:false, error:'Use POST.' });
  let id, user, reserved, acceptedTask, submissionStarted = false;
  try {
    if (!BASE || !KEY || !process.env.REAPI_API_KEY) throw Object.assign(Error('reAPI service is not configured.'), {status:503});
    user = await auth(event);
    const body = JSON.parse(event.body || '{}');
    if ((body.uid && body.uid !== user.id) || (body.user_id && body.user_id !== user.id)) throw Object.assign(Error('Account mismatch.'), {status:403});
    if (typeof body.run_id !== 'string' || body.run_id.length < 8 || body.run_id.length > 160) throw Error('Invalid run identifier.');
    id = generationId(user.id, body.run_id);
    let existing = (await db(`user_generations?id=eq.${id}&user_id=eq.${user.id}&select=id,meta,result_url`))?.[0];
    if (!existing && wan) existing = (await db(`user_generations?user_id=eq.${user.id}&meta->>run_id=eq.${encodeURIComponent(body.run_id)}&select=id,meta,result_url`))?.[0];
    if (existing) return json(200, responseFor(existing));
    let inputSeconds, sourceMeta = {};
    if (henshin) {
      validate(body);
      const inspected = await require('../henshin/server-media.cjs').prepareSource(body.video_url, {uid:user.id,id:id+'-'+crypto.randomUUID(),keepAudio:body.keep_audio!==false});
      inputSeconds = inspected.seconds;
      const originalPrompt = require('../henshin/prompts.cjs').extra(body.prompt);
      const composed = promptFor(body);
      sourceMeta = {source_feature:'henshin',mode:body.mode,user_prompt:originalPrompt,keep_audio:body.keep_audio!==false,video_url:body.video_url,source_audio_url:inspected.audioURL,source_video_duration:inputSeconds};
      body.prompt = composed; body.duration = -1; body.generate_audio = body.keep_audio === false;
      body.reference_video_urls = [inspected.videoURL]; body.reference_image_urls = body.image_urls;
      body.reference_audio_urls = []; delete body.audio_url;
    } else {
      // Validate shapes before downloading media. Billable lengths come from the
      // actual files, never from client-provided source_video_duration.
      const videos = urls(body, 'reference_video_urls', 'video_urls');
      const audio = urls(body, 'reference_audio_urls', 'audio_urls');
      buildRequest(body, version, {inputSeconds: wan ? 0 : videos.length ? Math.min(version === '2.5' ? 30 : 15, Number(body.source_video_duration) || 5) : 0});
      inputSeconds = await inspectReferences(videos, audio, version);
    }
    const {payload, quote, edit} = buildRequest(body, version, {inputSeconds, henshin});
    if ((wan && inputSeconds > 0 && body.expected_credits == null) || (body.expected_credits != null && Number(body.expected_credits) !== quote.displayedCredits)) return json(409,{ok:false,error:'The verified media duration changed the price. Review the new quote before submitting.',displayed_credits:quote.displayedCredits,input_seconds:inputSeconds,need:quote.internalCredits});
    const token = callbackToken(user.id,id);
    const checker = henshin ? 'henshin-check' : 'reapi-check';
    const meta = {source:'reapi',engine:henshin?'henshin':wan?'wan-3':`seedance-${version}`,model_id:wan?'wan-3':undefined,model:payload.model,variant:body.variant||'standard',run_id:body.run_id,status:'pending',checker,
      resolution:wan?quote.resolution:payload.resolution,...(wan?{aspect_ratio:payload.size,generate_audio:payload.audio,prompt_extend:payload.prompt_extend,seed:payload.seed}:{}),duration:quote.duration,source_video_duration:inputSeconds,video_edit_mode:edit,charged_duration:quote.duration,billed_seconds:quote.billedSeconds,refund_amount:quote.internalCredits,
      reference_video_urls:payload.video_urls||[],reference_image_urls:payload.image_urls||[],reference_audio_urls:payload.audio_urls||[],first_frame_url:body.first_frame_url,last_frame_url:body.last_frame_url,...sourceMeta};
    reserved = await transition('reserve',id,user.id,{provider:henshin?'Hansora Henshin':wan?'Wan 3.0':`Seedance ${version}`,prompt:henshin?(sourceMeta.user_prompt || `Henshin · ${body.mode==='swap'?'Object swap':body.mode==='edit'?'Video edit':'Motion transfer'}`):payload.prompt,meta});
    if (!reserved.created) return json(200,responseFor(reserved.row));
    const site = (process.env.DEPLOY_PRIME_URL || process.env.SITE_BASE || process.env.URL || 'https://hansora.co').replace(/\/+$/,'');
    payload.webhook_url = `${site}/.netlify/functions/${checker}?uid=${encodeURIComponent(user.id)}&run_id=${encodeURIComponent(body.run_id)}&token=${token}`;
    submissionStarted = true;
    const task = await client.submit(payload);
    acceptedTask = task.id;
    const saved = await transition('attach',id,user.id,{task_id:task.id});
    return json(201,responseFor(saved.row,{already_submitted:false,credits:reserved.credits}));
  } catch (error) {
    if (reserved?.created) {
      if (submissionStarted && !error.rejected) {
        // Keep the run reserved. Webhook/sweep can recover it; a browser retry
        // with the same run id never makes a second paid POST.
        const latest = await transition(acceptedTask?'attach':'uncertain',id,user.id,acceptedTask?{task_id:acceptedTask}:{}).catch(()=>null);
        return json(202,responseFor(latest?.row || reserved.row,{...(acceptedTask?{taskId:acceptedTask}:{}),already_submitted:false,submission_uncertain:!latest?.row?.meta?.task_id,message:'Submission is being confirmed. Check this generation before submitting another request.'}));
      }
      await transition('fail',id,user.id,{error:error.message}).catch(()=>{});
    }
    return json(error.status || 400,{ok:false,error:error.message});
  }
}; }
module.exports = { handler, generationId, inspectReferences };
