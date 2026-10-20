'use strict';
const crypto = require('node:crypto');
const {auth,db,json} = require('../henshin/common.cjs');
const {transition,callbackToken} = require('./billing.cjs');
const client = require('./client.cjs');
function tokenEqual(a,b) {
  const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));
  return x.length>=32 && x.length===y.length && crypto.timingSafeEqual(x,y);
}
function result(row) {
  const failed=row.meta.status==='failed';
  return {ok:!!row.result_url,failed,status:failed?'failed':row.result_url?'done':row.meta.status,error:failed?row.meta.error:undefined,refunded:!!row.meta.refunded,result_url:row.result_url,video_url:row.result_url,urls:row.result_url?[row.result_url]:[]};
}
async function reconcile(row,{enqueueAudio=true}={}) {
  if (row.meta.source!=='reapi') throw Error('Invalid provider.');
  if(row.result_url || row.meta.status==='failed')return result(row);
  if(require('../henshin/jobs.cjs').audioPending(row))return result(row);
  await transition('touch',row.id,row.user_id);
  const id=row.meta.task_id;
  if(!id) {
    const recovery=await transition('fail',row.id,row.user_id,{orphan:true,error:'Submission could not be confirmed. Your credits were returned.'});
    return result(recovery.row);
  }
  const state=await client.state(id,row.meta.model);
  if(state.failed) {
    const refund=await transition('fail',row.id,row.user_id,{error:state.error});
    return result(refund.row);
  }
  if(state.done) {
    const inputs = [row.meta.video_url,row.meta.first_frame_url,row.meta.last_frame_url,...(row.meta.reference_video_urls||[]),...(row.meta.reference_image_urls||[]),...(row.meta.reference_audio_urls||[])];
    if(state.urls.some(url=>inputs.includes(url)))throw Error('Provider returned an input instead of a generated video.');
    // Reuse history archival and the durable original-soundtrack workflow.
    // This helper commits reAPI completion through the atomic billing RPC.
    await require('../../netlify/functions/kie-check.js').markDone({row,ids:{uid:row.user_id,run_id:row.meta.run_id,taskId:id},urls:state.urls,enqueueAudio});
    const latest=(await db(`user_generations?id=eq.${row.id}&select=id,user_id,result_url,meta`))?.[0];
    return result(latest||row);
  }
  return {ok:false,status:'pending'};
}
async function handler(event) {
  if(event.httpMethod==='OPTIONS')return json(204,{});
  if(!['GET','POST'].includes(event.httpMethod))return json(405,{ok:false});
  try {
    const q=event.queryStringParameters||{};
    if(!/^[a-f0-9-]{36}$/i.test(q.uid||'')||typeof q.run_id!=='string'||q.run_id.length<8||q.run_id.length>160)throw Error('Invalid generation identifier.');
    if(event.httpMethod==='GET') {
      const user=await auth(event);
      if(user.id!==q.uid)return json(403,{ok:false,error:'Account mismatch.'});
    }
    let row=(await db(`user_generations?user_id=eq.${encodeURIComponent(q.uid)}&meta->>run_id=eq.${encodeURIComponent(q.run_id)}&select=id,user_id,result_url,meta`))?.[0];
    if(row?.meta?.source!=='reapi')return json(404,{ok:false,error:'Generation unavailable.'});
    if(event.httpMethod==='POST') {
      if(!tokenEqual(q.token,callbackToken(row.user_id,row.id)))return json(403,{ok:false});
      const id=client.taskId(JSON.parse(event.body||'{}'));
      if(!row.meta.task_id && id && !row.result_url && row.meta.status!=='failed') {
        const state=await client.state(id,row.meta.model);
        if(state.valid||state.done||state.failed)row=(await transition('attach',row.id,row.user_id,{task_id:id})).row;
      }
    }
    return json(200,await reconcile(row));
  } catch(e) {return json(e.status||502,{ok:false,status:'pending',error:e.message});}
}
module.exports={handler,reconcile,tokenEqual};
