const test=require('node:test'),assert=require('node:assert/strict');
const {createFeed,templateCard,templateHref,fetchTemplatesPage,text}=require('../../public/trend-feed.js');
const id=n=>`${String(n).padStart(8,'0')}-1111-2222-3333-aaaaaaaaaaaa`;
const row=(n,source='tutorial')=>({id:id(n),title:'Example '+n,created_at:new Date(Date.UTC(2026,9,n)).toISOString(),...(source==='henshin'?{video_url:'https://media.example/result.mp4',preview_url:'https://media.example/preview.mp4',poster_url:'https://media.example/poster.jpg'}:{cover_url:'https://media.example/tutorial.mp4'})});
function pages(items,size,calls=[]){return async offset=>{calls.push(offset);return {items:items.slice(offset,offset+size),nextOffset:offset+size<items.length?offset+size:null};};}
test('Both independently paginated sources merge newest first without losing buffered rows',async()=>{
 const tc=[],hc=[],feed=createFeed({tutorials:pages([10,8,6,4,2].map(n=>row(n)),2,tc),templates:pages([9,7,5,3,1].map(n=>row(n,'henshin')),3,hc),pageSize:3});
 const result=[];let page;do{page=await feed.next();assert.deepEqual(page.errors,[]);result.push(...page.items);}while(page.hasMore);
 assert.deepEqual(result.map(r=>r.id),[10,9,8,7,6,5,4,3,2,1].map(id));assert.deepEqual(tc,[0,2,4]);assert.deepEqual(hc,[0,3]);assert.equal(result.filter(r=>r.source==='henshin').length,5);
 assert.deepEqual((await feed.next()).items,[]);
});
test('Concurrent sentinel requests share one page and duplicates from pagination shifts are omitted',async()=>{
 let calls=0;const feed=createFeed({pageSize:2,tutorials:async start=>{calls++;await new Promise(r=>setTimeout(r,5));return start?{items:[row(4),row(3)],nextOffset:null}:{items:[row(5),row(4)],nextOffset:2};},templates:pages([] ,2)});
 const a=feed.next(),b=feed.next();assert.equal(a,b);assert.deepEqual((await a).items.map(r=>r.id),[5,4].map(id));assert.equal(calls,1);
 assert.deepEqual((await feed.next()).items.map(r=>r.id),[id(3)]);
});
test('One unavailable source preserves the other and invalid cursors cannot loop',async()=>{
 for(const failed of ['tutorials','templates']){
  const loaders={tutorials:pages([row(2)],12),templates:pages([row(1,'henshin')],24)};loaders[failed]=async()=>{throw Error('Unavailable');};
  const page=await createFeed(loaders).next();assert.equal(page.items.length,1);assert.equal(page.errors.length,1);assert.equal(page.hasMore,false);
 }
 const page=await createFeed({tutorials:async()=>({items:[],nextOffset:0}),templates:pages([],24)}).next();assert.match(page.errors[0].error.message,/cursor/);assert.equal(page.hasMore,false);
});
test('Published templates reuse lightweight previews and exclude invalid or deleting entries',()=>{
 const r=row(2,'henshin'),card=templateCard(r);assert.equal(card.cover_url,r.preview_url);assert.equal(card.cover_poster_url,r.poster_url);assert.equal(card.created_at,r.created_at);assert.equal(card.source,'henshin');
 assert.equal(templateCard({...r,preview_url:'javascript:alert(1)'}).cover_url,r.video_url);
 for(const changes of [{deleting:true},{id:'bad'},{video_url:'javascript:alert(1)'},{video_url:'https://user:pass@example.com/video.mp4'}])assert.equal(templateCard({...r,...changes}),null);
});
test('Invalid records and empty advancing pages do not hide later published templates',async()=>{
 const feed=createFeed({tutorials:pages([],12),templates:async offset=>offset===0?{items:[{id:'bad'}],nextOffset:24}:offset===24?{items:[],nextOffset:48}:{items:[row(1,'henshin')],nextOffset:null}});
 assert.deepEqual((await feed.next()).items.map(r=>r.id),[id(1)]);
});
test('Template links preserve locale and target the original recipe and editor',()=>{
 for(const [lang,suffix] of [['en',''],['ru','_ru'],['hy','_arm']]){
  assert.equal(templateHref(id(1),lang),`/henshin${suffix}.html?template=${id(1)}`);
  assert.equal(templateHref(id(1),lang,true),`/henshin-template${suffix}.html?id=${id(1)}`);
 }
 assert.equal(templateHref('bad&pending=1'),'');
 for(const lang of ['ru','hy']){assert.notEqual(text('No trend videos published yet.',lang),'No trend videos published yet.');assert.ok(text('Open Henshin example: {title}',lang,{title:'Custom $& title'}).includes('Custom $& title'));}
});
test('Public fetch only reads the published library, with no owner draft or write request',async()=>{
 const result=await fetchTemplatesPage(24,async(url,options)=>{assert.equal(url,'/.netlify/functions/henshin-templates?offset=24');assert.equal(options.cache,'no-store');assert.equal(options.method,undefined);assert.equal(options.headers,undefined);return new Response(JSON.stringify({ok:true,templates:[row(1,'henshin')],next_offset:48}));});
 assert.equal(result.nextOffset,48);assert.equal(result.items.length,1);
 await assert.rejects(fetchTemplatesPage(0,async()=>new Response(JSON.stringify({ok:false}),{status:503})),/Could not load/);
});
