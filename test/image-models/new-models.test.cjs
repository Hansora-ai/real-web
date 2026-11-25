const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {parse}=require('acorn');
const root=path.resolve(__dirname,'../..');
process.env.SUPABASE_URL='https://database.test';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-service';
process.env.KIE_API_KEY='test-provider';
process.env.SITE_BASE='https://hansora.test';
process.env.DEPLOY_PRIME_URL='https://preview.test';
const nano=require('../../netlify/functions/run-nano-banana-2-1.js').handler;
const flash=require('../../netlify/functions/run-seedream-5-flash.js').handler;
function mock({balance=10,providerCode=200,missingTask=false,interfere=false,earlyCallback=false}={}){
 const rows=new Map(),payloads=[];let credit=balance,collided=false;
 return {rows,payloads,get balance(){return credit;},async fetch(url,options={}){
  const u=new URL(url),body=options.body?JSON.parse(options.body):null;
  if(u.pathname==='/auth/v1/user')return Response.json({id:'verified-user'});
  if(u.hostname==='api.kie.ai'){
   payloads.push(body);
   if(earlyCallback){const row=[...rows.values()][0];row.meta={...row.meta,status:'done',task_id:'task-1'};row.result_url='https://result.test/image.png';}
   return Response.json({code:providerCode,msg:providerCode===200?'success':'rejected',data:providerCode===200?(missingTask?{}:{taskId:'task-1'}):null});
  }
  if(u.pathname==='/rest/v1/profiles'){
   if(options.method==='PATCH'){
    if(interfere&&!collided){credit-=1;collided=true;return Response.json([]);}
    if(Number(u.searchParams.get('credits').slice(3))!==credit)return Response.json([]);
    credit=body.credits;
   }
   return Response.json([{credits:credit}]);
  }
  assert.equal(u.pathname,'/rest/v1/user_generations',url);
  if(options.method==='POST'){
   if(rows.has(body.id))return Response.json({}, {status:409});
   rows.set(body.id,structuredClone(body));return Response.json([body]);
  }
  const id=u.searchParams.get('id')?.slice(3),row=rows.get(id);
  if(options.method==='PATCH'){assert.ok(row);Object.assign(row,structuredClone(body));}
  return Response.json(row?[structuredClone(row)]:[]);
 }};
}
const event=(body,auth=true)=>({httpMethod:'POST',headers:auth?{authorization:'Bearer test-session','x-user-id':'untrusted-user'}:{},body:JSON.stringify({prompt:'A blue bird',run_id:'run-test-123',...body})});
async function withMock(options,work){const m=mock(options),original=global.fetch;global.fetch=m.fetch;try{await work(m);}finally{global.fetch=original;}}

test('Nano 2.1 sends documented generation/edit inputs and debits real 0.3/0.5/0.7',async()=>{
 for(const [resolution,cost] of [['1K',.3],['2K',.5],['4K',.7]]) await withMock({},async m=>{
  const result=await nano(event({resolution,urls:resolution==='1K'?[]:['https://uploads.test/ref.png'],size:'1:8',format:'jpeg'}));
  assert.equal(result.statusCode,201);assert.equal(JSON.parse(result.body).cost,cost);assert.equal(m.balance,10-cost);
  const p=m.payloads[0];assert.equal(p.model,'nano-banana-2-1');assert.equal(p.input.resolution,resolution);assert.equal(p.input.aspect_ratio,'1:8');assert.equal(p.input.output_format,'jpg');assert.ok(Array.isArray(p.input.image_input));assert.ok(!('google_search' in p.input));
  assert.match(p.callBackUrl,/https:\/\/preview.test\/\.netlify\/functions\/kie-check\?uid=verified-user/);
  const row=[...m.rows.values()][0];assert.equal(row.user_id,'verified-user');assert.equal(row.meta.refund_amount,cost);assert.equal(row.meta.charged,true);assert.equal(row.meta.provider_api,'market');
 });
});
test('Flash selects generation vs edit endpoint, sends size not resolution, charges .3 for 1K/2K',async()=>{
 for(const resolution of ['1K','2K'])for(const urls of [[],['https://uploads.test/ref.png']])await withMock({},async m=>{
  const result=await flash(event({resolution,urls,size:'21:9',format:'jpg'}));assert.equal(result.statusCode,201);assert.equal(m.balance,9.7);
  const p=m.payloads[0];assert.equal(p.model,urls.length?'seedream/5-flash-image-to-image':'seedream/5-flash-text-to-image');assert.equal(p.input.size,resolution);assert.equal(p.input.output_format,'jpeg');assert.equal(p.input.nsfw_checker,true);assert.equal('resolution' in p.input,false);assert.equal('quality' in p.input,false);assert.deepEqual(p.input.image_urls,urls.length?urls:undefined);
 });
});
test('not enough credits rejects before provider submission; invalid sessions cannot debit',async()=>{
 await withMock({balance:.2},async m=>{const r=await nano(event({}));assert.equal(r.statusCode,402);assert.equal(m.balance,.2);assert.equal(m.payloads.length,0);});
 await withMock({},async m=>{const r=await flash(event({},false));assert.equal(r.statusCode,401);assert.equal(m.rows.size,0);assert.equal(m.payloads.length,0);});
});
test('provider rejection refunds reserved real credit amount',async()=>{
 await withMock({providerCode:422},async m=>{const r=await nano(event({resolution:'4K'}));assert.equal(r.statusCode,502);assert.equal(m.balance,10);assert.equal([...m.rows.values()][0].meta.refunded,true);});
});
test('HTTP 200 without a task ID fails and refunds reserved credits for new image models',async()=>{
 for(const handler of [nano,flash])await withMock({missingTask:true},async m=>{
  const r=await handler(event({}));assert.equal(r.statusCode,502);assert.equal(m.balance,10);
  const row=[...m.rows.values()][0];assert.equal(row.meta.status,'failed');assert.equal(row.meta.refunded,true);
 });
});
test('retry/concurrent identical run submits and charges only once',async()=>{
 await withMock({},async m=>{
  const results=await Promise.all([nano(event({})),nano(event({}))]);assert.ok(results.some(r=>r.statusCode===201));assert.equal(m.payloads.length,1);assert.equal(m.balance,9.7);
  const retry=await nano(event({}));assert.equal(retry.statusCode,200);assert.equal(JSON.parse(retry.body).already_submitted,true);assert.equal(m.payloads.length,1);assert.equal(m.balance,9.7);
 });
});
test('concurrent balance update is preserved, early callback completion is preserved',async()=>{
 await withMock({interfere:true,earlyCallback:true},async m=>{assert.equal((await flash(event({}))).statusCode,201);assert.equal(m.balance,8.7);const row=[...m.rows.values()][0];assert.equal(row.meta.status,'done');assert.equal(row.result_url,'https://result.test/image.png');});
});
test('rejects unsupported controls before debit or provider request',async()=>{
 for(const [handler,body] of [[nano,{urls:Array(11).fill('https://uploads.test/ref.png')}],[flash,{resolution:'4K'}],[flash,{size:'auto'}],[flash,{prompt:'x'.repeat(5001)}],[nano,{urls:['http://invalid.test/ref.png']}]])await withMock({},async m=>{assert.equal((await handler(event(body))).statusCode,400);assert.equal(m.payloads.length,0);assert.equal(m.balance,10);assert.equal(m.rows.size,0);});
});
function scripts(html){return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);}
function declaration(source,name){const ast=parse(source,{ecmaVersion:'latest'});const node=ast.body.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name===name));assert.ok(node,name);return source.slice(node.start,node.end);}
function fn(source,name){const node=parse(source,{ecmaVersion:'latest'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(node,name);return source.slice(node.start,node.end);}
test('all three localized pages have working controls, first model order, matching logos and 10x price display',()=>{
 for(const suffix of ['', '_arm','_ru']){
  const html=fs.readFileSync(path.join(root,`public/search-models${suffix}.html`),'utf8');const all=scripts(html);all.forEach(s=>parse(s,{ecmaVersion:'latest',sourceType:'script'}));const source=all.find(s=>s.includes('const MODELS ='));
  const sandbox={};vm.createContext(sandbox);
  vm.runInContext(declaration(source,'MODELS')+declaration(source,'IMAGE_MODEL_ORDER')+declaration(source,'__MULTI_APPEND_IMAGE_MODELS')+fn(source,'getModelUnitCreditValue')+fn(source,'getModelLogoUrl')+declaration(source,'MODEL_LOGO_BASE_URL')+';this.models=MODELS;this.order=IMAGE_MODEL_ORDER;this.append=__MULTI_APPEND_IMAGE_MODELS;',sandbox);
  assert.equal(sandbox.order[0],'nano-banana-2-1');
  for(const [id,resolutions,logo] of [['nano-banana-2-1',['1K','2K','4K'],'nano-banana-2'],['seedream-5-flash',['1K','2K'],'seedream-5-pro']]){
   const model=sandbox.models.find(m=>m.id===id);assert.ok(model);assert.deepEqual(Array.from(model.resolutionOptions),resolutions);assert.equal(model.maxFiles,10);assert.equal(model.uploadMaxMB,30);assert.equal(model.needsImage,false);assert.equal(sandbox.append.has(id),true);
   assert.equal(sandbox.getModelLogoUrl(model),sandbox.getModelLogoUrl({id:logo}));
   for(const resolution of resolutions){sandbox.currentResolution=resolution;assert.equal(sandbox.getModelUnitCreditValue(model)*10,id==='seedream-5-flash'?3:{'1K':3,'2K':5,'4K':7}[resolution]);}
  }
  if(suffix==='_arm'){assert.doesNotMatch(html,/վարկերը բավարար չեն/);assert.match(html,/Այս մոդելի համար կրեդիտները բավարար չեն/);}
  if(suffix==='_ru')assert.match(html,/Недостаточно кредитов для этой модели/);
 }
 const header=fs.readFileSync(path.join(root,'public/header.js'),'utf8');parse(header,{ecmaVersion:'latest'});
 assert.match(header,/const IMAGE_MENU_MODELS = \[\s*\{ label: 'Nano Banana 2\.1'/);
 const safe=fs.readFileSync(path.join(root,'netlify/functions/safe-run.cjs'),'utf8');assert.match(safe,/run-nano-banana-2-1/);assert.match(safe,/run-seedream-5-flash/);
});

test('new image jobs use the documented Market checker and archive only output images',async()=>{
 const checker=require('../../netlify/functions/kie-check.js').handler,original=global.fetch,calls=[];
 let row={id:'fixture-image-row',user_id:'verified-user',kind:'image',result_url:null,meta:{provider_api:'market',run_id:'fixture-run',task_id:'fixture-task',status:'processing',charged:true,refund_amount:.3,input_urls:['https://uploads.test/ref.png']}};
 global.fetch=async(raw,options={})=>{
  const u=new URL(raw);
  if(u.hostname==='api.kie.ai'){calls.push(u.pathname);return Response.json({code:200,data:{taskId:'fixture-task',state:'success',resultJson:JSON.stringify({resultUrls:['https://result.test/generated.png']})}});}
  if(u.hostname==='result.test')return new Response(Buffer.from([137,80,78,71]),{headers:{'Content-Type':'image/png'}});
  if(u.pathname.includes('/storage/'))return Response.json({ok:true});
  if(u.pathname.endsWith('/user_generations')){if(options.method==='PATCH')row={...row,...JSON.parse(options.body)};return Response.json([row]);}
  if(u.pathname.endsWith('/nb_results'))return Response.json([]);
  throw new Error('Unexpected mock URL: '+raw);
 };
 try{const r=await checker({httpMethod:'GET',queryStringParameters:{uid:'verified-user',run_id:'fixture-run',taskId:'fixture-task'}});const data=JSON.parse(r.body);assert.equal(data.status,'done');assert.deepEqual(calls,['/api/v1/jobs/recordInfo']);assert.equal(row.meta.status,'done');assert.match(data.result_url,/generation-history/);assert.notEqual(data.result_url,'https://uploads.test/ref.png');}finally{global.fetch=original;}
});

const seedream55=require('../../netlify/functions/run-seedream-5-5.js').handler;
const flux3=require('../../netlify/functions/run-flux-3-klein.js').handler;
const imagePricing=require('../../public/new-image-pricing.js');

test('Seedream 5.5 and FLUX 3 Klein prices keep at least a 30% margin in whole or half credits (shown ×10, debited as stored)',()=>{
 for(const [model,res,images,shown] of [['seedream-5-5','1K',0,3],['seedream-5-5','1.5K',0,3],['seedream-5-5','2K',0,4.5],['seedream-5-5','1K',1,4],['seedream-5-5','2K',2,7],['seedream-5-5','2K',10,15],['flux-3-klein','1K',0,1.5],['flux-3-klein','2K',3,2],['flux-3-klein','4K',0,5]]){
  const q=imagePricing.quote(model,{resolution:res,imageCount:images});
  assert.equal(q.displayedCredits,shown,`${model} ${res} ${images}`);assert.equal(q.internalCredits,Math.round(shown*10)/100);assert.equal(shown*2%1,0,'whole or half credits only');
  assert.ok(q.providerCostUSD/(q.displayedCredits/100)<=0.7+1e-9,`${model} ${res} margin`);
 }
 assert.throws(()=>imagePricing.quote('seedream-5-5',{resolution:'4K'}));assert.throws(()=>imagePricing.quote('flux-3-klein',{resolution:'1.5K'}));
 assert.throws(()=>imagePricing.quote('seedream-5-5',{imageCount:11}));
});

test('Seedream 5.5 sends the documented generation/edit inputs and debits the per-image price',async()=>{
 for(const [resolution,urls,cost] of [['1K',[],.3],['1.5K',[],.3],['2K',[],.45],['2K',['https://uploads.test/a.png','https://uploads.test/b.png'],.7]])await withMock({},async m=>{
  const result=await seedream55(event({resolution,urls,size:urls.length?'auto':'21:9',format:'png'}));assert.equal(result.statusCode,201,result.body);
  assert.equal(JSON.parse(result.body).cost,cost);assert.equal(m.balance,Number((10-cost).toFixed(2)));
  const p=m.payloads[0];assert.equal(p.model,urls.length?'seedream/5-5-image-to-image':'seedream/5-5-text-to-image');
  assert.equal(p.input.size,resolution);assert.equal(p.input.aspect_ratio,urls.length?'auto':'21:9');assert.equal(p.input.output_format,'png');assert.equal(p.input.nsfw_checker,true);assert.deepEqual(p.input.image_urls,urls.length?urls:undefined);
  const row=[...m.rows.values()][0];assert.equal(row.provider,'Seedream 5.5');assert.equal(row.meta.refund_amount,cost);
 });
 await withMock({},async m=>{await seedream55(event({size:'auto'}));assert.equal(m.payloads[0].input.aspect_ratio,'1:1');});
});

test('FLUX 3 Klein sends one documented image per job and charges the same for edits',async()=>{
 for(const [resolution,urls,cost] of [['1K',[],.15],['2K',['https://uploads.test/a.png'],.2],['4K',[],.5]])await withMock({},async m=>{
  const result=await flux3(event({resolution,urls,size:'9:21',format:'jpg'}));assert.equal(result.statusCode,201,result.body);assert.equal(m.balance,Number((10-cost).toFixed(2)));
  const p=m.payloads[0];assert.equal(p.model,urls.length?'flux-3/klein-edit-image':'flux-3/klein-text-to-image');
  assert.equal(p.input.resolution,resolution);assert.equal(p.input.aspect_ratio,'9:21');assert.equal(p.input.output_format,'jpeg');assert.equal('num_images' in p.input,false);assert.equal('size' in p.input,false);
 });
});

test('Seedream 5.5 / FLUX 3 Klein reject unsupported input before any debit',async()=>{
 for(const [handler,body] of [[seedream55,{prompt:'cat'}],[seedream55,{resolution:'4K'}],[seedream55,{size:'9:21'}],[flux3,{resolution:'1.5K'}],[flux3,{urls:Array(11).fill('https://uploads.test/a.png')}]])await withMock({},async m=>{assert.equal((await handler(event(body))).statusCode,400);assert.equal(m.payloads.length,0);assert.equal(m.balance,10);});
 await withMock({balance:.2},async m=>{assert.equal((await seedream55(event({}))).statusCode,402);assert.equal(m.payloads.length,0);});
});

test('pages list Seedream 5.5 (top 3, NEW) and FLUX 3 Klein, with prices shown ×10',()=>{
 for(const suffix of ['', '_arm','_ru']){
  const html=fs.readFileSync(path.join(root,`public/search-models${suffix}.html`),'utf8');const source=scripts(html).find(s=>s.includes('const MODELS ='));
  const sandbox={window:{NewImagePricing:imagePricing},uploadedFiles:[]};vm.createContext(sandbox);
  vm.runInContext(declaration(source,'MODELS')+declaration(source,'IMAGE_MODEL_ORDER')+declaration(source,'VIDEO_MODEL_ORDER')+declaration(source,'__MULTI_APPEND_IMAGE_MODELS')+fn(source,'getModelUnitCreditValue')+';this.models=MODELS;this.order=IMAGE_MODEL_ORDER;this.video=VIDEO_MODEL_ORDER;this.append=__MULTI_APPEND_IMAGE_MODELS;',sandbox);
  assert.equal(sandbox.order.indexOf('seedream-5-5'),2);assert.ok(sandbox.order.indexOf('flux-3-klein')>2);assert.equal(sandbox.video.indexOf('kling40-flash'),3);
  const sd=sandbox.models.find(m=>m.id==='seedream-5-5'),fx=sandbox.models.find(m=>m.id==='flux-3-klein'),kf=sandbox.models.find(m=>m.id==='kling40-flash');
  assert.equal(sd.isNew,true);assert.ok(!fx.isNew&&!fx.isTop);assert.equal(kf.isNew,true);assert.deepEqual(Array.from(kf.resolutionOptions),['720p']);
  assert.ok(sandbox.append.has('seedream-5-5')&&sandbox.append.has('flux-3-klein'));
  sandbox.currentModel=sd;sandbox.currentResolution='2K';sandbox.uploadedFiles=[{},{}];assert.equal(Math.round(sandbox.getModelUnitCreditValue(sd)*10*10)/10,7);
  sandbox.currentModel=fx;sandbox.currentResolution='4K';assert.equal(Math.round(sandbox.getModelUnitCreditValue(fx)*100)/10,5);
  assert.match(html,/new-image-pricing\.js\?v=/);
 }
 const safe=fs.readFileSync(path.join(root,'netlify/functions/safe-run.cjs'),'utf8');for(const name of ['run-seedream-5-5','run-flux-3-klein','run-kling-40-flash'])assert.match(safe,new RegExp(name));
 const header=fs.readFileSync(path.join(root,'public/header.js'),'utf8');assert.match(header,/id: 'seedream-5-5'.*badge: 'NEW'/);assert.match(header,/id: 'kling40-flash'.*badge: 'NEW'/);assert.doesNotMatch(header,/id: 'flux-3-klein'.*badge/);
 for(const suffix of ['', '_arm','_ru']){const page=fs.readFileSync(path.join(root,`public/models${suffix}.html`),'utf8');assert.match(page,/'seedream-5-5': 'NEW', 'kling40-flash': 'NEW'/);assert.match(page,/id: 'flux-3-klein'/);assert.doesNotMatch(page,/'flux-3-klein': '/);}
});

test('MAGI-2 is listed as NEW (3rd video model) on Search Models, the header and the models pages',()=>{
 const magi=require('../../public/magi-pricing.js');
 for(const suffix of ['', '_arm','_ru']){
  const html=fs.readFileSync(path.join(root,`public/search-models${suffix}.html`),'utf8');const source=scripts(html).find(s=>s.includes('const MODELS ='));
  const sandbox={window:{MagiPricing:magi},currentDuration:10};vm.createContext(sandbox);
  vm.runInContext(declaration(source,'MODELS')+declaration(source,'VIDEO_MODEL_ORDER')+fn(source,'getModelUnitCreditValue')+';this.models=MODELS;this.video=VIDEO_MODEL_ORDER;',sandbox);
  assert.equal(sandbox.video.indexOf('magi-2'),2);const m=sandbox.models.find(x=>x.id==='magi-2');assert.equal(m.isNew,true);assert.equal(m.specificUpload,'wan30');assert.deepEqual(Array.from(m.resolutionOptions),['1080p']);
  sandbox.currentModel=m;assert.equal(sandbox.getModelUnitCreditValue(m),11.5);assert.match(html,/magi-pricing\.js\?v=/);
 }
 assert.match(fs.readFileSync(path.join(root,'public/header.js'),'utf8'),/id: 'magi-2'.*badge: 'NEW'/);
 assert.match(fs.readFileSync(path.join(root,'netlify/functions/safe-run.cjs'),'utf8'),/run-magi-2/);
 for(const suffix of ['', '_arm','_ru'])assert.match(fs.readFileSync(path.join(root,`public/models${suffix}.html`),'utf8'),/'magi-2': 'NEW'/);
});

test('Recreate restores frames and references for reference video models before re-running',()=>{
 for(const suffix of ['', '_arm','_ru']){
  const html=fs.readFileSync(path.join(root,`public/search-models${suffix}.html`),'utf8');const source=scripts(html).find(s=>s.includes('const MODELS ='));
  const restore=fn(source,'restorePreviewGeneration');assert.match(restore,/if \(await restorePreviewReferenceInputs\(data \|\| \{\}, setStatus\)\) return;/);
  const refs=fn(source,'restorePreviewReferenceInputs');
  for(const key of ['first_frame_url','last_frame_url','reference_image_urls','reference_video_urls','reference_audio_urls'])assert.match(refs,new RegExp(key));
  assert.match(refs,/\['wan30', 'kling40', 'seedance'\]/);assert.match(refs,/restored < expected/);
 }
});
