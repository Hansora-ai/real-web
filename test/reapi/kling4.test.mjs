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
process.env.KIE_API_KEY='test-kie';
const pricing=require('../../public/kling4-pricing.js');
const {build}=require('../../lib/kling4/request.cjs');
const launch25=require('../../netlify/functions/run-kling-40.js').handler;
const lite=require('../../netlify/functions/run-henshin.js').handler;
const checker=require('../../netlify/functions/kling4-check.js').handler;
const {transition}=require('../../lib/reapi/billing.cjs');
const db=new PGlite(),uid=randomUUID(),other=randomUUID();
const source='https://example.supabase.co/storage/v1/object/public/generation-history/source.mp4';
const fixture=await readFile(new URL('../henshin/fixtures/source.mp4',import.meta.url));
const originalFetch=globalThis.fetch;
let posts=[],stored=[],tasks=new Map(),reject=false,uncertain=false,providerStatus=200,failArchive=false,inputFixture=fixture;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const event=(patch={},run=randomUUID())=>({httpMethod:'POST',headers:{authorization:'Bearer customer'},body:JSON.stringify({uid,run_id:run,prompt:'A cinematic kitten in warm light.',resolution:'720p',duration:10,expected_credits:190,...patch})});
async function balance(){return Number((await db.query('select credits from profiles where user_id=$1',[uid])).rows[0].credits);}
async function saved(){return (await db.query('select * from user_generations order by created_at desc')).rows;}
function polling(row,patch={}){return {httpMethod:'GET',headers:{authorization:'Bearer customer'},queryStringParameters:{uid,run_id:row.meta.run_id},...patch};}
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table profiles(user_id uuid primary key,credits numeric(12,1));
 create table user_generations(id uuid primary key,user_id uuid,provider text,kind text,prompt text,result_url text,meta jsonb,created_at timestamptz default now());grant select,update on user_generations to authenticated,service_role;`);
 await db.exec(await readFile(new URL('../../supabase/18_reapi_generation_billing.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/20_kling4_generation_billing.sql',import.meta.url),'utf8'));
 globalThis.fetch=async(raw,opts={})=>{
  const u=new URL(raw),body=opts.body&&typeof opts.body==='string'?JSON.parse(opts.body):null;
  if(u.hostname==='api.kie.ai'){
   assert.equal(opts.headers.Authorization,'Bearer test-kie');
   if(u.pathname.endsWith('/createTask')){
    posts.push(body);
    if(uncertain)throw Error('Connection lost after acceptance');
    if(reject)return json({code:422,msg:'Invalid input'});
    const id='task_'+randomUUID();tasks.set(id,{taskId:id,model:body.model,state:'generating'});
    return json({code:200,data:{taskId:id}});
   }
   return json({code:200,data:tasks.get(u.searchParams.get('taskId'))},providerStatus);
  }
  if(u.hostname==='cdn.kie.ai')return failArchive?new Response(null,{status:503}):new Response(fixture,{headers:{'content-type':'video/mp4'}});
  if(u.pathname.includes('/auth/'))return json({id:opts.headers.Authorization==='Bearer other'?other:uid});
  if(u.pathname.includes('/storage/')){
   if(opts.method==='POST'){stored.push({url:String(u),bytes:Buffer.from(opts.body)});return json({ok:true});}
   const archived=stored.find(file=>file.url.replace('/object/','/object/public/')===String(u));
   return new Response(archived?.bytes||inputFixture);
  }
  if(u.pathname.endsWith('/henshin-finish-background'))return new Response(null,{status:202});
  if(u.pathname.endsWith('/rpc/reapi_generation_transition')){
   try{return json((await db.query('select reapi_generation_transition($1,$2,$3,$4) as result',[body.p_action,body.p_id,body.p_user,body.p_payload])).rows[0].result);}
   catch(e){return json({message:e.message},400);}
  }
  if(u.pathname.endsWith('/user_generations')){
   if(opts.method==='PATCH'){
    // Exercise the deployed trigger with its real service role. Recovery may
    // resolve finishing fields, but cannot alter task, billing or refund data.
    const rows=await db.transaction(async tx=>{
     await tx.exec('set local role service_role');
     const filter=key=>u.searchParams.has(key)?u.searchParams.get(key).slice(3):null;
     const lease=u.searchParams.get('meta->>audio_lease');
     return (await tx.query("update user_generations set result_url=case when $8 then $3 else result_url end,meta=$4 where id=$1 and ($2::uuid is null or user_id=$2) and ($5::text is null or meta->>'status'=$5) and ($6::text is null or coalesce(meta->>'audio_lease','')=$6) and (not $7 or coalesce(meta->>'audio_restored','false')='false') returning *",[filter('id'),filter('user_id'),body.result_url??null,body.meta,filter('meta->>status'),lease===null?null:lease==='is.null'?'':lease.slice(3),u.searchParams.has('or'),Object.hasOwn(body,'result_url')])).rows;
    });return json(rows);
   }
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
 posts=[];stored=[];tasks=new Map();reject=false;uncertain=false;providerStatus=200;failArchive=false;inputFixture=fixture;
 await db.exec('delete from user_generations;delete from profiles;');
 await db.query('insert into profiles values($1,1000)',[uid]);
});
after(async()=>{globalThis.fetch=originalFetch;await db.close();});


test('Kling 25% quotes and the explicit Lite price use the same units as the UI',()=>{
 for(const [resolution,cost,credits,liteCredits]of [['720p',1.7,227,220],['1080p',2.55,340,340]]){
  const q=pricing.quote({resolution,duration:10,inputSeconds:10});
  assert.ok(Math.abs(q.providerCostUSD-cost)<1e-8);assert.equal(q.billedSeconds,20);assert.equal(q.displayedCredits,credits);
  assert.equal(pricing.quote({resolution,inputSeconds:10,lite:true}).displayedCredits,liteCredits);
 }
 assert.equal(pricing.quote({duration:10,inputSeconds:5}).billedSeconds,20);
 assert.equal(pricing.quote({duration:10,inputSeconds:15}).billedSeconds,25);
 assert.equal(pricing.quote({inputSeconds:10.08,lite:true}).duration,11);
 assert.throws(()=>pricing.quote({resolution:'480p'}));
});
test('documented Kling task IDs containing model-version dots are accepted',async()=>{
 const id='task_kling-4.0-reference-to-video_abc123';assert.equal(require('../../lib/kling4/client.cjs').taskId({code:200,data:{taskId:id}}),id);
 await launch25(event());const row=(await saved())[0];await db.query("update user_generations set meta=meta-'task_id' where id=$1",[row.id]);const updated=await transition('attach',row.id,uid,{task_id:id});assert.equal(updated.row.meta.task_id,id);
});

test('exact API mapping supports 10k prompts, references and optional original audio',()=>{
 const {payload}=build({prompt:'x'.repeat(10000),duration:30,resolution:'1080p',aspect_ratio:'auto',image_urls:[source+'.jpg'],video_urls:[source],audio_urls:[source+'.mp3'],keep_original_sound:false},{inputSeconds:10});
 assert.equal(payload.model,'kling-4.0/reference-to-video');assert.equal(payload.input.prompt.length,10000);
 assert.equal(payload.input.keep_original_sound,false);assert.deepEqual(payload.input.voices,[{name:'voice_1',audio_url:source+'.mp3'}]);
 assert.throws(()=>build({prompt:'@video_2',video_urls:[source]},{inputSeconds:10}),/Unknown/);
 assert.throws(()=>build({prompt:'x'.repeat(10001)}));
 assert.throws(()=>build({prompt:'test',image_urls:Array(11).fill(source)}));
});
test('simultaneous retries debit and submit only once',async()=>{
 const request=event();const results=await Promise.all([launch25(request),launch25(request)]);
 assert.ok(results.every(r=>[200,201].includes(r.statusCode)),JSON.stringify(results));
 assert.equal(posts.length,1);assert.equal(await balance(),981);assert.equal((await saved())[0].meta.charged_cost,19);
 assert.equal((await launch25(request)).statusCode,200);assert.equal(posts.length,1);
});
test('Search Models retains original video audio even when a stale client sends false',async()=>{
 const response=await launch25(event({video_urls:[source],keep_original_sound:false,expected_credits:227}));
 assert.equal(response.statusCode,201,response.body);
 assert.equal(posts[0].input.keep_original_sound,true);
 assert.equal((await saved())[0].meta.keep_original_sound,true);
});
test('insufficient balance and changed verified quote cannot submit a paid task',async()=>{
 assert.equal((await launch25(event({expected_credits:1}))).statusCode,409);assert.equal(posts.length,0);assert.equal(await balance(),1000);
 await db.query('update profiles set credits=1 where user_id=$1',[uid]);
 assert.equal((await launch25(event())).statusCode,402);assert.equal(posts.length,0);assert.equal((await saved()).length,0);
});
test('rejection and concurrent failure polling refund exactly once',async()=>{
 reject=true;assert.equal((await launch25(event())).statusCode,422);assert.equal(await balance(),1000);
 reject=false;await launch25(event());const row=(await saved()).find(r=>r.meta.task_id);tasks.get(row.meta.task_id).state='fail';
 await Promise.all([checker(polling(row)),checker(polling(row))]);assert.equal(await balance(),1000);
 await checker(polling(row));assert.equal(await balance(),1000);
});
test('ambiguous submissions never retry or immediately refund; aged orphans are recovered',async()=>{
 uncertain=true;const request=event();assert.equal((await launch25(request)).statusCode,202);assert.equal(posts.length,1);assert.equal(await balance(),981);
 assert.equal((await launch25(request)).statusCode,200);assert.equal(posts.length,1);
 let row=(await saved())[0];await checker(polling(row));assert.equal(await balance(),981);
 await db.query("update user_generations set created_at=now()-interval '31 minutes' where id=$1",[row.id]);await checker(polling(row));assert.equal(await balance(),1000);
});
test('canonical polling, callback authentication and ownership protect results and charges',async()=>{
 await launch25(event());const row=(await saved())[0];
 assert.equal((await checker(polling(row,{headers:{authorization:'Bearer other'}}))).statusCode,403);
 const callback={httpMethod:'POST',queryStringParameters:{uid,run_id:row.meta.run_id,token:'forged'},body:JSON.stringify({task_id:row.meta.task_id,code:400})};
 assert.equal((await checker(callback)).statusCode,403);
 callback.queryStringParameters.token=new URL(posts[0].callBackUrl).searchParams.get('token');
 await checker(callback);assert.equal(await balance(),981);
 providerStatus=503;await checker(polling(row));assert.equal(await balance(),981);providerStatus=200;
 tasks.get(row.meta.task_id).state='success';tasks.get(row.meta.task_id).resultJson=JSON.stringify({resultUrls:['https://cdn.kie.ai/result.mp4']});
 const out=JSON.parse((await checker(polling(row))).body);assert.ok(out.result_url?.includes('/storage/'),JSON.stringify(out));
 tasks.get(row.meta.task_id).state='fail';await checker(polling(row));assert.equal(await balance(),981);
});
test('Lite probes real source length and applies the 220-credit rate without charging a stale quote',async()=>{
 let response=await lite(event({henshin_model:'lite',video_url:source,image_urls:[source+'.jpg'],keep_audio:true,source_video_duration:10,mode:'motion',expected_credits:220}));
 assert.equal(response.statusCode,409,response.body);assert.equal(JSON.parse(response.body).displayed_credits,110);assert.equal(await balance(),1000);
 response=await lite(event({henshin_model:'lite',video_url:source,image_urls:[source+'.jpg'],keep_audio:true,source_video_duration:5,mode:'motion',expected_credits:110}));
 assert.equal(response.statusCode,201,response.body);assert.equal(await balance(),989);assert.equal(posts[0].input.duration,5);
 assert.ok(posts[0].input.prompt.includes('@video_1'));assert.ok(posts[0].input.prompt.includes('@image_1'));
 assert.equal(posts[0].input.keep_original_sound,false);
 const row=(await saved())[0];assert.equal(row.meta.finish_video,true);assert.match(row.meta.source_audio_url,/source-audio\.m4a$/);assert.equal(row.meta.audio_strategy,'original');
 assert.ok(posts[0].input.video_urls[0].endsWith('/silent-source.mp4'));
 const video=stored.find(file=>file.url.endsWith('/silent-source.mp4'));assert.ok(video.bytes.length<9.5*1024*1024);
 await require('../../lib/henshin/server-media.cjs').withCore(async core=>{core.FS.writeFile('submitted.mp4',video.bytes);assert.deepEqual(require('../../lib/henshin/server-media.cjs').probe(core,'submitted.mp4').streams.map(s=>s.codec_type),['video']);});
 tasks.get(row.meta.task_id).state='success';tasks.get(row.meta.task_id).resultJson=JSON.stringify({resultUrls:['https://cdn.kie.ai/result.mp4']});
 const completed=JSON.parse((await checker(polling(row))).body);
 assert.equal(completed.result_url,null);assert.equal(completed.meta.status,'restoring_audio');
});
test('Lite with original sound disabled still submits silent footage and saves no soundtrack',async()=>{
 const response=await lite(event({henshin_model:'lite',video_url:source,image_urls:[source+'.jpg'],keep_audio:false,source_video_duration:5,mode:'motion',expected_credits:110}));
 assert.equal(response.statusCode,201,response.body);assert.equal(posts[0].input.keep_original_sound,false);
 assert.equal((await saved())[0].meta.source_audio_url,null);
 assert.equal(stored.length,1);assert.ok(stored[0].url.endsWith('/silent-source.mp4'));
});
test('clients cannot rewrite protected Kling task or refund metadata',async()=>{
 await launch25(event());const row=(await saved())[0];
 await assert.rejects(db.exec(`set role authenticated;update user_generations set meta=meta||'{"refunded":true}' where id='${row.id}'`),/Server-owned/);
 await db.exec('reset role');
});
test('fractional Lite sources finish with the original soundtrack through the server worker',async()=>{
 await require('../../lib/henshin/server-media.cjs').withCore(async core=>{
  core.FS.writeFile('source.mp4',fixture);core.reset();assert.equal(core.exec('-i','source.mp4','-t','4.5','-c','copy','fractional.mp4'),0);
  inputFixture=Buffer.from(core.FS.readFile('fractional.mp4'));
 });
 const response=await lite(event({henshin_model:'lite',video_url:source,image_urls:[source+'.jpg'],keep_audio:true,source_video_duration:4.5,mode:'motion',expected_credits:110}));
 assert.equal(response.statusCode,201,response.body);const row=(await saved())[0];assert.equal(row.meta.duration,5);assert.equal(row.meta.finish_video,true);
 tasks.get(row.meta.task_id).state='success';tasks.get(row.meta.task_id).resultJson=JSON.stringify({resultUrls:['https://cdn.kie.ai/result.mp4']});
 const out=JSON.parse((await checker(polling(row))).body);
 assert.equal(out.result_url,null);assert.equal(out.meta.status,'restoring_audio');assert.equal(await balance(),989);
 const jobs=require('../../lib/henshin/jobs.cjs'),worker=require('../../netlify/functions/henshin-finish-background.js');
 const finished=await worker.handler({httpMethod:'POST',headers:{'x-henshin-internal':jobs.internalToken()},body:JSON.stringify({id:row.id})});
 assert.equal(JSON.parse(finished.body).ok,true,finished.body);
 const final=(await saved())[0];assert.equal(final.meta.status,'done');assert.equal(final.meta.audio_restored,true);assert.equal(await balance(),989);assert.equal(posts.length,1);
 const bytes=stored.find(file=>file.url.endsWith('/henshin-final.mp4')).bytes;
 await require('../../lib/henshin/server-media.cjs').withCore(async core=>{core.FS.writeFile('finished.mp4',bytes);const report=require('../../lib/henshin/server-media.cjs').probe(core,'finished.mp4');assert.ok(Math.abs(Number(report.format.duration)-4.5)<.15);assert.ok(report.streams.some(s=>s.codec_type==='audio'));});
});
for(const status of ['restoring_audio','audio_retry','audio_failed'])test(`archived Lite results recover from ${status} without another charge or generation`,async()=>{
 await lite(event({henshin_model:'lite',video_url:source,image_urls:[source+'.jpg'],keep_audio:true,source_video_duration:5,mode:'motion',expected_credits:110}));
 const row=(await saved())[0],archived=source.replace('source.mp4',`${uid}/${row.id}/result.mp4`);
 const meta={...row.meta,audio_strategy:undefined,status,generated_video_url:archived,finish_video:true,source_audio_url:source+'.m4a',audio_error:'Could not process the soundtrack.',audio_lease:'old-worker',audio_lease_until:Date.now()+60000};
 await db.query('update user_generations set meta=$2 where id=$1',[row.id,meta]);
 const responses=await Promise.all([checker(polling(row)),checker(polling(row))]);
 for(const response of responses){const out=JSON.parse(response.body);assert.equal(response.statusCode,200,response.body);assert.equal(out.result_url,archived);assert.equal(out.meta.status,'done');assert.equal(out.failed,false);}
 const recovered=(await saved())[0];assert.equal(recovered.result_url,archived);assert.equal(recovered.meta.audio_error,null);assert.notEqual(recovered.meta.audio_lease,'old-worker');
 assert.equal(recovered.meta.task_id,row.meta.task_id);assert.equal(recovered.meta.charged_cost,row.meta.charged_cost);assert.equal(await balance(),989);assert.equal(posts.length,1);
 assert.equal(await require('../../lib/henshin/jobs.cjs').enqueue(recovered),false);
});
test('a genuine Lite provider failure still fails and refunds exactly once',async()=>{
 await lite(event({henshin_model:'lite',video_url:source,image_urls:[source+'.jpg'],source_video_duration:5,mode:'motion',expected_credits:110}));
 const row=(await saved())[0];tasks.get(row.meta.task_id).state='fail';
 const out=JSON.parse((await checker(polling(row))).body);assert.equal(out.failed,true);assert.equal(out.result_url,null);assert.equal(await balance(),1000);
 await checker(polling(row));assert.equal(await balance(),1000);assert.equal(posts.length,1);
});
