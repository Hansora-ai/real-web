const {inspect}=require('../../lib/henshin/inspect.cjs');
const {BASE,KEY,OWNER,json,auth,db,mediaURL}=require('../../lib/henshin/common.cjs');
exports.handler=async event=>{
 try {
  if(!BASE||!KEY) throw Error('Templates service unavailable.');
  if(event.httpMethod==='GET') {
   const rows=await db('user_generations?provider=eq.Henshin%20Template&meta->>published=eq.true&order=created_at.desc&limit=100&select=id,prompt,result_url,meta');
   return json(200,{ok:true,templates:(rows||[]).map(r=>({id:r.id,title:r.prompt,video_url:r.result_url,duration:r.meta.duration}))});
  }
  if(event.httpMethod!=='POST') return json(405,{ok:false,error:'Use GET or POST.'});
  const user=await auth(event);
  if(!user.email_confirmed_at||String(user.email).toLowerCase()!==OWNER) return json(403,{ok:false,error:'Only the template owner can publish videos.'});
  const body=JSON.parse(event.body||'{}');
  if(!mediaURL(body.video_url)) throw Error('Invalid template video URL.');
  const {seconds:duration}=await inspect(body.video_url);
  if(!Number.isFinite(duration)||duration<4||duration>30) throw Error('Templates must be 4–30 seconds.');
  const title=String(body.title||'Motion template').trim().slice(0,100);
  const rows=await db('user_generations',{method:'POST',body:JSON.stringify({user_id:user.id,provider:'Henshin Template',kind:'video',prompt:title,result_url:body.video_url,meta:{source_feature:'henshin-template',published:true,duration,status:'ready'}})});
  return json(201,{ok:true,id:rows?.[0]?.id});
 } catch(e) {return json(e.status||400,{ok:false,error:e.message});}
};
