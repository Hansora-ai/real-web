'use strict';
const crypto=require('node:crypto');
const {BASE,KEY,auth,db,json,validate,promptFor}=require('../henshin/common.cjs');
const {transition,callbackToken}=require('../reapi/billing.cjs');
const client=require('./client.cjs'),{build,list}=require('./request.cjs');
const pricing=require('../../public/kling4-pricing.js');
function generationId(uid,run){const h=crypto.createHash('sha256').update(`kling4:${uid}:${run}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;}
function responseFor(row,extra={}){const m=row.meta;return {ok:m.status!=='failed',submitted:true,already_submitted:true,taskId:m.task_id,checker:m.checker,run_id:m.run_id,row_id:row.id,status:m.status,result_url:row.result_url,debited:m.charged_cost,refunded:!!m.refunded,...extra};}
function handler(lite=false){return async event=>{
 if(event.httpMethod==='OPTIONS')return json(204,{});
 if(event.httpMethod!=='POST')return json(405,{ok:false});
 let user,id,reserved,acceptedTask,submissionStarted=false;
 try{
  if(!BASE||!KEY||!(process.env.KIE_API_KEY||process.env.KIEAI_API_KEY))throw Object.assign(Error('Kling service is not configured.'),{status:503});
  user=await auth(event);const body=JSON.parse(event.body||'{}');
  if((body.uid&&body.uid!==user.id)||(body.user_id&&body.user_id!==user.id))throw Object.assign(Error('Account mismatch.'),{status:403});
  if(typeof body.run_id!=='string'||body.run_id.length<8||body.run_id.length>160)throw Error('Invalid run identifier.');
  id=generationId(user.id,body.run_id);
  const existing=(await db(`user_generations?id=eq.${id}&user_id=eq.${user.id}&select=id,meta,result_url`))?.[0];
  if(existing)return json(200,responseFor(existing));
  let inputSeconds=0,sourceMeta={};
  const media=require('../henshin/server-media.cjs');
  if(lite){
   validate(body);
   if(body.image_urls.length>10)throw Error('Henshin Lite accepts up to 10 reference images.');
   if(!['720p','1080p'].includes(body.resolution))throw Error('Henshin Lite supports 720p and 1080p.');
   // Keep the verified video and its audio together. Kling handles source audio
   // natively; Lite must not extract or reconnect a separate soundtrack.
   const prepared=await media.prepareSource(body.video_url,{uid:user.id,id:id+'-'+crypto.randomUUID(),maxMB:10,snapshot:true,stripAudio:false});
   const inspected=prepared;
   inputSeconds=inspected.seconds;
   const quote=pricing.quote({resolution:body.resolution,inputSeconds,lite:true});
   if(Number(body.expected_credits)!==quote.displayedCredits)return json(409,{ok:false,error:'The verified duration changed the price. Review the updated quote and generate again.',input_seconds:inputSeconds,displayed_credits:quote.displayedCredits});
   const userPrompt=require('../henshin/prompts.cjs').extra(body.prompt);
   body.prompt=promptFor(body).replace(/@Video\s+(\d+)/gi,'@video_$1').replace(/@Image\s+(\d+)/gi,'@image_$1');
   const ratio=inspected.width/inspected.height,aspects=['16:9','9:16','1:1','21:9'];
   body.aspect_ratio=aspects.find(aspect=>{const [w,h]=aspect.split(':').map(Number);return Math.abs(ratio-w/h)<.02;})||'auto';
   sourceMeta={source_feature:'henshin',henshin_model:'lite',mode:body.mode,user_prompt:userPrompt,keep_audio:body.keep_audio!==false,video_url:body.video_url,source_audio_url:null,finish_video:Math.abs(quote.duration-inputSeconds)>.05,source_width:inspected.width,source_height:inspected.height};
   body.video_urls=[prepared.videoURL];body.keep_original_sound=body.keep_audio!==false;
  }else{
   // Search Models always retains reference-video audio.
   body.keep_original_sound=true;
   const videos=list(body,'video_urls','reference_video_urls',5);
   // Validate request shape before fetching files; durations used for billing are server-probed.
   build(body,{inputSeconds:videos.length?1:0});
   for(const url of videos)inputSeconds+=(await media.inspectVideo(url,{maxMB:10,min:2})).seconds;
   if(inputSeconds>30.0001)throw Error('Reference videos may total at most 30 seconds.');
  }
  const {payload,quote}=build(body,{inputSeconds,lite});
  if(body.expected_credits==null||Number(body.expected_credits)!==quote.displayedCredits)return json(409,{ok:false,error:'Review the updated price before submitting.',input_seconds:inputSeconds,displayed_credits:quote.displayedCredits});
  const meta={source:'kie-kling4',engine:'kling4',provider_api:'market',model:payload.model,model_id:'kling40',run_id:body.run_id,status:'pending',checker:lite?'henshin-check':'kling4-check',resolution:quote.resolution,duration:quote.duration,aspect_ratio:payload.input.aspect_ratio,source_video_duration:inputSeconds,billed_seconds:quote.billedSeconds,refund_amount:quote.internalCredits,reference_image_urls:payload.input.image_urls,reference_video_urls:payload.input.video_urls,reference_audio_urls:payload.input.voices.map(v=>v.audio_url),keep_original_sound:payload.input.keep_original_sound,...sourceMeta};
  reserved=await transition('reserve',id,user.id,{provider:lite?'Hansora Henshin Lite':'Kling 4.0',prompt:lite?(sourceMeta.user_prompt||'Henshin Lite · '+body.mode):payload.input.prompt,meta});
  if(!reserved.created)return json(200,responseFor(reserved.row));
  const site=(process.env.DEPLOY_PRIME_URL||process.env.SITE_BASE||process.env.URL||'https://hansora.co').replace(/\/+$/,'');
  payload.callBackUrl=`${site}/.netlify/functions/kling4-check?uid=${encodeURIComponent(user.id)}&run_id=${encodeURIComponent(body.run_id)}&token=${callbackToken(user.id,id)}`;
  submissionStarted=true;acceptedTask=(await client.submit(payload)).id;
  const saved=await transition('attach',id,user.id,{task_id:acceptedTask});
  return json(201,responseFor(saved.row,{already_submitted:false,credits:reserved.credits}));
 }catch(error){
  if(reserved?.created){
   if(submissionStarted&&!error.rejected){const saved=await transition(acceptedTask?'attach':'uncertain',id,user.id,acceptedTask?{task_id:acceptedTask}:{}).catch(()=>null);return json(202,responseFor(saved?.row||reserved.row,{...(acceptedTask?{taskId:acceptedTask}:{}),submission_uncertain:!saved?.row?.meta?.task_id,message:'Submission is being confirmed. Check this generation before starting another.'}));}
   await transition('fail',id,user.id,{error:error.message}).catch(()=>{});
  }
  return json(error.status||400,{ok:false,error:error.message});
 }
};}
module.exports={handler,generationId,responseFor};
