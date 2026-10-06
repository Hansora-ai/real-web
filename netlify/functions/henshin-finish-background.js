const crypto=require('node:crypto');
const {json,db}=require('../../lib/henshin/common.cjs');
const {internal,audioPending}=require('../../lib/henshin/jobs.cjs');
const {restoreSoundtrack}=require('../../lib/henshin/server-media.cjs');
const shared=require('./kie-check.js');
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return json(405,{ok:false});
 if(!internal(event))return json(401,{ok:false});
 const {id}=JSON.parse(event.body||'{}');
 if(!/^[a-f0-9-]{36}$/i.test(id||''))return json(400,{ok:false});
 const path=`user_generations?id=eq.${id}&select=id,user_id,result_url,meta`;
 let row=(await db(path))?.[0];
 if(row?.meta?.source_feature!=='henshin')return json(404,{ok:false});
 if(row.result_url&&(!row.meta.source_audio_url||row.meta.audio_restored))return json(200,{ok:true});
 if(!audioPending(row)&&row.meta.task_id&&['processing','pending'].includes(row.meta.status)){
  await shared.handler({httpMethod:'GET',henshinFinishInline:true,queryStringParameters:{uid:row.user_id,run_id:row.meta.run_id,taskId:row.meta.task_id}});
  row=(await db(path))?.[0];
 }
 if(!audioPending(row)||row.meta.status==='audio_failed'||Number(row.meta.audio_lease_until)>Date.now()||Date.parse(row.meta.audio_retry_at)>Date.now())return json(200,{ok:true});
 const lease=crypto.randomUUID(),oldLease=row.meta.audio_lease||null;
 const attempts=Number(row.meta.audio_attempts||0)+1;
 const meta={...row.meta,status:'restoring_audio',generated_video_url:row.meta.generated_video_url||row.result_url,audio_lease:lease,audio_lease_until:Date.now()+16*60*1000,audio_attempts:attempts,audio_error:null};
 // Compare the previous lease. Simultaneous callbacks/sweeps cannot mux twice.
 const claimed=await db(`user_generations?id=eq.${id}&meta->>audio_lease=${oldLease?'eq.'+encodeURIComponent(oldLease):'is.null'}&or=(meta->>audio_restored.is.null,meta->>audio_restored.eq.false)`,{method:'PATCH',body:JSON.stringify({result_url:null,meta})});
 if(!claimed?.length)return json(200,{ok:true,already_claimed:true});
 row={...row,result_url:null,meta};
 try{
  const result=await restoreSoundtrack(row);
  await db(`user_generations?id=eq.${id}&meta->>audio_lease=eq.${lease}`,{method:'PATCH',body:JSON.stringify({result_url:result,meta:{...meta,status:'done',audio_restored:true,audio_restored_at:new Date().toISOString(),audio_lease_until:0,audio_retry_at:null,audio_error:null,completed_at:new Date().toISOString()}})});
  return json(200,{ok:true});
 }catch(e){
  const terminal=!!e.permanent||attempts>=3;
  await db(`user_generations?id=eq.${id}&meta->>audio_lease=eq.${lease}`,{method:'PATCH',body:JSON.stringify({meta:{...meta,status:terminal?'audio_failed':'audio_retry',audio_lease_until:0,audio_error:e.message,audio_retry_at:terminal?null:new Date(Date.now()+60000*2**(attempts-1)).toISOString()}})});
  return json(200,{ok:false,status:terminal?'audio_failed':'audio_retry'});
 }
};
