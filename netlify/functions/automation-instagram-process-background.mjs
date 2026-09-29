import { decryptSecret } from '../../lib/automation/crypto.mjs';
import { first, rows, serviceInsert, serviceUpdate, serviceUpsert, supabaseRequest } from '../../lib/automation/db.mjs';
import { executeFlowAdvance } from '../../lib/automation/flow-executor.mjs';
import { getInstagramSenderProfile, sendInstagramText } from '../../lib/automation/meta.mjs';
import { generateAutomationReply } from '../../lib/automation/provider.mjs';
import { clickedActionId, nodeForAction, recordFlowEvent } from '../../lib/automation/flow-stats.mjs';
import { automationPrices, canAfford, chargeCredits, handleOutOfCredits } from '../../lib/automation/billing.mjs';
import { notifyOwner } from '../../lib/automation/notify.mjs';
import { prepareConversationActions } from '../../lib/automation/tools.mjs';
import { buildConversationContext, loadConversationMemory } from '../../lib/automation/history.mjs';

const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)});

export async function handler(event){
  if(event.httpMethod!=='POST')return json(405,{error:'method_not_allowed'});
  if(!internalAuthorized(event))return json(401,{error:'unauthorized'});
  const startedAt=Date.now();
  let eventId='';
  try{
    const body=JSON.parse(event.body||'{}');eventId=String(body.event_id||'');
    if(!/^[0-9a-f-]{36}$/i.test(eventId))return json(400,{error:'invalid_event_id'});
    const webhook=await first(`/rest/v1/automation_webhook_events?id=eq.${encodeURIComponent(eventId)}&status=in.(received,failed)&select=*&limit=1`);
    if(!webhook)return json(200,{ok:true,replayed:true});
    await serviceUpdate('automation_webhook_events',`id=eq.${webhook.id}`,{status:'processing',attempt_count:Number(webhook.attempt_count||0)+1,last_error:null});
    const message=webhook.payload||{};
    const account=await first(`/rest/v1/automation_provider_resources?provider=eq.meta&resource_type=eq.instagram_account&provider_resource_id=eq.${encodeURIComponent(message.recipientId)}&status=eq.active&select=*&limit=1`);
    if(!account){console.warn('automation-instagram message for an account not connected in Hansora',{recipientId:message.recipientId});throw new Error('instagram_account_not_connected');}
    const connection=await first(`/rest/v1/automation_channel_connections?business_id=eq.${account.business_id}&channel_type=eq.instagram_dm&status=eq.connected&select=*&limit=1`);
    if(!connection){console.warn('automation-instagram DMs are not active for this business (finish setup on the Instagram channel page)',{businessId:account.business_id});throw new Error('instagram_dm_not_active');}
    const settings=connection.settings||{};
    const credential=await first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${account.id}&credential_type=eq.access_token&select=*&limit=1`);
    if(!credential)throw new Error('instagram_token_not_found');
    if(credential.expires_at&&Date.parse(credential.expires_at)<=Date.now())throw new Error('instagram_token_expired');
    const occurredAt=new Date(Number(message.timestamp)||Date.now()).toISOString();
    // Show the customer's real name and @username: looked up once per customer, kept on later messages.
    const known=await first(`/rest/v1/automation_contacts?business_id=eq.${account.business_id}&channel_type=eq.instagram_dm&external_contact_id=eq.${encodeURIComponent(message.senderId)}&select=display_name,profile&limit=1`).catch(()=>null);
    const senderProfile=known?.profile?.username?null:await getInstagramSenderProfile({senderId:message.senderId,accessToken:decryptSecret(credential)});
    const profile={...(known?.profile||{}),instagram_scoped_id:message.senderId,...(senderProfile?{username:senderProfile.username,name:senderProfile.name,profile_pic:senderProfile.profilePic}:{})};
    const displayName=(senderProfile?(senderProfile.name||`@${senderProfile.username}`):known?.display_name)||'Instagram customer';
    const contact=await serviceUpsert('automation_contacts','business_id,channel_type,external_contact_id',{business_id:account.business_id,display_name:displayName,channel_type:'instagram_dm',external_contact_id:message.senderId,last_seen_at:occurredAt,profile});
    const conversation=await serviceUpsert('automation_conversations','business_id,channel_type,external_thread_id',{business_id:account.business_id,contact_id:contact.id,channel_connection_id:connection.id,channel_type:'instagram_dm',external_thread_id:message.senderId,status:'open',last_message_preview:String(message.text).slice(0,1000),last_message_at:occurredAt});
    const inbound=await serviceInsert('automation_messages',{business_id:account.business_id,conversation_id:conversation.id,external_message_id:message.externalEventId,idempotency_key:`meta:instagram:in:${message.externalEventId}`,direction:'inbound',sender_type:'customer',content_type:'text',content:message.text,status:'received',billable:false,provider:'meta',provider_message_id:message.externalEventId,metadata:{sender_id:message.senderId,recipient_id:message.recipientId},occurred_at:occurredAt},{ignoreDuplicates:true});
    if(settings.automatic_replies===false||!conversation.ai_enabled||['human_handling','resolved','archived'].includes(conversation.status)){await markProcessed(webhook.id,account.business_id);return json(200,{ok:true,ai_skipped:true});}

    const session=await first(`/rest/v1/automation_flow_sessions?business_id=eq.${account.business_id}&external_contact_id=eq.${encodeURIComponent(message.senderId)}&status=in.(awaiting_reply,running,waiting,ai_active)&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*&order=updated_at.desc&limit=1`);
    let flowInstruction='';
    if(session){
      // Count button taps for the automation's per-step results.
      const tappedAction=clickedActionId(message.quickReplyPayload);
      if(tappedAction){const flowForStats=await first(`/rest/v1/automation_comment_workflows?id=eq.${session.workflow_id}&select=dm_steps&limit=1`).catch(()=>null);await recordFlowEvent({businessId:account.business_id,workflowId:session.workflow_id,sessionId:session.id,nodeId:nodeForAction(flowForStats?.dm_steps,tappedAction)?.id||'',actionId:tappedAction,eventType:'click',idempotencyKey:`click:${message.externalEventId}`});}
      const labels=Array.isArray(session.context?.handoff_labels)?session.context.handoff_labels:[];
      const wantsHandoff=message.quickReplyPayload==='HANSORA_HANDOFF'||labels.some(label=>label.toLocaleLowerCase()===String(message.text||'').trim().toLocaleLowerCase());
      if(wantsHandoff){
        await serviceUpdate('automation_flow_sessions',`id=eq.${session.id}`,{conversation_id:conversation.id,status:'human_handling',updated_at:new Date().toISOString()});
        await serviceUpdate('automation_conversations',`id=eq.${conversation.id}`,{ai_enabled:false,status:'needs_attention',summary:'Customer requested a person from an Instagram comment flow.'});
        await serviceInsert('automation_messages',{business_id:account.business_id,conversation_id:conversation.id,idempotency_key:`flow-handoff-request:${message.externalEventId}`,direction:'internal',sender_type:'system',content_type:'text',content:'Customer requested a person.',status:'received',billable:false,provider:'hansora',metadata:{flow_session_id:session.id},occurred_at:new Date().toISOString()},{ignoreDuplicates:true});
        await markProcessed(webhook.id,account.business_id);return json(200,{ok:true,handoff:true});
      }
      if(session.status==='waiting'){await markProcessed(webhook.id,account.business_id);return json(200,{ok:true,flow_waiting:true});}
      const workflow=await first(`/rest/v1/automation_comment_workflows?id=eq.${session.workflow_id}&business_id=eq.${account.business_id}&select=*&limit=1`);
      if(workflow&&['awaiting_reply','running'].includes(session.status)){
        const advanced=await executeFlowAdvance({session,workflow,inboundText:message.text,inboundPayload:message.quickReplyPayload,canUseInbound:true,account,accessToken:decryptSecret(credential),conversation,recipientId:message.senderId});
        if(advanced.handled){await markProcessed(webhook.id,account.business_id);return json(200,{ok:true,flow_advanced:true,status:advanced.plan.status});}
        flowInstruction=advanced.aiAction?.instruction||'';
      }else if(workflow&&session.status==='ai_active'){
        const node=(Array.isArray(workflow.dm_steps)?workflow.dm_steps:[])[session.current_node_index];
        flowInstruction=node?.type==='ai'?String(node.instruction||''):'';
      }
    }

    // These lookups are independent reads, so they run together to answer faster.
    const price=automationPrices().aiReply;
    const [aiResource,affordable,actions,memory]=await Promise.all([
      first(`/rest/v1/automation_provider_resources?business_id=eq.${account.business_id}&provider=eq.elevenlabs&resource_type=eq.agent&status=eq.active&select=*&limit=1`),
      canAfford(account.business_id,price),
      prepareConversationActions({businessId:account.business_id,conversationId:conversation.id,contactId:contact.id,channel:'instagram_dm',contact:{name:contact.display_name==='Instagram customer'?'':contact.display_name,externalId:message.senderId}}),
      loadConversationMemory({businessId:account.business_id,conversationId:conversation.id,contactId:contact.id})
    ]);
    if(!aiResource)throw new Error('ai_provider_agent_not_ready');
    // Pay as you go: no credits, no AI reply. The conversation goes to the owner instead.
    if(!affordable.ok){await handleOutOfCredits({businessId:account.business_id,conversationId:conversation.id,channel:'Instagram DM',customer:contact.display_name,notifyOwner});await markProcessed(webhook.id,account.business_id);return json(200,{ok:true,out_of_credits:true});}

    const context=buildConversationContext({intro:['Continue this Instagram conversation. Do not greet again unless the customer greeted first.',actions.contextLine,flowInstruction?`Flow instruction: ${flowInstruction}`:''].filter(Boolean),memory});
    const aiStartedAt=Date.now();
    const generated=await generateAutomationReply({providerResourceId:aiResource.provider_resource_id,text:message.text,context,channel:'instagram_dm',onToolCall:actions.onToolCall});
    const aiMs=Date.now()-aiStartedAt;
    const handedOff=generated.toolCalls?.some(call=>call.name==='handoff_to_human'&&call.ok);
    // The chosen reply speed counts from when the message arrived, so the AI's own thinking time is included.
    const replyDelay=Math.min(30,Math.max(0,Number(settings.reply_delay)||0));
    const waitMs=replyDelay*1000-(Date.now()-startedAt);
    if(waitMs>0)await new Promise(resolve=>setTimeout(resolve,waitMs));
    const currentConversation=await first(`/rest/v1/automation_conversations?id=eq.${conversation.id}&select=ai_enabled,status&limit=1`);
    if(!handedOff&&(!currentConversation?.ai_enabled||['human_handling','resolved','archived'].includes(currentConversation.status))){await markProcessed(webhook.id,account.business_id);return json(200,{ok:true,ai_skipped:true});}
    const sent=await sendInstagramText({instagramUserId:account.provider_resource_id,recipientId:message.senderId,text:generated.text,accessToken:decryptSecret(credential)});
    console.log('automation reply timing',{channel:'instagram_dm',ai_ms:aiMs,to_send_ms:Date.now()-startedAt,chosen_delay_s:replyDelay});
    const outbound=await serviceInsert('automation_messages',{business_id:account.business_id,conversation_id:conversation.id,external_message_id:String(sent.message_id||''),idempotency_key:`meta:instagram:out:${message.externalEventId}`,direction:'outbound',sender_type:'ai',content_type:'text',content:generated.text,status:'sent',billable:true,provider:'meta',model:'eleven-agents',provider_message_id:String(sent.message_id||''),metadata:{recipient_id:message.senderId,elevenlabs_conversation_id:generated.conversationId||null},occurred_at:new Date().toISOString()},{ignoreDuplicates:true});
    // Charge only now that the reply was actually sent; the usage key doubles as the charge key.
    const charge=outbound?await chargeCredits({businessId:account.business_id,idempotencyKey:`usage:instagram:${message.externalEventId}`,kind:'ai_reply',credits:price,conversationId:conversation.id,reference:{channel:'instagram_dm',message_id:outbound.id}}).catch(error=>{console.error('automation credit charge failed',{message:error?.message});return{ok:false,charged:0}}):null;
    if(outbound)await serviceInsert('automation_usage_events',{business_id:account.business_id,conversation_id:conversation.id,message_id:outbound.id,channel_type:'instagram_dm',unit_type:'ai_message',quantity:1,billable_quantity:1,estimated_cost_minor:0,currency:'AMD',provider:'elevenlabs',provider_usage_id:generated.conversationId||null,idempotency_key:`usage:instagram:${message.externalEventId}`,credits:charge?.charged||0,metadata:{meta_message_id:sent.message_id||null}},{ignoreDuplicates:true});
    await serviceUpdate('automation_conversations',`id=eq.${conversation.id}`,{last_message_preview:generated.text.slice(0,1000),last_message_at:new Date().toISOString()});
    await markProcessed(webhook.id,account.business_id);
    return json(200,{ok:true});
  }catch(error){
    console.error('automation-instagram-process error',{eventId,message:error?.message,status:error?.status,providerStatus:error?.providerStatus});
    if(eventId)await serviceUpdate('automation_webhook_events',`id=eq.${encodeURIComponent(eventId)}`,{status:'failed',last_error:String(error?.message||'processing_failed').slice(0,2000)}).catch(()=>null);
    return json(Number(error?.status)||500,{error:'instagram_message_processing_failed'});
  }
}

function internalAuthorized(event){const expected=String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET||'');const actual=String(event.headers?.['x-hansora-internal-secret']||event.headers?.['X-Hansora-Internal-Secret']||'');return expected.length>=32&&actual===expected;}
async function markProcessed(id,businessId){await serviceUpdate('automation_webhook_events',`id=eq.${id}`,{business_id:businessId,status:'processed',processed_at:new Date().toISOString(),last_error:null});}
