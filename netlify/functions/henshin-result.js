// Authenticated retry only. Visitors cannot write arbitrary final-video URLs.
const {json,auth,db}=require('../../lib/henshin/common.cjs');
const {audioPending,enqueue}=require('../../lib/henshin/jobs.cjs');
exports.handler=async event=>{
 try{
  if(event.httpMethod!=='POST')return json(405,{ok:false,error:'Use POST.'});
  const user=await auth(event),body=JSON.parse(event.body||'{}');
  if(!/^[a-f0-9-]{36}$/i.test(body.id||''))throw Error('Invalid result.');
  const row=(await db(`user_generations?id=eq.${body.id}&user_id=eq.${user.id}&select=id,user_id,meta,result_url`))?.[0];
  if(row?.meta?.source_feature!=='henshin')return json(404,{ok:false,error:'Henshin result unavailable.'});
  if(row.meta.audio_restored)return json(200,{ok:true,result_url:row.result_url});
  if(!audioPending(row))return json(409,{ok:false,error:'Wait for the generated video.'});
  if(Number(row.meta.audio_lease_until)>Date.now())return json(202,{ok:true,status:'restoring_audio'});
  const leaseFilter=row.meta.audio_lease?'eq.'+encodeURIComponent(row.meta.audio_lease):'is.null';
  const updated=await db(`user_generations?id=eq.${row.id}&user_id=eq.${user.id}&meta->>audio_lease=${leaseFilter}&meta->>status=eq.${row.meta.status}`,{method:'PATCH',body:JSON.stringify({result_url:null,meta:{...row.meta,generated_video_url:row.meta.generated_video_url||row.result_url,status:'restoring_audio',audio_retry_at:null,audio_attempts:0,audio_error:null}})});
  if(updated?.length)await enqueue(updated[0]).catch(()=>{});
  return json(202,{ok:true,status:'restoring_audio'});
 }catch(e){return json(e.status||400,{ok:false,error:e.message});}
};
