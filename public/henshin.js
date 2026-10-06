(() => {
 'use strict';
 const $=id=>document.getElementById(id), config=window.HenshinConfig;
 const sb=window.__HANSORA_SB__||window.supabase.createClient(config.url,config.key);window.__HANSORA_SB__=sb;
 const OWNER='hansora.ai.bot@gmail.com';
 let source=null,seconds=0,sourceURL='',images=[],resolution='720p',mode='motion',filter='all',busy=false,rows=[],refreshing=false,sessionUser='',uploadingTemplate=false;
 let sourceSelection=0,activePreview=null,submission=null;
 const restoring=new Set(),failedAudio=new Map();
 const rates={'480p':2,'720p':4.2,'1080p':9};
 function status(text,error=false){if(busy&&submission){submission=text;renderResults();}$('status').textContent=text;$('status').classList.toggle('error',error);}
 function cost(){return seconds?Math.round(Math.ceil(seconds)*rates[resolution]*10):rates[resolution]*10;}
 function update(){ $('cost').hidden=!seconds; $('cost').textContent=seconds?`${cost()} credits`:'';$('generate').disabled=busy||!source||!seconds||!images.length; }
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
   $('sourceName').textContent=`${file.name} · ${d.toFixed(2)}s`;$('sourcePreview').hidden=false;$('videoDrop').hidden=true;status('');update();return true;
  }catch(e){status(e.message,true);return false;}
 }
 function clearSource(){if(busy)return;sourceSelection++;source=null;seconds=0;if(sourceURL)URL.revokeObjectURL(sourceURL);sourceURL='';$('sourceVideo').removeAttribute('src');$('sourceVideo').load();$('videoInput').value='';$('sourcePreview').hidden=true;$('videoDrop').hidden=false;update();}
 async function addImages(files){
  if(busy)return;
  for(const file of files){if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){status('Use JPG, PNG or WebP images smaller than 10 MB.',true);continue;}try{const bitmap=await createImageBitmap(file);const ratio=bitmap.width/bitmap.height;const valid=bitmap.width>300&&bitmap.width<6000&&bitmap.height>300&&bitmap.height<6000&&ratio>.4&&ratio<2.5;bitmap.close();if(!valid)throw Error('Reference images must be 301–5999 px on each side, with an aspect ratio between 0.4 and 2.5.');if(busy)return;if(images.length<30)images.push({file,url:URL.createObjectURL(file)});}catch(e){status(e.message||'Could not read reference image.',true);}}
  renderImages();update();
 }
 function renderImages(){
  const grid=$('imageGrid');grid.replaceChildren();grid.hidden=!images.length;$('imagesAddEmpty').hidden=!!images.length;
  $('imagesDrop').classList.toggle('has-images',!!images.length);
  if(!images.length)return;
  const add=document.createElement('button');add.type='button';add.className='image-add-tile';add.setAttribute('aria-label','Add reference images');add.title='Add reference images';add.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';add.disabled=busy||images.length>=30;add.onclick=()=>{if(!busy&&images.length<30)$('imagesInput').click();};grid.append(add);
  images.forEach((item,index)=>{const tile=document.createElement('div'),img=document.createElement('img'),remove=document.createElement('button');tile.className='image-reference-tile';img.src=item.url;img.alt=`Reference ${index+1}`;remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`Remove reference ${index+1}`);remove.onclick=()=>{if(busy)return;URL.revokeObjectURL(item.url);images.splice(index,1);renderImages();update();};tile.append(img,remove);grid.append(tile);});
 }
 function drop(id,input,handle){
  const el=$(id);if(el.tagName==='BUTTON')el.onclick=()=>$(input).click();$(input).onchange=e=>{const files=Array.from(e.target.files);e.target.value='';handle(files);};
  for(const name of ['dragenter','dragover'])el.addEventListener(name,e=>{e.preventDefault();el.classList.add('drag');});
  for(const name of ['dragleave','drop'])el.addEventListener(name,e=>{e.preventDefault();el.classList.remove('drag');});
  el.addEventListener('drop',e=>handle(Array.from(e.dataTransfer.files)));
 }
 drop('videoDrop','videoInput',files=>setSource(files[0]));drop('imagesDrop','imagesInput',addImages);$('clearVideo').onclick=clearSource;$('imagesAddEmpty').onclick=()=>{if(!busy)$('imagesInput').click();};
 for(const button of document.querySelectorAll('[data-resolution]'))button.onclick=()=>{if(busy)return;resolution=button.dataset.resolution;document.querySelectorAll('[data-resolution]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});update();};
 for(const button of document.querySelectorAll('[data-mode]'))button.onclick=()=>{if(busy)return;mode=button.dataset.mode;document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});$('promptHint').textContent=mode!=='motion'?'Required':'Optional';$('prompt').placeholder=mode!=='motion'?'Describe exactly what to change in the video.':'Replace the main character with my references. Keep the scene and camera unchanged.';};
 for(const button of document.querySelectorAll('[data-filter]'))button.onclick=()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});renderResults();};
 const modeName=value=>({motion:'Motion transfer',swap:'Object swap',edit:'Video edit'}[value]||'Motion transfer');
 const iconPaths={preview:'<rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 6-3v10l-6-3"/>',recreate:'<path d="M4 10a8 8 0 0 1 13.7-4.7L20 7.5M20 3v4.5h-4.5M20 14a8 8 0 0 1-13.7 4.7L4 16.5M4 21v-4.5h4.5"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M5 21h14"/>'};
 function decorate(button,kind,label){button.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[kind]}</svg>`;button.setAttribute('aria-label',label);button.title=label;return button;}
 function preview(item){
  activePreview=typeof item==='string'?{video_url:item,title:'Video preview'}:item;
  const data=activePreview;$('previewVideo').src=data.video_url;$('previewTitle').textContent=data.title||'Henshin';
  $('previewPrompt').textContent=data.prompt||'No additional prompt.';$('previewModel').textContent='Henshin · '+modeName(data.mode);$('previewQuality').textContent=data.resolution||'—';
  $('previewStatus').textContent='';$('previewAssets').replaceChildren();
  if(data.source_video_url){const box=document.createElement('div'),v=document.createElement('video'),label=document.createElement('span');v.src=data.source_video_url;v.controls=true;v.muted=true;v.playsInline=true;v.preload='metadata';v.setAttribute('aria-label','Source video');label.textContent='Source video';box.append(v,label);$('previewAssets').append(box);}
  for(const [i,url] of (data.image_urls||[]).entries()){const box=document.createElement('div'),img=document.createElement('img'),label=document.createElement('span');img.src=url;img.alt=`Reference ${i+1}`;label.textContent=`Image ${i+1}`;box.append(img,label);$('previewAssets').append(box);}
  $('previewRecreate').hidden=!data.source_video_url;$('previewDialog').showModal();$('previewVideo').play().catch(()=>{});
 }
 $('previewClose').onclick=()=>$('previewDialog').close();
 $('previewDialog').addEventListener('close',()=>{$('previewDialog').querySelectorAll('video').forEach(v=>{v.pause();v.removeAttribute('src');v.load();});activePreview=null;});
 $('previewCopy').onclick=async()=>{try{await navigator.clipboard.writeText(activePreview?.prompt||'');$('previewStatus').textContent='Prompt copied.';}catch{$('previewStatus').textContent='Select the prompt text to copy it.';}};
 $('previewRecreate').onclick=async()=>{const button=$('previewRecreate');button.disabled=true;try{await recreate(activePreview);$('previewDialog').close();}catch(e){$('previewStatus').textContent=e.message;}finally{button.disabled=false;}};
 $('previewDownload').onclick=()=>activePreview&&download(activePreview.video_url);
 for(const [id,kind,label]of [['previewRecreate','recreate','Recreate'],['previewDownload','download','Download']]){const b=$(id);decorate(b,kind,label);const span=document.createElement('span');span.textContent=label;b.append(span);}
 function rowDetails(row){const m=row.meta||{};return {title:isHenshin(row)?'Henshin · '+modeName(m.mode):'Seedance 2.5',video_url:row.result_url,source_video_url:m.video_url||m.reference_video_urls?.[0],image_urls:m.reference_image_urls||[],prompt:m.user_prompt??row.prompt??'',mode:m.mode||'motion',resolution:m.resolution||'720p',keep_audio:m.keep_audio!==false};}
 function generationStage(stage,label){const box=document.createElement('div');box.className='generation-stage';box.dataset.stage=stage;box.innerHTML='<div class="generation-stage-icon" aria-hidden="true"><span class="request-loading-spinner"></span><span class="generation-stage-core"></span></div><div class="generation-stage-label"></div>';box.querySelector('.generation-stage-label').textContent=label;return box;}
 function isHenshin(row){return row.meta?.source_feature==='henshin';}
 function isSeedance(row){return row.meta?.engine==='seedance-2.5'||row.provider==='Seedance 2.5';}
 function action(label,fn){const button=document.createElement('button');button.textContent=label;button.onclick=fn;return button;}
 async function download(url){try{const r=await fetch(url);if(!r.ok)throw Error();const blobURL=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=blobURL;a.download='hansora-henshin.mp4';a.click();setTimeout(()=>URL.revokeObjectURL(blobURL),1000);}catch{window.open(url,'_blank','noopener');}}
 function renderResults(){
  $('resultsList').replaceChildren();const visible=rows.filter(row=>filter==='all'||(filter==='henshin'?isHenshin(row):isSeedance(row)));$('empty').hidden=visible.length>0||!!submission;
  if(submission){const card=document.createElement('article');card.className='result';card.append(generationStage('requesting',submission));$('resultsList').append(card);}
  for(const row of visible){
   const meta=row.meta||{},audioPending=isHenshin(row)&&meta.source_audio_url&&!meta.audio_restored,failed=/fail|error|reject|cancel/.test(meta.status||''),ready=!!row.result_url&&!audioPending&&!failed,card=document.createElement('article');card.className='result';
   const badge=document.createElement('span');badge.className='badge';badge.textContent=isHenshin(row)?'HENSHIN · '+modeName(meta.mode).toUpperCase():'SEEDANCE 2.5';card.append(badge);
   const media=document.createElement('div');media.className='result-media';card.append(media);
   if(ready){const video=document.createElement('video');video.src=row.result_url;video.controls=true;video.playsInline=true;video.preload='metadata';media.append(video);}
   else if(failed){const box=document.createElement('div');box.className='result-failed-state';const symbol=document.createElement('span');symbol.className='result-failed-icon';symbol.textContent='×';const label=document.createElement('strong');label.textContent='Failed';const copy=document.createElement('p');copy.textContent=meta.error||'Generation wasn’t completed';box.append(symbol,label,copy);media.append(box);}
   else{const queued=/queued/.test(meta.status||''),requesting=/requesting|uploading|preparing/.test(meta.status||''),audio=audioPending&&row.result_url;media.append(generationStage(audio?'requesting':queued?'queued':requesting?'requesting':'generating',failedAudio.get(row.id)||(audio?'Restoring original audio…':queued?'In Queue':requesting?'Processing request…':'Generating')));}
   const title=document.createElement('h3');title.textContent=new Date(row.created_at||Date.now()).toLocaleString();const actions=document.createElement('div');actions.className='result-actions';card.append(title,actions);
   if(ready){const details=rowDetails(row);actions.append(decorate(action('',()=>preview(details)),'preview','Preview'));if(details.source_video_url)actions.append(decorate(action('',async()=>{try{await recreate(details);}catch(e){status(e.message,true);}}),'recreate','Recreate'));actions.append(decorate(action('',()=>download(row.result_url)),'download','Download'));}
   if(failedAudio.has(row.id))actions.append(action('Retry audio',()=>{failedAudio.delete(row.id);restore(row);}),action('Preview generated video',()=>preview(rowDetails(row))));
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
    const qs=new URLSearchParams({uid:s.user.id,run_id:row.meta.run_id,taskId:row.meta.task_id});const checker=isHenshin(row)?'henshin-check':'kie-check';const r=await fetch('/.netlify/functions/'+checker+'?'+qs,{cache:'no-store',headers:isHenshin(row)?{Authorization:'Bearer '+s.access_token}:{}});const data=await r.json();const url=data.result_url||data.video_url||data.urls?.[0];if(url)row.result_url=url;if(data.meta)row.meta=data.meta;if(data.failed)row.meta.status='failed';
   }));renderResults();
  }catch(e){status('Could not load recent generations. '+e.message,true);}finally{refreshing=false;}
 }
 $('generate').onclick=async()=>{
  if(busy||!source||!images.length||!seconds)return;
  const s=await session();if(!s){status('Sign in to generate.',true);window.HansoraHeader?.openAuth?.();return;}
  if(mode!=='motion'&&!$('prompt').value.trim()){status('Describe the element you want to swap.',true);return;}
  busy=true;setView('history');submission='Processing request…';renderResults();update();
  const input=source,refs=images.map(i=>i.file),duration=seconds,quality=resolution,chosenMode=mode,prompt=$('prompt').value,preserve=$('keepAudio').checked;
  try{
   let audio=null;if(preserve){status('Extracting the original soundtrack…');audio=await window.HenshinMedia.extractAudio(input);}
   status('Preparing a compatible MP4 source…');const prepared=await window.HenshinMedia.compress(input);
   status('Uploading your source video and references…');const videoURL=await upload(prepared),imageURLs=[];for(const file of refs) imageURLs.push(await upload(file));const audioURL=audio?await upload(audio):null;
   setView('history');status('Starting your transformation…');
   const data=await request('run-henshin',{run_id:crypto.randomUUID(),video_url:videoURL,image_urls:imageURLs,audio_url:audioURL,source_video_duration:duration,resolution:quality,mode:chosenMode,prompt});
   if(data.credits!==undefined)window.HansoraHeader?.setCredits?.(data.credits);
   window.HansoraHeader?.startCreditsPolling?.(90000,1500);status(data.submission_uncertain?data.message:audio?'Generating. Your original audio will be restored when the video is ready.':'Generating your Henshin video…');await refresh();
  }catch(e){status(e.message,true);}finally{busy=false;submission=null;renderResults();update();}
 };
 async function recreate(item){
  if(busy)throw Error('Wait for the current request to finish.');
  if(!item?.source_video_url)throw Error('This video has no saved source.');
  const selection=++sourceSelection;
  const fetchFile=async(url,name,type)=>{const r=await fetch(url);if(!r.ok)throw Error('Could not load a saved reference.');const blob=await r.blob();if(blob.size>(type==='video/mp4'?100:10)*1024*1024)throw Error('Saved reference exceeds the upload size limit.');return new File([blob],name,{type:blob.type||type});};
  const input=await fetchFile(item.source_video_url,(item.title||'Template')+'.mp4','video/mp4'),d=await window.HenshinMedia.duration(input);
  if(d<4||d>30)throw Error('Source video must be 4–30 seconds.');
  const refs=await Promise.all((item.image_urls||[]).map((url,i)=>fetchFile(url,'reference-'+(i+1)+'.png','image/png')));
  if(refs.length>30)throw Error('Too many reference images.');
  for(const file of refs){if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Unsupported reference image.');const bitmap=await createImageBitmap(file),ratio=bitmap.width/bitmap.height,valid=bitmap.width>300&&bitmap.width<6000&&bitmap.height>300&&bitmap.height<6000&&ratio>.4&&ratio<2.5;bitmap.close();if(!valid)throw Error('A saved reference image has invalid dimensions.');}
  if(busy||selection!==sourceSelection)throw Error('Source selection changed. Try Recreate again.');
  if(!await setSource(input))throw Error($('status').textContent);
  images.forEach(i=>URL.revokeObjectURL(i.url));images=refs.map(file=>({file,url:URL.createObjectURL(file)}));renderImages();
  $('prompt').value=item.prompt||'';document.querySelector(`[data-mode="${['motion','swap','edit'].includes(item.mode)?item.mode:'motion'}"]`).click();document.querySelector(`[data-resolution="${Object.hasOwn(rates,item.resolution)?item.resolution:'720p'}"]`).click();$('keepAudio').checked=item.keep_audio!==false;
  setView('history');status(refs.length?'Template loaded. Your video, references and prompt are ready.':'Motion loaded. Add your references to continue.');update();
  $('composerScroll').scrollTop=0;if(matchMedia('(max-width:740px)').matches)$('sourcePreview').scrollIntoView({behavior:'smooth',block:'center'});
 }
 function setView(view){
  const library=view==='library';
  $('libraryView').hidden=!library;$('historyView').hidden=library;
  for(const [id,active] of [['templatesOpen',library],['historyOpen',!library]]){$(id).classList.toggle('active',active);$(id).setAttribute('aria-selected',String(active));$(id).tabIndex=active?0:-1;}
  if(!library)$('templatesList').querySelectorAll('video').forEach(v=>v.pause());
 }
 async function openLibrary(){
  setView('library');const s=await session();$('ownerControls').hidden=!(s?.user.email_confirmed_at&&s.user.email?.toLowerCase()===OWNER);await loadTemplates();
 }
 function libraryEmpty(title,description){
  const box=document.createElement('div');box.className='library-empty';
  const heading=document.createElement('h3');heading.textContent=title;
  const p=document.createElement('p');p.textContent=description;box.append(heading,p);$('templatesList').replaceChildren(box);
 }
 async function loadTemplates(){
  $('templatesList').textContent='Loading motion library…';
  try{
   const r=await fetch('/.netlify/functions/henshin-templates',{cache:'no-store'}),data=await r.json();
   if(!r.ok||!data.ok)throw Error(data.error||'Could not load the motion library.');
   $('templatesList').replaceChildren();
   if(!data.templates.length){libraryEmpty('No templates yet','Videos added by Hansora will appear here. Choose one to recreate its motion with your own references.');return;}
   for(const template of data.templates){
    const card=document.createElement('article');card.className='template';
    const v=document.createElement('video');v.src=template.video_url;v.muted=true;v.loop=true;v.playsInline=true;v.preload='metadata';v.setAttribute('aria-label',template.title+' motion preview');
    card.addEventListener('mouseenter',()=>v.play().catch(()=>{}));card.addEventListener('mouseleave',()=>v.pause());
    const duration=document.createElement('span');duration.className='template-duration';duration.textContent=Number(template.duration).toFixed(0)+'s';
    const meta=document.createElement('div');meta.className='template-meta';
    const title=document.createElement('h3');title.textContent=template.title;
    const button=action('Recreate',async()=>{
     button.disabled=true;
     try{await recreate(template);}
     catch(e){$('templateStatus').textContent=e.message;}
     finally{button.disabled=false;}
    });
    button.className='template-recreate';button.addEventListener('focus',()=>v.play().catch(()=>{}));button.addEventListener('blur',()=>v.pause());
    const open=action('',()=>preview(template));open.className='template-open';open.setAttribute('aria-label','View '+template.title);card.append(open);meta.append(title,button);card.append(v,duration,meta);$('templatesList').append(card);
   }
  }catch(e){libraryEmpty('Motion library unavailable',e.message);}
 }
 $('templatesOpen').onclick=openLibrary;$('emptyLibrary').onclick=openLibrary;$('historyOpen').onclick=()=>setView('history');
 for(const tab of [$('historyOpen'),$('templatesOpen')])tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const target=event.key==='Home'?$('historyOpen'):event.key==='End'?$('templatesOpen'):tab===$('historyOpen')?$('templatesOpen'):$('historyOpen');target.click();target.focus();});
 update();refresh();setInterval(()=>{if(document.visibilityState==='visible'&&!busy)refresh();},12000);sb.auth.onAuthStateChange((_event,s)=>{ $('ownerControls').hidden=!(s?.user.email_confirmed_at&&s.user.email?.toLowerCase()===OWNER);setTimeout(refresh,0);});
})();
