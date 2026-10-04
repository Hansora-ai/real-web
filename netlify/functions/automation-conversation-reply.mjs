import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { decryptSecret } from '../../lib/automation/crypto.mjs';
import { first, serviceInsert, serviceUpdate } from '../../lib/automation/db.mjs';
import { sendInstagramText } from '../../lib/automation/meta.mjs';
import { sendTelegramText } from '../../lib/automation/telegram.mjs';
import { sendMessengerText } from '../../lib/automation/messenger.mjs';
import { listWhatsAppTemplates, renderWhatsAppTemplate, sendWhatsAppTemplate, sendWhatsAppText, WHATSAPP_SERVICE_WINDOW_MS } from '../../lib/automation/whatsapp.mjs';

const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(statusCode,body)=>({statusCode,headers:HEADERS,body:JSON.stringify(body)});

export async function handler(event){
  if(event.httpMethod==='OPTIONS')return json(204,{});if(event.httpMethod!=='POST')return json(405,{error:'method_not_allowed'});
  try{
    const user=await authenticateRequest(event);if(!user)return json(401,{error:'authentication_required'});
    let body;try{body=JSON.parse(event.body||'{}')}catch(_){return json(400,{error:'invalid_json'})}
    let message=String(body.message||'').trim();
    const template=body.template&&typeof body.template==='object'?{name:String(body.template.name||'').trim(),language:String(body.template.language||'').trim(),params:Array.isArray(body.template.params)?body.template.params.map(value=>String(value??'').trim()):[]}:null;
    if(template&&(!/^[a-z0-9_]{1,512}$/.test(template.name)||!/^[A-Za-z_]{2,15}$/.test(template.language)||template.params.length>20||template.params.some(value=>!value||value.length>1024)))return json(400,{error:'invalid_template'});
    if(!isUuid(body.business_id)||!isUuid(body.conversation_id)||(!template&&(!message||message.length>1000)))return json(400,{error:'invalid_reply'});
    const business=await first(`/rest/v1/automation_businesses?id=eq.${body.business_id}&owner_user_id=eq.${user.id}&select=id&limit=1`);if(!business)return json(404,{error:'business_not_found'});
    const conversation=await first(`/rest/v1/automation_conversations?id=eq.${body.conversation_id}&business_id=eq.${business.id}&select=*&limit=1`);if(!conversation)return json(404,{error:'conversation_not_found'});
    if(conversation.ai_enabled||conversation.status!=='human_handling')return json(409,{error:'take_over_before_replying'});
    const contact=await first(`/rest/v1/automation_contacts?id=eq.${conversation.contact_id}&business_id=eq.${business.id}&select=*&limit=1`);if(!contact)return json(404,{error:'contact_not_found'});
    if(!['instagram_dm','whatsapp','telegram','messenger'].includes(conversation.channel_type))return json(409,{error:'channel_reply_not_supported'});
    let providerMessageId='',provider='meta';
    if(['telegram','messenger'].includes(conversation.channel_type)){
      if(template)return json(400,{error:'template_whatsapp_only'});
      if(conversation.channel_type==='telegram'){
        const account=await first(`/rest/v1/automation_provider_resources?business_id=eq.${business.id}&provider=eq.telegram&resource_type=eq.telegram_account&status=eq.active&select=*&limit=1`);if(!account)return json(409,{error:'telegram_not_connected'});
        const sent=await sendTelegramText({businessConnectionId:account.provider_resource_id,chatId:contact.external_contact_id,text:message});providerMessageId=sent.messageId;provider='telegram';
      }else{
        const account=await first(`/rest/v1/automation_provider_resources?business_id=eq.${business.id}&provider=eq.meta&resource_type=eq.facebook_page&status=eq.active&select=*&limit=1`);if(!account)return json(409,{error:'messenger_not_connected'});
        const credential=await first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${account.id}&credential_type=eq.access_token&select=*&limit=1`);if(!credential)return json(409,{error:'channel_token_not_found'});
        const sent=await sendMessengerText({pageId:account.provider_resource_id,pageToken:decryptSecret(credential),recipientId:contact.external_contact_id,text:message});providerMessageId=sent.messageId;
      }
      return await saveReply();
    }
    const resourceType=conversation.channel_type==='whatsapp'?'whatsapp_account':'instagram_account';
    const account=await first(`/rest/v1/automation_provider_resources?business_id=eq.${business.id}&provider=eq.meta&resource_type=eq.${resourceType}&status=eq.active&select=*&limit=1`);if(!account)return json(409,{error:conversation.channel_type==='whatsapp'?'whatsapp_not_connected':'instagram_not_connected'});
    const credential=await first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${account.id}&credential_type=eq.access_token&select=*&limit=1`);if(!credential)return json(409,{error:'channel_token_not_found'});
    if(conversation.channel_type==='whatsapp'){
      const lastInbound=await first(`/rest/v1/automation_messages?conversation_id=eq.${conversation.id}&direction=eq.inbound&select=occurred_at&order=occurred_at.desc&limit=1`);
      const windowOpen=Boolean(lastInbound)&&Date.now()-Date.parse(lastInbound.occurred_at)<=WHATSAPP_SERVICE_WINDOW_MS;
      const accessToken=decryptSecret(credential);
      if(template){
        // Only send templates Meta has approved for this account, and store the text the customer actually sees.
        const approved=(await listWhatsAppTemplates({wabaId:String(account.safe_config?.waba_id||''),accessToken})).find(item=>item.name===template.name&&item.language===template.language);
        if(!approved)return json(409,{error:'template_not_approved'});
        if(template.params.length!==approved.variableCount)return json(400,{error:'template_variables_missing'});
        const sent=await sendWhatsAppTemplate({phoneNumberId:account.provider_resource_id,to:contact.external_contact_id,name:approved.name,language:approved.language,params:template.params,accessToken});providerMessageId=sent.messageId;
        message=renderWhatsAppTemplate(approved.body,template.params);
      }else{
        if(!windowOpen)return json(409,{error:'whatsapp_template_required'});
        const sent=await sendWhatsAppText({phoneNumberId:account.provider_resource_id,to:contact.external_contact_id,text:message,accessToken});providerMessageId=sent.messageId;
      }
    }else if(template){return json(400,{error:'template_whatsapp_only'});
    }else{const sent=await sendInstagramText({instagramUserId:account.provider_resource_id,recipientId:contact.external_contact_id,text:message,accessToken:decryptSecret(credential)});providerMessageId=String(sent.message_id||'');}
    return await saveReply();
    async function saveReply(){
      const idempotency=`human:${user.id}:${body.conversation_id}:${providerMessageId||Date.now()}`;
      const saved=await serviceInsert('automation_messages',{business_id:business.id,conversation_id:conversation.id,external_message_id:providerMessageId||null,idempotency_key:idempotency,direction:'outbound',sender_type:'human',content_type:'text',content:message,status:'sent',billable:false,provider,provider_message_id:providerMessageId||null,metadata:{sent_by_user_id:user.id,...(template?{whatsapp_template:{name:template.name,language:template.language}}:{})},occurred_at:new Date().toISOString()});
      await serviceUpdate('automation_conversations',`id=eq.${conversation.id}`,{last_message_preview:message.slice(0,1000),last_message_at:new Date().toISOString(),human_owner_user_id:user.id});
      return json(200,{ok:true,message_id:saved?.id||null});
    }
  }catch(error){console.error('automation-conversation-reply error',{message:error?.message,status:error?.status,providerStatus:error?.providerStatus});return json(Number(error?.status)||500,{error:Number(error?.status)>=500?'manual_reply_unavailable':String(error?.message||'manual_reply_failed')});}
}
