const crypto=require('node:crypto');
const {inspect}=require('../../lib/henshin/inspect.cjs');
const {BASE,KEY,json,auth,db,validate,promptFor}=require('../../lib/henshin/common.cjs');
const KIE_BASE=(process.env.KIE_BASE_URL||'https://api.kie.ai').replace(/\/$/,'');
const KIE_KEY=process.env.KIE_API_KEY||'';
async function changeBalance(uid, cost, refund=false) {
  for(let attempt=0;attempt<5;attempt++) {
    const rows=await db(`profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits`);
    if(!rows?.length) throw Error('Credit balance unavailable.');
    const current=Number(rows[0].credits);
    if(!refund&&current<cost) throw Object.assign(Error('Not enough credits.'),{status:402});
    const next=Number((current+(refund?cost:-cost)).toFixed(2));
    const updated=await db(`profiles?user_id=eq.${encodeURIComponent(uid)}&credits=eq.${current}`,{method:'PATCH',body:JSON.stringify({credits:next})});
    if(updated?.length) return next;
  }
  throw Error('Credit balance changed. Please try again.');
}
exports.handler=async event=>{
  if(event.httpMethod!=='POST') return json(405,{ok:false,error:'Use POST.'});
  let rowId,meta,charged=false,reserved=false,submissionStarted=false,providerRejected=false,user,cost;
  try {
    if(!BASE||!KEY||!KIE_KEY) throw Error('Henshin service is not configured.');
    user=await auth(event);
    const body=JSON.parse(event.body||'{}');
    validate(body);
    if(body.mode==='swap'&&!String(body.prompt||'').trim()) throw Error('Describe the element to swap.');
    const hash=crypto.createHash('sha256').update(`henshin:${user.id}:${body.run_id}`).digest('hex');
    rowId=`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
    const prior=await db(`user_generations?id=eq.${rowId}&user_id=eq.${user.id}&select=id,meta`);
    if(prior?.length) return json(prior[0].meta.task_id?200:409,{ok:!!prior[0].meta.task_id,already_submitted:true,taskId:prior[0].meta.task_id,run_id:body.run_id,error:'This run is already reserved. Check recent generations.'});
    const inspected=await inspect(body.video_url);
    body.source_video_duration=inspected.seconds;
    ({cost}=validate(body));
    const prompt=promptFor(body);
    meta={source:'kie',engine:'henshin',source_feature:'henshin',run_id:body.run_id,status:'pending',resolution:body.resolution,mode:body.mode,video_url:body.video_url,reference_image_urls:body.image_urls,source_audio_url:body.audio_url||null,source_video_duration:body.source_video_duration,refund_amount:cost,charged_duration:Math.ceil(body.source_video_duration)};
    // Deterministic primary key reserves a run once, including concurrent requests.
    await db('user_generations',{method:'POST',body:JSON.stringify({id:rowId,user_id:user.id,provider:'Hansora Henshin',kind:'video',prompt,result_url:null,meta})});
    reserved=true;
    const credits=await changeBalance(user.id,cost);
    charged=true;
    meta={...meta,charged:true,charged_cost:cost,debited:cost,charged_at:new Date().toISOString()};
    await db(`user_generations?id=eq.${rowId}`,{method:'PATCH',body:JSON.stringify({meta})});
    const callback=`${(process.env.SITE_BASE||'https://hansora.co').replace(/\/$/,'')}/.netlify/functions/kie-check?uid=${encodeURIComponent(user.id)}&run_id=${encodeURIComponent(body.run_id)}`;
    submissionStarted=true;
    const response=await fetch(`${KIE_BASE}/api/v1/jobs/createTask`,{method:'POST',signal:AbortSignal.timeout(25000),headers:{Authorization:`Bearer ${KIE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:'bytedance/seedance-2-5',callBackUrl:callback,input:{prompt,resolution:body.resolution,duration:-1,aspect_ratio:'adaptive',generate_audio:!body.audio_url,output_format:'mp4',reference_video_urls:[body.video_url],reference_image_urls:body.image_urls,...(body.audio_url?{reference_audio_urls:[body.audio_url]}:{})}})});
    const data=await response.json();
    const taskId=data?.data?.taskId;
    if(!response.ok||Number(data.code)!==200||!taskId) {
      providerRejected=Number(data.code)!==200&&Number(data.code)>0;
      throw Error(data.msg||'Generation could not be submitted.');
    }
    meta={...meta,status:'processing',task_id:taskId,model:'bytedance/seedance-2-5'};
    // Provider may already have called back; preserve completion/refund metadata.
    const latest=await db(`user_generations?id=eq.${rowId}&select=meta,result_url`);
    meta={...meta,...(latest?.[0]?.meta||{}),task_id:taskId};
    if(meta.status==='pending') meta.status='processing';
    await db(`user_generations?id=eq.${rowId}`,{method:'PATCH',body:JSON.stringify({meta})});
    return json(201,{ok:true,taskId,run_id:body.run_id,row_id:rowId,credits,debited:cost});
  } catch(error) {
    // Ambiguous network failures may have created a paid task. Let its callback
    // reconcile the reserved row instead of refunding an accepted generation.
    if(charged&&submissionStarted&&!providerRejected&&!meta?.task_id) {
      try {await db(`user_generations?id=eq.${rowId}`,{method:'PATCH',body:JSON.stringify({meta:{...meta,status:'pending',submission_uncertain:true,error:String(error.message)}})});} catch {}
      return json(202,{ok:true,submitted:true,submission_uncertain:true,run_id:meta.run_id,row_id:rowId,message:'Submission is being confirmed. Please wait for the callback; do not resubmit.'});
    }
    if(meta?.task_id) return json(202,{ok:true,submitted:true,taskId:meta.task_id,run_id:meta.run_id,row_id:rowId});
    // Explicit rejections return the reserved charge.
    if(reserved&&rowId&&meta&&!meta.task_id) {
      try {
        if(charged) {await changeBalance(user.id,cost,true);meta={...meta,refunded:true,refunded_at:new Date().toISOString()};}
        await db(`user_generations?id=eq.${rowId}`,{method:'PATCH',body:JSON.stringify({meta:{...meta,status:'failed',error:String(error.message)}})});
      } catch {}
    }
    return json(error.status||400,{ok:false,error:String(error.message)});
  }
};
