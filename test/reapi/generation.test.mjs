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
const checker=require('../../netlify/functions/reapi-check.js').handler;
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
   if(u.searchParams.has('meta->>run_id'))rows=rows.filter(row=>row.meta.run_id===u.searchParams.get('meta->>run_id').slice(3));
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
