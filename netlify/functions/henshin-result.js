const {json,auth,db,mediaURL}=require('../../lib/henshin/common.cjs');
exports.handler=async event=>{
 try {
  if(event.httpMethod!=='POST') return json(405,{ok:false,error:'Use POST.'});
  const user=await auth(event),body=JSON.parse(event.body||'{}');
  if(!/^[a-f0-9-]{36}$/i.test(body.id||'')||!mediaURL(body.result_url)) throw Error('Invalid result.');
  const rows=await db(`user_generations?id=eq.${body.id}&user_id=eq.${user.id}&select=id,meta,result_url`);
  const row=rows?.[0];
  if(!row||row.meta?.source_feature!=='henshin'||!row.result_url||!row.meta.source_audio_url) return json(404,{ok:false,error:'Henshin result unavailable.'});
  if(row.meta.audio_restored) return json(200,{ok:true,result_url:row.result_url});
  await db(`user_generations?id=eq.${row.id}&user_id=eq.${user.id}`,{method:'PATCH',body:JSON.stringify({result_url:body.result_url,meta:{...row.meta,generated_video_url:row.result_url,audio_restored:true,audio_restored_at:new Date().toISOString()}})});
  return json(200,{ok:true,result_url:body.result_url});
 } catch(e) {return json(e.status||400,{ok:false,error:e.message});}
};
