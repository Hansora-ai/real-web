const {templateInput,templatePublic}=require('../../lib/henshin/templates.cjs');
const {inspect}=require('../../lib/henshin/inspect.cjs');
const {BASE,KEY,OWNER,json,auth,db,mediaURL}=require('../../lib/henshin/common.cjs');
const {mediaFiles,removeFiles}=require('../../lib/henshin/template-storage.cjs');
const validID=id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||'');
exports.handler=async event=>{
 try {
  if(!BASE||!KEY) throw Error('Templates service unavailable.');
  if(event.httpMethod==='GET'&&!event.queryStringParameters?.id) {
   let pending=false;
   if(event.queryStringParameters?.pending==='1'){const user=await auth(event);if(!user.email_confirmed_at||String(user.email).toLowerCase()!==OWNER)return json(403,{ok:false,error:'Only the confirmed template owner can manage templates.'});pending=true;}
   const offset=Number(event.queryStringParameters?.offset||0),limit=24;
   if(!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid library page.');
   const rows=await db(`user_generations?provider=eq.Henshin%20Template&${pending?'or=(meta->>published.eq.true,meta->>deleting.eq.true)':'meta->>published=eq.true'}&order=created_at.desc,id.desc&offset=${offset}&limit=${limit+1}&select=id,prompt,result_url,meta`);
   const result=json(200,{ok:true,templates:(rows||[]).slice(0,limit).map(templatePublic),next_offset:rows?.length>limit?offset+limit:null});
   return result;
  }
  if(!['GET','POST','PATCH','DELETE'].includes(event.httpMethod)) return json(405,{ok:false,error:'Use GET, POST, PATCH or DELETE.'});
  const user=await auth(event);
  if(!user.email_confirmed_at||String(user.email).toLowerCase()!==OWNER) return json(403,{ok:false,error:'Only the confirmed template owner can manage templates.'});
  const body=event.httpMethod==='GET'?{id:event.queryStringParameters.id}:JSON.parse(event.body||'{}');
  let row,path;
  if(event.httpMethod!=='POST') {
   if(!validID(body.id))throw Error('Invalid template identifier.');
   path='user_generations?id=eq.'+encodeURIComponent(body.id)+'&user_id=eq.'+encodeURIComponent(user.id)+'&provider=eq.Henshin%20Template&meta->>source_feature=eq.henshin-template';
   row=(await db(path+'&select=id,prompt,result_url,meta'))?.[0];
   if(!row) return json(404,{ok:false,error:'Template not found.'});
  }
  if(event.httpMethod==='GET')return json(200,{ok:true,template:templatePublic(row)});
  if(event.httpMethod==='DELETE') {
   // Keep the row until Storage confirms removal, so a partial failure can be retried.
   const locked=await db(path+'&meta=eq.'+encodeURIComponent(JSON.stringify(row.meta)),{method:'PATCH',body:JSON.stringify({meta:{...row.meta,published:false,deleting:true}})});
   if(!locked?.length)return json(409,{ok:false,error:'Template changed. Please reload and try again.'});
   await removeFiles(mediaFiles(row));
   await db(path,{method:'DELETE'});
   return json(200,{ok:true,id:row.id});
  }
  if(row?.meta?.deleting)throw Error('Template deletion is in progress. Please retry deleting it.');
  const inputs=templateInput(body);
  const {seconds:duration,aspectRatio}=row?.result_url===body.video_url?{seconds:row.meta.duration,aspectRatio:row.meta.aspect_ratio}:await inspect(body.video_url);
  if(!Number.isFinite(duration)||duration<4||duration>30) throw Error('Templates must be 4–30 seconds.');
  const sourceDuration=inputs.source_video_url===body.video_url?duration:row?.meta.source_video_url===inputs.source_video_url?row.meta.source_duration:(await inspect(inputs.source_video_url)).seconds;
  if(sourceDuration<4||sourceDuration>30)throw Error('Source videos must be 4–30 seconds.');
  const meta={source_feature:'henshin-template',published:true,duration,aspect_ratio:aspectRatio,source_duration:sourceDuration,...inputs,status:'ready'};
  if(row){
   const active=new Set(mediaFiles({result_url:body.video_url,meta}));
   meta.retired_media_urls=mediaFiles(row).filter(url=>!active.has(url));
  }
  const values={user_id:user.id,provider:'Henshin Template',kind:'video',prompt:row?.prompt||'Motion template',result_url:body.video_url,meta};
  const rows=await db(row?path+'&meta=eq.'+encodeURIComponent(JSON.stringify(row.meta)):'user_generations',{method:row?'PATCH':'POST',body:JSON.stringify(values)});
  if(row&&!rows?.length)return json(409,{ok:false,error:'Template changed. Please reload and try again.'});
  let cleanupPending=false;
  if(meta.retired_media_urls?.length){
   try{await removeFiles(meta.retired_media_urls);await db(path+'&meta=eq.'+encodeURIComponent(JSON.stringify(meta)),{method:'PATCH',body:JSON.stringify({meta:{...meta,retired_media_urls:[]}})});}
   catch{cleanupPending=true;}
  }
  return json(row?200:201,{ok:true,id:rows?.[0]?.id||row?.id,cleanup_pending:cleanupPending});
 } catch(e) {return json(e.status||400,{ok:false,error:e.message});}
};
