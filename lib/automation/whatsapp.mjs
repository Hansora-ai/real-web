import crypto from 'node:crypto';
import { safeEqual } from './crypto.mjs';

function required(name, fallback = '') {
  const value = String(process.env[name] || fallback || '').trim();
  if (!value) { const error = new Error(`missing_${name.toLowerCase()}`); error.status = 503; throw error; }
  return value;
}

export function whatsappConfig() {
  return {
    appId:required('META_WHATSAPP_APP_ID',process.env.META_INSTAGRAM_APP_ID),
    appSecret:required('META_WHATSAPP_APP_SECRET',process.env.META_INSTAGRAM_APP_SECRET),
    // Only the Embedded Signup popup needs this; webhooks and token connections work without it.
    configurationId:String(process.env.META_WHATSAPP_CONFIGURATION_ID||'').trim(),
    verifyToken:required('META_WHATSAPP_WEBHOOK_VERIFY_TOKEN',process.env.META_WEBHOOK_VERIFY_TOKEN),
    graphVersion:String(process.env.META_WHATSAPP_GRAPH_VERSION||process.env.META_GRAPH_VERSION||'v23.0').replace(/^\/?/,'')
  };
}

async function jsonResponse(response, publicError) {
  const body=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(publicError);error.status=response.status>=500?502:400;error.providerStatus=response.status;error.providerError=body?.error;throw error;}
  return body;
}

export function verifyWhatsAppSignature(rawBody, signatureHeader) {
  const signature=String(signatureHeader||'');
  if(!signature.startsWith('sha256='))return false;
  const expected=`sha256=${crypto.createHmac('sha256',whatsappConfig().appSecret).update(String(rawBody||'')).digest('hex')}`;
  return safeEqual(signature,expected);
}

export async function exchangeWhatsAppCode(code, fetchImpl=fetch) {
  const config=whatsappConfig();
  const url=new URL(`https://graph.facebook.com/${config.graphVersion}/oauth/access_token`);
  url.search=new URLSearchParams({client_id:config.appId,client_secret:config.appSecret,code:String(code)}).toString();
  const data=await jsonResponse(await fetchImpl(url,{headers:{Accept:'application/json'}}),'whatsapp_code_exchange_failed');
  if(!data.access_token)throw Object.assign(new Error('whatsapp_token_missing'),{status:502});
  return{accessToken:String(data.access_token),expiresIn:Number(data.expires_in||0)};
}

export async function getWhatsAppPhone({phoneNumberId,accessToken,fetchImpl=fetch}) {
  const config=whatsappConfig();
  const url=new URL(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(phoneNumberId)}`);
  url.search=new URLSearchParams({fields:'id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,status'}).toString();
  const data=await jsonResponse(await fetchImpl(url,{headers:{Authorization:`Bearer ${accessToken}`,Accept:'application/json'}}),'whatsapp_phone_lookup_failed');
  return{id:String(data.id||phoneNumberId),displayPhoneNumber:String(data.display_phone_number||''),verifiedName:String(data.verified_name||''),qualityRating:String(data.quality_rating||''),verificationStatus:String(data.code_verification_status||''),platformType:String(data.platform_type||''),status:String(data.status||'')};
}

export async function subscribeWhatsAppApp({wabaId,accessToken,fetchImpl=fetch}) {
  const config=whatsappConfig();
  return jsonResponse(await fetchImpl(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(wabaId)}/subscribed_apps`,{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,Accept:'application/json'}}),'whatsapp_webhook_subscription_failed');
}

export async function registerWhatsAppPhone({phoneNumberId,pin,accessToken,fetchImpl=fetch}) {
  const config=whatsappConfig();
  if(!/^\d{6}$/.test(String(pin||'')))throw Object.assign(new Error('whatsapp_pin_invalid'),{status:400});
  return jsonResponse(await fetchImpl(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(phoneNumberId)}/register`,{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',pin:String(pin)})}),'whatsapp_registration_failed');
}

export function generateWhatsAppPin() {
  return String(crypto.randomInt(0,1000000)).padStart(6,'0');
}

export async function markWhatsAppRead({phoneNumberId,messageId,accessToken,fetchImpl=fetch}) {
  const config=whatsappConfig();
  return jsonResponse(await fetchImpl(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`,{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',status:'read',message_id:String(messageId)})}),'whatsapp_read_receipt_failed');
}

export async function listWhatsAppTemplates({wabaId,accessToken,fetchImpl=fetch}) {
  const config=whatsappConfig();
  const url=new URL(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(wabaId)}/message_templates`);
  url.search=new URLSearchParams({fields:'name,language,status,category,components',limit:'100'}).toString();
  const data=await jsonResponse(await fetchImpl(url,{headers:{Authorization:`Bearer ${accessToken}`,Accept:'application/json'}}),'whatsapp_templates_unavailable');
  return(Array.isArray(data.data)?data.data:[]).filter(template=>template.status==='APPROVED').map(template=>{
    const components=Array.isArray(template.components)?template.components:[];
    const body=String(components.find(component=>component.type==='BODY')?.text||'');
    const header=components.find(component=>component.type==='HEADER');
    return{name:String(template.name),language:String(template.language),category:String(template.category||''),body,headerText:header?.format==='TEXT'?String(header.text||''):'',hasMediaHeader:Boolean(header&&header.format!=='TEXT'),variableCount:templateVariableCount(body)};
  }).filter(template=>!template.hasMediaHeader&&!templateVariableCount(template.headerText));
}

export function templateVariableCount(text) {
  const numbers=[...String(text||'').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(match=>Number(match[1]));
  return numbers.length?Math.max(...numbers):0;
}

export function renderWhatsAppTemplate(text,params=[]) {
  return String(text||'').replace(/\{\{\s*(\d+)\s*\}\}/g,(match,index)=>String(params[Number(index)-1]??match));
}

export async function sendWhatsAppTemplate({phoneNumberId,to,name,language,params=[],accessToken,fetchImpl=fetch}) {
  const template={name:String(name),language:{code:String(language)}};
  if(params.length)template.components=[{type:'body',parameters:params.map(value=>({type:'text',text:String(value).slice(0,1024)}))}];
  return sendWhatsAppTemplateRaw({phoneNumberId,to,template,accessToken,fetchImpl});
}

export async function sendWhatsAppTemplateRaw({phoneNumberId,to,template,accessToken,fetchImpl=fetch}) {
  const config=whatsappGraphVersion();
  const response=await fetchImpl(`https://graph.facebook.com/${config}/${encodeURIComponent(phoneNumberId)}/messages`,{
    method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:String(to),type:'template',template})
  });
  const data=await jsonResponse(response,'whatsapp_template_send_failed');
  return{messageId:String(data.messages?.[0]?.id||''),raw:data};
}

// Hansora's own notification number does not need the Embedded Signup app configuration.
function whatsappGraphVersion(){return String(process.env.META_WHATSAPP_GRAPH_VERSION||process.env.META_GRAPH_VERSION||'v23.0').replace(/^\/?/,'');}

export const WHATSAPP_SERVICE_WINDOW_MS=24*60*60*1000;

export function extractWhatsAppMessages(payload) {
  if(!payload||payload.object!=='whatsapp_business_account'||!Array.isArray(payload.entry))return[];
  const output=[];
  for(const entry of payload.entry){for(const change of Array.isArray(entry.changes)?entry.changes:[]){
    if(change?.field!=='messages')continue;
    const value=change.value||{};const phoneNumberId=String(value.metadata?.phone_number_id||'');
    const contacts=new Map((Array.isArray(value.contacts)?value.contacts:[]).map(contact=>[String(contact.wa_id||''),String(contact.profile?.name||'')]));
    for(const message of Array.isArray(value.messages)?value.messages:[]){
      const from=String(message.from||'');const text=whatsAppMessageText(message);if(!message.id||!from||!phoneNumberId||!text)continue;
      output.push({externalEventId:String(message.id),phoneNumberId,wabaId:String(entry.id||''),senderId:from,displayName:contacts.get(from)||'',text:text.slice(0,24000),messageType:String(message.type||'text'),contentType:whatsAppContentType(message),interactiveId:String(message.interactive?.button_reply?.id||message.interactive?.list_reply?.id||message.button?.payload||''),timestamp:Number(message.timestamp||Math.floor(Date.now()/1000))*1000,raw:message});
    }
  }}
  return output;
}

export function extractWhatsAppStatuses(payload) {
  if(!payload||payload.object!=='whatsapp_business_account'||!Array.isArray(payload.entry))return[];
  const output=[];
  for(const entry of payload.entry){for(const change of Array.isArray(entry.changes)?entry.changes:[]){
    const value=change.value||{};
    for(const status of Array.isArray(value.statuses)?value.statuses:[])if(status.id)output.push({messageId:String(status.id),status:String(status.status||''),recipientId:String(status.recipient_id||''),timestamp:Number(status.timestamp||Math.floor(Date.now()/1000))*1000,errors:Array.isArray(status.errors)?status.errors:[]});
  }}
  return output;
}

export async function sendWhatsAppText({phoneNumberId,to,text,accessToken,fetchImpl=fetch}) {
  const config=whatsappConfig();
  const response=await fetchImpl(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`,{
    method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:String(to),type:'text',text:{preview_url:false,body:String(text).slice(0,4096)}})
  });
  const data=await jsonResponse(response,'whatsapp_send_failed');
  return{messageId:String(data.messages?.[0]?.id||''),raw:data};
}

function whatsAppMessageText(message){
  const caption=value=>String(value||'').trim();
  switch(message.type){
    case'text':return caption(message.text?.body);
    case'button':return caption(message.button?.text);
    case'interactive':return caption(message.interactive?.button_reply?.title||message.interactive?.list_reply?.title);
    case'image':return`[Customer sent a photo]${caption(message.image?.caption)?` ${caption(message.image.caption)}`:''}`;
    case'video':return`[Customer sent a video]${caption(message.video?.caption)?` ${caption(message.video.caption)}`:''}`;
    case'document':return`[Customer sent a file${message.document?.filename?`: ${caption(message.document.filename)}`:''}]${caption(message.document?.caption)?` ${caption(message.document.caption)}`:''}`;
    case'audio':return message.audio?.voice?'[Customer sent a voice message]':'[Customer sent an audio file]';
    case'sticker':return'[Customer sent a sticker]';
    case'location':{const place=[message.location?.name,message.location?.address].map(caption).filter(Boolean).join(', ');return`[Customer shared a location${place?`: ${place}`:''}]`;}
    case'contacts':return'[Customer shared a contact card]';
    default:return'';
  }
}

function whatsAppContentType(message){
  return({text:'text',button:'interactive',interactive:'interactive',image:'image',sticker:'image',video:'video',audio:'audio',document:'file',location:'location',contacts:'file'})[message.type]||'text';
}
