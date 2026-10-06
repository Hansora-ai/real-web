const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test';process.env.KIE_API_KEY='test';
const common=require('../../lib/henshin/common.cjs');
const url='https://example.supabase.co/storage/v1/object/public/generation-history/source.mp4';
const body={run_id:'fixture-run',resolution:'480p',source_video_duration:5.1,video_url:url,image_urls:[url.replace('.mp4','.png')],mode:'motion'};
test('All three resolutions round billing seconds upward and preserve decimal rates',()=>{for(const [resolution,expected]of [['480p',12],['720p',25.2],['1080p',54]])assert.equal(common.validate({...body,resolution}).cost,expected);});
test('Invalid resolution, duration, references and storage hosts are rejected',()=>{for(const patch of [{resolution:'780p'},{source_video_duration:NaN},{source_video_duration:3},{source_video_duration:31},{video_url:'http://127.0.0.1/video.mp4'},{image_urls:[]},{image_urls:Array(31).fill(url)},{mode:'bad'},{audio_url:'https://attacker.test/a.mp3'}])assert.throws(()=>common.validate({...body,...patch}));});
test('Prompt assigns images to identity and video to the camera and timing',()=>{const prompt=common.promptFor(body);assert.match(prompt,/@Video 1 as the sole master/);assert.match(prompt,/@Image 1/);assert.match(prompt,/never their camera angle/);assert.match(common.promptFor({...body,mode:'swap',audio_url:url}),/Use @Audio 1 only/);});
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
test('Template publication and final result writes require the authenticated owner',async()=>{const original=global.fetch;global.fetch=async()=>response({id:'user',email:'someone@example.com',email_confirmed_at:'today'});try{const templates=require('../../netlify/functions/henshin-templates');const res=await templates.handler({httpMethod:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({video_url:url,duration:5})});assert.equal(res.statusCode,403);const result=require('../../netlify/functions/henshin-result');global.fetch=async u=>String(u).includes('/auth/')?response({id:'user'}):response([]);assert.equal((await result.handler({httpMethod:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',result_url:url})})).statusCode,404);}finally{global.fetch=original;}});
test('Server ffprobe uses actual video duration',async()=>{const original=global.fetch;global.fetch=async()=>new Response(fs.readFileSync('test/henshin/fixtures/source.mp4'));try{const result=await require('../../lib/henshin/inspect.cjs').inspect(url);assert.ok(Math.abs(result.seconds-5)<.1);assert.equal(result.hasAudio,true);}finally{global.fetch=original;}});
function mockServices({credits=100,reject=false}={}){
 let record=null,submits=0,providerInput=null;
 return {state:()=>({record,credits,submits,providerInput}),fetch:async(raw,options={})=>{
  const u=new URL(raw),b=options.body?JSON.parse(options.body):null;
  if(u.pathname.includes('/storage/'))return new Response(fs.readFileSync('test/henshin/fixtures/source.mp4'));
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
test('Successful run charges verified duration, preserves audio references and submits once',async()=>{
 const original=global.fetch,services=mockServices();global.fetch=services.fetch;
 try{const {handler}=require('../../netlify/functions/run-henshin');let result=await handler(event({audio_url:url}));assert.equal(result.statusCode,201);assert.equal(JSON.parse(result.body).debited,10);assert.equal(services.state().credits,90);assert.equal(services.state().providerInput.duration,-1);assert.equal(services.state().providerInput.generate_audio,false);assert.deepEqual(services.state().providerInput.reference_audio_urls,[url]);assert.equal(services.state().record.meta.refund_amount,10);result=await handler(event());assert.equal(result.statusCode,200);assert.equal(services.state().submits,1);assert.equal(services.state().credits,90);}finally{global.fetch=original;}
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
 for(const patch of [{mode:'unknown'},{source_video_url:'http://localhost/source.mp4'},{image_urls:[]},{mode:'swap',prompt:''}])assert.throws(()=>templateInput({video_url:url,image_urls:body.image_urls,...patch}));
});
test('Dedicated checker rejects another account and forged callbacks before provider reconciliation',async()=>{
 const original=global.fetch;const uid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';let dbReads=0;
 global.fetch=async u=>{if(String(u).includes('/auth/'))return response({id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'});dbReads++;return response([{id:uid,user_id:uid,meta:{source_feature:'henshin',run_id:'fixture-run',callback_token:'a'.repeat(48)}}]);};
 try{const {handler}=require('../../netlify/functions/henshin-check');const queryStringParameters={uid,run_id:'fixture-run'};
 assert.equal((await handler({httpMethod:'GET',headers:{authorization:'Bearer test'},queryStringParameters})).statusCode,403);assert.equal(dbReads,0);
 assert.equal((await handler({httpMethod:'POST',queryStringParameters:{...queryStringParameters,token:'forged'}})).statusCode,403);
 }finally{global.fetch=original;}
});
test('Dedicated checker returns a saved result without launching another task or losing audio state',async()=>{
 const original=global.fetch,uid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';global.fetch=async u=>String(u).includes('/auth/')?response({id:uid}):response([{id:uid,user_id:uid,result_url:url,meta:{source_feature:'henshin',run_id:'fixture-run',source_audio_url:url}}]);
 try{const result=await require('../../netlify/functions/henshin-check').handler({httpMethod:'GET',headers:{authorization:'Bearer test'},queryStringParameters:{uid,run_id:'fixture-run'}});assert.equal(result.statusCode,200);assert.equal(JSON.parse(result.body).status,'restoring_audio');assert.equal(JSON.parse(result.body).result_url,url);}finally{global.fetch=original;}
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
