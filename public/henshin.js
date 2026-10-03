(() => {
 'use strict';
 const $=id=>document.getElementById(id), config=window.HenshinConfig;
 const sb=window.__HANSORA_SB__||window.supabase.createClient(config.url,config.key);window.__HANSORA_SB__=sb;
 const OWNER='hansora.ai.bot@gmail.com';
 let source=null,seconds=0,sourceURL='',images=[],resolution='720p',mode='motion',filter='all',busy=false,rows=[],refreshing=false,sessionUser='',uploadingTemplate=false;
 let sourceSelection=0;
 const restoring=new Set(),failedAudio=new Map();
 const rates={'480p':2,'720p':4.2,'1080p':9};
 function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
 function cost(){return seconds?Math.round(Math.ceil(seconds)*rates[resolution]*10):rates[resolution]*10;}
 function update(){ $('cost').textContent=`${cost()} ⚡${seconds?'':' / s'}`;$('generate').disabled=busy||!source||!seconds||!images.length; }
 async function session(){return (await sb.auth.getSession()).data.session;}
 async function request(route,body){
  const s=await session();if(!s) throw Error('Sign in first.');
  const r=await fetch('/.netlify/functions/'+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token},body:JSON.stringify(body)});
  const data=await r.json();if(!r.ok||!data.ok) throw Error(data.error||'Request failed.');return data;
 }
 async function upload(file){const result=await window.kieUploadBridge.upload(file,{bucket:'video'});if(!result.publicUrl) throw Error('Upload failed.');return result.publicUrl;}
 async function setSource(file){
  if(busy) return;
  if(!file||!file.type.startsWith('video/')||file.size>100*1024*1024){status('Choose a video smaller than 100 MB.',true);return;}
  const selection=++sourceSelection;
  try {
   const d=await window.HenshinMedia.duration(file);
   if(selection!==sourceSelection)return;
   if(d<4||d>30) throw Error('Choose a source video between 4 and 30 seconds.');
   if(sourceURL) URL.revokeObjectURL(sourceURL);
   source=file;seconds=d;sourceURL=URL.createObjectURL(file);$('sourceVideo').src=sourceURL;
   $('sourceName').textContent=`${file.name} · ${d.toFixed(2)}s`;$('sourcePreview').hidden=false;$('videoDrop').hidden=true;status('');update();
  }catch(e){status(e.message,true);}
 }
 function clearSource(){if(busy)return;sourceSelection++;source=null;seconds=0;if(sourceURL)URL.revokeObjectURL(sourceURL);sourceURL='';$('sourceVideo').removeAttribute('src');$('sourceVideo').load();$('videoInput').value='';$('sourcePreview').hidden=true;$('videoDrop').hidden=false;update();}
 async function addImages(files){
  if(busy)return;
  for(const file of files){if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){status('Use JPG, PNG or WebP images smaller than 10 MB.',true);continue;}try{const bitmap=await createImageBitmap(file);const ratio=bitmap.width/bitmap.height;const valid=bitmap.width>300&&bitmap.width<6000&&bitmap.height>300&&bitmap.height<6000&&ratio>.4&&ratio<2.5;bitmap.close();if(!valid)throw Error('Reference images must be 301–5999 px on each side, with an aspect ratio between 0.4 and 2.5.');if(busy)return;if(images.length<30)images.push({file,url:URL.createObjectURL(file)});}catch(e){status(e.message||'Could not read reference image.',true);}}
  renderImages();update();
 }
 function renderImages(){
  $('imageGrid').replaceChildren();images.forEach((item,index)=>{const tile=document.createElement('div'),img=document.createElement('img'),remove=document.createElement('button');img.src=item.url;img.alt=`Reference ${index+1}`;remove.textContent='×';remove.setAttribute('aria-label',`Remove reference ${index+1}`);remove.onclick=()=>{if(busy)return;URL.revokeObjectURL(item.url);images.splice(index,1);renderImages();update();};tile.append(img,remove);$('imageGrid').append(tile);});
 }
 function drop(id,input,handle){
  const el=$(id);el.onclick=()=>$(input).click();$(input).onchange=e=>handle(Array.from(e.target.files));
  for(const name of ['dragenter','dragover'])el.addEventListener(name,e=>{e.preventDefault();el.classList.add('drag');});
  for(const name of ['dragleave','drop'])el.addEventListener(name,e=>{e.preventDefault();el.classList.remove('drag');});
  el.addEventListener('drop',e=>handle(Array.from(e.dataTransfer.files)));
 }
 drop('videoDrop','videoInput',files=>setSource(files[0]));drop('imagesDrop','imagesInput',addImages);$('clearVideo').onclick=clearSource;
 for(const button of document.querySelectorAll('[data-resolution]'))button.onclick=()=>{if(busy)return;resolution=button.dataset.resolution;document.querySelectorAll('[data-resolution]').forEach(b=>b.classList.toggle('active',b===button));update();};
 for(const button of document.querySelectorAll('[data-mode]'))button.onclick=()=>{if(busy)return;mode=button.dataset.mode;document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b===button));$('prompt').placeholder=mode==='swap'?'Describe exactly which character, outfit, object or location to replace.':'Replace the main character with my references. Keep the scene and camera unchanged.';};
 for(const button of document.querySelectorAll('[data-filter]'))button.onclick=()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b===button));renderResults();};
 function preview(url){$('previewVideo').src=url;$('previewDownload').href=url;$('previewDialog').showModal();$('previewVideo').play().catch(()=>{});}
 $('previewClose').onclick=()=>$('previewDialog').close();$('previewDialog').addEventListener('close',()=>{$('previewVideo').pause();$('previewVideo').removeAttribute('src');$('previewVideo').load();});
 function isHenshin(row){return row.meta?.source_feature==='henshin';}
 function isSeedance(row){return row.meta?.engine==='seedance-2.5'||row.provider==='Seedance 2.5';}
 function action(label,fn){const button=document.createElement('button');button.textContent=label;button.onclick=fn;return button;}
 async function download(url){try{const r=await fetch(url);if(!r.ok)throw Error();const blobURL=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=blobURL;a.download='hansora-henshin.mp4';a.click();setTimeout(()=>URL.revokeObjectURL(blobURL),1000);}catch{window.open(url,'_blank','noopener');}}
 function renderResults(){
  $('resultsList').replaceChildren();const visible=rows.filter(row=>filter==='all'||(filter==='henshin'?isHenshin(row):isSeedance(row)));$('empty').hidden=visible.length>0;
  for(const row of visible){
   const meta=row.meta||{},audioPending=isHenshin(row)&&meta.source_audio_url&&!meta.audio_restored,ready=!!row.result_url&&!audioPending,failed=/fail|reject|cancel/.test(meta.status||''),card=document.createElement('article');card.className='result';
   const badge=document.createElement('span');badge.className='badge';badge.textContent=`${isHenshin(row)?'HENSHIN':'SEEDANCE 2.5'} · ${ready?'READY':failed?'FAILED':row.result_url?'RESTORING AUDIO':'GENERATING'}`;card.append(badge);
   if(ready){const video=document.createElement('video');video.src=row.result_url;video.controls=true;video.playsInline=true;video.preload='metadata';card.append(video);}else{const processing=document.createElement('div');processing.className='processing';processing.textContent=failed?'Generation failed':failedAudio.get(row.id)|| (audioPending&&row.result_url?'Restoring your original soundtrack…':'Your transformation is processing…');card.append(processing);}
   const title=document.createElement('h3');title.textContent=new Date(row.created_at||Date.now()).toLocaleString();const actions=document.createElement('div');actions.className='result-actions';card.append(title,actions);
   if(ready)actions.append(action('Preview',()=>preview(row.result_url)),action('Download ↓',()=>download(row.result_url)));
   if(ready&&isHenshin(row)&&meta.video_url)actions.append(action('Recreate',async()=>{try{await loadRemoteSource(meta.video_url,'Original motion');$('prompt').value='';window.scrollTo({top:0,behavior:'smooth'});}catch(e){status(e.message,true);}}));
   if(failedAudio.has(row.id))actions.append(action('Retry audio',()=>{failedAudio.delete(row.id);restore(row);}),action('Preview generated video',()=>preview(row.result_url)));
   $('resultsList').append(card);
   if(audioPending&&row.result_url&&!restoring.has(row.id)&&!failedAudio.has(row.id))restore(row);
  }
 }
 async function restore(row){
  if(restoring.has(row.id))return;restoring.add(row.id);
  try{
   const media=await window.HenshinMedia.restoreAudio(row.result_url,row.meta.source_audio_url,Number(row.meta.source_video_duration));
   const url=await upload(media);const saved=await request('henshin-result',{id:row.id,result_url:url});
   row.result_url=saved.result_url;row.meta.audio_restored=true;status('Henshin is ready with the original soundtrack.');
  }catch(e){failedAudio.set(row.id,e.message);status(e.message,true);}finally{restoring.delete(row.id);renderResults();}
 }
 async function refresh(){
  if(refreshing)return;refreshing=true;
  try{
   const s=await session();
   if(!s){rows=[];sessionUser='';renderResults();return;}
   if(sessionUser!==s.user.id){rows=[];failedAudio.clear();sessionUser=s.user.id;}
   const {data,error}=await sb.from('user_generations').select('id,provider,prompt,result_url,meta,created_at').eq('user_id',s.user.id).eq('kind','video').order('created_at',{ascending:false}).limit(100);
   if(error)throw error;rows=(data||[]).filter(row=>isHenshin(row)||isSeedance(row));
   // Resume shared KIE checking after navigation or a browser reload.
   await Promise.allSettled(rows.filter(row=>!row.result_url&&!/fail|reject|cancel/.test(row.meta?.status||'')&&row.meta?.task_id).map(async row=>{
    const qs=new URLSearchParams({uid:s.user.id,run_id:row.meta.run_id,taskId:row.meta.task_id});const r=await fetch('/.netlify/functions/kie-check?'+qs,{cache:'no-store'});const data=await r.json();const url=data.result_url||data.video_url||data.urls?.[0];if(url)row.result_url=url;if(data.failed)row.meta.status='failed';
   }));renderResults();
  }catch(e){status('Could not load recent generations. '+e.message,true);}finally{refreshing=false;}
 }
 $('generate').onclick=async()=>{
  if(busy||!source||!images.length||!seconds)return;
  const s=await session();if(!s){status('Sign in to generate.',true);window.HansoraHeader?.openAuth?.();return;}
  if(mode==='swap'&&!$('prompt').value.trim()){status('Describe the element you want to swap.',true);return;}
  busy=true;update();
  const input=source,refs=images.map(i=>i.file),duration=seconds,quality=resolution,chosenMode=mode,prompt=$('prompt').value,preserve=$('keepAudio').checked;
  try{
   let audio=null;if(preserve){status('Extracting the original soundtrack…');audio=await window.HenshinMedia.extractAudio(input);}
   status('Preparing a compatible MP4 source…');const prepared=await window.HenshinMedia.compress(input);
   status('Uploading your source video and references…');const videoURL=await upload(prepared),imageURLs=[];for(const file of refs) imageURLs.push(await upload(file));const audioURL=audio?await upload(audio):null;
   status('Starting your transformation…');
   const data=await request('run-henshin',{run_id:crypto.randomUUID(),video_url:videoURL,image_urls:imageURLs,audio_url:audioURL,source_video_duration:duration,resolution:quality,mode:chosenMode,prompt});
   if(data.credits!==undefined)window.HansoraHeader?.setCredits?.(data.credits);
   window.HansoraHeader?.startCreditsPolling?.(90000,1500);status(data.submission_uncertain?data.message:audio?'Generating. Your original audio will be restored when the video is ready.':'Generating your Henshin video…');await refresh();
  }catch(e){status(e.message,true);}finally{busy=false;update();}
 };
 async function loadRemoteSource(url,name){if(busy)throw Error('Wait for the current upload to finish.');const r=await fetch(url);if(!r.ok)throw Error('Could not load this template.');const blob=await r.blob();await setSource(new File([blob],name+'.mp4',{type:blob.type||'video/mp4'}));}
 async function loadTemplates(){
  $('templatesList').textContent='Loading templates…';
  try{const r=await fetch('/.netlify/functions/henshin-templates',{cache:'no-store'}),data=await r.json();if(!r.ok||!data.ok)throw Error(data.error||'Could not load templates.');$('templatesList').replaceChildren();if(!data.templates.length)$('templatesList').textContent='Templates are coming soon.';
   for(const template of data.templates){const card=document.createElement('article');card.className='template';const v=document.createElement('video');v.src=template.video_url;v.controls=true;v.muted=true;v.playsInline=true;v.preload='metadata';const title=document.createElement('h3');title.textContent=template.title;const button=action('Recreate ↗',async()=>{button.disabled=true;try{await loadRemoteSource(template.video_url,template.title);$('templatesDialog').close();status('Template loaded. Add your character images to make it yours.');window.scrollTo({top:0,behavior:'smooth'});}catch(e){$('templateStatus').textContent=e.message;}finally{button.disabled=false;}});button.className='secondary';card.append(v,title,button);$('templatesList').append(card);}
  }catch(e){$('templatesList').textContent=e.message;}
 }
 $('templatesOpen').onclick=async()=>{$('templatesDialog').showModal();const s=await session();$('ownerControls').hidden=!(s?.user.email_confirmed_at&&s.user.email?.toLowerCase()===OWNER);await loadTemplates();};
 $('templatesClose').onclick=()=>$('templatesDialog').close();$('templatesDialog').addEventListener('close',()=>$('templatesList').querySelectorAll('video').forEach(v=>v.pause()));
 $('templateInput').onchange=async e=>{
  const file=e.target.files[0];if(!file||uploadingTemplate)return;uploadingTemplate=true;e.target.disabled=true;
  try{if(file.size>100*1024*1024)throw Error('Choose a video smaller than 100 MB.');const d=await window.HenshinMedia.duration(file);if(d<4||d>30)throw Error('Templates must be 4–30 seconds.');$('templateStatus').textContent='Compressing template to MP4…';const compressed=await window.HenshinMedia.compress(file);$('templateStatus').textContent='Uploading template…';const url=await upload(compressed);await request('henshin-templates',{title:$('templateTitle').value.trim()||file.name.replace(/\.[^.]+$/,''),video_url:url,duration:await window.HenshinMedia.duration(compressed)});$('templateStatus').textContent='Template published.';await loadTemplates();}catch(e){$('templateStatus').textContent=e.message;}finally{uploadingTemplate=false;e.target.disabled=false;e.target.value='';}
 };
 update();refresh();setInterval(()=>{if(document.visibilityState==='visible'&&!busy)refresh();},12000);sb.auth.onAuthStateChange((_event,s)=>{ $('ownerControls').hidden=!(s?.user.email_confirmed_at&&s.user.email?.toLowerCase()===OWNER);setTimeout(refresh,0);});
})();
