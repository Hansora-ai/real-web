import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { extractWhatsAppMessages, extractWhatsAppStatuses, generateWhatsAppPin, listWhatsAppTemplates, markWhatsAppRead, registerWhatsAppPhone, renderWhatsAppTemplate, sendWhatsAppTemplate, sendWhatsAppText, templateVariableCount, verifyWhatsAppSignature } from '../../lib/automation/whatsapp.mjs';

process.env.META_WHATSAPP_APP_ID='wa-app';
process.env.META_WHATSAPP_APP_SECRET='wa-secret';
process.env.META_WHATSAPP_CONFIGURATION_ID='wa-config';
process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN='wa-verify';

test('WhatsApp webhook extracts text, interactive replies and statuses',()=>{
  const payload={object:'whatsapp_business_account',entry:[{id:'waba-1',changes:[{field:'messages',value:{metadata:{phone_number_id:'phone-1'},contacts:[{wa_id:'37499111222',profile:{name:'Ani'}}],messages:[{id:'wamid.1',from:'37499111222',timestamp:'1700000000',type:'text',text:{body:'Hello'}},{id:'wamid.2',from:'37499111222',timestamp:'1700000001',type:'interactive',interactive:{button_reply:{id:'prices',title:'Prices'}}}],statuses:[{id:'wamid.out',status:'delivered',recipient_id:'37499111222',timestamp:'1700000002'}]}}]}]};
  assert.deepEqual(extractWhatsAppMessages(payload).map(item=>({id:item.externalEventId,text:item.text,interactive:item.interactiveId,name:item.displayName})),[{id:'wamid.1',text:'Hello',interactive:'',name:'Ani'},{id:'wamid.2',text:'Prices',interactive:'prices',name:'Ani'}]);
  assert.deepEqual(extractWhatsAppStatuses(payload).map(item=>({id:item.messageId,status:item.status})),[{id:'wamid.out',status:'delivered'}]);
});

test('WhatsApp signature and text sending follow Cloud API payloads',async()=>{
  const raw='{"object":"whatsapp_business_account"}';
  const signature=`sha256=${crypto.createHmac('sha256','wa-secret').update(raw).digest('hex')}`;
  assert.equal(verifyWhatsAppSignature(raw,signature),true);
  let request;
  const result=await sendWhatsAppText({phoneNumberId:'phone-1',to:'37499111222',text:'Welcome',accessToken:'token',fetchImpl:async(url,options)=>{request={url,options};return{ok:true,status:200,json:async()=>({messages:[{id:'wamid.sent'}]})}}});
  assert.match(String(request.url),/graph\.facebook\.com\/v23\.0\/phone-1\/messages/);
  assert.deepEqual(JSON.parse(request.options.body),{messaging_product:'whatsapp',recipient_type:'individual',to:'37499111222',type:'text',text:{preview_url:false,body:'Welcome'}});
  assert.equal(result.messageId,'wamid.sent');
});

const okFetch=(capture,body={success:true})=>async(url,options={})=>{capture.push({url:String(url),options});return{ok:true,status:200,json:async()=>body}};

test('WhatsApp media messages become readable placeholders with content types',()=>{
  const payload={object:'whatsapp_business_account',entry:[{id:'waba-1',changes:[{field:'messages',value:{metadata:{phone_number_id:'phone-1'},messages:[
    {id:'m1',from:'374',type:'image',image:{id:'img',caption:'Is this in stock?'}},
    {id:'m2',from:'374',type:'audio',audio:{id:'a',voice:true}},
    {id:'m3',from:'374',type:'location',location:{latitude:40.18,longitude:44.51,name:'Arabkir'}},
    {id:'m4',from:'374',type:'reaction',reaction:{emoji:'👍'}}
  ]}}]}]};
  assert.deepEqual(extractWhatsAppMessages(payload).map(item=>[item.contentType,item.text]),[
    ['image','[Customer sent a photo] Is this in stock?'],
    ['audio','[Customer sent a voice message]'],
    ['location','[Customer shared a location: Arabkir]']
  ]);
});

test('WhatsApp registration uses a 6-digit PIN and read receipts reference the message',async()=>{
  assert.match(generateWhatsAppPin(),/^\d{6}$/);
  const calls=[];
  await registerWhatsAppPhone({phoneNumberId:'phone-1',pin:'012345',accessToken:'t',fetchImpl:okFetch(calls)});
  await markWhatsAppRead({phoneNumberId:'phone-1',messageId:'wamid.1',accessToken:'t',fetchImpl:okFetch(calls)});
  assert.match(calls[0].url,/\/phone-1\/register$/);
  assert.deepEqual(JSON.parse(calls[0].options.body),{messaging_product:'whatsapp',pin:'012345'});
  assert.deepEqual(JSON.parse(calls[1].options.body),{messaging_product:'whatsapp',status:'read',message_id:'wamid.1'});
  await assert.rejects(registerWhatsAppPhone({phoneNumberId:'phone-1',pin:'12',accessToken:'t',fetchImpl:okFetch([])}),/whatsapp_pin_invalid/);
});

test('WhatsApp templates list only approved text templates and send body variables',async()=>{
  const calls=[];
  const templates=await listWhatsAppTemplates({wabaId:'waba-1',accessToken:'t',fetchImpl:okFetch(calls,{data:[
    {name:'order_update',language:'hy',status:'APPROVED',category:'UTILITY',components:[{type:'BODY',text:'Hello {{1}}, your order {{2}} is ready.'}]},
    {name:'pending_one',language:'en',status:'PENDING',category:'UTILITY',components:[{type:'BODY',text:'Hi'}]},
    {name:'promo_image',language:'en',status:'APPROVED',category:'MARKETING',components:[{type:'HEADER',format:'IMAGE'},{type:'BODY',text:'Sale'}]}
  ]})});
  assert.match(calls[0].url,/\/waba-1\/message_templates\?/);
  assert.deepEqual(templates.map(item=>[item.name,item.variableCount]),[['order_update',2]]);
  assert.equal(templateVariableCount('{{1}} and {{ 3 }}'),3);
  assert.equal(renderWhatsAppTemplate(templates[0].body,['Ani','#42']),'Hello Ani, your order #42 is ready.');
  const sendCalls=[];
  const sent=await sendWhatsAppTemplate({phoneNumberId:'phone-1',to:'374',name:'order_update',language:'hy',params:['Ani','#42'],accessToken:'t',fetchImpl:okFetch(sendCalls,{messages:[{id:'wamid.t'}]})});
  assert.deepEqual(JSON.parse(sendCalls[0].options.body),{messaging_product:'whatsapp',recipient_type:'individual',to:'374',type:'template',template:{name:'order_update',language:{code:'hy'},components:[{type:'body',parameters:[{type:'text',text:'Ani'},{type:'text',text:'#42'}]}]}});
  assert.equal(sent.messageId,'wamid.t');
});
