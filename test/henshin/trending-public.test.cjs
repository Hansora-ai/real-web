const test=require('node:test'),assert=require('node:assert/strict');
process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test';
const {handler}=require('../../netlify/functions/henshin-templates');
const id='aaaaaaaa-1111-2222-3333-aaaaaaaaaaaa';
const row={id,created_at:'2026-10-13T12:00:00Z',prompt:'Motion template',result_url:'https://example.supabase.co/storage/v1/object/public/media/result.mp4',meta:{published:true,transformation_prompt:'Change only the jacket',reference_image_urls:['https://example.supabase.co/storage/v1/object/public/media/ref.png'],source_video_url:'https://example.supabase.co/storage/v1/object/public/media/source.mp4',mode:'edit',keep_audio:false,resolution:'1080p'}};
async function using(rows,work){const old=global.fetch,calls=[];global.fetch=async(url,options={})=>{calls.push({url:new URL(url),options});return new Response(JSON.stringify(rows));};try{await work(calls);}finally{global.fetch=old;}}
const get=query=>handler({httpMethod:'GET',headers:{},queryStringParameters:query});
test('Anonymous Trending detail resolves a published recipe without authentication or writes',()=>using([row],async calls=>{
 const res=await get({public_id:id});assert.equal(res.statusCode,200);const template=JSON.parse(res.body).template;
 assert.equal(template.created_at,row.created_at);assert.equal(template.prompt,row.meta.transformation_prompt);assert.equal(template.source_video_url,row.meta.source_video_url);assert.deepEqual(template.image_urls,row.meta.reference_image_urls);assert.equal(template.keep_audio,false);assert.equal(template.resolution,'1080p');
 assert.equal(calls.length,1);const {url,options}=calls[0];assert.ok(url.pathname.endsWith('/user_generations'));assert.equal(url.searchParams.get('id'),'eq.'+id);assert.equal(url.searchParams.get('meta->>published'),'eq.true');assert.equal(url.searchParams.get('provider'),'eq.Henshin Template');assert.equal(options.method,undefined);
}));
test('Public detail never exposes unpublished, deleting, missing or invalid templates',async()=>{
 for(const rows of [[],[{...row,meta:{...row.meta,published:false}}],[{...row,meta:{...row.meta,deleting:true}}]])await using(rows,async()=>assert.equal((await get({public_id:id})).statusCode,404));
 await using([row],async calls=>{assert.equal((await get({public_id:'invalid&pending=1'})).statusCode,400);assert.equal(calls.length,0);});
});
test('Public library retains published-only pagination and supplies chronological dates for Trending',()=>using(Array.from({length:25},(_,i)=>({...row,id:String(i)})),async calls=>{
 const res=await get({offset:'24'}),data=JSON.parse(res.body);assert.equal(res.statusCode,200);assert.equal(data.templates.length,24);assert.equal(data.next_offset,48);assert.equal(data.templates[0].created_at,row.created_at);
 const query=calls[0].url.searchParams;assert.equal(query.get('meta->>published'),'eq.true');assert.equal(query.get('offset'),'24');assert.equal(query.get('order'),'created_at.desc,id.desc');assert.ok(query.get('select').includes('created_at'));
}));
