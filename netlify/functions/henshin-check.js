// Henshin owns its authenticated polling/callback route. Provider reconciliation,
// result archival and atomic refund claims remain shared with the existing checker.
const crypto=require('node:crypto');
const {json,auth,db}=require('../../lib/henshin/common.cjs');
const shared=require('./kie-check.js');
const {audioPending,enqueue}=require('../../lib/henshin/jobs.cjs');
function equalToken(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length>=32&&x.length===y.length&&crypto.timingSafeEqual(x,y);}
exports.handler=async event=>{
 try{
  if(!['GET','POST'].includes(event.httpMethod))return json(405,{ok:false,error:'Use GET or POST.'});
  const q=event.queryStringParameters||{};
  if(!/^[a-f0-9-]{36}$/i.test(q.uid||'')||typeof q.run_id!=='string'||q.run_id.length<8||q.run_id.length>160)throw Error('Invalid generation identifier.');
  if(event.httpMethod==='GET'){const user=await auth(event);if(user.id!==q.uid)return json(403,{ok:false,error:'This generation belongs to another account.'});}
  const path=`user_generations?user_id=eq.${encodeURIComponent(q.uid)}&meta->>run_id=eq.${encodeURIComponent(q.run_id)}&select=id,user_id,result_url,meta`;
  const row=(await db(path))?.[0];
  if(!row||row.meta?.source_feature!=='henshin')return json(404,{ok:false,error:'Henshin generation unavailable.'});
  if(event.httpMethod==='POST'&&!equalToken(q.token,row.meta.callback_token))return json(403,{ok:false,error:'Invalid callback token.'});
  if(audioPending(row)){
   await enqueue(row).catch(()=>{});
   return json(200,{ok:true,status:row.meta.status==='audio_failed'?'audio_failed':'restoring_audio',meta:row.meta});
  }
  if(row.result_url)return json(200,{ok:true,status:'ready',result_url:row.result_url,meta:row.meta});
  if(/fail|reject|cancel/.test(row.meta.status||''))return json(200,{ok:false,failed:true,status:'failed',error:row.meta.error||'Generation failed.',refunded:!!row.meta.refunded});
  if(!row.meta.task_id&&event.httpMethod==='POST'){
   const body=JSON.parse(event.body||'{}'),taskId=body.taskId||body.task_id||body.data?.taskId||body.data?.task_id;
   if(typeof taskId==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(taskId)){
    // A signed callback can reconcile a submission whose provider response timed out.
    row.meta={...row.meta,task_id:taskId,status:'processing'};
    await db(`user_generations?id=eq.${row.id}&user_id=eq.${row.user_id}`,{method:'PATCH',body:JSON.stringify({meta:row.meta})});
   }
  }
  if(!row.meta.task_id)return json(200,{ok:false,status:'pending'});
  // Poll the provider ourselves; callback bodies cannot forge a result or refund.
  const response=await shared.handler({httpMethod:'GET',queryStringParameters:{uid:row.user_id,run_id:row.meta.run_id,taskId:row.meta.task_id}});
  const latest=(await db(path))?.[0];
  const result=JSON.parse(response.body||'{}');
  if(audioPending(latest))return json(200,{ok:true,status:latest.meta.status==='audio_failed'?'audio_failed':'restoring_audio',meta:latest.meta});
  if(latest?.meta?.audio_restored&&latest.result_url)return json(200,{ok:true,status:'ready',result_url:latest.result_url,meta:latest.meta});
  return json(200,{...result,meta:latest?.meta||row.meta});
 }catch(e){return json(e.status||400,{ok:false,error:e.message});}
};
