import { decryptSecret } from '../../lib/automation/crypto.mjs';
import { first, rows, serviceInsert, serviceUpdate, serviceUpsert, supabaseRequest } from '../../lib/automation/db.mjs';
import { executeFlowAdvance } from '../../lib/automation/flow-executor.mjs';
import { getInstagramSenderProfile, sendInstagramAction, sendInstagramText } from '../../lib/automation/meta.mjs';
import { keepTyping } from '../../lib/automation/typing.mjs';
import { flagFailedReply } from '../../lib/automation/failure.mjs';
import { makeFlowStarter, maybeStartDmAutomation } from '../../lib/automation/dm-triggers.mjs';

// Messages without text still show something readable in the Inbox.
const KIND_LABELS={story_mention:'📣 Mentioned you in their story',share:'↪️ Shared a post or reel with you',media:'📷 Sent a photo or video',referral:'🔗 Opened your link',story_reply:'💬 Replied to your story'};
const shownText=message=>String(message.text||KIND_LABELS[message.kind]||'').slice(0,24000);
import { generateAutomationReply } from '../../lib/automation/provider.mjs';
import { clickedActionId, nodeForAction, recordFlowEvent } from '../../lib/automation/flow-stats.mjs';
import { automationPrices, canAfford, chargeCredits, handleOutOfCredits } from '../../lib/automation/billing.mjs';
import { notifyOwner } from '../../lib/automation/notify.mjs';
import { prepareConversationActions } from '../../lib/automation/tools.mjs';
import { buildConversationContext, loadConversationMemory } from '../../lib/automation/history.mjs';
import { ensureAgentUpToDate } from '../../lib/automation/agent-sync.mjs';
import { mediaMessage, understandMedia } from '../../lib/automation/media.mjs';
import { matchProductPhoto } from '../../lib/automation/product-match.mjs';
import { burstNote, hasNewerCustomerMessage, mediaContext, unansweredCustomerMessages, waitForPendingMedia } from '../../lib/automation/turns.mjs';

const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)});

export async function handler(event){
  if(event.httpMethod!=='POST')return json(405,{error:'method_not_allowed'});
  if(!internalAuthorized(event))return json(401,{error:'unauthorized'});
  const startedAt=Date.now();
  let eventId='';let stopTyping=()=>{};let pendingReply=null;
  try{
    const body=JSON.parse(event.body||'{}');eventId=String(body.event_id||'');
    if(!/^[0-9a-f-]{36}$/i.test(eventId))return json(400,{error:'invalid_event_id'});
    const webhook=await first(`/rest/v1/automation_webhook_events?id=eq.${encodeURIComponent(eventId)}&status=in.(received,failed)&select=*&limit=1`);
    if(!webhook)return json(200,{ok:true,replayed:true});
    const message=webhook.payload||{};
    // Independent database steps run together: every request to the database adds waiting time.
    const [,account]=await Promise.all([
      serviceUpdate('automation_webhook_events',`id=eq.${webhook.id}`,{status:'processing',attempt_count:Number(webhook.attempt_count||0)+1,last_error:null}),
      first(`/rest/v1/automation_provider_resources?provider=eq.meta&resource_type=eq.instagram_account&provider_resource_id=eq.${encodeURIComponent(message.recipientId)}&status=eq.active&select=*&limit=1`)
    ]);
    if(!account){console.warn('automation-instagram message for an account not connected in Hansora',{recipientId:message.recipientId});throw new Error('instagram_account_not_connected');}
    const [connection,credential,known]=await Promise.all([
      first(`/rest/v1/automation_channel_connections?business_id=eq.${account.business_id}&channel_type=eq.instagram_dm&status=eq.connected&select=*&limit=1`),
      first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${account.id}&credential_type=eq.access_token&select=*&limit=1`),
      first(`/rest/v1/automation_contacts?business_id=eq.${account.business_id}&channel_type=eq.instagram_dm&external_contact_id=eq.${encodeURIComponent(message.senderId)}&select=display_name,profile&limit=1`).catch(()=>null)
    ]);
    const loadedMs=Date.now()-startedAt;
    // Started now and awaited just before the AI: they only need the business, not the saved message.
    const settle=promise=>promise.then(value=>({value}),error=>({error}));const take=result=>{if(result.error)throw result.error;return result.value;};
    const price=automationPrices().aiReply;
    // The AI is brought up to date first if Hansora's rules or the owner's settings changed since its last update.
    const aiResourceP=settle(ensureAgentUpToDate({businessId:account.business_id}).catch(error=>console.error('automation agent auto-update failed',{message:error?.message})).then(()=>first(`/rest/v1/automation_provider_resources?business_id=eq.${account.business_id}&provider=eq.elevenlabs&resource_type=eq.agent&status=eq.active&select=*&limit=1`)));
    const affordableP=settle(canAfford(account.business_id,price));
    const sessionP=settle(first(`/rest/v1/automation_flow_sessions?business_id=eq.${account.business_id}&external_contact_id=eq.${encodeURIComponent(message.senderId)}&status=in.(awaiting_reply,running,waiting,ai_active)&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*&order=updated_at.desc&limit=1`));
    if(!connection){console.warn('automation-instagram DMs are not active for this business (finish setup on the Instagram channel page)',{businessId:account.business_id});throw new Error('instagram_dm_not_active');}
    const settings=connection.settings||{};
    if(!credential)throw new Error('instagram_token_not_found');
    if(credential.expires_at&&Date.parse(credential.expires_at)<=Date.now())throw new Error('instagram_token_expired');
    // "typing…" right away, before the preparation, when automatic replies are on. If the AI then does not answer
    // (team took over the chat), it is switched off again; a sent reply hides it by itself.
    let replySent=false,stopRefresh=()=>{};
    if(settings.automatic_replies!==false){
      const typingTarget={instagramUserId:account.provider_resource_id,recipientId:message.senderId,accessToken:decryptSecret(credential)};
      // Meta's answer to the first typing signal is logged, so a chat without the animation can be explained.
      let typingLogged=false;const typingStartedMs=Date.now()-startedAt;
      stopRefresh=keepTyping(()=>sendInstagramAction({...typingTarget,action:'typing_on'}).then(result=>{if(!typingLogged){typingLogged=true;console.log('instagram typing sent',{after_ms:typingStartedMs,result});}},error=>{if(!typingLogged){typingLogged=true;console.warn('instagram typing refused',{after_ms:typingStartedMs,message:error?.message,status:error?.status,providerStatus:error?.providerStatus,details:error?.details||error?.providerDetails||null});}throw error;}));
      stopTyping=()=>{stopRefresh();if(!replySent)sendInstagramAction({...typingTarget,action:'typing_off'}).catch(()=>null);};
    }
    const occurredAt=new Date(Number(message.timestamp)||Date.now()).toISOString();
    // Voice notes, photos, videos, shared posts/reels and stories become text: transcribed or described, shown in the
    // inbox and answered by the AI. Runs alongside the steps below; on any failure the old label is kept.
    const mediaType=String(message.attachmentTypes?.[0]||'');
    const mediaUrl=message.kind==='story_reply'?message.storyUrl:['media','share','story_mention'].includes(message.kind)?message.attachmentUrl:'';
    const hasMedia=Boolean(mediaUrl)&&mediaType!=='file';
    // Show the customer's real name and @username: looked up once per customer, kept on later messages.
    // Name and photo: looked up when the photo is missing (at most once a day per person), e.g. someone who first
    // commented (Instagram only shares the photo once they write to you or tap a button).
    const checkedRecently=Date.parse(known?.profile?.profile_checked_at||'')>Date.now()-86_400_000&&known?.profile?.username;
    const senderProfile=known?.profile?.profile_pic||checkedRecently?null:await getInstagramSenderProfile({senderId:message.senderId,accessToken:decryptSecret(credential)});
    const profile={...(known?.profile||{}),instagram_scoped_id:message.senderId,...(senderProfile?{username:senderProfile.username,name:senderProfile.name,profile_pic:senderProfile.profilePic,profile_checked_at:new Date().toISOString()}:{})};
    const displayName=(senderProfile?(senderProfile.name||`@${senderProfile.username}`):known?.display_name)||'Instagram customer';
    const contact=await serviceUpsert('automation_contacts','business_id,channel_type,external_contact_id',{business_id:account.business_id,display_name:displayName,channel_type:'instagram_dm',external_contact_id:message.senderId,last_seen_at:occurredAt,profile});
    const conversation=await serviceUpsert('automation_conversations','business_id,channel_type,external_thread_id',{business_id:account.business_id,contact_id:contact.id,channel_connection_id:connection.id,channel_type:'instagram_dm',external_thread_id:message.senderId,status:'open',last_message_preview:shownText(message).slice(0,1000),last_message_at:occurredAt});
    // Saving the message, loading the chat memory and preparing actions run together.
    const [inbound,memory,actions]=await Promise.all([
      serviceInsert('automation_messages',{business_id:account.business_id,conversation_id:conversation.id,external_message_id:message.externalEventId,idempotency_key:`meta:instagram:in:${message.externalEventId}`,direction:'inbound',sender_type:'customer',content_type:hasMedia?(mediaType==='audio'?'audio':mediaType==='video'?'video':'image'):'text',content:shownText(message),status:'received',billable:false,provider:'meta',provider_message_id:message.externalEventId,metadata:{sender_id:message.senderId,recipient_id:message.recipientId,...(hasMedia?{media_pending:true}:{})},occurred_at:occurredAt},{ignoreDuplicates:true}),
      loadConversationMemory({businessId:account.business_id,conversationId:conversation.id,contactId:contact.id,excludeExternalId:message.externalEventId}),
      prepareConversationActions({businessId:account.business_id,conversationId:conversation.id,contactId:contact.id,channel:'instagram_dm',contact:{name:contact.display_name==='Instagram customer'?'':contact.display_name,externalId:message.senderId}})
    ]);
    // The message is saved first (so a question sent right after it waits for it); then the photo / voice note is
    // understood with the business and the latest messages as context, and the saved message is updated.
    let media=null,understood=null;
    if(hasMedia&&inbound){
      const context=await mediaContext({businessId:account.business_id,history:memory.history}).catch(()=>'');
      media=await understandMedia({url:mediaUrl,kind:['audio','video','image'].includes(mediaType)?mediaType:'',caption:message.text,context,store:{businessId:account.business_id,channel:'instagram_dm',conversationId:conversation.id,key:message.externalEventId},afterVisual:file=>matchProductPhoto({businessId:account.business_id,...file,caption:message.text})});
      understood=media?mediaMessage({source:message.kind==='media'?media.kind:message.kind,media,caption:message.text}):null;
      await serviceUpdate('automation_messages',`id=eq.${inbound.id}`,{content:understood?.content||shownText(message),metadata:{sender_id:message.senderId,recipient_id:message.recipientId,media_pending:false,...(media?.mediaPath?{media_path:media.mediaPath,media_mime:media.mimeType}:{})}}).catch(error=>console.warn('media message update failed',{message:error?.message}));
      if(understood)await serviceUpdate('automation_conversations',`id=eq.${conversation.id}`,{last_message_preview:understood.content.slice(0,1000)}).catch(()=>null);
      // A voice note counts as what the customer typed (for automations and the AI).
      if(understood&&media.kind==='audio')message.text=understood.aiText;
    }
    // DM automations (keyword, story reply or mention, shared post, ig.me link, conversation starter, default reply)
    // start here, before the AI; they run even when AI replies are off, but not while your team handles the chat.
    const accessTokenPlain=decryptSecret(credential);
    const flowStarter=makeFlowStarter({account,accessToken:accessTokenPlain});
    if(!['human_handling','resolved','archived'].includes(conversation.status)){
      const activeSession=take(await sessionP);
      const started=await maybeStartDmAutomation({account,accessToken:accessTokenPlain,conversation,message,hasActiveSession:Boolean(activeSession)}).catch(error=>{console.error('automation DM trigger failed',{message:error?.message});return null;});
      if(started?.handled){await markProcessed(webhook.id,account.business_id);return json(200,{ok:true,automation_started:started.workflowId||true});}
    }
    // A story mention, shared post, photo or link opening without text gets no AI reply unless an automation handled it.
    // A photo, video or shared post the AI could understand is answered too; a story mention is not.
    const aiText=String(message.text||'').trim()||(message.kind!=='story_mention'?understood?.aiText||'':'');
    if(!aiText){await markProcessed(webhook.id,account.business_id);return json(200,{ok:true,no_text:true});}
    if(settings.automatic_replies===false||!conversation.ai_enabled||['human_handling','resolved','archived'].includes(conversation.status)){await markProcessed(webhook.id,account.business_id);return json(200,{ok:true,ai_skipped:true});}

    pendingReply={businessId:account.business_id,conversationId:conversation.id,customer:contact.display_name,channel:'Instagram DM'};
    const session=take(await sessionP);
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
      // During a Smart delay the automation is paused, not the conversation: the AI answers what they wrote, and
      // the automation continues by itself when the wait is over.
      const workflow=await first(`/rest/v1/automation_comment_workflows?id=eq.${session.workflow_id}&business_id=eq.${account.business_id}&select=*&limit=1`);
      if(workflow&&['awaiting_reply','running'].includes(session.status)){
        const advanced=await executeFlowAdvance({session,workflow,inboundText:message.text,inboundPayload:message.quickReplyPayload,canUseInbound:true,account,accessToken:accessTokenPlain,conversation,recipientId:message.senderId,deps:{startFlow:args=>flowStarter(args)}});
        if(advanced.handled){await markProcessed(webhook.id,account.business_id);return json(200,{ok:true,flow_advanced:true,status:advanced.plan.status});}
        flowInstruction=advanced.aiAction?.instruction||'';
      }else if(workflow&&session.status==='ai_active'){
        const node=(Array.isArray(workflow.dm_steps)?workflow.dm_steps:[])[session.current_node_index];
        flowInstruction=node?.type==='ai'?String(node.instruction||''):'';
      }
    }

    // One answer per turn: a newer message from the customer answers for both; an earlier photo still being read is
    // waited for, so this answer knows about it.
    const turn={conversationId:conversation.id,occurredAt:inbound?.occurred_at||occurredAt,createdAt:inbound?.created_at,messageId:inbound?.id};
    if(await hasNewerCustomerMessage(turn)){pendingReply=null;await markProcessed(webhook.id,account.business_id);return json(200,{ok:true,answered_by_newer_message:true});}
    const liveMemory=await waitForPendingMedia(turn)?await loadConversationMemory({businessId:account.business_id,conversationId:conversation.id,contactId:contact.id,excludeExternalId:message.externalEventId}):memory;
    const pendingQuestions=burstNote(await unansweredCustomerMessages(turn));
    if(pendingQuestions)console.log('automation turn with several messages',{conversation:conversation.id});

    const aiResource=take(await aiResourceP);const affordable=take(await affordableP);
    if(!aiResource)throw new Error('ai_provider_agent_not_ready');
    // Pay as you go: no credits, no AI reply. The conversation goes to the owner instead.
    if(!affordable.ok){await handleOutOfCredits({businessId:account.business_id,conversationId:conversation.id,channel:'Instagram DM',customer:contact.display_name,notifyOwner});await markProcessed(webhook.id,account.business_id);return json(200,{ok:true,out_of_credits:true});}

    const context=buildConversationContext({intro:['Continue this Instagram conversation.',actions.contextLine,understood?.note||'',flowInstruction?`Flow instruction: ${flowInstruction}`:''].filter(Boolean),memory:liveMemory,after:[actions.liveBrief,pendingQuestions]});
    const aiStartedAt=Date.now();const preparedMs=aiStartedAt-startedAt;
    const generated=await generateAutomationReply({providerResourceId:aiResource.provider_resource_id,text:aiText,context,channel:'instagram_dm',onToolCall:actions.onToolCall,checkTimes:actions.checkTimes,knownTimes:actions.knownTimes});
    const aiMs=Date.now()-aiStartedAt;
    if(generated.toolCalls?.length)console.log('automation tool calls',{channel:'instagram_dm',calls:generated.toolCalls});
    const handedOff=generated.toolCalls?.some(call=>call.name==='handoff_to_human'&&call.ok);
    // The chosen reply speed counts from when the message arrived, so the AI's own thinking time is included.
    const replyDelay=Math.min(30,Math.max(0,Number(settings.reply_delay)||0));
    const waitMs=replyDelay*1000-(Date.now()-startedAt);
    if(waitMs>0)await new Promise(resolve=>setTimeout(resolve,waitMs));
    const currentConversation=await first(`/rest/v1/automation_conversations?id=eq.${conversation.id}&select=ai_enabled,status&limit=1`);
    if(!handedOff&&(!currentConversation?.ai_enabled||['human_handling','resolved','archived'].includes(currentConversation.status))){await markProcessed(webhook.id,account.business_id);return json(200,{ok:true,ai_skipped:true});}
    if(await hasNewerCustomerMessage(turn)){pendingReply=null;await markProcessed(webhook.id,account.business_id);return json(200,{ok:true,answered_by_newer_message:true});}
    stopRefresh();replySent=true;
    const sent=await sendInstagramText({instagramUserId:account.provider_resource_id,recipientId:message.senderId,text:generated.text,accessToken:decryptSecret(credential)});
    pendingReply=null; // the customer has the answer: a later error (billing, logging) is not a missed reply
    console.log('automation reply timing',{channel:'instagram_dm',loaded_ms:loadedMs,ready_for_ai_ms:preparedMs,ai_ms:aiMs,to_send_ms:Date.now()-startedAt,chosen_delay_s:replyDelay});
    const outbound=await serviceInsert('automation_messages',{business_id:account.business_id,conversation_id:conversation.id,external_message_id:String(sent.message_id||''),idempotency_key:`meta:instagram:out:${message.externalEventId}`,direction:'outbound',sender_type:'ai',content_type:'text',content:generated.text,status:'sent',billable:true,provider:'meta',model:'eleven-agents',provider_message_id:String(sent.message_id||''),metadata:{recipient_id:message.senderId,elevenlabs_conversation_id:generated.conversationId||null},occurred_at:new Date().toISOString()},{ignoreDuplicates:true});
    // Charge only now that the reply was actually sent; the usage key doubles as the charge key.
    const charge=outbound?await chargeCredits({businessId:account.business_id,idempotencyKey:`usage:instagram:${message.externalEventId}`,kind:'ai_reply',credits:price,conversationId:conversation.id,reference:{channel:'instagram_dm',message_id:outbound.id}}).catch(error=>{console.error('automation credit charge failed',{message:error?.message});return{ok:false,charged:0}}):null;
    if(outbound)await serviceInsert('automation_usage_events',{business_id:account.business_id,conversation_id:conversation.id,message_id:outbound.id,channel_type:'instagram_dm',unit_type:'ai_message',quantity:1,billable_quantity:1,estimated_cost_minor:0,currency:'AMD',provider:'elevenlabs',provider_usage_id:generated.conversationId||null,idempotency_key:`usage:instagram:${message.externalEventId}`,credits:charge?.charged||0,metadata:{meta_message_id:sent.message_id||null}},{ignoreDuplicates:true});
    await serviceUpdate('automation_conversations',`id=eq.${conversation.id}`,{last_message_preview:generated.text.slice(0,1000),last_message_at:new Date().toISOString()});
    await markProcessed(webhook.id,account.business_id);
    return json(200,{ok:true});
  }catch(error){
    if(pendingReply&&eventId)await flagFailedReply({...pendingReply,eventId});
    console.error('automation-instagram-process error',{eventId,message:error?.message,status:error?.status,providerStatus:error?.providerStatus});
    if(eventId)await serviceUpdate('automation_webhook_events',`id=eq.${encodeURIComponent(eventId)}`,{status:'failed',last_error:String(error?.message||'processing_failed').slice(0,2000)}).catch(()=>null);
    return json(Number(error?.status)||500,{error:'instagram_message_processing_failed'});
  }finally{stopTyping();}
}

function internalAuthorized(event){const expected=String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET||'');const actual=String(event.headers?.['x-hansora-internal-secret']||event.headers?.['X-Hansora-Internal-Secret']||'');return expected.length>=32&&actual===expected;}
async function markProcessed(id,businessId){await serviceUpdate('automation_webhook_events',`id=eq.${id}`,{business_id:businessId,status:'processed',processed_at:new Date().toISOString(),last_error:null});}
