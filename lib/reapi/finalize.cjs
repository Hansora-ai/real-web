'use strict';
const { BASE, KEY, auth, db, json } = require('../henshin/common.cjs');
const { transition, callbackToken } = require('./billing.cjs');
const { generationId } = require('./launch.cjs');
const client = require('./client.cjs');
const pricing = require('../../public/seedance-pricing.js');
const MODEL = 'doubao-seedance-2.5-face';
function response(row, extra = {}) {
  const m = row.meta;
  return { ok:m.status!=='failed',submitted:true,already_submitted:true,run_id:m.run_id,taskId:m.task_id,checker:'reapi-check',status:m.status,result_url:row.result_url,meta:m,refunded:!!m.refunded,...extra };
}
async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204,{});
  if (event.httpMethod !== 'POST') return json(405,{ok:false,error:'Use POST.'});
  let user,id,reserved,submissionStarted=false,acceptedTask;
  try {
    if (!BASE || !KEY || !process.env.REAPI_API_KEY) throw Object.assign(Error('reAPI service is not configured.'),{status:503});
    user = await auth(event);
    const body = JSON.parse(event.body || '{}');
    if ((body.uid && body.uid !== user.id) || (body.user_id && body.user_id !== user.id)) throw Object.assign(Error('Account mismatch.'),{status:403});
    if (typeof body.draft_run_id !== 'string' || body.draft_run_id.length < 8 || body.draft_run_id.length > 160) throw Error('Choose a completed 480p draft.');
    const parent = (await db(`user_generations?user_id=eq.${user.id}&meta->>run_id=eq.${encodeURIComponent(body.draft_run_id)}&select=id,user_id,prompt,result_url,meta,created_at`))?.[0];
    const m = parent?.meta || {};
    if (!parent?.result_url || m.source !== 'reapi' || m.model !== MODEL || !client.taskId({id:m.task_id}) || m.draft !== true || m.resolution !== '480p' || m.status !== 'done' || m.source_feature === 'henshin') throw Error('This result is not an eligible completed 480p draft.');
    const finals = await db(`user_generations?user_id=eq.${user.id}&meta->>draft_parent_run_id=eq.${encodeURIComponent(body.draft_run_id)}&meta->>source=eq.reapi&meta->>draft_final=eq.true&select=id,meta,result_url&order=created_at.desc&limit=1`);
    const previous = finals?.[0];
    if (previous && previous.meta.status !== 'failed') return json(200,response(previous));
    const expires = Date.parse(m.draft_expires_at || new Date(Date.parse(parent.created_at)+7*86400000).toISOString());
    if (!Number.isFinite(expires) || expires <= Date.now()) throw Error('This draft has expired. Generate a new 480p video to make a 1080p version.');
    // Explicit-length drafts retain their requested duration. Auto/edit drafts
    // inherit their delivered video length, measured from our archived result.
    const seconds = m.video_edit_mode
      ? Math.ceil((await require('../henshin/server-media.cjs').inspectVideo(parent.result_url,{min:4,maxMB:200})).seconds)
      : Number(m.duration);
    const quote = pricing.quoteFinal({duration:seconds,inputSeconds:Number(m.source_video_duration || 0)});
    const attempt = Number(previous?.meta.final_attempt || 0)+1;
    const run = `seedance25-final-${parent.id}-${attempt}`;
    id = generationId(user.id,run);
    if (body.quote_only === true) return json(200,{ok:true,quote_only:true,run_id:run,...quote});
    if (Number(body.expected_credits) !== quote.displayedCredits) return json(409,{ok:false,error:'Review the 1080p price before generating.',displayed_credits:quote.displayedCredits,need:quote.internalCredits});
    const meta = {source:'reapi',engine:'seedance-2.5',model:MODEL,run_id:run,status:'pending',checker:'reapi-check',resolution:'1080p',duration:seconds,
      draft_final:true,draft_parent_run_id:m.run_id,final_attempt:attempt,draft_task_id:m.task_id,
      source_video_duration:quote.inputSeconds,billed_seconds:quote.billedSeconds,refund_amount:quote.internalCredits,
      reference_image_urls:m.reference_image_urls||[],reference_video_urls:m.reference_video_urls||[],reference_audio_urls:m.reference_audio_urls||[],first_frame_url:m.first_frame_url,last_frame_url:m.last_frame_url};
    reserved = await transition('reserve',id,user.id,{provider:'Seedance 2.5 · 1080p',prompt:parent.prompt,meta});
    if (!reserved.created) return json(200,response(reserved.row));
    const site = (process.env.DEPLOY_PRIME_URL || process.env.SITE_BASE || process.env.URL || 'https://hansora.co').replace(/\/+$/,'');
    // Inherited prompt/media/duration/ratio/seed/audio MUST NOT be resent.
    const payload = {model:MODEL,draft_task_id:m.task_id,resolution:'1080p',output_format:'mp4',watermark:false,bitrate_mode:'default',
      webhook_url:`${site}/.netlify/functions/reapi-check?uid=${encodeURIComponent(user.id)}&run_id=${encodeURIComponent(run)}&token=${callbackToken(user.id,id)}`};
    submissionStarted = true;
    const task = await client.submit(payload);
    acceptedTask = task.id;
    const saved = await transition('attach',id,user.id,{task_id:task.id});
    return json(201,response(saved.row,{already_submitted:false,credits:reserved.credits}));
  } catch (error) {
    if (reserved?.created) {
      if (submissionStarted && !error.rejected) {
        const latest = await transition(acceptedTask?'attach':'uncertain',id,user.id,acceptedTask?{task_id:acceptedTask}:{}).catch(()=>null);
        return json(202,response(latest?.row || reserved.row,{...(acceptedTask?{taskId:acceptedTask}:{}),already_submitted:false,submission_uncertain:true}));
      }
      await transition('fail',id,user.id,{error:error.message}).catch(()=>{});
    }
    return json(error.status || 400,{ok:false,error:error.message});
  }
}
module.exports = {handler};
