import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const controller=await readFile(new URL('../../public/automation-voice-test.js',import.meta.url),'utf8');
const source=await readFile(new URL('../../public/automation-phone.js',import.meta.url),'utf8');

async function page(inline = false) {
  const nodes=new Map(), rooms=[], timers=new Map(), requests=[];
  let timerId=0;
  function element(selector) {
    if (!nodes.has(selector)) {
      const classes=new Set();
      nodes.set(selector,{hidden:false,value:'',checked:true,textContent:'',innerHTML:'',dataset:{},style:{setProperty(){}},listeners:{},
        classList:{add(...values){values.forEach(value=>classes.add(value));},remove(...values){values.forEach(value=>classes.delete(value));},toggle(value,on){on?classes.add(value):classes.delete(value);},contains:value=>classes.has(value)},
        addEventListener(name,fn){this.listeners[name]=fn;},remove(){},scrollHeight:0});
    }
    return nodes.get(selector);
  }
  element('input[name="number-mode"]:checked').value='new';
  element('input[name="answer-mode"]:checked').value='always';
  const steps=[1,2,3,4].map(n=>{const node=element(`step-${n}`);node.dataset.phoneStep=String(n);return node;});
  const tabs=[1,2,3,4].map(n=>{const node=element(`tab-${n}`);node.dataset.step=String(n);return node;});
  class Room {
    constructor(){this.events={};this.canPlaybackAudio=true;this.microphone=[];this.localParticipant={setMicrophoneEnabled:async value=>this.microphone.push(value)};rooms.push(this);}
    on(name,fn){this.events[name]=fn;}
    async connect(){}
    async startAudio(){}
    async disconnect(){this.events.disconnected?.();}
  }
  const api={isLocalPreview:false,requireUser:async()=>({id:'new-user'}),
    db:{from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null}),update(){throw Error('A test must not save number setup');}})},
    authenticatedFetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return{ok:true,json:async()=>({url:'wss://voice.test',token:'test-token',max_seconds:300})};},displayError:error=>error.message};
  const sandbox={window:{addEventListener(){},HansoraAutomation:api,HansoraUI:{toast(){}},LivekitClient:{Room,Track:{Kind:{Audio:'audio'}},RoomEvent:{TrackSubscribed:'track',ParticipantAttributesChanged:'attributes',TrackUnsubscribed:'untrack',TranscriptionReceived:'transcript',Disconnected:'disconnected',MediaDevicesError:'devices',AudioPlaybackStatusChanged:'playback'}}},
    document:{querySelector:element,querySelectorAll:selector=>selector==='.phone-step'?steps:selector==='.ui-stepper li'?tabs:[],body:{appendChild(){}}},
    location:{pathname:'/automation-phone.html',search:'?business=123e4567-e89b-42d3-a456-426614174000&test=1',protocol:'https:'},URLSearchParams,Date,console,
    setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),setInterval:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearInterval:id=>timers.delete(id)};
  vm.runInNewContext(controller,sandbox);
  if (inline) sandbox.window.HansoraVoiceTest.mount({api,businessId:'123e4567-e89b-42d3-a456-426614174000',elements:{root:element('#voice-talk'),button:element('#test-call'),orb:element('#call-orb'),status:element('#call-status'),timer:element('#call-timer'),error:element('#phone-error'),audio:element('#enable-call-audio')}});
  else await vm.runInNewContext(source,sandbox);
  return{element,steps,rooms,timers,requests,click:()=>element('#test-call').listeners.click({currentTarget:element('#test-call')})};
}

test('real page opens directly in Test for a new business with no phone row, and waits for the AI',async()=>{
  const p=await page();
  assert.equal(p.steps[3].hidden,false);
  assert.ok(p.steps.slice(0,3).every(step=>step.hidden));
  await p.click();
  assert.equal(p.requests.length,1);
  assert.equal(p.element('#call-status').textContent,'Waiting for your AI employee…');
  assert.equal(p.element('#call-orb').classList.contains('live'),false);
  const room=p.rooms[0];
  room.events.attributes({'lk.agent.state':'listening'});
  assert.equal(p.element('#call-status').textContent,'Connected · speak naturally');
  assert.ok([...p.timers.values()].some(timer=>timer.ms===300000));
  await p.click();
  assert.equal(room.microphone.at(-1),false);
  assert.equal(p.timers.size,0);
  assert.match(p.element('#call-timer').textContent,/not billed/);
});

test('missing worker ends the test, releases the microphone, and allows a clean retry',async()=>{
  const p=await page();await p.click();
  const timeout=[...p.timers.values()].find(timer=>timer.ms===20000);
  assert.ok(timeout);await timeout.fn();
  assert.equal(p.rooms[0].microphone.at(-1),false);
  assert.equal(p.element('#call-status').textContent,'Test call unavailable');
  assert.match(p.element('#phone-error').textContent,/could not join/);
  await p.click();
  assert.equal(p.rooms.length,2);
  assert.equal(p.element('#call-status').textContent,'Waiting for your AI employee…');
  await p.click();
});


test('workspace call widget uses the existing employee directly and hangs up without page navigation',async()=>{
  const p=await page(true);await p.click();
  assert.equal(p.requests[0].body.business_id,'123e4567-e89b-42d3-a456-426614174000');
  assert.equal(p.requests[0].body.settings,undefined);
  assert.equal(p.element('#test-call').textContent,'Hang up');
  p.rooms[0].events.attributes({'lk.agent.state':'speaking'});
  assert.equal(p.element('#voice-talk').dataset.callState,'speaking');
  await p.click();
  assert.equal(p.element('#test-call').textContent,'Call');
  assert.equal(p.element('#voice-talk').dataset.callState,'idle');
  assert.equal(p.rooms[0].microphone.at(-1),false);
});
