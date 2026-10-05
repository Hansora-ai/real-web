import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import * as phone from '../../lib/automation/phone.mjs';

const source = (await readFile(new URL('../../workers/automation-phone/src/worker.mjs', import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace('export default defineAgent(', 'globalThis.definition = defineAgent(').replace('import.meta.url', "'file:///worker.mjs'");
const id = '123e4567-e89b-42d3-a456-426614174000';
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture(owner = 'new-owner') {
  const inserts = [], updates = [], timeouts = [], sessions = [];
  let toolContext;
  class Session extends EventEmitter {
    constructor() { super(); sessions.push(this); }
    async start(options) { this.options = options; }
    generateReply() {}
  }
  const sandbox = {
    ...phone, console, process:{env:{}}, Date, setTimeout:(fn,ms) => {const timer={fn,ms};timeouts.push(timer);return timer;}, clearTimeout:timer => {timer.cleared=true;},
    fileURLToPath:value=>value, cli:{runApp(){}}, ServerOptions:class {}, defineAgent:value=>value,
    llm:{ChatMessage:class {}}, tool:value=>value, voice:{AgentSession:Session,Agent:{create:value=>value},AgentSessionEventTypes:{MetricsCollected:'metrics',ConversationItemAdded:'message',Error:'error',Close:'close'}},
    google:{realtime:{RealtimeModel:class {}}}, ParticipantKind:{SIP:3}, LiveKitAPI:class {room={deleteRoom:async()=>{}};},
    first:async()=>({id,owner_user_id:owner,name:'New business',automation_agents:{},automation_business_knowledge:{},automation_channel_connections:[]}),
    serviceUpsert:async(table,valueKey,value)=>({id:table,...value}),
    serviceInsert:async(table,value)=>{inserts.push({table,value});return{id:table,...value};},
    serviceUpdate:async(table,query,value)=>{updates.push({table,value});}, notifyOwner:async()=>{throw Error('must not notify');},
    automationPrices:()=>({voiceMinute:0.8,testVoiceMinute:0.8}),
    canAfford:async(businessId,price)=>{assert.equal(price,0);return{ok:true,balance:null};},
    affordableVoiceSeconds:()=>{throw Error('must not check balance');},
    chargeCredits:async()=>{throw Error('must not charge');}, handleOutOfCredits:async()=>{throw Error('must not check credits');}, voiceCredits:()=>{throw Error('must not charge');},
    loadToolConfigs:async()=>[],buildToolDefinitions:()=>[],createToolRunner:context=>{toolContext=context;const run=async()=>({ok:true});run.liveBrief=async()=>'';return run;},
    toolInstructions:()=>'',businessClock:()=>'',buildAutomationInstructions:()=>'',firstMessageFor:()=> 'Hello'
  };
  vm.runInNewContext(source,sandbox);
  const ctx = {job:{metadata:JSON.stringify({business_id:id,owner_user_id:'new-owner',participant_identity:'caller',direction:'test'})},room:{name:'test-room'},connect:async()=>{},waitForParticipant:async identity=>{assert.equal(identity,'caller');return{identity,attributes:{}};},addShutdownCallback(){},shutdown(){}};
  return {entry:()=>sandbox.definition.entry(ctx),inserts,updates,timeouts,sessions,get toolContext(){return toolContext;}};
}

test('zero-credit browser tests stay free, simulate actions, log tokens and enforce the test deadline', async () => {
  const f = fixture();
  await f.entry();
  const session = f.sessions[0];
  assert.equal(f.toolContext.dryRun,true);
  assert.equal(session.options.record.audio,false);
  assert.equal(session.options.inputOptions.participantIdentity,'caller');
  assert.ok(f.timeouts.some(timer=>timer.ms===300000));
  session.emit('metrics',{metrics:{type:'realtime_model_metrics',requestId:'response-1',inputTokens:20,outputTokens:10,inputTokenDetails:{audioTokens:18,textTokens:2},outputTokenDetails:{audioTokens:10,textTokens:0},ttftMs:240}});
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
