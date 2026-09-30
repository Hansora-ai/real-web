import { decryptSecret } from '../../lib/automation/crypto.mjs';
import { executeFlowAdvance } from '../../lib/automation/flow-executor.mjs';
import { makeFlowStarter } from '../../lib/automation/dm-triggers.mjs';
import { followUpConfig, preparePrivateReply } from '../../lib/automation/comment-flow.mjs';
import { sendInstagramMessage } from '../../lib/automation/meta.mjs';
import { serviceInsert } from '../../lib/automation/db.mjs';
import { first, rows, serviceUpdate, supabaseRequest } from '../../lib/automation/db.mjs';

const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)});

export async function handler(event){
  if(event.httpMethod!=='POST'&&event.httpMethod!=='GET')return json(405,{error:'method_not_allowed'});
  const internal=String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET||'');
  const provided=String(event.headers?.['x-hansora-internal-secret']||event.headers?.['X-Hansora-Internal-Secret']||'');
  const scheduled=String(event.headers?.['x-nf-event']||event.headers?.['X-Nf-Event']||'')==='schedule';
  if(!scheduled&&!(internal.length>=32&&provided===internal))return json(401,{error:'unauthorized'});
  const jobs=rows(await supabaseRequest(`/rest/v1/automation_flow_jobs?status=eq.pending&run_at=lte.${encodeURIComponent(new Date().toISOString())}&select=*&order=run_at.asc&limit=25`));
  const results=[];
  for(const job of jobs){
    try{results.push({id:job.id,...await runJob(job)});}catch(error){
      await serviceUpdate('automation_flow_jobs',`id=eq.${job.id}`,{status:'failed',attempt_count:Number(job.attempt_count||0)+1,last_error:String(error?.message||'flow_job_failed').slice(0,2000),updated_at:new Date().toISOString()}).catch(()=>null);
      await serviceUpdate('automation_flow_sessions',`id=eq.${job.session_id}`,{status:'failed',last_error:String(error?.message||'flow_job_failed').slice(0,2000),updated_at:new Date().toISOString()}).catch(()=>null);
      results.push({id:job.id,ok:false});
    }
  }
  return json(200,{ok:true,processed:results.length,results});
}

async function runJob(job){
  const claimed=await serviceUpdate('automation_flow_jobs',`id=eq.${job.id}&status=eq.pending`,{status:'processing',attempt_count:Number(job.attempt_count||0)+1,updated_at:new Date().toISOString()});
  if(!claimed.length)return{ok:true,duplicate:true};
  if(String(job.idempotency_key||'').startsWith('flow-followup:'))return runFollowUp(job);
  const session=await first(`/rest/v1/automation_flow_sessions?id=eq.${job.session_id}&status=eq.waiting&select=*&limit=1`);
  if(!session){await serviceUpdate('automation_flow_jobs',`id=eq.${job.id}`,{status:'cancelled',updated_at:new Date().toISOString()});return{ok:true,cancelled:true};}
  const workflow=await first(`/rest/v1/automation_comment_workflows?id=eq.${session.workflow_id}&business_id=eq.${session.business_id}&select=*&limit=1`);
  const conversation=await first(`/rest/v1/automation_conversations?id=eq.${session.conversation_id}&business_id=eq.${session.business_id}&select=*&limit=1`);
  const account=await first(`/rest/v1/automation_provider_resources?business_id=eq.${session.business_id}&provider=eq.meta&resource_type=eq.instagram_account&status=eq.active&select=*&limit=1`);
  if(!workflow||!conversation||!account)throw new Error('flow_job_context_missing');
  const credential=await first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${account.id}&credential_type=eq.access_token&select=*&limit=1`);
  if(!credential)throw new Error('instagram_token_not_found');
  await serviceUpdate('automation_flow_sessions',`id=eq.${session.id}`,{status:'running',updated_at:new Date().toISOString()});
  const accessToken=decryptSecret(credential);const starter=makeFlowStarter({account,accessToken});
  await executeFlowAdvance({session:{...session,status:'running'},workflow,canUseInbound:false,account,accessToken,conversation,recipientId:session.external_contact_id,deps:{startFlow:args=>starter(args)}});
  await serviceUpdate('automation_flow_jobs',`id=eq.${job.id}`,{status:'completed',last_error:null,updated_at:new Date().toISOString()});
  return{ok:true};
}

// "If they don't tap": the reminder goes out only if the person is still at that same message (no tap, no reply
// since), and only once per sending of that message.
async function runFollowUp(job){
  const done=status=>serviceUpdate('automation_flow_jobs',`id=eq.${job.id}`,{status,updated_at:new Date().toISOString()});
  const session=await first(`/rest/v1/automation_flow_sessions?id=eq.${job.session_id}&select=*&limit=1`);
  const visit=Number(String(job.idempotency_key).split(':').pop())||1;
  if(!session||session.status!=='awaiting_reply'||Number(session.current_node_index)!==Number(job.node_index)||Number(session.context?.sends?.[job.node_index]||0)!==visit){await done('cancelled');return{ok:true,cancelled:true};}
  const workflow=await first(`/rest/v1/automation_comment_workflows?id=eq.${session.workflow_id}&business_id=eq.${session.business_id}&status=eq.active&select=*&limit=1`);
  const node=(Array.isArray(workflow?.dm_steps)?workflow.dm_steps:[])[job.node_index];
  const followUp=followUpConfig(node);
  const account=await first(`/rest/v1/automation_provider_resources?business_id=eq.${session.business_id}&provider=eq.meta&resource_type=eq.instagram_account&status=eq.active&select=*&limit=1`);
  if(!workflow||!followUp||!account){await done('cancelled');return{ok:true,cancelled:true};}
  const credential=await first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${account.id}&credential_type=eq.access_token&select=*&limit=1`);
  if(!credential)throw new Error('instagram_token_not_found');
  const prepared=preparePrivateReply({...node,text:followUp.text});
  const reserved=await serviceInsert('automation_messages',{business_id:session.business_id,conversation_id:session.conversation_id,idempotency_key:job.idempotency_key,direction:'outbound',sender_type:'system',content_type:'interactive',content:prepared.text,status:'queued',billable:false,provider:'meta',metadata:{workflow_id:workflow.id,flow_session_id:session.id,node_id:node?.id||null,follow_up:true},occurred_at:new Date().toISOString()},{ignoreDuplicates:true});
  if(reserved){const sent=await sendInstagramMessage({instagramUserId:account.provider_resource_id,recipientId:session.external_contact_id,text:prepared.text,quickReplies:prepared.quickReplies,buttons:prepared.buttons,accessToken:decryptSecret(credential)});await serviceUpdate('automation_messages',`id=eq.${reserved.id}`,{status:'sent',external_message_id:String(sent.message_id||'')||null});}
  await done('completed');return{ok:true,follow_up:true};
}
