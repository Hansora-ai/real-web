import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { decryptSecret, encryptSecret } from '../../lib/automation/crypto.mjs';
import { buildInstagramAuthorizationUrl, createOAuthState, extractInstagramComments, extractInstagramMessages, INSTAGRAM_SCOPES, listInstagramMedia, replyToInstagramComment, sendInstagramPrivateReply, verifyMetaSignature, verifyOAuthState } from '../../lib/automation/meta.mjs';
import { askElevenLabsText } from '../../lib/automation/providers/elevenlabs.mjs';

const env = {
  META_INSTAGRAM_APP_ID:'123456', META_INSTAGRAM_APP_SECRET:'meta-secret',
  META_INSTAGRAM_REDIRECT_URI:'https://example.com/.netlify/functions/automation-meta-callback',
  META_WEBHOOK_VERIFY_TOKEN:'verify-token', HANSORA_AUTOMATION_OAUTH_SECRET:'oauth-secret-with-enough-entropy',
  HANSORA_AUTOMATION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'), ELEVENLABS_API_KEY:'eleven-test-key'
};
for(const [key,value] of Object.entries(env))process.env[key]=value;

test('Instagram OAuth state is signed, expires and uses current business scopes',()=>{
  const now=1_800_000_000_000;
  const state=createOAuthState({business_id:'11111111-1111-4111-8111-111111111111',user_id:'22222222-2222-4222-8222-222222222222'},now);
  const payload=verifyOAuthState(state,now+1000);
  assert.equal(payload.business_id,'11111111-1111-4111-8111-111111111111');
  assert.throws(()=>verifyOAuthState(`${state}x`,now+1000),/invalid_oauth_state/);
  assert.throws(()=>verifyOAuthState(state,now+11*60*1000),/expired_oauth_state/);
  const url=new URL(buildInstagramAuthorizationUrl(state));
  assert.equal(url.hostname,'www.instagram.com');
  assert.deepEqual(url.searchParams.get('scope').split(','),INSTAGRAM_SCOPES);
  assert.equal(url.searchParams.get('state'),state);
});

test('webhook signature and Instagram message extraction reject echoes',()=>{
  const payload={object:'instagram',entry:[{messaging:[{sender:{id:'igsid-customer'},recipient:{id:'ig-business'},timestamp:1700000000000,message:{mid:'mid.1',text:'Hello'}},{sender:{id:'ig-business'},recipient:{id:'igsid-customer'},message:{mid:'mid.2',text:'Echo',is_echo:true}}]}]};
  const raw=JSON.stringify(payload);
  const signature=`sha256=${crypto.createHmac('sha256',env.META_INSTAGRAM_APP_SECRET).update(raw).digest('hex')}`;
  assert.equal(verifyMetaSignature(raw,signature),true);
  assert.equal(verifyMetaSignature(raw,'sha256=bad'),false);
  assert.deepEqual(extractInstagramMessages(payload).map(item=>({id:item.externalEventId,text:item.text,recipient:item.recipientId})),[{id:'mid.1',text:'Hello',recipient:'ig-business'}]);
});

test('Instagram postback buttons become routable inbound messages',()=>{
  const payload={object:'instagram',entry:[{messaging:[{sender:{id:'igsid-customer'},recipient:{id:'ig-business'},timestamp:1700000000123,postback:{mid:'postback.1',title:'Send details',payload:'HANSORA_FLOW:details'}}]}]};
  assert.deepEqual(extractInstagramMessages(payload).map(item=>({id:item.externalEventId,text:item.text,payload:item.quickReplyPayload})),[{id:'postback.1',text:'Send details',payload:'HANSORA_FLOW:details'}]);
});

test('Instagram comment webhooks become stable comment events',()=>{
  const payload={object:'instagram',entry:[{id:'ig-business',time:1700000000,changes:[{field:'comments',value:{id:'comment-1',text:'PRICE please',from:{id:'igsid-customer',username:'maria'},media:{id:'media-1'}}}]}]};
  assert.deepEqual(extractInstagramComments(payload).map(item=>({event:item.externalEventId,account:item.accountId,media:item.mediaId,sender:item.senderId,text:item.text,timestamp:item.timestamp})),[{event:'comment:comment-1',account:'ig-business',media:'media-1',sender:'igsid-customer',text:'PRICE please',timestamp:1700000000000}]);
});

test('Instagram media and comment reply calls use the Instagram Login graph host',async()=>{
  const requests=[];
  const fetchImpl=async(url,options={})=>{requests.push({url:String(url),options});return{ok:true,status:200,json:async()=>requests.length===1?{data:[{id:'media-1',caption:'New collection',media_type:'IMAGE',media_url:'https://cdn.test/1.jpg'}]}:{id:'reply-1',message_id:'message-1'}}};
  const media=await listInstagramMedia({instagramUserId:'ig-business',accessToken:'token',fetchImpl});
  await replyToInstagramComment({commentId:'comment-1',message:'Sent!',accessToken:'token',fetchImpl});
  await sendInstagramPrivateReply({instagramUserId:'ig-business',commentId:'comment-1',text:'Choose one',quickReplies:[{title:'Prices',payload:'PRICES'}],accessToken:'token',fetchImpl});
  assert.equal(media[0].id,'media-1');
  assert.match(requests[0].url,/graph\.instagram\.com\/v23\.0\/ig-business\/media/);
  assert.match(requests[1].url,/comment-1\/replies$/);
  assert.deepEqual(JSON.parse(requests[2].options.body),{recipient:{comment_id:'comment-1'},message:{text:'Choose one',quick_replies:[{content_type:'text',title:'Prices',payload:'PRICES'}]}});
});

test('Instagram button templates contain real link and flow buttons',async()=>{
  const requests=[];const fetchImpl=async(url,options={})=>{requests.push({url:String(url),options});return{ok:true,status:200,json:async()=>({message_id:'message-1'})}};
  await sendInstagramPrivateReply({instagramUserId:'ig-business',commentId:'comment-1',text:'Choose one',buttons:[{type:'postback',title:'Prices',payload:'HANSORA_FLOW:prices'},{type:'web_url',title:'Catalog',url:'https://example.com'}],accessToken:'token',fetchImpl});
  assert.deepEqual(JSON.parse(requests[0].options.body),{recipient:{comment_id:'comment-1'},message:{attachment:{type:'template',payload:{template_type:'button',text:'Choose one',buttons:[{type:'postback',title:'Prices',payload:'HANSORA_FLOW:prices'},{type:'web_url',url:'https://example.com',title:'Catalog'}]}}}});
});

test('provider access tokens encrypt with authenticated encryption',()=>{
  const encrypted=encryptSecret('IGAA-secret-token');
  assert.notEqual(encrypted.encrypted_secret,'IGAA-secret-token');
  assert.equal(decryptSecret(encrypted),'IGAA-secret-token');
});

test('ElevenLabs text bridge sends context and returns the completed reply',async()=>{
  class FakeWebSocket{
    constructor(url){this.url=url;this.listeners={};queueMicrotask(()=>this.emit('open',{}));}
    addEventListener(type,fn){(this.listeners[type]||=[]).push(fn)}
    emit(type,event){for(const fn of this.listeners[type]||[])fn(event)}
    send(raw){const value=JSON.parse(raw);if(value.type==='conversation_initiation_client_data')queueMicrotask(()=>this.emit('message',{data:JSON.stringify({type:'conversation_initiation_metadata'})}));if(value.type==='user_message')queueMicrotask(()=>this.emit('message',{data:JSON.stringify({type:'agent_response',agent_response_event:{agent_response:'We are open until 19:00.'}})}));}
    close(){}
  }
  const fetchImpl=async()=>({ok:true,status:200,json:async()=>({signed_url:'wss://example.test/signed'})});
  const result=await askElevenLabsText({agentId:'agent_test',text:'When are you open?',context:'Business hours: 10:00–19:00',fetchImpl,WebSocketImpl:FakeWebSocket,timeoutMs:1000});
  assert.equal(result.text,'We are open until 19:00.');
});
