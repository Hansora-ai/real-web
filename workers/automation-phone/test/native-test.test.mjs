import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { NativePhoneTestSession } from "../src/native-test.mjs";
const flush = () => new Promise((r) => setImmediate(r));
function fixture({ hold = false, failConnect = false, captionConfig } = {}) {
  let callbacks, config, release;
  const frames = [],
    sent = [],
    results = [],
    executions = [],
    states = [],
    inputEvents = [];
  let clears = 0,
    closes = 0;
  const provider = {
    sendRealtimeInput: (x) => sent.push(x),
    sendToolResponse: (x) => results.push(x),
    sendClientContent: (x) => sent.push(x),
    close() {
      callbacks.onclose();
    },
  };
  class AI {
    live = {
      connect: async (x) => {
        callbacks = x.callbacks;
        if(failConnect)throw Error('private connection payload');
        config = x.config;
        return provider;
      },
    };
  }
  class Source {
    async captureFrame(f) {
      frames.push(f);
      if (hold && frames.length === 1)
        await new Promise((r) => {
          release = r;
        });
    }
    clearQueue() {
      clears++;
    }
    waitForPlayout() {
      return Promise.resolve();
    }
    async close() {
      closes++;
    }
  }
  class Frame {
    constructor(data, sampleRate, channels, samplesPerChannel) {
      Object.assign(this, { data, sampleRate, channels, samplesPerChannel });
    }
  }
  const room = new EventEmitter();
  room.remoteParticipants = new Map();
  room.localParticipant = {
    publishTrack: async () => {},
    setAttributes: async (x) => states.push(x),
    sendText() {
      throw Error("must not publish transcripts");
    },
  };
  const events = {
    MetricsCollected: "metrics",
    Error: "session_error",
    Close: "close",
  };
  const session = new NativePhoneTestSession(
    {
      nativeTestOnly: true,
      nativeEvents: events,
      nativeOptions: {
        model: "gemini-3.8-live",
        voice: "Leda",
        instructions: "fixture",
        inputAudioTranscription: captionConfig,
        apiKey: "fixture-not-a-key",
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
            silenceDurationMs: 500,
          },
        },
        addressMemory: { inputCompleted: (e) => inputEvents.push(e) },
        definitions: [
          {
            name: "remember_delivery_address",
            parameters: {
              type: "object",
              properties: { confirmed: { type: "boolean" } },
            },
          },
        ],
        execute: async (name, args) => {
          executions.push({ name, args });
          return { ok: true };
        },
      },
    },
    {
      GoogleGenAI: AI,
      AudioSource: Source,
      AudioFrame: Frame,
      AudioStream: class {
        constructor(track) {
          return new ReadableStream({
            start(c) {
              for (const f of track.frames || []) c.enqueue(f);
              c.close();
            },
          });
        }
      },
      LocalAudioTrack: { createAudioTrack: () => ({}) },
      TrackPublishOptions: class {},
      TrackSource: { SOURCE_MICROPHONE: 1 },
      RoomEvent: { TrackSubscribed: "track", ParticipantDisconnected: "left" },
    },
  );
  const start = () =>
    session.start({
      room,
      agent: {},
      inputOptions: { participantIdentity: "caller" },
      record: { audio: false, transcript: false, traces: false, logs: false },
    });
  return {
    session,
    start,
    room,
    frames,
    sent,
    results,
    executions,
    states,
    inputEvents,
    get config() {
      return config;
    },
    get callbacks() {
      return callbacks;
    },
    get clears() {
      return clears;
    },
    get closes() {
      return closes;
    },
    release: () => release?.(),
  };
}
const audio = (data) => ({
  serverContent: {
    modelTurn: {
      parts: [
        {
          inlineData: {
            data: Buffer.from(new Int16Array(data).buffer).toString("base64"),
          },
        },
      ],
    },
  },
});
test('live captions are sent only to an unexpired observer for the exact owner/business and never enter snapshots',async()=>{
 const f=fixture();await f.start();const deliveries=[];
 f.room.localParticipant.sendText=async(text,options)=>deliveries.push({text,options});
 f.session.config.nativeOptions.diagnosticOwner={ownerUserId:'owner',businessId:'business'};
 const metadata={purpose:'phone_confirmation_diagnostic',owner_user_id:'owner',business_id:'business',expires_at:Date.now()+60000};
 const valid={identity:'owner-diagnostic-owner-private',metadata:JSON.stringify(metadata)};
 f.room.remoteParticipants.set('valid',valid);
 f.room.remoteParticipants.set('wrong-business',{identity:'owner-diagnostic-owner-other',metadata:JSON.stringify({...metadata,business_id:'other'})});
 f.room.remoteParticipants.set('expired',{identity:'owner-diagnostic-owner-expired',metadata:JSON.stringify({...metadata,expires_at:Date.now()-1})});
 await f.session.receive({serverContent:{inputTranscription:{text:'Synthetic private agreement'}}});
 assert.equal(deliveries.length,1);assert.deepEqual(deliveries[0].options.destinationIdentities,[valid.identity]);
 assert.doesNotMatch(JSON.stringify(f.session.snapshot()),/Synthetic private agreement/);
 f.room.remoteParticipants.clear();await f.session.receive({serverContent:{inputTranscription:{text:'Not forwarded'}}});assert.equal(deliveries.length,1);await f.session.dispose();
});
test('numeric tool diagnostics distinguish missing confirmation, missing fields and success without storing arguments',async()=>{
 const f=fixture();await f.start();
 f.session.config.nativeOptions.definitions=[{name:'create_order'}];
 let result={ok:false,error:'missing_details',missing:['Name','Address']};
 f.session.config.nativeOptions.execute=async()=>result;
 const request=id=>({toolCall:{functionCalls:[{id,name:'create_order',args:{customer_confirmed:true,customer_name:'Synthetic Private Person',phone_number:'2025558868',delivery_address:'Private Road'}}]}});
 await f.session.receive(request('one'));result={ok:true,test:true};await f.session.receive(request('two'));
 const events=f.session.snapshot().tool_events;assert.equal(events[0].customer_confirmed,true);assert.equal(events[1].error,'missing_details');assert.equal(events[1].missing_fields,2);assert.equal(events[3].ok,true);assert.equal(events[3].test,true);assert.doesNotMatch(JSON.stringify(events),/Private|Address|2025558868/);await f.session.dispose();
});
test('end_call waits for the goodbye audio and playout; order confirmation alone never requests hangup',async()=>{
 const f=fixture();await f.start();let ended=0,release;
 f.session.config.nativeOptions.definitions=[{name:'end_call'},{name:'create_order'}];
 f.session.config.nativeOptions.execute=async()=>({ok:true});f.session.config.nativeOptions.endCall=async()=>{ended++;};
 await f.session.receive({toolCall:{functionCalls:[{id:'order',name:'create_order',args:{customer_confirmed:true}}]}});assert.equal(f.session.pendingEnd,undefined);
 await f.session.receive({toolCall:{functionCalls:[{id:'end',name:'end_call',args:{}}]}});
 f.session.source.waitForPlayout=()=>new Promise(r=>{release=r;});
 await f.session.receive(audio([1000,1000]));await f.session.output;
 await f.session.receive({serverContent:{turnComplete:true}});
 await new Promise(r=>setTimeout(r,400));assert.equal(ended,0);
 release();await flush();assert.equal(ended,1);assert.equal(f.clears,0);await f.session.dispose();
});
test('new caller speech cancels a pending hangup and lets the conversation continue',async()=>{
 const f=fixture();await f.start();let ended=0;
 f.session.config.nativeOptions.definitions=[{name:'end_call'}];f.session.config.nativeOptions.endCall=async()=>{ended++;};
 await f.session.receive({toolCall:{functionCalls:[{id:'end',name:'end_call',args:{}}]}});
 f.session.lastInputAt=f.session.pendingEnd.requestedAt+250;
 await f.session.receive({serverContent:{inputTranscription:{text:'Actually one more question'}}});assert.equal(f.session.pendingEnd,null);
 await f.session.receive(audio([1000,1000]));await f.session.receive({serverContent:{turnComplete:true}});
 await new Promise(r=>setTimeout(r,400));assert.equal(ended,0);await f.session.dispose();
});
test("native transport is limited to tests and refuses recording", async () => {
  assert.throws(
    () => new NativePhoneTestSession({ nativeTestOnly: false }),
    /test_only/,
  );
  const f = fixture();
  await assert.rejects(
    f.session.start({ record: { audio: true } }),
    /recording_disabled/,
  );
});
test("keeps Gemini/Leda/native endpointing and JSON schemas; only intended caller track is streamed without sample changes", async () => {
  const f = fixture();
  await f.start();
  assert.equal(
    f.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
    "Leda",
  );
  assert.equal(
    f.config.realtimeInputConfig.automaticActivityDetection.disabled,
    false,
  );
  assert.equal(
    f.config.tools[0].functionDeclarations[0].behavior,
    "NON_BLOCKING",
  );
  assert.equal(
    f.config.tools[0].functionDeclarations[0].parametersJsonSchema.type,
    "object",
  );
  const data = new Int16Array([1, -32768, 32767, 1000]);
  f.room.emit(
    "track",
    { sid: "other", kind: 1, frames: [{ data }] },
    {},
    { identity: "other" },
  );
  f.room.emit(
    "track",
    { sid: "own", kind: 1, frames: [{ data }] },
    {},
    { identity: "caller" },
  );
  await flush();
  assert.equal(f.sent.length, 1);
  assert.deepEqual(
    Buffer.from(f.sent[0].audio.data, "base64"),
    Buffer.from(data.buffer),
  );
  await f.session.dispose();
});
test("interruption drops queued old audio and forwards new native PCM", async () => {
  const f = fixture({ hold: true });
  await f.start();
  await f.session.receive(audio([1, 2, 3]));
  await f.session.receive(audio([4, 5, 6]));
  await flush();
  await f.session.receive({ serverContent: { interrupted: true } });
  f.release();
  await f.session.output;
  assert.equal(f.frames.length, 1);
  await f.session.receive(audio([7, 8]));
  await f.session.output;
  assert.deepEqual([...f.frames[1].data], [7, 8]);
  assert.equal(f.frames[1].sampleRate, 24000);
  assert.equal(f.clears, 1);
  await f.session.dispose();
});
test("executes a tool once, resumes memory replies promptly, and rejects undeclared calls", async () => {
  const f = fixture();
  await f.start();
  const call = {
    toolCall: {
      functionCalls: [
        {
          id: "a",
          name: "remember_delivery_address",
          args: { confirmed: false },
        },
      ],
    },
  };
  await f.session.receive(call);
  await f.session.receive(call);
  assert.equal(f.executions.length, 1);
  assert.equal(f.results[1].functionResponses[0].scheduling, "INTERRUPT");
  await f.session.receive({
    toolCall: { functionCalls: [{ id: "b", name: "unknown", args: {} }] },
  });
  assert.equal(f.executions.length, 1);
  assert.equal(
    f.results.at(-1).functionResponses[0].response.output.error,
    "unknown_tool",
  );
  await f.session.dispose();
});
test("input caption chunks count a caller turn once; shutdown is idempotent and never records or forwards transcript text", async () => {
  const f = fixture();
  await f.start();
  await f.session.receive({
    serverContent: { inputTranscription: { text: "Synthetic address secret" } },
  });
  await f.session.receive({
    serverContent: { inputTranscription: { text: "continued" } },
  });
  assert.equal(f.inputEvents[0].itemId, f.inputEvents[1].itemId);
  assert.equal(JSON.stringify(f.session.snapshot()).includes("secret"), false);
  await Promise.all([f.session.dispose(), f.session.dispose()]);
  assert.equal(f.closes, 1);
  await f.session.receive(audio([1, 2]));
  assert.equal(f.frames.length, 0);
  assert.equal(f.room.listenerCount("track"), 0);
});
test("provider failure emits a generic error and closes once without error payload leakage", async () => {
  const f = fixture();
  await f.start();
  const errors = [],
    closed = [];
  f.session.on("session_error", (e) => errors.push(e.error.message));
  f.session.on("close", () => closed.push(1));
  f.callbacks.onerror({ message: "private caller text" });
  await flush();
  await f.session.end();
  assert.deepEqual(errors, ["native_provider_error"]);
  assert.equal(closed.length, 1);
  assert.equal(f.closes, 1);
});

test('synthetic caption mode cannot be enabled for an ordinary caller room',async()=>{const f=fixture();f.session.config.nativeSyntheticCaptions=true;await assert.rejects(f.start(),/synthetic_caption_room_required/);assert.equal(f.sent.length,0);});

test('failed connection closes the published source and reports only a generic error',async()=>{const f=fixture({failConnect:true});const errors=[];f.session.on('session_error',e=>errors.push(e.error.message));await assert.rejects(f.start(),/native_connect_error/);await flush();assert.deepEqual(errors,['native_connect_error']);assert.equal(f.closes,1);});

test('one state update per transition; generationComplete releases the speaking state even without turnComplete',async()=>{const f=fixture();await f.start();for(let i=0;i<20;i++)await f.session.receive(audio([1000,1000]));await f.session.output;await f.session.receive({serverContent:{generationComplete:true}});await flush();assert.equal(f.states.at(-1)['lk.agent.state'],'listening');assert.equal(f.states.filter(s=>s['lk.agent.state']==='speaking').length,1);await f.session.dispose();});
test('a completed speech segment can listen while a nonblocking local tool finishes without further audio',async()=>{const f=fixture();await f.start();await f.session.receive(audio([1000,1000]));await f.session.output;await f.session.receive({serverContent:{generationComplete:true},toolCall:{functionCalls:[{id:'done',name:'remember_delivery_address',args:{confirmed:false}}]}});await flush();assert.equal(f.states.at(-1)['lk.agent.state'],'listening');await f.session.dispose();});

test('late audio after a completion flag cannot leave speaking stuck once the queued sound has drained',async()=>{
  const f=fixture();await f.start();
  await f.session.receive(audio([1,2,3]));
  await f.session.receive({serverContent:{generationComplete:true}});
  await f.session.receive(audio([4,5,6]));
  await f.session.output;
  await new Promise(resolve=>setTimeout(resolve,350));
  assert.equal(f.states.at(-1)['lk.agent.state'],'listening');
  await f.session.dispose();
});

test('caption language hints reach Gemini without constraining speech or feeding captions back', async () => {
 const f=fixture({captionConfig:{languageCodes:['en','hy','ru']}});await f.start();
 assert.deepEqual(f.config.inputAudioTranscription,{languageCodes:['en','hy','ru']});
 assert.deepEqual(f.config.outputAudioTranscription,{});
 assert.equal(f.config.speechConfig.languageCode,undefined);
 await f.session.receive({serverContent:{inputTranscription:{text:'Synthetic caption'}}});
 assert.equal(f.sent.length,0);
 await f.session.dispose();
});

test('a cancelled slow lookup does not inject its stale result after new caller speech', async () => {
 const f=fixture();await f.start();let complete,signal;
 f.session.config.nativeOptions.definitions=[{name:'search_products'}];
 f.session.config.nativeOptions.execute=async(name,args,context)=>{signal=context.signal;return new Promise(resolve=>{complete=resolve;});};
 const pending=f.session.receive({toolCall:{functionCalls:[{id:'old-query',name:'search_products',args:{query:'first request'}}]}});
 await flush();
 await f.session.receive({toolCallCancellation:{ids:['old-query']}});
 await f.session.receive({serverContent:{inputTranscription:{text:'I changed my request.'}}});
 complete({ok:true,products:[{name:'obsolete product'}]});await pending;
 assert.equal(f.results.length,1); // Only the initial silent acknowledgement.
 assert.equal(signal.aborted,true);
 assert.equal(f.session.closed,false);
 assert.equal(f.session.snapshot().cancelled_tool_calls,1);
 await f.session.dispose();
});

test('a tool exception returns a failure to Gemini and the next request still works', async () => {
 const f=fixture();await f.start();
 f.session.config.nativeOptions.definitions=[{name:'search_products'}];
 f.session.config.nativeOptions.execute=async()=>{throw Error('private backend detail');};
 await f.session.receive({toolCall:{functionCalls:[{id:'failure',name:'search_products',args:{}}]}});
 assert.deepEqual(f.results.at(-1).functionResponses[0].response,{output:{ok:false,error:'execution_failed'}});
 assert.equal(f.session.closed,false);
 assert.doesNotMatch(JSON.stringify(f.session.snapshot()),/private backend/);
 f.session.config.nativeOptions.execute=async()=>({ok:true,products:[]});
 await f.session.receive({toolCall:{functionCalls:[{id:'retry',name:'search_products',args:{}}]}});
 assert.equal(f.results.at(-1).functionResponses[0].response.output.ok,true);
 await f.session.dispose();
});

test('closing during a lookup prevents a late response or hangup action', async () => {
 const f=fixture();await f.start();let complete,ended=0;
 f.session.config.nativeOptions.definitions=[{name:'end_call'}];
 f.session.config.nativeOptions.execute=async()=>new Promise(resolve=>{complete=resolve;});
 f.session.config.nativeOptions.endCall=async()=>{ended++;};
 const pending=f.session.receive({toolCall:{functionCalls:[{id:'closing',name:'end_call',args:{}}]}});
 await flush();await f.session.dispose();complete({ok:true});await pending;
 assert.equal(f.results.length,1);assert.equal(ended,0);assert.equal(f.session.pendingEnd,null);
});

test('opted-in conversation captions aggregate once per completed turn without entering model input', async () => {
 const f=fixture();await f.start();const messages=[];
 f.session.config.nativeEvents.ConversationItemAdded='conversation';
 f.session.config.nativeOptions.createConversationItem=value=>value;
 f.session.on('conversation',value=>messages.push(value.item));
 await f.session.receive({serverContent:{inputTranscription:{text:'My address is '}}});
 await f.session.receive({serverContent:{inputTranscription:{text:'Vellorin 10/4.'}}});
 await f.session.receive({serverContent:{outputTranscription:{text:'I have '}}});
 await f.session.receive({serverContent:{outputTranscription:{text:'Vellorin 10/4.'}}});
 assert.equal(messages.length,0);
 await f.session.receive({serverContent:{turnComplete:true}});
 assert.deepEqual(messages.map(x=>[x.role,x.content[0]]),[['user','My address is Vellorin 10/4.'],['assistant','I have Vellorin 10/4.']]);
 assert.equal(f.sent.length,0);assert.doesNotMatch(JSON.stringify(f.session.snapshot()),/Vellorin/);
 await f.session.dispose();assert.equal(messages.length,2);
});

test('an interrupted answer is marked interrupted and caption recording stays opt-in', async () => {
 const f=fixture();await f.start();const messages=[];
 f.session.config.nativeEvents.ConversationItemAdded='conversation';
 f.session.on('conversation',value=>messages.push(value.item));
 await f.session.receive({serverContent:{inputTranscription:{text:'Not retained.'},turnComplete:true}});
 assert.equal(messages.length,0);
 f.session.config.nativeOptions.createConversationItem=value=>value;
 await f.session.receive({serverContent:{outputTranscription:{text:'Partial answer'}}});
 await f.session.receive({serverContent:{interrupted:true}});
 assert.equal(messages.length,1);assert.equal(messages[0].interrupted,true);
 await f.session.dispose();
});
