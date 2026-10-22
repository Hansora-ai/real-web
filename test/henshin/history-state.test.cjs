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
test('technical upload status messages do not replace the Processing card label',()=>{
 const element={classList:{toggle(){}}};context.$=()=>element;context.submission='requesting';
 const node=declarations.find(node=>node.id.name==='status');vm.runInContext(source.slice(node.start,node.end),context);
 vm.runInContext("status('Starting your transformation…')",context);
 assert.equal(context.submission,'requesting');assert.equal(element.textContent,'Starting your transformation…');
});
