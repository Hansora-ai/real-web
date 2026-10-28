import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import * as phone from '../../lib/automation/phone.mjs';
import { voiceCredits } from '../../lib/automation/billing.mjs';
import {naturalPhoneInstructions,naturalPhoneTools,phoneCaptionConfig} from '../../lib/automation/phone-natural-instructions.mjs';
import {END_CALL_DEFINITION} from '../../lib/automation/phone-call-diagnostic.mjs';
import {phoneTurnPolicy} from '../../lib/automation/phone-turns.mjs';

const source = (await readFile(new URL('../../workers/automation-phone/src/worker.mjs', import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace('export default defineAgent(', 'globalThis.definition = defineAgent(').replace('import.meta.url', "'file:///worker.mjs'");
const id = '123e4567-e89b-42d3-a456-426614174000';
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture(owner = 'new-owner', options = {}) {
  const inserts = [], updates = [], timeouts = [], sessions = [], reads = [], charges = [], shutdowns = [];
  const business = {id,owner_user_id:owner,name:'New business',automation_agents:{},automation_business_knowledge:{},automation_channel_connections:[{channel_type:'phone',settings:options.settings || {}}]};
  let shutdownCallback;
  let now=Date.now();
  class ClockDate extends Date {constructor(...args){super(...(args.length ? args : [now]));}static now(){return now;}}
  let toolContext;
  class Session extends EventEmitter {
    constructor(config) { super(); this.config=config; sessions.push(this); }
    snapshot(){return {};}
    async start(options) { this.options = options; }
    generateReply() {}
  }
  const sandbox = {
    ...phone, naturalPhoneInstructions,naturalPhoneTools,phoneCaptionConfig,END_CALL_DEFINITION,phoneTurnPolicy,phoneCatalogBrief:async()=>'',NativePhoneTestSession:Session, console, process:{env:{}}, Date:ClockDate, setTimeout:(fn,ms) => {const timer={fn,ms};timeouts.push(timer);return timer;}, clearTimeout:timer => {timer.cleared=true;},
    fileURLToPath:value=>value, cli:{runApp(){}}, ServerOptions:class {}, defineAgent:value=>value,
    llm:{ChatMessage:class { constructor(value){Object.assign(this,value);} static create(value){return new this({...value,id:'message-'+Math.random(),textContent:value.content.join('')});} }}, tool:value=>value, voice:{AgentSession:Session,Agent:{create:value=>value},AgentSessionEventTypes:{MetricsCollected:'metrics',ConversationItemAdded:'message',Error:'error',Close:'close'}},
    google:{realtime:{RealtimeModel:class {}}}, ParticipantKind:{SIP:3}, LiveKitAPI:class {room={deleteRoom:async()=>{}};},
    first:async path=>{reads.push(path); if(path.includes('automation_provider_resources?'))return options.noResource ? null : {business_id:id}; return business;},
    serviceUpsert:async(table,valueKey,value)=>({id:table,...value}),
    serviceInsert:async(table,value)=>{inserts.push({table,value});return{id:table,...value};},
    serviceUpdate:async(table,query,value)=>{updates.push({table,value});}, notifyOwner:async()=>{throw Error('must not notify');},
    automationPrices:()=>({voiceMinute:0.8,testVoiceMinute:0.8}),
    automationPricesFor:async businessId=>{assert.equal(businessId,id);return{voiceMinute:0.8};},
    canAfford:async(businessId,price)=>{assert.equal(price,options.inbound ? 0.8 : 0);return{ok:true,balance:options.inbound ? 8 : null};},
    affordableVoiceSeconds:(balance,price)=>{assert.ok(options.inbound);return 600;},
    chargeCredits:async value=>{assert.ok(options.inbound);charges.push(value);return{ok:true,charged:value.credits};}, handleOutOfCredits:async()=>{throw Error('must not check credits');}, voiceCredits,
    loadToolConfigs:async()=>[],buildToolDefinitions:()=>[],createToolRunner:context=>{toolContext=context;const run=async()=>({ok:true});run.liveBrief=async()=>'';return run;},
    toolInstructions:()=>'',businessClock:()=>'',buildAutomationInstructions:()=>'',firstMessageFor:()=> 'Hello'
  };
  vm.runInNewContext(source,sandbox);
  const ctx = {job:{metadata:JSON.stringify({business_id:id,owner_user_id:'new-owner',participant_identity:'caller',direction:'test'})},room:{name:'test-room'},connect:async()=>{},waitForParticipant:async identity=>{assert.equal(identity,'caller');return{identity,attributes:{}};},addShutdownCallback(fn){shutdownCallback=fn;},shutdown(){}};
  if(options.inbound){ctx.job.metadata='{}';ctx.waitForParticipant=async identity=>{assert.equal(identity,undefined);return{identity:'sip-caller',kind:3,attributes:{'sip.phoneNumber':'+15550100001','sip.trunkPhoneNumber':'+15550100002','sip.callID':'inbound-call'},metadata:JSON.stringify({business_id:'other-business',direction:'test'})};};}
  return {entry:()=>sandbox.definition.entry(ctx),inserts,updates,timeouts,sessions,reads,charges,business,ctx,sandbox,shutdown:()=>shutdownCallback(),advance:ms=>{now+=ms;},get toolContext(){return toolContext;}};
}

test('zero-credit browser tests stay free, simulate actions, log tokens and enforce the test deadline', async () => {
  const f = fixture();
  await f.entry();
  const session = f.sessions[0];
  assert.equal(f.toolContext.dryRun,true);
  assert.equal(session.config.nativeVoice,true);
  assert.equal(session.config.nativeOptions.voice,'Leda');
  assert.equal(session.config.nativeOptions.model,'gemini-3.8-live');
  assert.ok(session.config.nativeOptions.definitions.some(item=>item.name==='end_call'));
  assert.ok(!session.config.nativeOptions.definitions.some(item=>item.name==='send_product_photos'));
  assert.doesNotMatch(session.config.nativeOptions.instructions,/Final check before every|letter.by.letter spelling tool/);
  assert.equal(session.options.record.audio,false);
  assert.equal(session.options.inputOptions.participantIdentity,'caller');
  assert.ok(f.timeouts.some(timer=>timer.ms===300000));
  session.emit('metrics',{metrics:{type:'realtime_model_metrics',requestId:'response-1',inputTokens:20,outputTokens:10,inputTokenDetails:{audioTokens:18,textTokens:2},outputTokenDetails:{audioTokens:10,textTokens:0},ttftMs:240}});
  f.advance(1000);
  session.emit('close');
  await flush(); await flush();
  const usage = f.inserts.find(item=>item.table==='automation_usage_events').value;
  assert.equal(usage.credits,0);
  assert.equal(usage.billable_quantity,0);
  assert.equal(usage.metadata.provider_usage.input_audio_tokens,18);
  assert.deepEqual(Array.from(usage.metadata.provider_usage.model_first_audio_token_ms),[240]);
  assert.equal(f.updates.find(item=>item.table==='automation_calls').value.billable_seconds,0);
  assert.ok(f.timeouts.every(timer=>timer.cleared));
});

test('worker rejects a mismatched business owner before any database writes', async()=>{
  const f=fixture('someone-else');
  await assert.rejects(f.entry(),/phone_test_owner_mismatch/);
  assert.equal(f.inserts.length,0);
});

test('participant-controlled metadata cannot select another business or make an inbound call free',()=>{
  const call=phone.describePhoneCall({participantMetadata:{business_id:id,direction:'test',owner_user_id:'owner'},attributes:{'hansora.businessId':id,'hansora.callDirection':'test','sip.phoneNumber':'+15550100000'}});
  assert.equal(call.businessId,''); assert.equal(call.direction,'inbound'); assert.equal(call.ownerUserId,'');
});

test('usage collection ignores duplicate provider events and keeps reasoning separate',()=>{
  const metrics=phone.createPhoneMetrics();
  const event={type:'realtime_model_metrics',requestId:'one',inputTokens:30,outputTokens:20,reasoningTokens:5,ttftMs:-1};
  metrics.collect(event);metrics.collect(event);
  assert.equal(metrics.snapshot().responses,1);
  assert.equal(metrics.snapshot().output_tokens,20);
  assert.equal(metrics.snapshot().reasoning_tokens,5);
  assert.deepEqual(metrics.snapshot().model_first_audio_token_ms,[]);
});


test('inbound calls resolve the assigned number and retain paid business-scoped tools',async()=>{
  const f=fixture('new-owner',{inbound:true});
  await f.entry();
  assert.match(f.reads[0],/automation_provider_resources\?.*provider_resource_id=eq.%2B15550100002/);
  assert.equal(f.toolContext.businessId,id);
  assert.equal(f.toolContext.channel,'phone');
  assert.equal(f.toolContext.dryRun,false);
  assert.equal(f.sessions[0].options.inputOptions.participantIdentity,'sip-caller');
  assert.equal(f.inserts.find(x=>x.table==='automation_calls').value.direction,'inbound');
  assert.equal(f.inserts.find(x=>x.table==='automation_calls').value.business_id,id);
  assert.ok(f.timeouts.some(timer=>timer.ms===600000));
});

test('an unassigned number cannot reach an arbitrary business or create records',async()=>{
  const f=fixture('new-owner',{inbound:true,noResource:true});
  await assert.rejects(f.entry(),/phone_business_not_found/);
  assert.equal(f.inserts.length,0);
  assert.equal(f.sessions.length,0);
});

test('saved inbound captions go to their own business inbox and call transcript',async()=>{
  const f=fixture('new-owner',{inbound:true});
  await f.entry();
  const session=f.sessions[0];
  const item=session.config.nativeOptions.createConversationItem({role:'user',content:['Synthetic address: Unfamiliar Street 10/4'],createdAt:Date.now()});
  session.emit('message',{item});
  session.emit('message',{item:session.config.nativeOptions.createConversationItem({role:'assistant',content:['Synthetic confirmation.'],createdAt:Date.now(),interrupted:true})});
  await f.shutdown();
  const messages=f.inserts.filter(x=>x.table==='automation_messages');
  assert.equal(messages.length,2);
  assert.ok(messages.every(x=>x.value.business_id===id&&x.value.conversation_id==='automation_conversations'));
  assert.equal(messages[0].value.content,'Synthetic address: Unfamiliar Street 10/4');
  assert.equal(messages[1].value.metadata.interrupted,true);
  assert.equal(messages[0].value.metadata.transcription_source,'gemini_live');
  const saved=f.updates.find(x=>x.table==='automation_calls').value;
  assert.match(saved.transcript,/Unfamiliar Street 10\/4/);
  assert.match(saved.transcript,/Synthetic confirmation/);
});

test('transcript opt-out prevents caption creation and transcript/message persistence',async()=>{
  const f=fixture('new-owner',{inbound:true,settings:{save_transcripts:false}});
  await f.entry();
  assert.equal(f.sessions[0].config.nativeOptions.createConversationItem,undefined);
  f.sessions[0].emit('message',{item:f.sandbox.llm.ChatMessage.create({role:'user',content:['Must not save this synthetic caption']})});
  await f.shutdown();
  assert.equal(f.inserts.filter(x=>x.table==='automation_messages').length,0);
  assert.equal(f.updates.find(x=>x.table==='automation_calls').value.transcript,'');
});

test('inbound finalization charges once when close and shutdown both fire',async()=>{
  const f=fixture('new-owner',{inbound:true});
  await f.entry();
  f.advance(61000);
  f.sessions[0].emit('close');
  await f.shutdown(); await flush(); await flush();
  assert.equal(f.charges.length,1);
  assert.equal(f.charges[0].businessId,id);
  assert.equal(f.charges[0].credits,0.9);
  assert.equal(f.charges[0].idempotencyKey,'usage:phone:inbound-call');
  const usage=f.inserts.filter(x=>x.table==='automation_usage_events');
  assert.equal(usage.length,1);
  assert.equal(usage[0].value.billable_quantity,61);
  assert.equal(usage[0].value.credits,0.9);
  assert.equal(f.updates.filter(x=>x.table==='automation_calls').length,1);
});
