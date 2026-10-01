import { decryptSecret } from '../../lib/automation/crypto.mjs';
import { first, rows, serviceInsert, serviceUpdate, serviceUpsert, supabaseRequest } from '../../lib/automation/db.mjs';
import { generateAutomationReply } from '../../lib/automation/provider.mjs';
import { automationPrices, canAfford, chargeCredits, handleOutOfCredits } from '../../lib/automation/billing.mjs';
import { notifyOwner } from '../../lib/automation/notify.mjs';
import { prepareConversationActions } from '../../lib/automation/tools.mjs';
import { markWhatsAppRead, phonePauseExpired, sendWhatsAppText } from '../../lib/automation/whatsapp.mjs';
import { keepTyping } from '../../lib/automation/typing.mjs';
import { flagFailedReply } from '../../lib/automation/failure.mjs';
import { buildConversationContext, loadConversationMemory } from '../../lib/automation/history.mjs';
import { ensureAgentUpToDate } from '../../lib/automation/agent-sync.mjs';

const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)});

export async function handler(event){
  if(event.httpMethod!=='POST')return json(405,{error:'method_not_allowed'});if(!internalAuthorized(event))return json(401,{error:'unauthorized'});
  const startedAt=Date.now();
  let eventId='';let stopTyping=()=>{};let pendingReply=null;
  try{
    const body=JSON.parse(event.body||'{}');eventId=String(body.event_id||'');if(!/^[0-9a-f-]{36}$/i.test(eventId))return json(400,{error:'invalid_event_id'});
    const webhook=await first(`/rest/v1/automation_webhook_events?id=eq.${eventId}&event_type=eq.whatsapp_message&status=in.(received,failed)&select=*&limit=1`);if(!webhook)return json(200,{ok:true,replayed:true});
    const message=webhook.payload||{};
    // Independent database steps run together: every request to the database adds waiting time.
    const [,account]=await Promise.all([
      serviceUpdate('automation_webhook_events',`id=eq.${webhook.id}`,{status:'processing',attempt_count:Number(webhook.attempt_count||0)+1,last_error:null}),
      first(`/rest/v1/automation_provider_resources?provider=eq.meta&resource_type=eq.whatsapp_account&provider_resource_id=eq.${encodeURIComponent(message.phoneNumberId)}&status=eq.active&select=*&limit=1`)
    ]);if(!account)throw new Error('whatsapp_account_not_connected');
    const [connection,credential]=await Promise.all([
      first(`/rest/v1/automation_channel_connections?business_id=eq.${account.business_id}&channel_type=eq.whatsapp&status=eq.connected&select=*&limit=1`),
      first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${account.id}&credential_type=eq.access_token&select=*&limit=1`)
    ]);
    const loadedMs=Date.now()-startedAt;
    if(!connection)throw new Error('whatsapp_not_active');if(!credential)throw new Error('whatsapp_token_not_found');
    // Started now and awaited just before the AI: they only need the business, not the saved message.
    const settle=promise=>promise.then(value=>({value}),error=>({error}));const take=result=>{if(result.error)throw result.error;return result.value;};
    const price=automationPrices().aiReply;
    // The AI is brought up to date first if Hansora's rules or the owner's settings changed since its last update.
    const aiResourceP=settle(ensureAgentUpToDate({businessId:account.business_id}).catch(error=>console.error('automation agent auto-update failed',{message:error?.message})).then(()=>first(`/rest/v1/automation_provider_resources?business_id=eq.${account.business_id}&provider=eq.elevenlabs&resource_type=eq.agent&status=eq.active&select=*&limit=1`)));
    const affordableP=settle(canAfford(account.business_id,price));
    if(credential.expires_at&&Date.parse(credential.expires_at)<=Date.now())throw new Error('whatsapp_token_expired');
    const occurredAt=new Date(Number(message.timestamp)||Date.now()).toISOString();
    const contact=await serviceUpsert('automation_contacts','business_id,channel_type,external_contact_id',{business_id:account.business_id,display_name:message.displayName||'WhatsApp customer',primary_phone:message.senderId,channel_type:'whatsapp',external_contact_id:message.senderId,last_seen_at:occurredAt,profile:{whatsapp_id:message.senderId}});
    const conversation=await serviceUpsert('automation_conversations','business_id,channel_type,external_thread_id',{business_id:account.business_id,contact_id:contact.id,channel_connection_id:connection.id,channel_type:'whatsapp',external_thread_id:message.senderId,status:'open',last_message_preview:String(message.text).slice(0,1000),last_message_at:occurredAt});
    // Saving the message, loading the chat memory and preparing actions run together.
    const [inbound,memory,actions]=await Promise.all([
      serviceInsert('automation_messages',{business_id:account.business_id,conversation_id:conversation.id,external_message_id:message.externalEventId,idempotency_key:`meta:whatsapp:in:${message.externalEventId}`,direction:'inbound',sender_type:'customer',content_type:message.contentType||'text',content:message.text,status:'received',billable:false,provider:'meta',provider_message_id:message.externalEventId,metadata:{phone_number_id:message.phoneNumberId,waba_id:message.wabaId,message_type:message.messageType,interactive_id:message.interactiveId||null},occurred_at:occurredAt},{ignoreDuplicates:true}),
      loadConversationMemory({businessId:account.business_id,conversationId:conversation.id,contactId:contact.id,excludeExternalId:message.externalEventId}),
      prepareConversationActions({businessId:account.business_id,conversationId:conversation.id,contactId:contact.id,channel:'whatsapp',contact:{name:message.displayName||'',externalId:message.senderId,phone:message.senderId}})
    ]);
    if(!inbound){await markProcessed(webhook.id,account.business_id);return json(200,{ok:true,duplicate:true});}
    // Paused because the owner wrote from the WhatsApp Business app on their phone: the AI comes back once they
    // have been silent for a while (a pause made with "Take over" in the inbox stays until they give it back).
    if(!conversation.ai_enabled){
      const lastHuman=await first(`/rest/v1/automation_messages?conversation_id=eq.${conversation.id}&sender_type=eq.human&select=metadata,created_at&order=created_at.desc&limit=1`).catch(()=>null);
      if(phonePauseExpired(lastHuman)){await serviceUpdate('automation_conversations',`id=eq.${conversation.id}`,{ai_enabled:true,status:'open',updated_at:new Date().toISOString()});conversation.ai_enabled=true;conversation.status='open';}
    }
    const accessToken=decryptSecret(credential);
    // Blue ticks tell the customer the business has seen the message, whether AI or a person answers.
    // Sent in parallel with preparing the reply; awaited before the function ends.
    const settings=connection.settings||{};
    const aiWillReply=!(settings.automatic_replies===false||!conversation.ai_enabled||['human_handling','resolved','archived'].includes(conversation.status));
    // When the AI will answer, the blue ticks come with "typing…" until the reply arrives (kept on for long replies).
    const readTarget={phoneNumberId:account.provider_resource_id,messageId:message.externalEventId,accessToken};
    const readReceipt=markWhatsAppRead({...readTarget,typing:aiWillReply}).catch(()=>markWhatsAppRead(readTarget)).catch(error=>console.warn('whatsapp read receipt failed',{message:error?.message}));
    if(aiWillReply)stopTyping=keepTyping(()=>markWhatsAppRead({...readTarget,typing:true}),{everyMs:20000,immediate:false});
    if(!aiWillReply){await readReceipt;await markProcessed(webhook.id,account.business_id);return json(200,{ok:true,ai_skipped:true});}
    pendingReply={businessId:account.business_id,conversationId:conversation.id,customer:message.displayName||message.senderId,channel:'WhatsApp'};
    const aiResource=take(await aiResourceP);const affordable=take(await affordableP);
    if(!aiResource)throw new Error('ai_provider_agent_not_ready');
    // Pay as you go: no credits, no AI reply. The conversation goes to the owner instead.
    if(!affordable.ok){await handleOutOfCredits({businessId:account.business_id,conversationId:conversation.id,channel:'WhatsApp',customer:message.displayName||message.senderId,notifyOwner});await readReceipt;await markProcessed(webhook.id,account.business_id);return json(200,{ok:true,out_of_credits:true});}
    const mediaNote=message.contentType&&!['text','interactive'].includes(message.contentType)?'The latest customer message is a photo, video, voice note, file or location that you cannot open. Do not pretend to know its contents; use any caption, otherwise politely ask the customer to describe it in text, or offer a team member if it needs a human to review.':'';
    const context=buildConversationContext({intro:['Continue this WhatsApp conversation. Keep the reply concise.',actions.contextLine,mediaNote].filter(Boolean),memory,after:[actions.liveBrief]});
    const aiStartedAt=Date.now();const preparedMs=aiStartedAt-startedAt;
    const generated=await generateAutomationReply({providerResourceId:aiResource.provider_resource_id,text:message.text,context,channel:'whatsapp',onToolCall:actions.onToolCall,checkTimes:actions.checkTimes,knownTimes:actions.knownTimes});
    const aiMs=Date.now()-aiStartedAt;
    if(generated.toolCalls?.length)console.log('automation tool calls',{channel:'whatsapp',calls:generated.toolCalls});
    const handedOff=generated.toolCalls?.some(call=>call.name==='handoff_to_human'&&call.ok);
    // The chosen reply speed counts from when the message arrived, so the AI's own thinking time is included.
    const replyDelay=Math.min(30,Math.max(0,Number(settings.reply_delay)||0));const waitMs=replyDelay*1000-(Date.now()-startedAt);if(waitMs>0)await new Promise(resolve=>setTimeout(resolve,waitMs));
    const current=await first(`/rest/v1/automation_conversations?id=eq.${conversation.id}&select=ai_enabled,status&limit=1`);if(!handedOff&&(!current?.ai_enabled||['human_handling','resolved','archived'].includes(current.status))){await readReceipt;await markProcessed(webhook.id,account.business_id);return json(200,{ok:true,ai_skipped:true});}
    const sent=await sendWhatsAppText({phoneNumberId:account.provider_resource_id,to:message.senderId,text:generated.text,accessToken});
    pendingReply=null; // the customer has the answer: a later error (billing, logging) is not a missed reply
    console.log('automation reply timing',{channel:'whatsapp',loaded_ms:loadedMs,ready_for_ai_ms:preparedMs,ai_ms:aiMs,to_send_ms:Date.now()-startedAt,chosen_delay_s:replyDelay});
    const outbound=await serviceInsert('automation_messages',{business_id:account.business_id,conversation_id:conversation.id,external_message_id:sent.messageId||null,idempotency_key:`meta:whatsapp:out:${message.externalEventId}`,direction:'outbound',sender_type:'ai',content_type:'text',content:generated.text,status:'sent',billable:true,provider:'meta',model:'eleven-agents',provider_message_id:sent.messageId||null,metadata:{recipient_id:message.senderId,phone_number_id:account.provider_resource_id,elevenlabs_conversation_id:generated.conversationId||null},occurred_at:new Date().toISOString()},{ignoreDuplicates:true});
    // Charge only now that the reply was actually sent; the usage key doubles as the charge key.
    const charge=outbound?await chargeCredits({businessId:account.business_id,idempotencyKey:`usage:whatsapp:${message.externalEventId}`,kind:'ai_reply',credits:price,conversationId:conversation.id,reference:{channel:'whatsapp',message_id:outbound.id}}).catch(error=>{console.error('automation credit charge failed',{message:error?.message});return{ok:false,charged:0}}):null;
    if(outbound)await serviceInsert('automation_usage_events',{business_id:account.business_id,conversation_id:conversation.id,message_id:outbound.id,channel_type:'whatsapp',unit_type:'ai_message',quantity:1,billable_quantity:1,estimated_cost_minor:0,currency:'AMD',provider:'elevenlabs',provider_usage_id:generated.conversationId||null,idempotency_key:`usage:whatsapp:${message.externalEventId}`,credits:charge?.charged||0,metadata:{whatsapp_message_id:sent.messageId||null}},{ignoreDuplicates:true});
    await serviceUpdate('automation_conversations',`id=eq.${conversation.id}`,{last_message_preview:generated.text.slice(0,1000),last_message_at:new Date().toISOString()});
    await readReceipt;await markProcessed(webhook.id,account.business_id);return json(200,{ok:true});
  }catch(error){if(pendingReply&&eventId)await flagFailedReply({...pendingReply,eventId});console.error('automation-whatsapp-process error',{eventId,message:error?.message,status:error?.status,providerStatus:error?.providerStatus});if(eventId)await serviceUpdate('automation_webhook_events',`id=eq.${eventId}`,{status:'failed',last_error:String(error?.message||'processing_failed').slice(0,2000)}).catch(()=>null);return json(Number(error?.status)||500,{error:'whatsapp_message_processing_failed'});}finally{stopTyping();}
}

function internalAuthorized(event){const expected=String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET||'');const actual=String(event.headers?.['x-hansora-internal-secret']||event.headers?.['X-Hansora-Internal-Secret']||'');return expected.length>=32&&actual===expected;}
async function markProcessed(id,businessId){await serviceUpdate('automation_webhook_events',`id=eq.${id}`,{business_id:businessId,status:'processed',processed_at:new Date().toISOString(),last_error:null});}
