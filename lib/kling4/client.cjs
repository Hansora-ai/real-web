'use strict';
const base=()=>String(process.env.KIE_BASE_URL||'https://api.kie.ai').replace(/\/+$/,'');
const headers=()=>({'Content-Type':'application/json',Authorization:`Bearer ${process.env.KIE_API_KEY||process.env.KIEAI_API_KEY||''}`});
const taskId=data=>{const id=data?.data?.taskId||data?.task_id||data?.taskId;return typeof id==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(id)?id:null;};
async function submit(payload){
 const response=await fetch(base()+'/api/v1/jobs/createTask',{method:'POST',headers:headers(),body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)}),data=await response.json().catch(()=>null),id=taskId(data);
 if(response.ok&&data?.code===200&&id)return {id};
 const error=Error(data?.msg||'Kling submission could not be confirmed.');
 error.rejected=[400,401,402,403,404,413,422,429,433,455,505].includes(response.ok?data?.code:response.status);
 error.status=error.rejected?422:502;throw error;
}
async function state(id,model){
 const response=await fetch(base()+'/api/v1/jobs/recordInfo?taskId='+encodeURIComponent(id),{headers:headers(),signal:AbortSignal.timeout(25000)});
 if(!response.ok)return {pending:true};
 const body=await response.json(),data=body?.data;
 if(body.code!==200||data?.taskId!==id||data?.model!==model)return {pending:true};
 if(data.state==='fail')return {failed:true,error:data.failMsg||'Generation failed.'};
 let result;try{result=typeof data.resultJson==='string'?JSON.parse(data.resultJson):data.resultJson;}catch{}
 const urls=Array.isArray(result?.resultUrls)?result.resultUrls.filter(url=>typeof url==='string'&&/^https:\/\//.test(url)):[];
 if(data.state==='success'&&urls.length)return {done:true,urls:urls.slice(0,1)};
 return {pending:true,valid:true};
}
module.exports={submit,state,taskId};
