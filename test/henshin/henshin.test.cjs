const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test';process.env.KIE_API_KEY='test';
const common=require('../../lib/henshin/common.cjs');
const url='https://example.supabase.co/storage/v1/object/public/generation-history/source.mp4';
const body={run_id:'fixture-run',resolution:'480p',source_video_duration:5.1,video_url:url,image_urls:[url.replace('.mp4','.png')],mode:'motion'};
test('All three resolutions round billing seconds upward and preserve decimal rates',()=>{for(const [resolution,expected]of [['480p',12],['720p',25.2],['1080p',54]])assert.equal(common.validate({...body,resolution}).cost,expected);});
test('Invalid resolution, duration, references and storage hosts are rejected',()=>{for(const patch of [{resolution:'780p'},{source_video_duration:NaN},{source_video_duration:3},{source_video_duration:31},{video_url:'http://127.0.0.1/video.mp4'},{image_urls:[]},{image_urls:Array(31).fill(url)},{mode:'bad'},{audio_url:'https://attacker.test/a.mp3'}])assert.throws(()=>common.validate({...body,...patch}));});
test('Prompt assigns images to identity and video to the camera and timing',()=>{const prompt=common.promptFor(body);assert.match(prompt,/Strictly keep these exactly as in @Video 1/);assert.match(prompt,/@Image 1/);assert.match(prompt,/Ignore the pose, camera angle/);assert.doesNotMatch(common.promptFor({...body,mode:'swap',audio_url:url}),/@Audio/);});
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
test('Template publication and final result writes require the authenticated owner',async()=>{const original=global.fetch;global.fetch=async()=>response({id:'user',email:'someone@example.com',email_confirmed_at:'today'});try{const templates=require('../../netlify/functions/henshin-templates');const res=await templates.handler({httpMethod:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({video_url:url,duration:5})});assert.equal(res.statusCode,403);const result=require('../../netlify/functions/henshin-result');global.fetch=async u=>String(u).includes('/auth/')?response({id:'user'}):response([]);assert.equal((await result.handler({httpMethod:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',result_url:url})})).statusCode,404);}finally{global.fetch=original;}});
test('Server ffprobe uses actual video duration',async()=>{const original=global.fetch;global.fetch=async()=>new Response(fs.readFileSync('test/henshin/fixtures/source.mp4'));try{const result=await require('../../lib/henshin/inspect.cjs').inspect(url);assert.ok(Math.abs(result.seconds-5)<.1);assert.equal(result.hasAudio,true);}finally{global.fetch=original;}});
function mockServices({credits=100,reject=false}={}){
 let record=null,submits=0,providerInput=null;const media=new Map();
 return {state:()=>({record,credits,submits,providerInput,media}),fetch:async(raw,options={})=>{
  const u=new URL(raw);
  if(u.pathname.includes('/storage/')){if(options.method==='POST'){media.set(String(raw).replace('/storage/v1/object/','/storage/v1/object/public/'),Buffer.from(options.body));return response({ok:true});}return new Response(media.get(String(raw))||fs.readFileSync('test/henshin/fixtures/source.mp4'));}
  const b=options.body?JSON.parse(options.body):null;
  if(u.pathname.includes('/auth/'))return response({id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
  if(u.pathname.endsWith('/profiles')){
   if(options.method==='PATCH'){if(Number(u.searchParams.get('credits').slice(3))!==credits)return response([]);credits=b.credits;}return response([{credits}]);
  }
  if(u.pathname.endsWith('/user_generations')){
   if(options.method==='POST'){record=b;return response([b]);}
   if(options.method==='PATCH'){record={...record,...b};return response([record]);}return response(record?[record]:[]);
  }
  if(u.pathname.endsWith('/createTask')){submits++;providerInput=b.input;return response(reject?{code:422,msg:'Provider rejected input'}:{code:200,data:{taskId:'fixture-task'}});}
  throw Error('Unexpected test request: '+u.pathname);
 }};
}
const event=patch=>({httpMethod:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({...body,...patch})});
test('Successful run charges verified duration, saves audio only for restoration and submits once',async()=>{
 const original=global.fetch,services=mockServices();global.fetch=services.fetch;
 try{const {handler}=require('../../netlify/functions/run-henshin');let result=await handler(event({audio_url:url}));assert.equal(result.statusCode,201);assert.equal(JSON.parse(result.body).debited,10);assert.equal(services.state().credits,90);assert.equal(services.state().providerInput.duration,-1);assert.equal(services.state().providerInput.generate_audio,false);assert.equal(Object.hasOwn(services.state().providerInput,'reference_audio_urls'),false);assert.deepEqual(services.state().record.meta.reference_audio_urls,[]);assert.doesNotMatch(services.state().providerInput.prompt,/@Audio/);assert.match(services.state().record.meta.source_audio_url,/source-audio.m4a$/);assert.match(services.state().providerInput.reference_video_urls[0],/silent-source.mp4$/);assert.equal(services.state().record.meta.refund_amount,10);result=await handler(event());assert.equal(result.statusCode,200);assert.equal(services.state().submits,1);assert.equal(services.state().credits,90);}finally{global.fetch=original;}
});
test('Built-in instructions go only to the provider; the saved row keeps just the user text',async()=>{
 for(const [patch,saved] of [[{mode:'swap',prompt:'',keep_audio:true,audio_url:url},'Henshin · Object swap'],[{mode:'edit',prompt:'Make the jacket red.',keep_audio:false,audio_url:url},'Make the jacket red.']]){
  const original=global.fetch,services=mockServices();global.fetch=services.fetch;
  try{const result=await require('../../netlify/functions/run-henshin').handler(event(patch));assert.equal(result.statusCode,201);
   const {record,providerInput,media:objects}=services.state();assert.match(providerInput.prompt,/camera angle, camera position, camera movement/);
   assert.equal(Object.hasOwn(providerInput,'reference_audio_urls'),false);assert.doesNotMatch(providerInput.prompt,/@Audio/);
   assert.equal(providerInput.generate_audio,!patch.keep_audio);assert.equal(!!record.meta.source_audio_url,patch.keep_audio);
   const media=require('../../lib/henshin/server-media.cjs');await media.withCore(async core=>{
    core.FS.writeFile('provider-video.mp4',objects.get(providerInput.reference_video_urls[0]));
    assert.deepEqual(media.probe(core,'provider-video.mp4').streams.map(s=>s.codec_type),['video']);
   });
   assert.equal(record.prompt,saved);assert.equal(record.meta.user_prompt,patch.prompt);assert.doesNotMatch(JSON.stringify(record),/camera angle, camera position/);
  }finally{global.fetch=original;}
 }
 assert.ok(!fs.existsSync('public/henshin-prompts.js'));
});
test('Insufficient balance never launches a provider task',async()=>{const original=global.fetch,services=mockServices({credits:1});global.fetch=services.fetch;try{const result=await require('../../netlify/functions/run-henshin').handler(event());assert.equal(result.statusCode,402);assert.equal(services.state().submits,0);assert.equal(services.state().credits,1);}finally{global.fetch=original;}});
test('Explicit provider rejection restores the debit and records a refund',async()=>{const original=global.fetch,services=mockServices({reject:true});global.fetch=services.fetch;try{await require('../../netlify/functions/run-henshin').handler(event());assert.equal(services.state().credits,100);assert.equal(services.state().record.meta.status,'failed');assert.equal(services.state().record.meta.refunded,true);}finally{global.fetch=original;}});
test('Ambiguous provider timeout retains the reserved charge for callback reconciliation',async()=>{const original=global.fetch,services=mockServices();global.fetch=(url,options)=>String(url).includes('createTask')?Promise.reject(Error('Timed out')):services.fetch(url,options);try{const result=await require('../../netlify/functions/run-henshin').handler(event());assert.equal(result.statusCode,202);assert.equal(JSON.parse(result.body).submission_uncertain,true);assert.equal(services.state().credits,90);assert.equal(services.state().record.meta.status,'pending');assert.equal(services.state().record.meta.submission_uncertain,true);}finally{global.fetch=original;}});
test('Templates preserve the complete recreation recipe and reject invalid modes/hosts',()=>{
 const {templateInput,templatePublic}=require('../../lib/henshin/templates.cjs');
 const input=templateInput({video_url:url,source_video_url:url,image_urls:body.image_urls,prompt:'Change the jacket',mode:'edit',resolution:'1080p',keep_audio:false});
 assert.equal(input.mode,'edit');assert.equal(input.keep_audio,false);
 const item=templatePublic({id:'template',prompt:'Wardrobe',result_url:url,meta:{...input,duration:5}});
 assert.equal(item.prompt,'Change the jacket');assert.deepEqual(item.image_urls,body.image_urls);assert.equal(item.source_video_url,url);
 for(const patch of [{mode:'unknown'},{source_video_url:'http://localhost/source.mp4'},{image_urls:[]},{poster_url:'https://attacker.test/image.jpg'}])assert.throws(()=>templateInput({video_url:url,image_urls:body.image_urls,...patch}));
});
test('Dedicated checker rejects another account and forged callbacks before provider reconciliation',async()=>{
 const original=global.fetch;const uid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';let dbReads=0;
 global.fetch=async u=>{if(String(u).includes('/auth/'))return response({id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'});dbReads++;return response([{id:uid,user_id:uid,meta:{source_feature:'henshin',run_id:'fixture-run',callback_token:'a'.repeat(48)}}]);};
 try{const {handler}=require('../../netlify/functions/henshin-check');const queryStringParameters={uid,run_id:'fixture-run'};
 assert.equal((await handler({httpMethod:'GET',headers:{authorization:'Bearer test'},queryStringParameters})).statusCode,403);assert.equal(dbReads,0);
 assert.equal((await handler({httpMethod:'POST',queryStringParameters:{...queryStringParameters,token:'forged'}})).statusCode,403);
 }finally{global.fetch=original;}
});
test('Dedicated checker keeps an intermediate video pending until server audio completion',async()=>{
 const original=global.fetch,uid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';global.fetch=async u=>String(u).includes('/auth/')?response({id:uid}):response([{id:uid,user_id:uid,result_url:url,meta:{source_feature:'henshin',run_id:'fixture-run',source_audio_url:url}}]);
 try{const result=await require('../../netlify/functions/henshin-check').handler({httpMethod:'GET',headers:{authorization:'Bearer test'},queryStringParameters:{uid,run_id:'fixture-run'}});assert.equal(result.statusCode,200);assert.equal(JSON.parse(result.body).status,'restoring_audio');assert.equal(JSON.parse(result.body).result_url,undefined);}finally{global.fetch=original;}
});
test('Signed callback recovers a timed-out task by polling the provider rather than trusting callback results',async()=>{
 const original=global.fetch,uid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',shared=require('../../netlify/functions/kie-check'),savedHandler=shared.handler;let row={id:uid,user_id:uid,meta:{source_feature:'henshin',run_id:'fixture-run',status:'pending',charged:true,callback_token:'a'.repeat(48)}},delegated;
 global.fetch=async(u,options={})=>{assert.ok(String(u).includes('/rest/'));if(options.method==='PATCH')row={...row,...JSON.parse(options.body)};return response([row]);};
 shared.handler=async e=>{delegated=e;return {body:JSON.stringify({ok:false,status:'pending'})};};
 try{const result=await require('../../netlify/functions/henshin-check').handler({httpMethod:'POST',queryStringParameters:{uid,run_id:'fixture-run',token:'a'.repeat(48)},body:JSON.stringify({data:{taskId:'callback-task'},result_url:'https://attacker.test/fake.mp4'})});assert.equal(result.statusCode,200);assert.equal(row.meta.task_id,'callback-task');assert.equal(row.meta.charged,true);assert.equal(delegated.httpMethod,'GET');assert.equal(delegated.queryStringParameters.taskId,'callback-task');assert.equal(JSON.parse(result.body).result_url,undefined);}finally{global.fetch=original;shared.handler=savedHandler;}
});
test('Henshin polls only the Market record endpoint and archives a successful result',async()=>{
 const original=global.fetch,uid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',providerCalls=[];
 let row={id:uid,user_id:uid,provider:'Hansora Henshin',kind:'video',result_url:null,meta:{source_feature:'henshin',run_id:'fixture-run',task_id:'fixture-task',status:'processing',video_url:url}};
 global.fetch=async(raw,options={})=>{const u=new URL(raw);
  if(u.pathname.includes('/auth/'))return response({id:uid});
  if(u.hostname==='api.kie.ai'){providerCalls.push(u.pathname);return response({code:200,data:{taskId:'fixture-task',state:'success',resultJson:JSON.stringify({resultUrls:['https://results.example/generated.mp4']})}});}
  if(u.hostname==='results.example')return new Response(fs.readFileSync('test/henshin/fixtures/source.mp4'),{headers:{'Content-Type':'video/mp4'}});
  if(u.pathname.includes('/storage/'))return response({ok:true});
  if(u.pathname.endsWith('/user_generations')){if(options.method==='PATCH')row={...row,...JSON.parse(options.body)};return response([row]);}
  if(u.pathname.endsWith('/nb_results'))return response([]);
  throw Error('Unexpected mock URL: '+u.pathname);
 };
 try{const res=await require('../../netlify/functions/henshin-check').handler({httpMethod:'GET',headers:{authorization:'Bearer test'},queryStringParameters:{uid,run_id:'fixture-run'}});assert.equal(JSON.parse(res.body).status,'done');assert.match(JSON.parse(res.body).result_url,/generation-history/);assert.deepEqual(providerCalls,['/api/v1/jobs/recordInfo']);assert.equal(row.meta.status,'done');}finally{global.fetch=original;}
});
test('A temporary Market HTTP error stays pending and never refunds or saves input URLs',async()=>{
 const original=global.fetch,uid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';let writes=0;
 const row={id:uid,user_id:uid,result_url:null,meta:{source_feature:'henshin',run_id:'fixture-run',task_id:'fixture-task',status:'processing',video_url:url,charged:true,refund_amount:10}};
 global.fetch=async(raw,options={})=>{if(options.method)writes++;if(String(raw).includes('/auth/'))return response({id:uid});if(String(raw).includes('api.kie.ai'))return new Response(JSON.stringify({code:429,msg:'Rate limited'}),{status:429});return response([row]);};
 try{const result=JSON.parse((await require('../../netlify/functions/henshin-check').handler({httpMethod:'GET',headers:{authorization:'Bearer test'},queryStringParameters:{uid,run_id:'fixture-run'}})).body);assert.equal(result.status,'pending');assert.equal(result.failed,undefined);assert.equal(writes,0);}finally{global.fetch=original;}
});
test('Provider timeout does not overwrite a result already saved by the callback',async()=>{
 const original=global.fetch,services=mockServices();global.fetch=(raw,options)=>{if(String(raw).includes('createTask')){const record=services.state().record;record.meta={...record.meta,task_id:'callback-task',status:'done'};record.result_url='https://results.example/generated.mp4';return Promise.reject(Error('Timed out'));}return services.fetch(raw,options);};
 try{const result=await require('../../netlify/functions/run-henshin').handler(event());assert.equal(result.statusCode,202);assert.equal(JSON.parse(result.body).taskId,'callback-task');assert.equal(services.state().record.meta.status,'done');assert.equal(services.state().credits,90);}finally{global.fetch=original;}
});

test('Every mode keeps its detailed built-in instructions; the user text is only added as an extra request',()=>{
 const prompts=require('../../lib/henshin/prompts.cjs'),{templateInput}=require('../../lib/henshin/templates.cjs');
 const firsts={motion:/Replace the main character or characters in @Video 1/,swap:/Replace the main object or objects in @Video 1/,edit:/Edit the main subject or subjects in @Video 1/};
 for(const mode of ['motion','swap','edit'])for(const prompt of ['', '   ',...prompts.legacy]){
  const text=common.promptFor({...body,mode,prompt});assert.match(text,firsts[mode]);assert.match(text,/camera angle, camera position, camera movement/);assert.match(text,/No flicker, morphing or identity drift/);assert.doesNotMatch(text,/User's prompt/);
  assert.equal(templateInput({video_url:url,image_urls:body.image_urls,mode,prompt}).transformation_prompt,'');
 }
 const custom='Make the jacket red.',text=common.promptFor({...body,mode:'swap',prompt:custom});
 assert.match(text,/Replace the main object or objects in @Video 1/);assert.match(text,/the user's prompt wins\.\nUser's prompt: Make the jacket red\.$/);
});
test('Source preparation uploads a silent video and saves the original soundtrack on the server',async()=>{
 const original=global.fetch,services=mockServices();global.fetch=services.fetch;
 try{
  const media=require('../../lib/henshin/server-media.cjs');
  const prepared=await media.prepareSource(url,{uid:'fixture',id:'fixture',keepAudio:true});
  assert.equal(prepared.seconds,5);assert.ok(prepared.audioURL);assert.equal(Object.hasOwn(prepared,'timingAudioURL'),false);assert.equal(services.state().media.size,2);
  await media.withCore(async core=>{
   core.FS.writeFile('silent.mp4',services.state().media.get(prepared.videoURL));
   assert.deepEqual(media.probe(core,'silent.mp4').streams.map(s=>s.codec_type),['video']);
   core.FS.writeFile('audio.m4a',services.state().media.get(prepared.audioURL));
   assert.deepEqual(media.probe(core,'audio.m4a').streams.map(s=>s.codec_type),['audio']);
  });
 }finally{global.fetch=original;}
});
function finishServices({status='processing',duration=5,downloadFailure=false}={}){
 const uid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
 const bytes=fs.readFileSync('test/henshin/fixtures/source.mp4'),objects=new Map([[url,bytes]]),jobs=[];
 let row={id:uid,user_id:uid,provider:'Hansora Henshin',kind:'video',result_url:null,meta:{source_feature:'henshin',run_id:'fixture-run',task_id:'fixture-task',status,source_audio_url:url,source_video_duration:duration,charged:true,callback_token:'a'.repeat(48)}};
 if(status==='restoring_audio'){row.meta.generated_video_url=url;}
 return {get row(){return row;},set row(value){row=value;},objects,jobs,fetch:async(raw,options={})=>{
  const u=new URL(raw);
  if(u.pathname.includes('/auth/'))return response({id:uid});
  if(u.pathname.includes('henshin-finish-background')){assert.equal(options.headers['x-henshin-internal'],require('../../lib/henshin/jobs.cjs').internalToken());jobs.push(JSON.parse(options.body));return new Response(null,{status:202});}
  if(u.hostname==='api.kie.ai')return response({code:200,data:{taskId:'fixture-task',state:'success',resultJson:JSON.stringify({resultUrls:['https://results.example/generated.mp4']})}});
  if(u.hostname==='results.example')return new Response(bytes,{headers:{'Content-Type':'video/mp4'}});
  if(u.pathname.includes('/storage/')){
   if(options.method==='POST'){objects.set(String(raw).replace('/storage/v1/object/','/storage/v1/object/public/'),Buffer.from(options.body));return response({ok:true});}
   if(downloadFailure)throw Error('Temporary storage outage');
   return new Response(objects.get(String(raw))||bytes);
  }
  if(u.pathname.endsWith('/user_generations')){
   if(options.method==='PATCH'){
    const lease=u.searchParams.get('meta->>audio_lease');
    if(lease&&(lease==='is.null'?!!row.meta.audio_lease:lease!=='eq.'+row.meta.audio_lease))return response([]);
    const expected=u.searchParams.get('meta->>status');
    if(expected?.startsWith('eq.')&&expected.slice(3)!==row.meta.status)return response([]);
    if(expected==='in.(processing,pending)'&&!['processing','pending'].includes(row.meta.status))return response([]);
    if(u.searchParams.has('or')&&row.meta.audio_restored)return response([]);
    row={...row,...JSON.parse(options.body)};
   }
   return response([row]);
  }
  if(u.pathname.endsWith('/nb_results'))return response([]);
  throw Error('Unexpected finish mock request: '+u.pathname);
 }};
}
const backgroundEvent=id=>({httpMethod:'POST',headers:{'x-henshin-internal':require('../../lib/henshin/jobs.cjs').internalToken()},body:JSON.stringify({id})});
test('A signed callback and server worker finish a video with audio without any browser call',async()=>{
 const original=global.fetch,services=finishServices();global.fetch=services.fetch;
 try{
  const check=require('../../netlify/functions/henshin-check');
  const callback=await check.handler({httpMethod:'POST',queryStringParameters:{uid:services.row.user_id,run_id:'fixture-run',token:'a'.repeat(48)},body:'{}'});
  assert.equal(JSON.parse(callback.body).status,'restoring_audio');assert.equal(JSON.parse(callback.body).result_url,undefined);assert.equal(services.row.result_url,null);assert.equal(services.jobs.length,1);
  const worker=require('../../netlify/functions/henshin-finish-background');
  const result=await worker.handler(backgroundEvent(services.row.id));assert.equal(JSON.parse(result.body).ok,true);
  assert.equal(services.row.meta.audio_restored,true);assert.equal(services.row.meta.status,'done');assert.match(services.row.result_url,/henshin-final.mp4$/);assert.equal(services.row.meta.charged,true);
  const media=require('../../lib/henshin/server-media.cjs');await media.withCore(async core=>{
   core.FS.writeFile('finished',services.objects.get(services.row.result_url));const data=media.probe(core,'finished');assert.equal(Number(data.format.duration),5);assert.deepEqual(data.streams.map(s=>s.codec_type),['video','audio']);
  });
  const finalURL=services.row.result_url;await worker.handler(backgroundEvent(services.row.id));assert.equal(services.row.result_url,finalURL);assert.equal(services.row.meta.audio_attempts,1);
 }finally{global.fetch=original;}
});
test('Concurrent server finishers claim the soundtrack only once',async()=>{
 const original=global.fetch,services=finishServices({status:'restoring_audio'});global.fetch=services.fetch;
 try{const worker=require('../../netlify/functions/henshin-finish-background');await Promise.all([worker.handler(backgroundEvent(services.row.id)),worker.handler(backgroundEvent(services.row.id))]);assert.equal(services.row.meta.audio_attempts,1);assert.equal(services.row.meta.audio_restored,true);}finally{global.fetch=original;}
});
test('Duration mismatch stays an explicit audio failure and never publishes a mismatched final video',async()=>{
 const original=global.fetch,services=finishServices({status:'restoring_audio',duration:7});global.fetch=services.fetch;
 try{await require('../../netlify/functions/henshin-finish-background').handler(backgroundEvent(services.row.id));assert.equal(services.row.meta.status,'audio_failed');assert.equal(services.row.result_url,null);assert.equal(services.row.meta.audio_restored,undefined);assert.match(services.row.meta.audio_error,/duration differs/);assert.equal(services.row.meta.refunded,undefined);}finally{global.fetch=original;}
});
test('Transient finishing errors persist a retry job rather than relying on the user page',async()=>{
 const original=global.fetch,services=finishServices({status:'restoring_audio',downloadFailure:true});global.fetch=services.fetch;
 try{await require('../../netlify/functions/henshin-finish-background').handler(backgroundEvent(services.row.id));assert.equal(services.row.meta.status,'audio_retry');assert.equal(services.row.meta.audio_lease_until,0);assert.ok(Date.parse(services.row.meta.audio_retry_at)>Date.now());assert.equal(services.row.result_url,null);}finally{global.fetch=original;}
});
test('Finishing endpoint rejects visitor tokens before reading generation rows',async()=>{
 const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('Unexpected read');};
 try{const res=await require('../../netlify/functions/henshin-finish-background').handler({...backgroundEvent('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),headers:{authorization:'Bearer visitor'}});assert.equal(res.statusCode,401);assert.equal(calls,0);}finally{global.fetch=original;}
});
test('Visitor retry requests cannot supply their own finished video URL',async()=>{
 const original=global.fetch,services=finishServices({status:'restoring_audio'});global.fetch=services.fetch;
 try{const res=await require('../../netlify/functions/henshin-result').handler({httpMethod:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({id:services.row.id,result_url:'https://attacker.test/fake.mp4'})});assert.equal(res.statusCode,202);assert.equal(services.row.result_url,null);assert.equal(services.row.meta.audio_restored,undefined);assert.equal(services.jobs.length,1);}finally{global.fetch=original;}
});
test('Scheduled recovery polls and finishes missed callbacks without browser polling',async()=>{
 const original=global.fetch,services=finishServices();global.fetch=services.fetch;
 try{const sweep=await import('../../netlify/functions/henshin-sweep.mjs');const res=await sweep.default(new Request('https://hansora.co/scheduled',{method:'POST',body:JSON.stringify({next_run:new Date().toISOString()})}));assert.equal((await res.json()).dispatched,1);assert.equal(services.jobs.length,1);await require('../../netlify/functions/henshin-finish-background').handler(backgroundEvent(services.jobs[0].id));assert.equal(services.row.meta.audio_restored,true);assert.match(services.row.result_url,/henshin-final.mp4$/);}finally{global.fetch=original;}
});

test('Library deletion rejects visitors, unconfirmed owners and non-template rows',async()=>{
 const original=global.fetch,handler=require('../../netlify/functions/henshin-templates').handler,id='aaaaaaaa-1111-2222-3333-aaaaaaaaaaaa';let reads=0;
 try{
  for(const user of [{id:'owner',email:'visitor@example.com',email_confirmed_at:'today'},{id:'owner',email:common.OWNER}]){
   global.fetch=async raw=>{if(String(raw).includes('/auth/'))return response(user);reads++;throw Error('Unauthorized database access');};
   const result=await handler({httpMethod:'DELETE',headers:{authorization:'Bearer test'},body:JSON.stringify({id})});assert.equal(result.statusCode,403);
  }
  assert.equal(reads,0);
  global.fetch=async raw=>String(raw).includes('/auth/')?response({id:'owner',email:common.OWNER,email_confirmed_at:'today'}):response([]);
  assert.equal((await handler({httpMethod:'DELETE',headers:{authorization:'Bearer test'},body:JSON.stringify({id})})).statusCode,404);
  assert.equal((await handler({httpMethod:'DELETE',headers:{authorization:'Bearer test'},body:'{"id":"malformed"}'})).statusCode,400);
  assert.equal((await handler({httpMethod:'DELETE',headers:{},body:JSON.stringify({id})})).statusCode,401);
 }finally{global.fetch=original;}
});
test('Confirmed owner deletion removes the requested template files and database row',async()=>{
 const original=global.fetch,id='aaaaaaaa-1111-2222-3333-aaaaaaaaaaaa',meta={source_feature:'henshin-template',published:true,source_video_url:url,reference_image_urls:body.image_urls,transformation_prompt:'Change the jacket',mode:'swap',resolution:'1080p'};let saved,deleted=false,files;
 global.fetch=async(raw,options={})=>{
  const u=new URL(raw);if(u.pathname.includes('/auth/'))return response({id:'owner',email:common.OWNER,email_confirmed_at:'today'});
  if(u.pathname.includes('/storage/')){assert.equal(options.method,'DELETE');files=JSON.parse(options.body).prefixes;return response([]);}
  assert.equal(u.searchParams.get('id'),'eq.'+id);assert.equal(u.searchParams.get('user_id'),'eq.owner');assert.equal(u.searchParams.get('provider'),'eq.Henshin Template');assert.equal(u.searchParams.get('meta->>source_feature'),'eq.henshin-template');
  if(options.method==='PATCH'){saved=JSON.parse(options.body);return response([{id,meta:saved.meta}]);}
  if(options.method==='DELETE'){deleted=true;return response([{id}]);}
  return response([{id,meta}]);
 };
 try{const result=await require('../../netlify/functions/henshin-templates').handler({httpMethod:'DELETE',headers:{authorization:'Bearer test'},body:JSON.stringify({id})});assert.equal(result.statusCode,200);assert.equal(saved.meta.published,false);assert.equal(saved.meta.deleting,true);assert.deepEqual(files,['source.mp4','source.png']);assert.equal(deleted,true);}finally{global.fetch=original;}
});

test('The public library lists only published templates and does not retain deleted entries in shared caches',async()=>{
 const original=global.fetch;global.fetch=async raw=>{const u=new URL(raw);assert.equal(u.searchParams.get('provider'),'eq.Henshin Template');assert.equal(u.searchParams.get('meta->>published'),'eq.true');return response([{id:'template',prompt:'Example',result_url:url,meta:{poster_url:body.image_urls[0],aspect_ratio:9/16,source_video_url:url,reference_image_urls:body.image_urls}}]);};
 try{const result=await require('../../netlify/functions/henshin-templates').handler({httpMethod:'GET',headers:{}});assert.equal(result.statusCode,200);assert.equal(result.headers['Cache-Control'],'no-store');const item=JSON.parse(result.body).templates[0];assert.equal(item.poster_url,body.image_urls[0]);assert.equal(item.aspect_ratio,9/16);}finally{global.fetch=original;}
});


test('Video edit accepts no images without inventing an image reference, including templates and provider submission',async()=>{
 const original=global.fetch,services=mockServices();global.fetch=services.fetch;
 try{
  const input={...body,mode:'edit',image_urls:[],prompt:'Make the background blue.',keep_audio:true};
  assert.equal(common.validate(input).cost,12);assert.doesNotMatch(common.promptFor(input),/@Image|@Audio/);assert.match(common.promptFor(input),/Make the background blue/);
  for(const mode of ['motion','swap'])assert.throws(()=>common.validate({...input,mode}),/1–30/);
  const {templateInput}=require('../../lib/henshin/templates.cjs');assert.deepEqual(templateInput(input).reference_image_urls,[]);
  const response=await require('../../netlify/functions/run-henshin').handler(event(input));assert.equal(response.statusCode,201);
  assert.deepEqual(services.state().providerInput.reference_image_urls,[]);assert.doesNotMatch(services.state().providerInput.prompt,/@Image|@Audio/);assert.ok(services.state().record.meta.source_audio_url);
 }finally{global.fetch=original;}
});
test('Library pages return 24 recipes and an explicit next offset, with a separate playback preview',async()=>{
 const original=global.fetch;let observed;
 const rows=Array.from({length:25},(_,i)=>({id:String(i),prompt:'Example',result_url:url,meta:{preview_url:url,source_video_url:url,reference_image_urls:[]}}));
 global.fetch=async raw=>{observed=new URL(raw);return response(rows);};
 try{
  const handler=require('../../netlify/functions/henshin-templates').handler;
  const page=JSON.parse((await handler({httpMethod:'GET',queryStringParameters:{offset:'24'}})).body);
  assert.equal(observed.searchParams.get('offset'),'24');assert.equal(observed.searchParams.get('limit'),'25');assert.equal(page.templates.length,24);assert.equal(page.next_offset,48);assert.equal(page.templates[0].preview_url,url);
  global.fetch=async()=>response(rows.slice(0,2));assert.equal(JSON.parse((await handler({httpMethod:'GET'})).body).next_offset,null);
  assert.equal((await handler({httpMethod:'GET',queryStringParameters:{offset:'-1'}})).statusCode,400);
  assert.throws(()=>require('../../lib/henshin/templates.cjs').templateInput({...body,preview_url:'https://attacker.test/preview.mp4'}));
 }finally{global.fetch=original;}
});
