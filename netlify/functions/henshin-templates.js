const {templateInput,templatePublic}=require('../../lib/henshin/templates.cjs');
const {inspect}=require('../../lib/henshin/inspect.cjs');
const {BASE,KEY,OWNER,json,auth,db,mediaURL}=require('../../lib/henshin/common.cjs');
exports.handler=async event=>{
 try {
  if(!BASE||!KEY) throw Error('Templates service unavailable.');
  if(event.httpMethod==='GET') {
   const rows=await db('user_generations?provider=eq.Henshin%20Template&meta->>published=eq.true&order=created_at.desc&limit=100&select=id,prompt,result_url,meta');
   const result=json(200,{ok:true,templates:(rows||[]).map(templatePublic)});
   result.headers['Cache-Control']='public, max-age=0, s-maxage=10, must-revalidate';
   return result;
  }
  if(!['POST','DELETE'].includes(event.httpMethod)) return json(405,{ok:false,error:'Use GET, POST or DELETE.'});
  const user=await auth(event);
  if(!user.email_confirmed_at||String(user.email).toLowerCase()!==OWNER) return json(403,{ok:false,error:'Only the confirmed template owner can publish or delete videos.'});
  const body=JSON.parse(event.body||'{}');
  if(event.httpMethod==='DELETE') {
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id||'')) throw Error('Invalid template identifier.');
   const path='user_generations?id=eq.'+encodeURIComponent(body.id)+'&user_id=eq.'+encodeURIComponent(user.id)+'&provider=eq.Henshin%20Template&meta->>source_feature=eq.henshin-template';
   const row=(await db(path+'&select=id,meta'))?.[0];
   if(!row) return json(404,{ok:false,error:'Template not found.'});
   // Remove from the public library while preserving its recipe and files.
   await db(path,{method:'PATCH',body:JSON.stringify({meta:{...row.meta,published:false,deleted_at:new Date().toISOString()}})});
   return json(200,{ok:true,id:row.id});
  }
  const inputs=templateInput(body);
  const {seconds:duration,aspectRatio}=await inspect(body.video_url);
  if(!Number.isFinite(duration)||duration<4||duration>30) throw Error('Templates must be 4–30 seconds.');
  const sourceDuration=inputs.source_video_url===body.video_url?duration:(await inspect(inputs.source_video_url)).seconds;
  if(sourceDuration<4||sourceDuration>30)throw Error('Source videos must be 4–30 seconds.');
  const title=String(body.title||'Motion template').trim().slice(0,100);
  const rows=await db('user_generations',{method:'POST',body:JSON.stringify({user_id:user.id,provider:'Henshin Template',kind:'video',prompt:title,result_url:body.video_url,meta:{source_feature:'henshin-template',published:true,duration,aspect_ratio:aspectRatio,source_duration:sourceDuration,...inputs,status:'ready'}})});
  return json(201,{ok:true,id:rows?.[0]?.id});
 } catch(e) {return json(e.status||400,{ok:false,error:e.message});}
};
