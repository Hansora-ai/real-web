/* A read-only feed of tutorials and published Henshin templates. Media stays in its original storage. */
(function(root){
 'use strict';
 const copy={
  'Loading trend videos…':{ru:'Загружаем трендовые видео…',hy:'Թրենդային տեսանյութերը բեռնվում են…'},
  'Could not load examples.':{ru:'Не удалось загрузить примеры.',hy:'Չհաջողվեց բեռնել օրինակները։'},
  'Some trend videos could not load. Refresh to try again.':{ru:'Некоторые видео не удалось загрузить. Обновите страницу, чтобы попробовать снова.',hy:'Որոշ տեսանյութեր չհաջողվեց բեռնել։ Նորից փորձելու համար թարմացրեք էջը։'},
  'No trend videos published yet.':{ru:'Трендовых видео пока нет.',hy:'Թրենդային տեսանյութեր դեռ հրապարակված չեն։'},
  'Open tutorial: {title}':{ru:'Открыть инструкцию: {title}',hy:'Բացել ուղեցույցը՝ {title}'},
  'Open Henshin example: {title}':{ru:'Открыть пример Henshin: {title}',hy:'Բացել Henshin-ի օրինակը՝ {title}'},
  'Edit in Henshin':{ru:'Изменить в Henshin',hy:'Խմբագրել Henshin-ում'},
  'Motion template':{ru:'Шаблон движения',hy:'Շարժման ձևանմուշ'},
 };
 function text(key,language='en',values={}){
  return (copy[key]?.[language]||key).replace(/\{([a-z]+)\}/g,(slot,name)=>values[name]===undefined?slot:String(values[name]));
 }
 const validID=id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||'');
 const safeURL=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}};
 function templateCard(item){
  if(!validID(item?.id)||item.deleting||!safeURL(item.video_url))return null;
  return {id:item.id,source:'henshin',title:item.title||'Motion template',cover_url:safeURL(item.preview_url)||safeURL(item.video_url),cover_poster_url:safeURL(item.poster_url),published:true,created_at:item.created_at||''};
 }
 const suffix=language=>language==='hy'?'_arm':language==='ru'?'_ru':'';
 function templateHref(id,language='en',edit=false){
  if(!validID(id))return '';
  return `/henshin${edit?'-template':''}${suffix(language)}.html?${edit?'id':'template'}=${encodeURIComponent(id)}`;
 }
 function compare(a,b){
  return (Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0)||String(b.id).localeCompare(String(a.id))||String(a.source).localeCompare(String(b.source));
 }
 function createFeed({tutorials,templates,pageSize=12}){
  const seen=new Set();
  const streams=[{name:'tutorial',load:tutorials},{name:'henshin',load:templates}].map(s=>({...s,offset:0,items:[],done:false,error:null}));
  async function fill(stream){
   while(!stream.items.length&&!stream.done&&!stream.error){
    try{
     const page=await stream.load(stream.offset);
     if(!Array.isArray(page?.items))throw Error('Invalid trend feed page.');
     const next=page.nextOffset;
     if(next!=null&&(!Number.isSafeInteger(next)||next<=stream.offset))throw Error('Invalid trend feed cursor.');
     stream.items=page.items.map(row=>stream.name==='henshin'?templateCard(row):({...row,source:'tutorial'})).filter(Boolean);
     stream.done=next==null;if(!stream.done)stream.offset=next;
    }catch(error){stream.error=error;}
   }
  }
  let pending=null;
  async function read(){
   const items=[];
   while(items.length<pageSize){
    await Promise.all(streams.map(fill));
    const candidates=streams.filter(s=>s.items.length).sort((a,b)=>compare(a.items[0],b.items[0]));
    if(!candidates.length)break;
    const row=candidates[0].items.shift(),key=row.source+':'+row.id;
    if(seen.has(key))continue;seen.add(key);items.push(row);
   }
   return {items,hasMore:streams.some(s=>s.items.length||(!s.done&&!s.error)),errors:streams.filter(s=>s.error).map(s=>({source:s.name,error:s.error}))};
  }
  return {next(){if(!pending)pending=read().finally(()=>{pending=null;});return pending;}};
 }
 async function fetchTemplatesPage(offset=0,fetcher=root.fetch.bind(root)){
  const response=await fetcher('/.netlify/functions/henshin-templates?offset='+offset,{cache:'no-store',signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  if(!response.ok||!data.ok||!Array.isArray(data.templates))throw Error('Could not load Henshin templates.');
  return {items:data.templates,nextOffset:data.next_offset??null};
 }
 const api={text,validID,templateCard,templateHref,createFeed,fetchTemplatesPage};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.HansoraTrends=api;
})(typeof window==='object'?window:globalThis);
