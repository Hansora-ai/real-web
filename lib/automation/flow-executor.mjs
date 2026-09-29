import { planFlowAdvance } from './comment-flow.mjs';
import { serviceInsert, serviceUpdate } from './db.mjs';
import { sendInstagramMessage } from './meta.mjs';
import { withTrackedLinks } from './flow-stats.mjs';

export async function executeFlowAdvance({ session, workflow, inboundText = '', inboundPayload = '', canUseInbound = true, account, accessToken, conversation, recipientId }) {
  const plan = planFlowAdvance({nodes:workflow.dm_steps,startIndex:session.current_node_index,inboundText,inboundPayload,canUseInbound});
  let aiAction = null;
  for (const action of plan.actions) {
    if (action.type === 'message') await sendFlowMessage({action,session,workflow,account,accessToken,conversation,recipientId});
    if (action.type === 'delay') await scheduleFlowDelay({action,session});
    if (action.type === 'handoff') await handoffFlow({action,session,conversation});
    if (action.type === 'ai') aiAction = action;
  }
  await serviceUpdate('automation_flow_sessions',`id=eq.${session.id}`,{
    conversation_id:conversation.id,current_node_index:plan.nextIndex,status:plan.status,
    updated_at:new Date().toISOString(),last_error:null
  });
  return {plan,aiAction,handled:!aiAction};
}

async function sendFlowMessage({action:planned,session,workflow,account,accessToken,conversation,recipientId}){
  const nodeId=(Array.isArray(workflow.dm_steps)?workflow.dm_steps:[])[planned.nodeIndex]?.id||null;
  const action=withTrackedLinks(planned,{businessId:session.business_id,workflowId:workflow.id,sessionId:session.id,nodeId:nodeId||''});
  const idempotencyKey=`flow:${session.id}:node:${action.nodeIndex}`;
  const reserved=await serviceInsert('automation_messages',{
    business_id:session.business_id,conversation_id:conversation.id,idempotency_key:idempotencyKey,
    direction:'outbound',sender_type:'system',content_type:(action.buttons?.length||action.quickReplies.length)?'interactive':'text',
    content:action.text,status:'queued',billable:false,provider:'meta',
    metadata:{workflow_id:workflow.id,flow_session_id:session.id,node_id:nodeId,node_index:action.nodeIndex,quick_replies:action.quickReplies,buttons:action.buttons||[]},
    occurred_at:new Date().toISOString()
  },{ignoreDuplicates:true});
  if(!reserved)return;
  try{
    const sent=await sendInstagramMessage({instagramUserId:account.provider_resource_id,recipientId,text:action.text,quickReplies:action.quickReplies,buttons:action.buttons||[],accessToken});
    await serviceUpdate('automation_messages',`id=eq.${reserved.id}`,{status:'sent',external_message_id:String(sent.message_id||'')||null,provider_message_id:String(sent.message_id||'')||null});
    await serviceUpdate('automation_conversations',`id=eq.${conversation.id}`,{last_message_preview:action.text.slice(0,1000),last_message_at:new Date().toISOString()});
    const handoffLabels=action.quickReplies.filter(reply=>reply.payload==='HANSORA_HANDOFF').map(reply=>reply.title);
    if(handoffLabels.length)await serviceUpdate('automation_flow_sessions',`id=eq.${session.id}`,{context:{...(session.context||{}),handoff_labels:[...new Set([...(session.context?.handoff_labels||[]),...handoffLabels])]}});
  }catch(error){
    await serviceUpdate('automation_messages',`id=eq.${reserved.id}`,{status:'failed',metadata:{...reserved.metadata,error:String(error?.message||'instagram_send_failed')}}).catch(()=>null);
    throw error;
  }
}

async function scheduleFlowDelay({action,session}){
  await serviceInsert('automation_flow_jobs',{
    business_id:session.business_id,session_id:session.id,node_index:action.nextIndex,
    run_at:new Date(Date.now()+action.delayMs).toISOString(),status:'pending',
    idempotency_key:`flow-delay:${session.id}:${action.nodeIndex}:${action.nextIndex}`
  },{ignoreDuplicates:true});
}

async function handoffFlow({action,session,conversation}){
  await serviceUpdate('automation_conversations',`id=eq.${conversation.id}`,{ai_enabled:false,status:'needs_attention',summary:action.note});
  await serviceInsert('automation_messages',{
    business_id:session.business_id,conversation_id:conversation.id,idempotency_key:`flow-handoff:${session.id}:${action.nodeIndex}`,
    direction:'internal',sender_type:'system',content_type:'text',content:action.note,status:'received',billable:false,
    provider:'hansora',metadata:{flow_session_id:session.id,node_index:action.nodeIndex},occurred_at:new Date().toISOString()
  },{ignoreDuplicates:true});
}
