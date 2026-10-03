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
