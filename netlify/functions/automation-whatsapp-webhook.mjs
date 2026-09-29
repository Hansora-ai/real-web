import { first, serviceInsert, serviceUpdate } from '../../lib/automation/db.mjs';
import { extractWhatsAppMessages, extractWhatsAppStatuses, verifyWhatsAppSignature, whatsappConfig } from '../../lib/automation/whatsapp.mjs';

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
    for(const message of extractWhatsAppMessages(payload)){
      const externalEventId=`whatsapp:${message.externalEventId}`;
      const inserted=await serviceInsert('automation_webhook_events',{provider:'meta',external_event_id:externalEventId,event_type:'whatsapp_message',payload:message,status:'received'},{ignoreDuplicates:true});
      const row=inserted||await first(`/rest/v1/automation_webhook_events?provider=eq.meta&external_event_id=eq.${encodeURIComponent(externalEventId)}&select=id,status&limit=1`);
      if(row&&['received','failed'].includes(row.status))await dispatchBackground(event,row.id);
    }
    return text(200,'EVENT_RECEIVED');
  }catch(error){console.error('automation-whatsapp-webhook error',{message:error?.message,status:error?.status});return text(500,'webhook error');}
}

async function dispatchBackground(event,eventId){
  const secret=String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET||'');
  const requestOrigin=(()=>{try{return new URL(event.rawUrl||'').origin}catch(_){return''}})();
  const site=String(process.env.URL||process.env.DEPLOY_PRIME_URL||requestOrigin).replace(/\/$/,'');
  if(!secret||!site)throw new Error('automation_background_not_configured');
  const response=await fetch(`${site}/.netlify/functions/automation-whatsapp-process-background`,{method:'POST',headers:{'Content-Type':'application/json','x-hansora-internal-secret':secret},body:JSON.stringify({event_id:eventId})});
  if(!response.ok&&response.status!==202)throw new Error('automation_background_dispatch_failed');
}
