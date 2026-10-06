(() => {
 'use strict';
 const $=id=>document.getElementById(id), config=window.HenshinConfig;
 const sb=window.__HANSORA_SB__||window.supabase.createClient(config.url,config.key);window.__HANSORA_SB__=sb;
 const OWNER='hansora.ai.bot@gmail.com';
 let source=null,seconds=0,sourceURL='',images=[],resolution='720p',mode='motion',filter='all',busy=false,rows=[],refreshing=false,sessionUser='',uploadingTemplate=false;
 let sourceSelection=0,sourcePending=false,imagePending=0,imageChain=Promise.resolve(),activePreview=null,submission=null,libraryOwner=false,libraryObserver=null,templatePromise=null,libraryEpoch=0;
 const CACHE_KEY='hansora:henshin-templates:v2';let templateCache=null,libraryVisible=new Set(),libraryMoreBusy=false;
 try{templateCache=JSON.parse(sessionStorage.getItem(CACHE_KEY)||'null');if(!Array.isArray(templateCache?.templates))templateCache=null;}catch{}
 function cacheTemplates(templates,nextOffset=null){templateCache={templates,nextOffset,at:Date.now()};try{sessionStorage.setItem(CACHE_KEY,JSON.stringify(templateCache));}catch{}}
 async function templatePage(offset=0){
  const r=await fetch('/.netlify/functions/henshin-templates?offset='+offset,{signal:AbortSignal.timeout(12000)}),data=await r.json();
  if(!r.ok||!data.ok||!Array.isArray(data.templates))throw Error(data.error||'Could not load the motion library.');return data;
 }
 function fetchTemplates(){
  if(templatePromise)return templatePromise;const epoch=++libraryEpoch;
  templatePromise=templatePage().then(data=>{if(epoch===libraryEpoch)cacheTemplates(data.templates,data.next_offset??null);return templateCache?.templates||data.templates;}).finally(()=>{templatePromise=null;});return templatePromise;
 }
 function syncLibraryPlayback(){
  const enabled=!document.hidden&&!$('libraryView').hidden&&!$('previewDialog').open&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
  const limit=matchMedia('(max-width:740px)').matches?2:3;
  const playing=new Set(enabled?Array.from(libraryVisible).filter(v=>v.isConnected).slice(0,limit):[]);
  $('templatesList').querySelectorAll('video').forEach(v=>{
   if(playing.has(v)){if(!v.getAttribute('src'))v.src=v.dataset.src;v.play().catch(()=>{});}
   else if(v.getAttribute('src')){v.pause();v.removeAttribute('src');v.load();}
  });
 }
 async function loadMoreTemplates(){
  if(libraryMoreBusy||templateCache?.nextOffset==null)return;
  libraryMoreBusy=true;$('libraryMore').disabled=true;const epoch=libraryEpoch,offset=templateCache.nextOffset;
  try{
   const data=await templatePage(offset);if(epoch!==libraryEpoch)return;
   const seen=new Set(templateCache.templates.map(t=>t.id)),added=data.templates.filter(t=>!seen.has(t.id));
   cacheTemplates([...templateCache.templates,...added],data.next_offset??null);renderTemplates(added,true);$('templateStatus').textContent='';
  }catch(e){$('templateStatus').textContent='Could not load more templates. Please try again.';}
  finally{libraryMoreBusy=false;$('libraryMore').disabled=false;}
 }
 const closeIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
 const owner=s=>!!(s?.user.email_confirmed_at&&s.user.email?.toLowerCase()===OWNER);
 const hero=$('heroVideo');hero.src=config.heroVideoURL;
 if(!matchMedia('(prefers-reduced-motion: reduce)').matches)hero.play().catch(()=>{});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){hero.pause();syncLibraryPlayback();}else{if(!matchMedia('(prefers-reduced-motion: reduce)').matches)hero.play().catch(()=>{});syncLibraryPlayback();}});
 const rates={'480p':2,'720p':4.2,'1080p':9};
 function status(text,error=false){if(busy&&submission){submission=text;renderResults();}$('status').textContent=text;$('status').classList.toggle('error',error);}
 function cost(){return seconds?Math.round(Math.ceil(seconds)*rates[resolution]*10):rates[resolution]*10;}
 function update(){ $('cost').hidden=!seconds; $('cost').textContent=seconds?`${cost()} credits`:'';$('generate').disabled=busy||sourcePending||imagePending>0||!source||!seconds||(mode!=='edit'&&!images.length);$('imagesAddEmpty').querySelector('small').textContent=mode==='edit'?'Optional · up to 30 reference images':'Up to 30 reference images'; }
 async function session(){return (await sb.auth.getSession()).data.session;}
 async function request(route,body,method='POST'){
  const s=await session();if(!s) throw Error('Sign in first.');
  const r=await fetch('/.netlify/functions/'+route,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token},body:JSON.stringify(body)});
  const data=await r.json();if(!r.ok||!data.ok) throw Error(data.error||'Request failed.');return data;
 }
 async function upload(file){try{const result=await window.kieUploadBridge.upload(file,{bucket:'video',timeoutMs:300000});if(!result.publicUrl)throw Error('Upload returned no file URL.');return result.publicUrl;}catch(e){throw Error(`Could not upload “${file.name}”. ${/timeout|network|aborted|failed_0/.test(e.message)?'Check your connection and try again.':e.message||'Please try again.'}`);}}
 async function setSource(file){
  if(busy) return;
  if(!file)return;
  const selection=++sourceSelection;sourcePending=true;$('videoStatus').textContent='Reading video…';update();
  try {
   const prepared=await window.HenshinMedia.prepareVideo(file),d=prepared.seconds;
   if(selection!==sourceSelection)return;
   if(sourceURL) URL.revokeObjectURL(sourceURL);
   source=prepared.file;seconds=d;sourceURL=URL.createObjectURL(source);$('sourceVideo').src=sourceURL;
   $('sourceName').textContent=`${file.name} · ${d.toFixed(2)}s`;$('sourcePreview').hidden=false;$('videoDrop').hidden=true;$('videoStatus').textContent='';status('');return true;
  }catch(e){if(selection===sourceSelection)$('videoStatus').textContent=e.message;return false;}finally{if(selection===sourceSelection)sourcePending=false;update();}
 }
 function clearSource(){if(busy)return;sourceSelection++;sourcePending=false;source=null;seconds=0;if(sourceURL)URL.revokeObjectURL(sourceURL);sourceURL='';$('sourceVideo').removeAttribute('src');$('sourceVideo').load();$('videoInput').value='';$('sourcePreview').hidden=true;$('videoDrop').hidden=false;$('videoStatus').textContent='';update();}
 function addImages(files){
  if(busy)return;
  imagePending++;update();
  imageChain=imageChain.then(async()=>{
   const errors=[];$('imageStatus').textContent='Preparing reference images…';
   for(const input of files){if(images.length>=30){errors.push('You can add up to 30 references. Remove one to add another.');break;}try{const file=await window.HenshinMedia.prepareImage(input);images.push({file,url:URL.createObjectURL(file)});renderImages();}catch(e){errors.push(`“${input.name}”: ${e.message||'Could not read this image.'}`);}}
   $('imageStatus').textContent=errors.join(' ');
  }).catch(e=>{$('imageStatus').textContent=e.message;}).finally(()=>{imagePending--;renderImages();update();});return imageChain;
 }
 function renderImages(){
  const grid=$('imageGrid');grid.replaceChildren();grid.hidden=!images.length;$('imagesAddEmpty').hidden=!!images.length;
  $('imagesDrop').classList.toggle('has-images',!!images.length);
  if(!images.length)return;
  const add=document.createElement('button');add.type='button';add.className='image-add-tile';add.setAttribute('aria-label','Add reference images');add.title='Add reference images';add.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';add.disabled=busy||images.length>=30;add.onclick=()=>{if(!busy&&images.length<30)$('imagesInput').click();};grid.append(add);
  images.forEach((item,index)=>{const tile=document.createElement('div'),img=document.createElement('img'),remove=document.createElement('button');tile.className='image-reference-tile';img.src=item.url;img.alt=`Reference ${index+1}`;remove.type='button';remove.innerHTML=closeIcon;remove.setAttribute('aria-label',`Remove reference ${index+1}`);remove.onclick=()=>{if(busy)return;URL.revokeObjectURL(item.url);images.splice(index,1);renderImages();update();};tile.append(img,remove);grid.append(tile);});
 }
 function drop(id,input,handle){
  const el=$(id);if(el.tagName==='BUTTON')el.onclick=()=>$(input).click();$(input).onchange=e=>{const files=Array.from(e.target.files);e.target.value='';handle(files);};
  for(const name of ['dragenter','dragover'])el.addEventListener(name,e=>{e.preventDefault();el.classList.add('drag');});
  for(const name of ['dragleave','drop'])el.addEventListener(name,e=>{e.preventDefault();el.classList.remove('drag');});
  el.addEventListener('drop',e=>handle(Array.from(e.dataTransfer.files)));
 }
 drop('videoDrop','videoInput',files=>setSource(files[0]));drop('imagesDrop','imagesInput',addImages);$('clearVideo').onclick=clearSource;$('imagesAddEmpty').onclick=()=>{if(!busy)$('imagesInput').click();};
 for(const button of document.querySelectorAll('[data-resolution]'))button.onclick=()=>{if(busy)return;resolution=button.dataset.resolution;document.querySelectorAll('[data-resolution]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});update();};
 for(const button of document.querySelectorAll('[data-mode]'))button.onclick=()=>{if(busy)return;mode=button.dataset.mode;document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});update();};
 for(const button of document.querySelectorAll('[data-filter]'))button.onclick=()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});renderResults();};
 const modeName=value=>({motion:'Motion transfer',swap:'Object swap',edit:'Video edit'}[value]||'Motion transfer');
 const iconPaths={preview:'<rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 6-3v10l-6-3"/>',recreate:'<path d="M4 10a8 8 0 0 1 13.7-4.7L20 7.5M20 3v4.5h-4.5M20 14a8 8 0 0 1-13.7 4.7L4 16.5M4 21v-4.5h4.5"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M5 21h14"/>'};
 function decorate(button,kind,label){button.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[kind]}</svg>`;button.setAttribute('aria-label',label);button.title=label;return button;}
 function preview(item){
  $('templatesList').querySelectorAll('video').forEach(v=>v.pause());$('resultsList').querySelectorAll('video').forEach(v=>v.pause());
  activePreview=typeof item==='string'?{video_url:item,title:'Video preview'}:item;
  const data=activePreview;$('previewVideo').setAttribute('aria-label','Result video');$('previewVideo').src=data.video_url;$('previewTitle').textContent=data.title||'Henshin';
  $('previewPrompt').textContent=data.prompt||'No additional prompt.';$('previewModel').textContent=data.model_label||'Henshin · '+modeName(data.mode);$('previewQuality').textContent=data.resolution||'—';
  $('previewStatus').textContent='';$('previewAssets').replaceChildren();
  if(data.source_video_url){
   const box=document.createElement('div'),button=document.createElement('button'),v=document.createElement('video'),label=document.createElement('span');
   button.type='button';button.className='source-asset-button';button.setAttribute('aria-label','Preview source video');button.setAttribute('aria-pressed','false');
   v.src=data.source_video_url;v.muted=true;v.playsInline=true;v.preload='metadata';v.setAttribute('aria-hidden','true');
   const play=document.createElement('span');play.className='source-asset-play';play.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7z"/></svg>';
   button.append(v,play);label.textContent='Source video';button.onclick=()=>{
    const showing=button.getAttribute('aria-pressed')!=='true';button.setAttribute('aria-pressed',String(showing));
    button.setAttribute('aria-label',showing?'Return to result video':'Preview source video');label.textContent=showing?'View result':'Source video';
    $('previewVideo').src=showing?data.source_video_url:data.video_url;$('previewVideo').setAttribute('aria-label',showing?'Original source video':'Result video');$('previewVideo').play().catch(()=>{});
   };
   box.append(button,label);$('previewAssets').append(box);
  }
  for(const [i,url] of (data.image_urls||[]).entries()){const box=document.createElement('div'),img=document.createElement('img'),label=document.createElement('span');img.src=url;img.alt=`Reference ${i+1}`;label.textContent=`Image ${i+1}`;box.append(img,label);$('previewAssets').append(box);}
  $('previewRecreate').hidden=!data.source_video_url;$('previewDialog').showModal();syncLibraryPlayback();$('previewVideo').play().catch(()=>{});
 }
 $('previewClose').onclick=()=>$('previewDialog').close();
 $('previewDialog').addEventListener('close',()=>{$('previewDialog').querySelectorAll('video').forEach(v=>{v.pause();v.removeAttribute('src');v.load();});activePreview=null;syncLibraryPlayback();});
 $('previewCopy').onclick=async()=>{try{await navigator.clipboard.writeText(activePreview?.prompt||'');$('previewStatus').textContent='Prompt copied.';}catch{$('previewStatus').textContent='Select the prompt text to copy it.';}};
 $('previewRecreate').onclick=async()=>{const button=$('previewRecreate');button.disabled=true;try{await recreate(activePreview);$('previewDialog').close();}catch(e){$('previewStatus').textContent=e.message;}finally{button.disabled=false;}};
 $('previewDownload').onclick=()=>activePreview&&download(activePreview.video_url);
 for(const [id,kind,label]of [['previewRecreate','recreate','Recreate'],['previewDownload','download','Download']]){const b=$(id);decorate(b,kind,label);const span=document.createElement('span');span.textContent=label;b.append(span);}
 function rowDetails(row){
  const m=row.meta||{},input=m.request_input||m.diagnostic?.request_input||m.diagnostic?.client||{};
  return {title:isHenshin(row)?'Henshin · '+modeName(m.mode):'Seedance 2.5',model_label:isHenshin(row)?'Henshin · '+modeName(m.mode):'Seedance 2.5',video_url:row.result_url,
   source_video_url:m.video_url||m.reference_video_urls?.[0]||input.reference_video_urls?.[0],image_urls:m.reference_image_urls||input.reference_image_urls||[],
   prompt:isHenshin(row)?m.user_prompt||'':m.user_prompt??row.prompt??'',mode:m.mode||'motion',resolution:m.resolution||input.resolution||'720p',keep_audio:m.keep_audio!==false};
 }
 function errorText(value){
  if(typeof value==='string')return value;
  if(value&&typeof value==='object')return errorText(value.message||value.msg||value.error||value.detail);
  return 'Generation wasn’t completed';
 }
 function orient(card,ratio){
  const r=Number(ratio);card.classList.toggle('result-landscape',r>1.1);card.classList.toggle('result-square',r>=.9&&r<=1.1);card.classList.toggle('result-portrait',!r||r<.9);
 }
 function savedRatio(meta){
  const value=meta.aspect_ratio||meta.request_input?.aspect_ratio||meta.diagnostic?.client?.aspect_ratio||'';
  const parts=String(value).match(/^(\d+(?:\.\d+)?)[:x/]([\d.]+)$/);return parts?Number(parts[1])/Number(parts[2]):0;
 }
 function generationStage(stage,label){const box=document.createElement('div');box.className='generation-stage';box.dataset.stage=stage;box.innerHTML='<div class="generation-stage-icon" aria-hidden="true"><span class="request-loading-spinner"></span><span class="generation-stage-core"></span></div><div class="generation-stage-label"></div>';box.querySelector('.generation-stage-label').textContent=label;return box;}
 function isHenshin(row){return row.meta?.source_feature==='henshin';}
 function isSeedance(row){return row.meta?.engine==='seedance-2.5'||row.provider==='Seedance 2.5';}
 function action(label,fn){const button=document.createElement('button');button.textContent=label;button.onclick=fn;return button;}
 async function download(url){try{const r=await fetch(url);if(!r.ok)throw Error();const blobURL=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=blobURL;a.download='hansora-henshin.mp4';a.click();setTimeout(()=>URL.revokeObjectURL(blobURL),1000);}catch{window.open(url,'_blank','noopener');}}
 function renderResults(){
  $('resultsList').querySelectorAll('video').forEach(v=>v.pause());
  $('resultsList').replaceChildren();const visible=rows.filter(row=>filter==='all'||(filter==='henshin'?isHenshin(row):isSeedance(row)));$('empty').hidden=visible.length>0||!!submission;
  if(submission){const card=document.createElement('article');card.className='result result-portrait';card.append(generationStage('requesting',submission));$('resultsList').append(card);}
  for(const row of visible){
   const meta=row.meta||{},audioPending=isHenshin(row)&&meta.source_audio_url&&!meta.audio_restored,audioFailed=meta.status==='audio_failed',failed=/fail|error|reject|cancel/.test(meta.status||''),ready=!!row.result_url&&!audioPending&&!failed,card=document.createElement('article'),details=rowDetails(row);card.className='result';orient(card,savedRatio(meta));
   const media=document.createElement('div');media.className='result-media';card.append(media);
   const chip=document.createElement('span');chip.className='result-status-chip'+(ready?' ready':failed?' failed':'');chip.textContent=ready?'Ready':failed?'Failed':audioPending?'Restoring audio':/queued/.test(meta.status||'')?'In Queue':/requesting|uploading|preparing/.test(meta.status||'')?'Processing':'Generating';media.append(chip);
   if(ready){
    const video=document.createElement('video');video.src=row.result_url;video.controls=true;video.muted=true;video.playsInline=true;video.preload='metadata';video.setAttribute('aria-label',details.title+' result');
    video.addEventListener('loadedmetadata',()=>{if(video.videoWidth&&video.videoHeight)orient(card,video.videoWidth/video.videoHeight);});
    video.onclick=event=>{if(event.clientY>=video.getBoundingClientRect().bottom-52)return;event.preventDefault();video.pause();preview(details);};
    media.append(video);const open=action('Open preview',()=>{video.pause();preview(details);});open.className='result-preview-open';media.append(open);
   }
   else if(failed){const box=document.createElement('div');box.className='result-failed-state';const symbol=document.createElement('span');symbol.className='result-failed-icon';symbol.innerHTML=closeIcon;const label=document.createElement('strong');label.textContent=audioFailed?'Audio needs attention':'Failed';const copy=document.createElement('p');copy.textContent=errorText(meta.audio_error||meta.error);box.append(symbol,label,copy);media.append(box);}
   else{const queued=/queued/.test(meta.status||''),requesting=/requesting|uploading|preparing/.test(meta.status||''),audio=audioPending&&(meta.generated_video_url||row.result_url);media.append(generationStage(audio?'requesting':queued?'queued':requesting?'requesting':'generating',audio?'Restoring original audio…':queued?'In Queue':requesting?'Processing request…':'Generating'));}
   const body=document.createElement('div');body.className='result-body';const head=document.createElement('div');head.className='result-head';const title=document.createElement('strong');title.textContent=details.title;const kind=document.createElement('span');kind.textContent='VIDEO';head.append(title,kind);
   const prompt=document.createElement('p');prompt.className='result-prompt';prompt.textContent=details.prompt||'Character transformation using your references';prompt.title=details.prompt||'';
   const bottom=document.createElement('div');bottom.className='result-bottom';const state=document.createElement('span');state.className='result-state'+(ready?' ready':failed?' failed':'');state.textContent=chip.textContent;state.title=new Date(row.created_at||Date.now()).toLocaleString();const actions=document.createElement('div');actions.className='result-actions';bottom.append(state,actions);body.append(head,prompt,bottom);card.append(body);
   if(ready){actions.append(decorate(action('',()=>preview(details)),'preview','Preview'));if(details.source_video_url)actions.append(decorate(action('',async()=>{try{await recreate(details);}catch(e){status(e.message,true);}}),'recreate','Recreate'));actions.append(decorate(action('',()=>download(row.result_url)),'download','Download'));}
   if(audioFailed)actions.append(action('Retry audio',async()=>{try{await request('henshin-result',{id:row.id});await refresh();}catch(e){status(e.message,true);}}),action('Preview generated video',()=>preview({...details,video_url:meta.generated_video_url||row.result_url})));
   $('resultsList').append(card);
  }
 }
 async function refresh(){
  if(refreshing)return;refreshing=true;
  try{
   const s=await session();
   if(!s){rows=[];sessionUser='';renderResults();return;}
   if(sessionUser!==s.user.id){rows=[];sessionUser=s.user.id;}
   const {data,error}=await sb.from('user_generations').select('id,provider,prompt,result_url,meta,created_at').eq('user_id',s.user.id).eq('kind','video').order('created_at',{ascending:false}).limit(100);
   if(error)throw error;rows=(data||[]).filter(row=>isHenshin(row)||isSeedance(row));
   // Resume shared KIE checking after navigation or a browser reload.
   await Promise.allSettled(rows.filter(row=>!row.result_url&&!/fail|reject|cancel/.test(row.meta?.status||'')&&row.meta?.task_id).map(async row=>{
    const qs=new URLSearchParams({uid:s.user.id,run_id:row.meta.run_id,taskId:row.meta.task_id});const checker=isHenshin(row)?'henshin-check':'kie-check';const r=await fetch('/.netlify/functions/'+checker+'?'+qs,{cache:'no-store',headers:isHenshin(row)?{Authorization:'Bearer '+s.access_token}:{}});const data=await r.json();const url=data.result_url||data.video_url||data.urls?.[0];if(url)row.result_url=url;if(data.meta)row.meta=data.meta;if(data.failed)row.meta.status='failed';
   }));renderResults();
  }catch(e){status('Could not load recent generations. '+e.message,true);}finally{refreshing=false;}
 }
 $('generate').onclick=async()=>{
  if(busy||sourcePending||imagePending>0||!source||(mode!=='edit'&&!images.length)||!seconds)return;
  const s=await session();if(!s){status('Sign in to generate.',true);window.HansoraHeader?.openAuth?.();return;}
  busy=true;setView('history');submission='Processing request…';renderResults();update();
  const input=source,refs=images.map(i=>i.file),duration=seconds,quality=resolution,chosenMode=mode,prompt=$('prompt').value,preserve=$('keepAudio').checked;
  try{
   status('Preparing a compatible MP4 source…');const prepared=await window.HenshinMedia.compress(input);
   status('Uploading your source video and references…');const videoURL=await upload(prepared),imageURLs=[];for(const file of refs) imageURLs.push(await upload(file));
   setView('history');status('Starting your transformation…');
   const data=await request('run-henshin',{run_id:crypto.randomUUID(),video_url:videoURL,image_urls:imageURLs,keep_audio:preserve,source_video_duration:duration,resolution:quality,mode:chosenMode,prompt});
   if(data.credits!==undefined)window.HansoraHeader?.setCredits?.(data.credits);
   window.HansoraHeader?.startCreditsPolling?.(90000,1500);status(data.submission_uncertain?data.message:preserve?'Generating. Your finished video will include the original soundtrack.':'Generating your Henshin video…');await refresh();
  }catch(e){status(e.message,true);}finally{busy=false;submission=null;renderResults();update();}
 };
 async function recreate(item){
  if(busy||sourcePending||imagePending>0)throw Error('Wait for the current upload or request to finish.');
  if(!item?.source_video_url)throw Error('This video has no saved source.');
  const selection=++sourceSelection;
  const fetchFile=async(url,name,type)=>{const r=await fetch(url);if(!r.ok)throw Error('Could not load a saved reference.');const blob=await r.blob();return new File([blob],name,{type:blob.type||type});};
  const input=await fetchFile(item.source_video_url,(item.title||'Template')+'.mp4','video/mp4');
  if((item.image_urls||[]).length>30)throw Error('Too many reference images.');
  const refs=[];for(const [i,url]of (item.image_urls||[]).entries())refs.push(await window.HenshinMedia.prepareImage(await fetchFile(url,'reference-'+(i+1)+'.png','image/png')));
  if(busy||selection!==sourceSelection)throw Error('Source selection changed. Try Recreate again.');
  if(!await setSource(input))throw Error($('videoStatus').textContent||'Could not load the source video.');
  images.forEach(i=>URL.revokeObjectURL(i.url));images=refs.map(file=>({file,url:URL.createObjectURL(file)}));renderImages();
  $('prompt').value=item.prompt||'';document.querySelector(`[data-mode="${['motion','swap','edit'].includes(item.mode)?item.mode:'motion'}"]`).click();document.querySelector(`[data-resolution="${Object.hasOwn(rates,item.resolution)?item.resolution:'720p'}"]`).click();$('keepAudio').checked=item.keep_audio!==false;
  setView('history');status(refs.length||mode==='edit'?'Loaded. Your video and prompt are ready.':'Motion loaded. Add your references to continue.');update();
  $('composerScroll').scrollTop=0;if(matchMedia('(max-width:740px)').matches)$('sourcePreview').scrollIntoView({behavior:'smooth',block:'center'});
 }
 function setView(view){
  const library=view==='library',wasLibrary=!$('libraryView').hidden;
  $('libraryView').hidden=!library;$('historyView').hidden=library;
  for(const [id,active] of [['templatesOpen',library],['historyOpen',!library]]){$(id).classList.toggle('active',active);$(id).setAttribute('aria-selected',String(active));$(id).tabIndex=active?0:-1;}
  if(library)$('resultsList').querySelectorAll('video').forEach(v=>{v.pause();v.removeAttribute('src');v.load();});
  else if(wasLibrary)renderResults();
  syncLibraryPlayback();
 }
 function openLibrary(){
  setView('library');const loading=loadTemplates();
  session().then(s=>{const isOwner=owner(s),changed=isOwner!==libraryOwner;libraryOwner=isOwner;$('ownerControls').hidden=!isOwner;if(changed&&templateCache&&!$('libraryView').hidden)renderTemplates(templateCache.templates);}).catch(()=>{$('ownerControls').hidden=true;});
  return loading;
 }
 function libraryEmpty(title,description){
  const box=document.createElement('div');box.className='library-empty';
  const heading=document.createElement('h3');heading.textContent=title;
  const p=document.createElement('p');p.textContent=description;box.append(heading,p);$('templatesList').replaceChildren(box);
 }
 async function loadTemplates(){
  if(templateCache)renderTemplates(templateCache.templates);
  else if(!$('templatesList').children.length)$('templatesList').innerHTML='<div class="library-loading" role="status"><span class="request-loading-spinner"></span>Loading motion library…</div>';
  if(templateCache&&Date.now()-templateCache.at<30000)return;
  try{const templates=await fetchTemplates();renderTemplates(templates);$('templateStatus').textContent='';}
  catch(e){if(templateCache)$('templateStatus').textContent='Showing saved templates. Could not refresh the library.';else libraryEmpty('Motion library unavailable','Please try opening the library again.');}
 }
 function renderTemplates(templates,append=false){
  if(!append){
   libraryObserver?.disconnect();libraryVisible.clear();$('templatesList').querySelectorAll('video').forEach(v=>{v.pause();v.removeAttribute('src');v.load();});$('templatesList').replaceChildren();
   libraryObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting)libraryVisible.add(entry.target);else libraryVisible.delete(entry.target);}syncLibraryPlayback();},{root:matchMedia('(max-width:740px)').matches?null:$('libraryView'),threshold:.15});
  }
  $('libraryMore').hidden=templateCache?.nextOffset==null;
  if(!templates.length&&!append){libraryEmpty('No templates yet','Videos added by Hansora will appear here. Choose one to recreate its motion with your own references.');return;}
   for(const template of templates){
    const card=document.createElement('article');card.className='template';
    const v=document.createElement('video');v.dataset.src=template.preview_url||template.video_url;v.muted=true;v.loop=true;v.playsInline=true;v.preload='none';
    if(template.poster_url)v.poster=template.poster_url;v.style.aspectRatio=Number(template.aspect_ratio)||9/16;v.setAttribute('aria-label',template.title+' motion preview');
    const play=()=>{if(libraryVisible.has(v)){libraryVisible.delete(v);libraryVisible=new Set([v,...libraryVisible]);syncLibraryPlayback();}};
    card.addEventListener('mouseenter',play);v.addEventListener('loadedmetadata',()=>{if(v.videoWidth&&v.videoHeight)v.style.aspectRatio=v.videoWidth/v.videoHeight;});
    const duration=document.createElement('span');duration.className='template-duration';duration.textContent=Number(template.duration).toFixed(0)+'s';
    const meta=document.createElement('div');meta.className='template-meta';
    const title=document.createElement('h3');title.textContent=template.title;
    const button=action('Recreate',async()=>{
     button.disabled=true;
     try{await recreate(template);}
     catch(e){$('templateStatus').textContent=e.message;}
     finally{button.disabled=false;}
    });
    button.className='template-recreate';button.addEventListener('focus',play);
    const open=action('',()=>preview(template));open.className='template-open';open.setAttribute('aria-label','View '+template.title);card.append(open);meta.append(title,button);card.append(v,duration,meta);
    if(libraryOwner){
     const remove=action('',async()=>{
      remove.disabled=true;
      try{await request('henshin-templates',{id:template.id},'DELETE');libraryEpoch++;cacheTemplates((templateCache?.templates||templates).filter(t=>t.id!==template.id),templateCache?.nextOffset==null?null:Math.max(0,templateCache.nextOffset-1));libraryObserver.unobserve(v);libraryVisible.delete(v);v.pause();v.removeAttribute('src');v.load();card.remove();syncLibraryPlayback();$('templateStatus').textContent='Template deleted from the library.';if(!$('templatesList').children.length)libraryEmpty('No templates yet','Videos added by Hansora will appear here.');}
      catch(e){$('templateStatus').textContent=e.message;remove.disabled=false;}
     });
     remove.className='template-delete';remove.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';remove.setAttribute('aria-label','Delete '+template.title);remove.title='Delete template';card.append(remove);
    }
    $('templatesList').append(card);libraryObserver.observe(v);
   }
 }
 $('libraryMore').onclick=loadMoreTemplates;
 $('templatesOpen').onclick=openLibrary;$('emptyLibrary').onclick=openLibrary;$('historyOpen').onclick=()=>setView('history');
 for(const tab of [$('historyOpen'),$('templatesOpen')])tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const target=event.key==='Home'?$('historyOpen'):event.key==='End'?$('templatesOpen'):tab===$('historyOpen')?$('templatesOpen'):$('historyOpen');target.click();target.focus();});
 fetchTemplates().catch(()=>{});
 update();refresh();setInterval(()=>{if(document.visibilityState==='visible'&&!busy&&$('libraryView').hidden&&!$('previewDialog').open)refresh();},12000);sb.auth.onAuthStateChange((_event,s)=>{ $('ownerControls').hidden=!(s?.user.email_confirmed_at&&s.user.email?.toLowerCase()===OWNER);const changed=libraryOwner!==owner(s);libraryOwner=owner(s);if(changed&&templateCache&&!$('libraryView').hidden)renderTemplates(templateCache.templates);setTimeout(refresh,0);});
})();
