const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {parse}=require('acorn'),source=fs.readFileSync('public/henshin.js','utf8');
const declarations=parse(source,{ecmaVersion:'latest'}).body[0].expression.callee.body.body.filter(node=>node.type==='FunctionDeclaration');
const context=vm.createContext({t:value=>value});
for(const name of ['isHenshin','resultState']){const node=declarations.find(node=>node.id.name===name);vm.runInContext(source.slice(node.start,node.end),context);}
const row=(meta={},result_url=null)=>({result_url,meta:{source_feature:'henshin',henshin_model:'lite',source:'kie-kling4',...meta}});
const state=value=>{context.row=value;return vm.runInContext('resultState(row)',context);};
test('Processing switches to Generating only after a task is accepted',()=>{
 assert.equal(state(row({status:'pending'})).label,'Processing request…');
 assert.equal(state(row({status:'pending',task_id:'accepted'})).label,'Generating');
 assert.equal(state(row({status:'queued',task_id:'accepted'})).label,'In Queue');
});
test('a successful Lite video hidden by a finishing failure is Ready and has no audio retry',()=>{
 for(const status of ['audio_failed','audio_retry','restoring_audio']){
  const result=state(row({status,task_id:'accepted',finish_video:true,generated_video_url:'/finished.mp4'}));
  assert.equal(result.ready,true);assert.equal(result.failed,false);assert.equal(result.audioFailed,false);assert.equal(result.videoURL,'/finished.mp4');
 }
});
test('real failures and refunds cannot become successful because a URL exists in metadata',()=>{
 for(const meta of [{status:'failed'},{status:'audio_failed',refunded:true}]){
  const result=state(row({...meta,generated_video_url:'/finished.mp4'}));assert.equal(result.ready,false);assert.equal(result.failed,true);
 }
 assert.equal(state(row({henshin_model:'standard',status:'audio_failed',generated_video_url:'/finished.mp4'})).audioFailed,true);
});
test('new Lite jobs wait for original soundtrack restoration instead of exposing the raw model result',()=>{
 const pending=state(row({audio_strategy:'original',status:'restoring_audio',finish_video:true,generated_video_url:'/raw.mp4'}));
 assert.equal(pending.ready,false);assert.equal(pending.failed,false);assert.equal(pending.audioPending,true);
 const done=state(row({audio_strategy:'original',status:'done',finish_video:true,audio_restored:true},'/final.mp4'));
 assert.equal(done.ready,true);assert.equal(done.videoURL,'/final.mp4');
});
test('original-audio jobs show Generating until the provider returns a video to finish',()=>{
 for(const henshin_model of ['lite','standard']){
  const result=state(row({henshin_model,audio_strategy:'original',status:'processing',task_id:'accepted',finish_video:true,source_audio_url:'/original.m4a'}));
  assert.equal(result.label,'Generating');assert.equal(result.audioPending,false);assert.equal(result.ready,false);
 }
});
test('technical upload status messages do not replace the Processing card label',()=>{
 const element={classList:{toggle(){}}};context.$=()=>element;context.submission='requesting';
 const node=declarations.find(node=>node.id.name==='status');vm.runInContext(source.slice(node.start,node.end),context);
 vm.runInContext("status('Starting your transformation…')",context);
 assert.equal(context.submission,'requesting');assert.equal(element.textContent,'Starting your transformation…');
});
function timings({reject=false,consent='accepted'}={}){
 let now=0;const events=[],timers=new Map(),listeners=new Map();
 const c=vm.createContext({performance:{now:()=>now},config:{url:'https://example.test',key:'public'},location:{pathname:'/henshin.html'},matchMedia:()=>({matches:false}),localStorage:{getItem:()=>consent},setTimeout:(fn,ms)=>{timers.set(ms,fn);return ms;},clearTimeout:id=>timers.delete(id),window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},fetch:(_url,options)=>{events.push(JSON.parse(options.body));return reject?Promise.reject(Error('offline')):Promise.resolve({ok:true});}});
 const node=declarations.find(node=>node.id.name==='submissionTiming');vm.runInContext(source.slice(node.start,node.end),c);
 const tracker=vm.runInContext("submissionTiming({user:{id:'owner'},access_token:'private-token'},'run-123','lite',14000000)",c);
 return {tracker,events,timers,listeners,at:value=>{now=value;},details:()=>events.map(e=>JSON.parse(e.element_label))};
}
test('submission timing distinguishes preparation, upload, acceptance and long waits',()=>{
 const s=timings();s.at(1200);s.tracker.next('uploading',{prepared_bytes:13000000});
 s.at(60000);s.timers.get(60000)();s.at(180000);s.timers.get(180000)();
 s.at(181000);s.tracker.next('submitting');s.at(182000);s.tracker.finish('accepted',{row_id:'generation'});
 const details=s.details();assert.equal(details[1].phase,'preparing');assert.equal(details[1].phase_ms,1200);
 assert.deepEqual(details.filter(e=>e.outcome==='slow').map(e=>[e.threshold_ms,e.phase]),[[60000,'uploading'],[180000,'uploading']]);
 assert.equal(details.at(-1).elapsed_ms,182000);assert.equal(details.at(-1).phase_ms,1000);assert.equal(details.at(-1).outcome,'accepted');
 assert.ok(s.events.every(e=>e.event_name==='click'&&e.element_type==='henshin_submission'&&e.element_id==='run-123'));
 assert.doesNotMatch(JSON.stringify(s.events),/private-token/);assert.equal(s.timers.size,0);assert.equal(s.listeners.size,0);
 s.tracker.finish('failed');assert.equal(s.events.length,6);
});
test('leaving or failing before submission is recorded; telemetry errors never block generation',async()=>{
 const s=timings({reject:true});s.at(5000);assert.doesNotThrow(()=>s.listeners.get('pagehide')());s.tracker.finish('failed');
 assert.deepEqual(s.details().map(e=>e.outcome),['started','page_left','failed']);assert.equal(s.timers.size,0);
 const optedOut=timings({consent:'rejected'});optedOut.tracker.finish('accepted');assert.equal(optedOut.events.length,0);
 await Promise.resolve();
});
