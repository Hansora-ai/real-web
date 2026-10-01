import { first, serviceInsert, serviceUpdate, serviceUpsert } from '../../lib/automation/db.mjs';
import { extractWhatsAppEchoes, extractWhatsAppMessages, extractWhatsAppStatuses, verifyWhatsAppSignature, whatsappConfig } from '../../lib/automation/whatsapp.mjs';

const text=(statusCode,body)=>({statusCode,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'},body:String(body)});

export async function handler(event){
  if(event.httpMethod==='GET'){
    const q=event.queryStringParameters||{};let config;try{config=whatsappConfig();}catch(_){return text(503,'not configured');}
    return q['hub.mode']==='subscribe'&&q['hub.verify_token']===config.verifyToken&&q['hub.challenge']?text(200,q['hub.challenge']):text(403,'forbidden');
  }
  if(event.httpMethod!=='POST')return text(405,'method not allowed');
  try{
    if(!verifyWhatsAppSignature(event.body||'',event.headers?.['x-hub-signature-256']||event.headers?.['X-Hub-Signature-256']))return text(401,'invalid signature');
    let payload;try{payload=JSON.parse(event.body||'{}')}catch(_){return text(400,'invalid json')}
    for(const status of extractWhatsAppStatuses(payload)){
      if(!['sent','delivered','read','failed'].includes(status.status))continue;
      await serviceUpdate('automation_messages',`provider_message_id=eq.${encodeURIComponent(status.messageId)}&provider=eq.meta`,{status:status.status,metadata:{whatsapp_recipient_id:status.recipientId,whatsapp_status_errors:status.errors,status_updated_at:new Date(status.timestamp||Date.now()).toISOString()}}).catch(()=>null);
    }
    for(const echo of extractWhatsAppEchoes(payload))await saveOwnerPhoneMessage(echo).catch(error=>console.error('automation whatsapp echo failed',{message:error?.message}));
    for(const message of extractWhatsAppMessages(payload)){
      const externalEventId=`whatsapp:${message.externalEventId}`;
      const inserted=await serviceInsert('automation_webhook_events',{provider:'meta',external_event_id:externalEventId,event_type:'whatsapp_message',payload:message,status:'received'},{ignoreDuplicates:true});
      const row=inserted||await first(`/rest/v1/automation_webhook_events?provider=eq.meta&external_event_id=eq.${encodeURIComponent(externalEventId)}&select=id,status&limit=1`);
      if(row&&['received','failed'].includes(row.status))await dispatchBackground(event,row.id);
    }
    return text(200,'EVENT_RECEIVED');
  }catch(error){console.error('automation-whatsapp-webhook error',{message:error?.message,status:error?.status});return text(500,'webhook error');}
}

// The owner replied from the WhatsApp Business app on their phone (coexistence): show it in the inbox as the
// team's message and pause the AI in that chat so they don't both answer.
async function saveOwnerPhoneMessage(echo){
  const account=await first(`/rest/v1/automation_provider_resources?provider=eq.meta&resource_type=eq.whatsapp_account&provider_resource_id=eq.${encodeURIComponent(echo.phoneNumberId)}&status=eq.active&select=id,business_id&limit=1`);
  if(!account)return;
  const connection=await first(`/rest/v1/automation_channel_connections?business_id=eq.${account.business_id}&channel_type=eq.whatsapp&select=id&limit=1`);
  const sentAt=new Date(Number(echo.timestamp)||Date.now()).toISOString();
  const contactQuery=`/rest/v1/automation_contacts?business_id=eq.${account.business_id}&channel_type=eq.whatsapp&external_contact_id=eq.${encodeURIComponent(echo.customerId)}&select=id&limit=1`;
  const contact=await first(contactQuery)||await serviceInsert('automation_contacts',{business_id:account.business_id,channel_type:'whatsapp',external_contact_id:echo.customerId,primary_phone:echo.customerId,profile:{whatsapp_id:echo.customerId}},{ignoreDuplicates:true})||await first(contactQuery);
  if(!contact)return;
  const conversation=await serviceUpsert('automation_conversations','business_id,channel_type,external_thread_id',{business_id:account.business_id,contact_id:contact.id,channel_connection_id:connection?.id||null,channel_type:'whatsapp',external_thread_id:echo.customerId,last_message_preview:String(echo.text).slice(0,1000),last_message_at:sentAt});
  const saved=await serviceInsert('automation_messages',{business_id:account.business_id,conversation_id:conversation.id,external_message_id:echo.externalEventId,idempotency_key:`meta:whatsapp:echo:${echo.externalEventId}`,direction:'outbound',sender_type:'human',content_type:echo.contentType||'text',content:echo.text,status:'sent',billable:false,provider:'meta',provider_message_id:echo.externalEventId,metadata:{source:'whatsapp_business_app',sent_at:sentAt}},{ignoreDuplicates:true});
  if(saved)await serviceUpdate('automation_conversations',`id=eq.${conversation.id}`,{ai_enabled:false,status:'human_handling',updated_at:new Date().toISOString()});
}

async function dispatchBackground(event,eventId){
  const secret=String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET||'');
  const requestOrigin=(()=>{try{return new URL(event.rawUrl||'').origin}catch(_){return''}})();
  const site=String(process.env.URL||process.env.DEPLOY_PRIME_URL||requestOrigin).replace(/\/$/,'');
  if(!secret||!site)throw new Error('automation_background_not_configured');
  const response=await fetch(`${site}/.netlify/functions/automation-whatsapp-process-background`,{method:'POST',headers:{'Content-Type':'application/json','x-hansora-internal-secret':secret},body:JSON.stringify({event_id:eventId})});
  if(!response.ok&&response.status!==202)throw new Error('automation_background_dispatch_failed');
}
