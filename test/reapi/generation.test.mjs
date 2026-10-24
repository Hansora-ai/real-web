import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
const require=createRequire(import.meta.url);
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-service';
process.env.REAPI_API_KEY='test-reapi';
const pricing=require('../../public/seedance-pricing.js');
const {build}=require('../../lib/reapi/request.cjs');
const launch25=require('../../netlify/functions/run-seedance-25.js').handler;
const launch20=require('../../netlify/functions/run-seedance-2.js').handler;
const launchWan=require('../../netlify/functions/run-wan-3.js').handler;
const wanPricing=require('../../public/wan-pricing.js');
const buildWan=require('../../lib/reapi/wan-request.cjs').build;
const checker=require('../../netlify/functions/reapi-check.js').handler;
const finalize=require('../../netlify/functions/run-seedance-25-final.js').handler;
const {transition}=require('../../lib/reapi/billing.cjs');
const db=new PGlite(),uid=randomUUID(),other=randomUUID();
const source='https://example.supabase.co/storage/v1/object/public/generation-history/source.mp4';
const fixture=await readFile(new URL('../henshin/fixtures/source.mp4',import.meta.url));
const originalFetch=globalThis.fetch;
let posts=[],tasks=new Map(),reject=false,uncertain=false,providerStatus=200,failArchive=false;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const event=(patch={},run=randomUUID())=>({httpMethod:'POST',headers:{authorization:'Bearer customer'},body:JSON.stringify({uid,run_id:run,prompt:'A cinematic kitten in warm light.',resolution:'480p',duration:10,...patch})});
async function balance(){return Number((await db.query('select credits from profiles where user_id=$1',[uid])).rows[0].credits);}
async function saved(){return (await db.query('select * from user_generations order by created_at desc')).rows;}
function polling(row,patch={}){return {httpMethod:'GET',headers:{authorization:'Bearer customer'},queryStringParameters:{uid,run_id:row.meta.run_id},...patch};}
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table profiles(user_id uuid primary key,credits numeric(12,1));
 create table user_generations(id uuid primary key,user_id uuid,provider text,kind text,prompt text,result_url text,meta jsonb,created_at timestamptz default now());`);
 await db.exec(await readFile(new URL('../../supabase/18_reapi_generation_billing.sql',import.meta.url),'utf8'));
 globalThis.fetch=async(raw,opts={})=>{
  const u=new URL(raw),body=opts.body&&typeof opts.body==='string'?JSON.parse(opts.body):null;
  if(u.hostname==='reapi.ai'){
   assert.equal(opts.headers.Authorization,'Bearer test-reapi');
   if(u.pathname.endsWith('/videos/generations')){
    posts.push(body);
    if(uncertain)throw Error('Connection lost after acceptance');
    if(reject)return json({error:{code:20003,message:'Invalid input'}},400);
    const id='task_'+randomUUID();tasks.set(id,{id,model:body.model,status:'processing',output:null});
    return json(tasks.get(id));
   }
   return json(tasks.get(decodeURIComponent(u.pathname.split('/').at(-1)))||{},providerStatus);
  }
  if(u.hostname==='cdn.reapi.ai')return failArchive?new Response(null,{status:503}):new Response(fixture,{headers:{'content-type':'video/mp4'}});
  if(u.pathname.includes('/auth/'))return json({id:opts.headers.Authorization==='Bearer other'?other:uid});
  if(u.pathname.includes('/storage/'))return opts.method==='POST'?json({ok:true}):new Response(fixture);
  if(u.pathname.endsWith('/rpc/reapi_generation_transition')){
   try{return json((await db.query('select reapi_generation_transition($1,$2,$3,$4) as result',[body.p_action,body.p_id,body.p_user,body.p_payload])).rows[0].result);}
   catch(e){return json({message:e.message},400);}
  }
  if(u.pathname.endsWith('/user_generations')){
   assert.ok(!opts.method||opts.method==='GET','New generation metadata must use atomic transitions');
   let rows=(await db.query('select * from user_generations')).rows;
   for(const key of ['id','user_id'])if(u.searchParams.has(key))rows=rows.filter(row=>row[key]===u.searchParams.get(key).slice(3));
   for(const key of ['run_id','draft_parent_run_id','source','draft_final'])if(u.searchParams.has('meta->>'+key))rows=rows.filter(row=>String(row.meta[key])===u.searchParams.get('meta->>'+key).slice(3));
   return json(rows);
  }
  throw Error('Unexpected HTTP request: '+raw);
 };
});
beforeEach(async()=>{
 posts=[];tasks=new Map();reject=false;uncertain=false;providerStatus=200;failArchive=false;
 await db.exec('delete from user_generations;delete from profiles;');
 await db.query('insert into profiles values($1,1000)',[uid]);
});
after(async()=>{globalThis.fetch=originalFetch;await db.close();});

test('agreed prices, source-plus-output billing and minimums are shared with the browser',()=>{
 for(const [resolution,expected]of [['480p',175],['720p',380],['1080p',900]])assert.equal(pricing.quote({resolution,inputSeconds:10,edit:true}).displayedCredits,expected);
 for(const [model,values]of [['seedance25',[146,318,757]],['seedance20',[88,184,451]]]){
  ['480p','720p','1080p'].forEach((resolution,i)=>assert.equal(pricing.quote({model,resolution,duration:10}).displayedCredits,values[i]));
 }
 assert.equal(pricing.quote({inputSeconds:2,duration:10}).billedSeconds,17);
 assert.equal(pricing.quote({model:'seedance20',inputSeconds:5.1,duration:10}).billedSeconds,16);
 assert.equal(pricing.quote({resolution:'480p',inputSeconds:5,edit:true}).displayedCredits,88);
});

test('request mapping preserves 10,000-character prompts, reference order, quality, frames and web search',()=>{
 const prompt='abcd '.repeat(2000);
 for(const version of ['2.0','2.5']){
  const {payload}=build({prompt,duration:10,resolution:'720p',reference_image_urls:[source+'.png'],reference_video_urls:[source],reference_audio_urls:[source+'.mp3'],enable_web_search:true},version,{inputSeconds:5});
  assert.equal(payload.prompt,prompt.trim());assert.equal(payload.watermark,false);assert.equal(payload.content_filter,true);assert.equal(payload.bitrate_mode,'default');
  assert.deepEqual(payload.tools,[{type:'web_search'}]);assert.deepEqual(payload.video_urls,[source]);assert.equal(payload.size,'16:9');assert.equal(payload.duration,10);
  assert.equal('input' in payload,false);assert.equal('aspect_ratio' in payload,false);
 }
 const p=build({prompt:'Two frames',first_frame_url:source,last_frame_url:source,duration:5,resolution:'1080p'},'2.5').payload;
 assert.equal(p.size,'adaptive');assert.deepEqual(p.image_with_roles.map(x=>x.role),['first_frame','last_frame']);
 assert.throws(()=>build({prompt:'x'.repeat(20001)},'2.0'),/20,000/);
 assert.throws(()=>build({prompt:'Test',first_frame_url:source,reference_video_urls:[source]},'2.0',{inputSeconds:5}),/cannot be combined/);
 assert.throws(()=>build({prompt:'Test',reference_audio_urls:[source]},'2.0'),/requires/);
 assert.throws(()=>build({prompt:'Test',resolution:'1080p',variant:'fast'},'2.0'),/resolution/);
});

test('simultaneous retries reserve and submit exactly once, with the UI price deducted',async()=>{
 const request=event(),responses=await Promise.all([launch25(request),launch25(request)]);
 assert.ok(responses.every(r=>r.statusCode===200||r.statusCode===201));
 assert.equal(posts.length,1);assert.equal(posts[0].model,'doubao-seedance-2.5-face');
 assert.equal(await balance(),985.4);assert.equal((await saved()).length,1);
 const row=(await saved())[0];assert.equal(row.meta.charged_cost,14.6);assert.equal(row.meta.refund_amount,14.6);assert.equal(row.meta.checker,'reapi-check');
 assert.equal((await launch25(request)).statusCode,200);assert.equal(posts.length,1);
});

test('insufficient credits and invalid inputs cannot create paid jobs',async()=>{
 await db.query('update profiles set credits=1 where user_id=$1',[uid]);
 assert.equal((await launch20(event())).statusCode,402);assert.equal(posts.length,0);assert.equal((await saved()).length,0);assert.equal(await balance(),1);
 assert.equal((await launch25(event({resolution:'4k'}))).statusCode,400);assert.equal(posts.length,0);
});

test('explicit rejection and repeated failed callbacks refund exactly once',async()=>{
 reject=true;assert.equal((await launch25(event())).statusCode,422);assert.equal(await balance(),1000);assert.equal((await saved())[0].meta.refunded,true);
 reject=false;await launch25(event());const row=(await saved()).find(r=>r.meta.task_id);
 const task=tasks.get(row.meta.task_id);task.status='failed';task.error={message:'Provider failure',code:500};
 const outcomes=await Promise.all([checker(polling(row)),checker(polling(row))]);
 assert.ok(outcomes.every(r=>JSON.parse(r.body).failed));assert.equal(await balance(),1000);
 await checker(polling(row));assert.equal(await balance(),1000);
});

test('transient polling errors neither refund nor complete a generation',async()=>{
 await launch25(event());const row=(await saved())[0];providerStatus=503;
 const out=JSON.parse((await checker(polling(row))).body);assert.equal(out.status,'pending');assert.equal(await balance(),985.4);assert.equal((await saved())[0].meta.refunded,undefined);
});

test('callbacks cannot forge outputs or cross account boundaries',async()=>{
 await launch25(event());const row=(await saved())[0];
 assert.equal((await checker(polling(row,{headers:{authorization:'Bearer other'}}))).statusCode,403);
 assert.equal((await checker(polling(row,{headers:{}}))).statusCode,401);
 const callback={httpMethod:'POST',queryStringParameters:{uid,run_id:row.meta.run_id,token:'forged'},body:JSON.stringify({id:row.meta.task_id,status:'completed',output:{video_urls:['https://attacker.test/fake.mp4']}})};
 assert.equal((await checker(callback)).statusCode,403);
 callback.queryStringParameters.token=new URL(posts.at(-1).webhook_url).searchParams.get('token');
 assert.equal(JSON.parse((await checker(callback)).body).status,'pending');assert.equal((await saved())[0].result_url,null);
});

test('completion archives the verified output, never an input, and cannot later refund',async()=>{
 await launch25(event());const row=(await saved())[0],task=tasks.get(row.meta.task_id);
 task.status='completed';task.output={video_urls:['https://cdn.reapi.ai/video.mp4']};
 failArchive=true;assert.equal((await checker(polling(row))).statusCode,502);assert.equal((await saved())[0].result_url,null);
 failArchive=false;const out=JSON.parse((await checker(polling(row))).body);assert.equal(out.status,'done');assert.match(out.result_url,/generation-history/);
 const refund=await transition('fail',row.id,uid,{error:'late failure'});assert.equal(refund.changed,false);assert.equal(await balance(),985.4);
});

test('ambiguous submit never retries paid POST and a verified webhook can recover its task id',async()=>{
 uncertain=true;const request=event();assert.equal((await launch25(request)).statusCode,202);
 const row=(await saved())[0];assert.equal(await balance(),985.4);
 await launch25(request);assert.equal(posts.length,1);
 const id='task_late';tasks.set(id,{id,model:row.meta.model,status:'processing'});
 await checker({httpMethod:'POST',queryStringParameters:{uid,run_id:row.meta.run_id,token:new URL(posts.at(-1).webhook_url).searchParams.get('token')},body:JSON.stringify({id})});
 assert.equal((await saved())[0].meta.task_id,id);assert.equal(await balance(),985.4);
});

test('orphan recovery waits thirty minutes and never refunds a known task',async()=>{
 uncertain=true;await launch25(event());let row=(await saved())[0];
 await checker(polling(row));assert.equal(await balance(),985.4);
 await db.query("update user_generations set created_at=now()-interval '31 minutes' where id=$1",[row.id]);
 await checker(polling(row));assert.equal(await balance(),1000);
 await checker(polling(row));assert.equal(await balance(),1000);
});

test('billing verifies the uploaded video, ignoring a forged declared duration',async()=>{
 const res=await launch25(event({duration:-1,source_video_duration:4,reference_video_urls:[source],resolution:'480p'}));
 assert.equal(res.statusCode,201);const row=(await saved())[0];
 assert.equal(row.meta.source_video_duration,5);assert.equal(row.meta.charged_cost,8.8);assert.equal(posts[0].omni_reference_task_type,'edit');assert.equal(posts[0].duration,-1);
});

test('quote mismatch is refused before billing or provider submission',async()=>{
 const res=await launch25(event({duration:-1,source_video_duration:4,reference_video_urls:[source],expected_credits:70}));
 assert.equal(res.statusCode,409);assert.equal(JSON.parse(res.body).displayed_credits,88);assert.equal(await balance(),1000);assert.equal(posts.length,0);
});

test('a failed refund transaction rolls back both balance and terminal status',async()=>{
 await launch25(event());const row=(await saved())[0];
 await db.exec(`create function reject_refund() returns trigger language plpgsql as $$begin raise exception 'simulated failure';end;$$;create trigger reject_refund before update on profiles for each row execute function reject_refund();`);
 await assert.rejects(transition('fail',row.id,uid,{error:'failed'}));
 assert.equal((await saved())[0].meta.status,'processing');assert.equal(await balance(),985.4);
 await db.exec('drop trigger reject_refund on profiles;drop function reject_refund();');
 await transition('fail',row.id,uid,{error:'failed'});assert.equal(await balance(),1000);
});

test('owner-visible history cannot modify billing, switch providers, or expose callback credentials',async()=>{
 await launch25(event());const row=(await saved())[0];assert.equal(row.meta.callback_token,undefined);
 await db.exec('grant select,insert,update,delete on user_generations to authenticated;set role authenticated;');
 try {
  await assert.rejects(db.query("update user_generations set meta=meta || '{\"refund_amount\":100000}'::jsonb where id=$1",[row.id]),/Server-owned/);
  await assert.rejects(db.query("update user_generations set meta='{}'::jsonb where id=$1",[row.id]),/Server-owned/);
  await assert.rejects(db.query('delete from user_generations where id=$1',[row.id]),/Wait for/);
 } finally {await db.exec('reset role');}
 assert.equal((await saved())[0].meta.refund_amount,14.6);assert.equal(await balance(),985.4);
});

test('legacy text-only URLs also use reAPI and share duplicate protection',async()=>{
 const same=event(),cheap25=require('../../netlify/functions/run-seedance-25-cheap.js').handler;
 await cheap25(same);await launch25(same);assert.equal(posts.length,1);assert.equal(posts[0].model,'doubao-seedance-2.5-face');
 const cheap20=require('../../netlify/functions/run-seedance-cheap.js').handler;
 await cheap20(event({variant:'fast',resolution:'720p'}));assert.equal(posts[1].model,'doubao-seedance-2.0-fast-face');
});

test('a provider response containing an uploaded input is never saved as a generated result',async()=>{
 await launch25(event({reference_image_urls:[source+'.png']}));const row=(await saved())[0];
 const task=tasks.get(row.meta.task_id);task.status='completed';task.output={video_urls:[source+'.png']};
 assert.equal((await checker(polling(row))).statusCode,502);assert.equal((await saved())[0].result_url,null);
});

test('scheduled recovery completes a missed callback without a browser',async()=>{
 await launch25(event());const row=(await saved())[0],task=tasks.get(row.meta.task_id);
 task.status='completed';task.output={video_urls:['https://cdn.reapi.ai/result.mp4']};
 const sweep=await import('../../netlify/functions/reapi-sweep.mjs');
 assert.equal((await sweep.default(new Request('https://local.test',{method:'POST',body:'{}'}))).status,401);
 const res=await sweep.default(new Request('https://local.test',{method:'POST',body:JSON.stringify({next_run:new Date().toISOString()})}));
 assert.equal((await res.json()).checked,1);assert.equal((await saved())[0].meta.status,'done');assert.equal(await balance(),985.4);
});

test('legacy service-role writes cannot refund reAPI rows; audio workers keep their narrow write path',async()=>{
 await launch25(event());const row=(await saved())[0];
 await db.exec('grant select,update on user_generations to service_role;set role service_role;');
 try {await assert.rejects(db.query("update user_generations set meta=meta || '{\"status\":\"failed\",\"refund_claim\":\"legacy\"}'::jsonb where id=$1",[row.id]),/Server-owned/);}
 finally {await db.exec('reset role');}
 await db.query("update user_generations set meta=meta || '{\"source_feature\":\"henshin\"}'::jsonb where id=$1",[row.id]);
 await transition('complete',row.id,uid,{result_url:null,meta:{status:'restoring_audio',source_audio_url:source,generated_video_url:source}});
 await db.exec('set role service_role;');
 try {
  await db.query("update user_generations set meta=meta || '{\"audio_lease\":\"worker\",\"audio_attempts\":1}'::jsonb where id=$1",[row.id]);
  await assert.rejects(db.query("update user_generations set meta=meta || '{\"refunded\":true}'::jsonb where id=$1",[row.id]),/Server-owned/);
  await db.query("update user_generations set result_url=$2,meta=meta || '{\"status\":\"done\",\"audio_restored\":true}'::jsonb where id=$1",[row.id,source]);
 } finally {await db.exec('reset role');}
 assert.equal((await saved())[0].meta.audio_restored,true);assert.equal(await balance(),985.4);
});

test('Wan prices preserve every current rate and bill fractional source length without rounding seconds',()=>{
 for(const [resolution,expected] of [['480p',60],['720p',100],['1080p',200]]) {
  assert.equal(wanPricing.quote({resolution,duration:10}).displayedCredits,expected);
  assert.equal(wanPricing.quote({resolution,duration:10,inputSeconds:10}).displayedCredits,expected*2);
 }
 assert.equal(wanPricing.quote({resolution:'480p',duration:10,inputSeconds:5.1}).displayedCredits,91);
 assert.equal(wanPricing.quote({resolution:'1080p',duration:10,inputSeconds:10.08}).displayedCredits,402);
 for(const args of [{duration:-1},{duration:1},{duration:31},{duration:2.5},{resolution:'4k'},{inputSeconds:16},{inputSeconds:15,duration:16}]) assert.throws(()=>wanPricing.quote(args));
});

test('Wan maps native sound, frames and all reference types to the documented reAPI contract',()=>{
 const request={prompt:'a'.repeat(20000),duration:10,resolution:'720p',reference_image_urls:Array(10).fill(source+'.png'),reference_video_urls:Array(5).fill(source),reference_audio_urls:Array(5).fill(source+'.mp3')};
 const p=buildWan(request,'wan-3',{inputSeconds:5}).payload;
 assert.equal(p.model,'wan3.0-video');assert.equal(p.resolution,'720P');assert.equal(p.audio,true);assert.equal(p.content_filter,true);assert.equal(p.watermark,false);assert.equal(p.prompt.length,20000);
 assert.equal(p.input,undefined);assert.equal(p.generation_type,'reference');assert.equal(p.image_urls.length,10);assert.equal(p.video_urls.length,5);assert.equal(p.audio_urls.length,5);
 const f=buildWan({prompt:'Frames',first_frame_url:source+'.png',last_frame_url:source+'.jpg',audio:false,prompt_extend:false,seed:42}).payload;
 assert.deepEqual(f.image_with_roles.map(x=>x.role),['first_frame','last_frame']);assert.equal(f.audio,false);assert.equal(f.prompt_extend,false);assert.equal(f.seed,42);
 assert.equal(buildWan({prompt:'Voice',reference_audio_urls:[source+'.mp3']}).payload.audio_urls.length,1);
 for(const patch of [{prompt:'a'.repeat(20001)},{last_frame_url:source},{first_frame_url:source,reference_video_urls:[source]},{reference_video_urls:Array(6).fill(source)},{seed:-2}])assert.throws(()=>buildWan({prompt:'Test',...patch}));
});

test('Wan text jobs debit the displayed quote once even when submitted concurrently',async()=>{
 const request=event({expected_credits:60});const responses=await Promise.all([launchWan(request),launchWan(request)]);
 assert.ok(responses.every(r=>[200,201].includes(r.statusCode)));assert.equal(posts.length,1);assert.equal(posts[0].model,'wan3.0-video');assert.equal(await balance(),994);
 const row=(await saved())[0];assert.equal(row.provider,'Wan 3.0');assert.equal(row.meta.model_id,'wan-3');assert.equal(row.meta.checker,'reapi-check');assert.equal(row.meta.refund_amount,6);
 for(const [resolution,expected] of [['720p',100],['1080p',200]]) assert.equal((await launchWan(event({resolution,expected_credits:expected}))).statusCode,201);
 assert.equal(await balance(),964);
});

test('Wan verifies reference duration and refuses stale or missing quotes before any charge',async()=>{
 const body={reference_video_urls:[source],source_video_duration:1};
 for(const expected_credits of [undefined,60]) {
  const res=await launchWan(event({...body,expected_credits}));assert.equal(res.statusCode,409);assert.equal(JSON.parse(res.body).displayed_credits,90);assert.equal(JSON.parse(res.body).input_seconds,5);
 }
 assert.equal(await balance(),1000);assert.equal(posts.length,0);assert.equal((await saved()).length,0);
 const res=await launchWan(event({...body,expected_credits:90}));assert.equal(res.statusCode,201);assert.equal(await balance(),991);
 const row=(await saved())[0];assert.equal(row.meta.source_video_duration,5);assert.equal(row.meta.billed_seconds,15);assert.deepEqual(posts[0].video_urls,[source]);
});

test('Wan audio references add no video seconds and invalid combined media is rejected unpaid',async()=>{
 assert.equal((await launchWan(event({reference_audio_urls:[source],expected_credits:60}))).statusCode,201);
 assert.equal(await balance(),994);assert.deepEqual(posts[0].audio_urls,[source]);assert.equal(posts[0].audio,true);
 const before=posts.length;
 for(const patch of [{reference_video_urls:Array(4).fill(source)},{reference_audio_urls:Array(4).fill(source)},{reference_video_urls:[source],duration:26},{reference_video_urls:['https://untrusted.test/video.mp4']}]) {
  const res=await launchWan(event(patch));assert.equal(res.statusCode,400,res.body);
 }
 assert.equal(posts.length,before);assert.equal(await balance(),994);
});

test('Wan submission failures and confirmed failed tasks refund exactly once',async()=>{
 reject=true;assert.equal((await launchWan(event())).statusCode,422);assert.equal(await balance(),1000);
 reject=false;await launchWan(event({resolution:'720p'}));const row=(await saved()).find(r=>r.meta.task_id);
 assert.equal(await balance(),990);tasks.get(row.meta.task_id).status='failed';
 await Promise.all([checker(polling(row)),checker(polling(row))]);assert.equal(await balance(),1000);assert.equal((await saved()).find(r=>r.id===row.id).meta.refunded,true);
});

test('Wan finished video is archived and legacy KIE retries keep the original job and checker',async()=>{
 await launchWan(event());const row=(await saved())[0],task=tasks.get(row.meta.task_id);
 task.status='completed';task.output={video_urls:['https://cdn.reapi.ai/wan.mp4']};
 assert.equal(JSON.parse((await checker(polling(row))).body).status,'done');assert.match((await saved())[0].result_url,/generation-history/);assert.equal(await balance(),994);
 const run=randomUUID();await db.query('insert into user_generations(id,user_id,provider,meta) values($1,$2,$3,$4)',[randomUUID(),uid,'Wan 3.0',{source:'kie',engine:'wan-3',status:'processing',run_id:run,task_id:'legacy-wan'}]);
 const reply=JSON.parse((await launchWan(event({},run))).body);assert.equal(reply.taskId,'legacy-wan');assert.equal(reply.checker,'kie-check');assert.equal(posts.length,1);assert.equal(await balance(),994);
});

const finalEvent=(parent,patch={})=>({httpMethod:'POST',headers:{authorization:'Bearer customer'},body:JSON.stringify({draft_run_id:parent.meta.run_id,...patch})});
async function completedDraft(patch={}) {
 const out=await launch25(event({draft:true,...patch}));assert.equal(out.statusCode,201,out.body);
 const parent=(await saved())[0];
 const task=tasks.get(parent.meta.task_id);task.status='completed';task.output={video_urls:['https://cdn.reapi.ai/draft.mp4']};
 const result=JSON.parse((await checker(polling(parent))).body);
 assert.equal(result.meta.draft,true);assert.ok(result.meta.draft_expires_at);
 return (await saved()).find(r=>r.id===parent.id);
}

test('drafts keep the normal 480p price, while the 1080p action targets 5% margin without the video minimum',()=>{
 const q=pricing.quoteFinal({duration:10});assert.equal(q.displayedCredits,677);assert.equal(q.providerCostUSD,6.43);
 assert.ok((q.displayedCredits/100-q.providerCostUSD)/(q.displayedCredits/100)>=.05);
 assert.equal(pricing.quoteFinal({duration:10,inputSeconds:2}).billedSeconds,12);
 assert.equal(pricing.quoteFinal({duration:10,inputSeconds:10}).displayedCredits,1354);
 assert.equal(pricing.quoteFinal({duration:10,inputSeconds:2.1}).billedSeconds,13);
 for(const patch of [{duration:0},{duration:31},{duration:10.5},{duration:10,inputSeconds:-1},{duration:10,inputSeconds:31}])assert.throws(()=>pricing.quoteFinal(patch));
 const p=build({prompt:'A fox walks',resolution:'480p',draft:true,return_last_frame:true},'2.5').payload;
 assert.equal(p.draft,true);assert.equal(p.return_last_frame,false);
 assert.equal(build({prompt:'Legacy 480p',resolution:'480p'},'2.5').payload.draft,undefined);
 for(const [body,version]of [[{draft:true,resolution:'720p',prompt:'Test'},'2.5'],[{draft:true,resolution:'480p',prompt:''},'2.5'],[{draft:true,resolution:'480p',prompt:'Test'},'2.0']])assert.throws(()=>build(body,version));
});

test('final quote is free; concurrent confirmations submit once using only the owned draft ID and output options',async()=>{
 const parent=await completedDraft();assert.equal(await balance(),985.4);
 const quoted=JSON.parse((await finalize(finalEvent(parent,{quote_only:true}))).body);
 assert.equal(quoted.displayedCredits,677);assert.equal(await balance(),985.4);assert.equal(posts.length,1);
 const req=finalEvent(parent,{expected_credits:677,draft_task_id:'forged',duration:4,source_video_duration:0,resolution:'480p'});
 const replies=await Promise.all([finalize(req),finalize(req)]);
 assert.ok(replies.every(r=>[200,201].includes(r.statusCode)),JSON.stringify(replies));
 assert.equal(posts.length,2);assert.equal(await balance(),917.7);
 assert.equal(posts[1].draft_task_id,parent.meta.task_id);assert.equal(posts[1].resolution,'1080p');
 assert.deepEqual(Object.keys(posts[1]).sort(),['bitrate_mode','draft_task_id','model','output_format','resolution','watermark','webhook_url']);
 assert.equal((await finalize(req)).statusCode,200);assert.equal(posts.length,2);
 const final=(await saved()).find(r=>r.meta.draft_final);assert.equal(final.meta.run_id,quoted.run_id);assert.equal(final.meta.refund_amount,67.7);
 tasks.get(final.meta.task_id).status='completed';tasks.get(final.meta.task_id).output={video_urls:['https://cdn.reapi.ai/final.mp4']};
 assert.equal(JSON.parse((await checker(polling(final))).body).status,'done');
 assert.equal((await saved()).find(r=>r.id===parent.id).result_url,parent.result_url);assert.equal(await balance(),917.7);
});

test('non-drafts, unfinished or expired drafts and other accounts cannot be finalized or charged',async()=>{
 await launch25(event({draft:true}));let parent=(await saved())[0];
 assert.equal((await finalize(finalEvent(parent,{expected_credits:677}))).statusCode,400);
 parent=await completedDraft();
 const req=finalEvent(parent,{expected_credits:677});req.headers.authorization='Bearer other';
 assert.equal((await finalize(req)).statusCode,400);
 req.headers={};assert.equal((await finalize(req)).statusCode,401);
 const before=await balance();
 for(const patch of [{draft:false},{model:'doubao-seedance-2.0-face'},{draft_expires_at:'2000-01-01T00:00:00Z'},{source_feature:'henshin'}]) {
  await db.query('update user_generations set meta=$2 where id=$1',[parent.id,{...parent.meta,...patch}]);
  assert.equal((await finalize(finalEvent(parent,{expected_credits:677}))).statusCode,400);
 }
 assert.equal(await balance(),before);assert.equal(posts.length,2);
});

test('upgrade refuses a missing or changed quote before deduction',async()=>{
 const parent=await completedDraft();
 for(const patch of [{},{expected_credits:1}])assert.equal((await finalize(finalEvent(parent,patch))).statusCode,409);
 assert.equal(await balance(),985.4);assert.equal(posts.length,1);
});

test('rejected finalization refunds only the upgrade; an explicit retry gets a new protected attempt',async()=>{
 const parent=await completedDraft();reject=true;
 const req=finalEvent(parent,{expected_credits:677});assert.equal((await finalize(req)).statusCode,422);
 assert.equal(await balance(),985.4);assert.equal((await saved()).find(r=>r.id===parent.id).meta.refunded,undefined);
 reject=false;const reply=JSON.parse((await finalize(req)).body);assert.equal(reply.meta.final_attempt,2);assert.equal(await balance(),917.7);
 assert.equal((await finalize(req)).statusCode,200);assert.equal(posts.length,3);
 const final=(await saved()).find(r=>r.meta.final_attempt===2);tasks.get(final.meta.task_id).status='failed';
 await Promise.all([checker(polling(final)),checker(polling(final))]);assert.equal(await balance(),985.4);
 assert.equal((await saved()).find(r=>r.id===parent.id).result_url,parent.result_url);
});

test('uncertain finalization never repeats its paid POST and signed recovery can attach the task',async()=>{
 const parent=await completedDraft();uncertain=true;
 const req=finalEvent(parent,{expected_credits:677});assert.equal((await finalize(req)).statusCode,202);
 await finalize(req);assert.equal(posts.length,2);assert.equal(await balance(),917.7);
 const final=(await saved()).find(r=>r.meta.draft_final),id='task_final_late';
 tasks.set(id,{id,model:final.meta.model,status:'processing'});
 const token=new URL(posts.at(-1).webhook_url).searchParams.get('token');
 await checker({httpMethod:'POST',queryStringParameters:{uid,run_id:final.meta.run_id,token},body:JSON.stringify({id})});
 assert.equal((await saved()).find(r=>r.id===final.id).meta.task_id,id);assert.equal(await balance(),917.7);
});

test('video-edit draft finalization quotes the delivered length plus original reference seconds',async()=>{
 const parent=await completedDraft({duration:-1,reference_video_urls:[source]});
 const actual=(await require('../../lib/henshin/server-media.cjs').inspectVideo(parent.result_url,{min:4})).seconds;
 const quoted=JSON.parse((await finalize(finalEvent(parent,{quote_only:true}))).body);
 assert.equal(quoted.duration,Math.ceil(actual));assert.equal(quoted.billedSeconds,Math.ceil(actual)+5);
 assert.equal(quoted.displayedCredits,pricing.quoteFinal({duration:Math.ceil(actual),inputSeconds:5}).displayedCredits);
 assert.equal(posts.length,1);
});

test('client-writable legacy metadata cannot impersonate an existing paid finalization',async()=>{
 const parent=await completedDraft();
 await db.query('insert into user_generations(id,user_id,provider,result_url,meta) values($1,$2,$3,$4,$5)',[randomUUID(),uid,'Legacy','https://untrusted.test/fake.mp4',{source:'kie',draft_parent_run_id:parent.meta.run_id,draft_final:true,status:'done'}]);
 const quote=JSON.parse((await finalize(finalEvent(parent,{quote_only:true}))).body);
 assert.equal(quote.quote_only,true);assert.equal(quote.displayedCredits,677);assert.equal(quote.submitted,undefined);assert.equal(await balance(),985.4);
});
