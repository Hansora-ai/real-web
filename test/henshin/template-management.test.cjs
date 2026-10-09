const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test';
const {handler}=require('../../netlify/functions/henshin-templates');
const {removeFiles}=require('../../lib/henshin/template-storage.cjs');
const base=process.env.SUPABASE_URL+'/storage/v1/object/public/media/',id='aaaaaaaa-1111-2222-3333-aaaaaaaaaaaa';
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function services(){
 const state={row:{id,prompt:'Motion template',result_url:base+'example.mp4',meta:{source_feature:'henshin-template',published:true,duration:5,source_duration:5,aspect_ratio:16/9,source_video_url:base+'source.mp4',poster_url:base+'poster.jpg',preview_url:base+'preview.mp4',reference_image_urls:[base+'reference.png'],transformation_prompt:'Change the jacket',mode:'swap',resolution:'720p',keep_audio:true}},deleted:[],failDelete:false,user:{id:'owner',email:'hansora.ai.bot@gmail.com',email_confirmed_at:'today'},conflict:false,videoReads:0};
 state.fetch=async(raw,options={})=>{
  const u=new URL(raw);
  if(u.pathname.includes('/auth/'))return response(state.user);
  if(u.pathname.includes('/storage/')){
   if(options.method==='DELETE'){
    if(state.failDelete)return response({error:'unavailable'},503);
    state.deleted.push(...JSON.parse(options.body).prefixes);return response([]);
   }
   state.videoReads++;return new Response(fs.readFileSync('test/henshin/fixtures/source.mp4'));
  }
  assert.ok(u.pathname.endsWith('/user_generations'));
  if(u.searchParams.has('id')){assert.equal(u.searchParams.get('id'),'eq.'+id);assert.equal(u.searchParams.get('user_id'),'eq.owner');assert.equal(u.searchParams.get('provider'),'eq.Henshin Template');assert.equal(u.searchParams.get('meta->>source_feature'),'eq.henshin-template');}
  if(options.method==='DELETE'){assert.ok(state.deleted.length);state.row=null;return response([{id}]);}
  if(options.method==='PATCH'){
   if(state.conflict||!state.row||u.searchParams.get('meta')&&u.searchParams.get('meta')!=='eq.'+JSON.stringify(state.row.meta))return response([]);
   state.row={...state.row,...JSON.parse(options.body)};return response([state.row]);
  }
  return response(state.row?[state.row]:[]);
 };
 return state;
}
function event(method,body){return {httpMethod:method,headers:{authorization:'Bearer test'},body:JSON.stringify(body)};}
function recipe(row){const m=row.meta;return {id,video_url:row.result_url,source_video_url:m.source_video_url,poster_url:m.poster_url,preview_url:m.preview_url,image_urls:m.reference_image_urls,prompt:m.transformation_prompt,mode:m.mode,resolution:m.resolution,keep_audio:m.keep_audio};}
async function using(work){const old=global.fetch,state=services();global.fetch=state.fetch;try{await work(state);}finally{global.fetch=old;}}
test('Only the confirmed owner can read an editing recipe, edit or access pending deletions',()=>using(async state=>{
 for(const user of [{id:'owner',email:'visitor@example.com',email_confirmed_at:'today'},{id:'owner',email:'hansora.ai.bot@gmail.com'}]){
  state.user=user;
  for(const e of [{httpMethod:'GET',headers:{authorization:'Bearer test'},queryStringParameters:{id}},{httpMethod:'GET',headers:{authorization:'Bearer test'},queryStringParameters:{pending:'1'}},event('PATCH',recipe(state.row))])assert.equal((await handler(e)).statusCode,403);
 }
 assert.equal(state.videoReads,0);assert.equal(state.deleted.length,0);
}));
test('Owner edits update the same row and keep unchanged videos without downloading them again',()=>using(async state=>{
 const res=await handler(event('PATCH',{...recipe(state.row),prompt:'Make the jacket red',mode:'edit',resolution:'1080p',keep_audio:false}));assert.equal(res.statusCode,200);assert.equal(state.row.id,id);assert.equal(state.row.meta.transformation_prompt,'Make the jacket red');assert.equal(state.row.meta.resolution,'1080p');assert.equal(state.row.meta.keep_audio,false);assert.equal(state.videoReads,0);assert.equal(state.deleted.length,0);
 const loaded=JSON.parse((await handler({httpMethod:'GET',headers:{authorization:'Bearer test'},queryStringParameters:{id}})).body).template;assert.equal(loaded.prompt,'Make the jacket red');assert.equal(loaded.source_video_url,base+'source.mp4');
}));
test('Replacing media verifies the new example and deletes obsolete previews and references',()=>using(async state=>{
 const res=await handler(event('PATCH',{...recipe(state.row),video_url:base+'replacement.mp4',preview_url:base+'new-preview.mp4',poster_url:base+'new-poster.jpg',image_urls:[],mode:'edit'}));assert.equal(res.statusCode,200);assert.equal(state.videoReads,1);assert.equal(state.row.result_url,base+'replacement.mp4');assert.deepEqual(new Set(state.deleted),new Set(['example.mp4','poster.jpg','preview.mp4','reference.png']));assert.deepEqual(state.row.meta.retired_media_urls,[]);assert.ok(!state.deleted.includes('source.mp4'));
}));
test('Complete deletion removes example, source, preview, poster, references and retired files before deleting the row',()=>using(async state=>{
 state.row.meta.retired_media_urls=[base+'old-reference.png',base+'preview.mp4'];
 const res=await handler(event('DELETE',{id}));assert.equal(res.statusCode,200);assert.equal(state.row,null);assert.deepEqual(new Set(state.deleted),new Set(['example.mp4','source.mp4','poster.jpg','preview.mp4','reference.png','old-reference.png']));assert.equal(state.deleted.length,6);
}));
test('A failed Storage deletion remains retryable and never reports a completed deletion',()=>using(async state=>{
 state.failDelete=true;assert.equal((await handler(event('DELETE',{id}))).statusCode,502);assert.equal(state.row.meta.published,false);assert.equal(state.row.meta.deleting,true);
 assert.equal((await handler(event('PATCH',recipe(state.row)))).statusCode,400);
 const pending=JSON.parse((await handler({httpMethod:'GET',headers:{authorization:'Bearer test'},queryStringParameters:{pending:'1'}})).body);assert.equal(pending.templates[0].deleting,true);
 state.failDelete=false;assert.equal((await handler(event('DELETE',{id}))).statusCode,200);assert.equal(state.row,null);
}));
test('Failed cleanup after editing is retained for the next save or full deletion',()=>using(async state=>{
 state.failDelete=true;const res=await handler(event('PATCH',{...recipe(state.row),preview_url:base+'new-preview.mp4'}));assert.equal(JSON.parse(res.body).cleanup_pending,true);assert.deepEqual(state.row.meta.retired_media_urls,[base+'preview.mp4']);
 state.failDelete=false;assert.equal((await handler(event('DELETE',{id}))).statusCode,200);assert.ok(state.deleted.includes('preview.mp4'));assert.ok(state.deleted.includes('new-preview.mp4'));
}));
test('Concurrent changes cannot be overwritten or have their files deleted',()=>using(async state=>{
 state.conflict=true;assert.equal((await handler(event('PATCH',{...recipe(state.row),prompt:'Different'}))).statusCode,409);assert.equal((await handler(event('DELETE',{id}))).statusCode,409);assert.equal(state.deleted.length,0);assert.equal(state.row.meta.published,true);
}));
test('Storage cleanup uses exact decoded object keys and rejects external media URLs',()=>using(async state=>{
 await removeFiles([base+'folder/a%20b.mp4',base+'folder/a%20b.mp4']);assert.deepEqual(state.deleted,['folder/a b.mp4']);await assert.rejects(removeFiles(['https://attacker.test/file.mp4']),/Invalid template media/);
}));
