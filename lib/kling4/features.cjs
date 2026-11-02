'use strict';
const {handler}=require('./launch.cjs');
const {auth,db,json}=require('../henshin/common.cjs');
const features={
 'video-relight':{
  id:'video-relight',name:'Video Relight',
  prompt(body){
   const references=body.image_urls.map((_,i)=>`@image_${i+1}`).join(', ');
   return [
    'Relight @video_1 only. Preserve every subject, identity, face, body, clothing, object, background, action, expression and lip movement.',
    'Keep the source camera movement, angle, framing, cuts, duration and timing unchanged. Do not replace subjects or change the environment.',
    references?`Use ${references} only as lighting examples: match light direction, color temperature, exposure, contrast, shadows and reflections. Do not copy their subjects, objects, backgrounds or composition.`:'',
    `Lighting instruction: ${[body.lighting_preset,body.lighting_prompt,body.user_lighting_note,body.prompt].filter(Boolean).join('. ')}`,
    'Apply consistent realistic illumination throughout the clip. Only lighting, color mood, shadows and highlights should change.'
   ].filter(Boolean).join(' ');
  }
 },
 'background-change':{
  id:'background-change',name:'Background Change',
  prompt(body){
   const references=body.image_urls.map((_,i)=>`@image_${i+1}`).join(', ');
   return [
    'Change only the background of @video_1. Preserve the original foreground subjects, identities, faces, bodies, clothing, hairstyles, expressions, gestures and lip movements.',
    'Keep camera movement, framing, cuts, duration and timing unchanged. Replace only the environment, matching perspective, lighting, shadows, reflections and depth.',
    references?`Use ${references} as background references only; do not copy or replace their people or foreground subjects.`:'',
    `User background request: ${body.prompt}`
   ].filter(Boolean).join(' ');
  }
 }
};
function launch(id){
 const feature=features[id],run=handler(true,feature);
 return async event=>{
  if(event.httpMethod!=='POST')return run(event);
  try{
   const body=JSON.parse(event.body||'{}');
   const start=Number(body.video_start??0),ends=Number(body.video_end);
   if(!Number.isFinite(start)||!Number.isFinite(ends)||start<0||ends-start<4||ends-start>30.0001)throw Error('Choose a 4–30 second video segment.');
   if(typeof body.prompt!=='string'||!body.prompt.trim()||body.prompt.length>1200)throw Error('Enter a valid editing instruction.');
   // Feature routing is fixed by this endpoint, never a client-provided feature.
   // Keep the internal Henshin pipeline marker for its protected audio worker;
   // tool_feature and provider keep these jobs in the correct feature history.
   return run({...event,body:JSON.stringify({...body,mode:'edit',keep_audio:true,source_video_duration:ends-start,input_window:{start,ends}})});
  }catch(error){return json(400,{ok:false,error:error.message});}
 };
}
function checker(id,legacy){
 return async event=>{
  // New callbacks go to the signed Kling checker. Preserve old Gemini callbacks
  // and pending legacy jobs while routing authenticated feature polls correctly.
  if(event.httpMethod!=='GET')return legacy(event);
  try{
   const user=await auth(event),q=event.queryStringParameters||{};
   if(q.uid!==user.id)return json(403,{ok:false,error:'Account mismatch.'});
   const row=(await db(`user_generations?user_id=eq.${encodeURIComponent(user.id)}&meta->>run_id=eq.${encodeURIComponent(q.run_id||'')}&select=id,user_id,result_url,meta`))?.[0];
   if(row?.meta?.source==='kie-kling4'){
    if(row.meta.tool_feature!==id)return json(404,{ok:false,error:'Generation unavailable.'});
    return require('./check.cjs').handler(event);
   }
   return legacy(event);
  }catch(error){return json(error.status||400,{ok:false,error:error.message});}
 };
}
module.exports={launch,checker,features};
