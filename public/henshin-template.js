(() => {
 'use strict';
 const i18n=window.HenshinI18n,t=i18n?.t||((key,values={})=>key.replace(/\{([a-z]+)\}/g,(m,k)=>Object.hasOwn(values,k)?String(values[k]):m));
 const $=id=>document.getElementById(id),config=window.HenshinConfig,sb=window.__HANSORA_SB__||window.supabase.createClient(config.url,config.key);
 const OWNER='hansora.ai.bot@gmail.com',editID=new URLSearchParams(location.search).get('id');let busy=false,pending=0,references=[],referenceChain=Promise.resolve(),loadingEdit=null;const videos=new Map();
 function pendingUpdate(change){pending+=change;$('editorPublish').disabled=busy||pending>0;}
 const owner=s=>!!(s?.user.email_confirmed_at&&s.user.email?.toLowerCase()===OWNER);
 function access(s){$('editorForm').hidden=!owner(s);$('editorAccess').textContent=owner(s)?t('Save the source, references and prompt people will use to recreate this example.'):t('Only the Hansora template owner can publish to this library. Sign in with the owner account to continue.');}
 async function session(){return (await sb.auth.getSession()).data.session;}
 const closeIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
 function clearVideo(input){
  const v=$(input+'Preview');if(v.dataset.blob)URL.revokeObjectURL(v.dataset.blob);delete v.dataset.blob;
  v.pause();v.removeAttribute('src');v.load();$(input+'Media').hidden=true;$(input).value='';$(input).required=true;videos.delete(input);$(input+'Status').textContent='';
 }
 for(const input of ['editorResult','editorSource']){
  let selection=0;
  $(input+'Remove').onclick=()=>{if(!busy){selection++;clearVideo(input);}};
  $(input).onchange=async()=>{
   if(busy)return;const chosen=++selection,file=$(input).files[0],v=$(input+'Preview');if(!file)return;pendingUpdate(1);videos.delete(input);$(input+'Status').textContent=t('Reading video…');
   if(v.dataset.blob)URL.revokeObjectURL(v.dataset.blob);delete v.dataset.blob;v.pause();v.removeAttribute('src');v.load();$(input+'Media').hidden=true;
   try{const prepared=await window.HenshinMedia.prepareVideo(file,{example:input==='editorResult'});if(selection!==chosen)return;videos.set(input,prepared.file);$(input).required=false;v.src=URL.createObjectURL(prepared.file);v.dataset.blob=v.src;$(input+'Media').hidden=false;$(input+'Status').textContent='';}
   catch(e){if(selection===chosen){clearVideo(input);$(input+'Status').textContent=t(e.message);}}finally{pendingUpdate(-1);}
  };
 }
 function renderReferences(){
  $('editorImages').replaceChildren();$('editorReferences').required=$('editorMode').value!=='edit'&&references.length===0;$('editorReferences').previousElementSibling.textContent=$('editorMode').value==='edit'?t('Reference images · optional'):t('Reference images');
  for(const [i,item]of references.entries()){
   const tile=document.createElement('div'),img=document.createElement('img'),remove=document.createElement('button');
   tile.className='editor-image-tile';img.src=item.url;img.alt=t('Reference {n}',{n:i+1});
   remove.type='button';remove.className='remove-media';remove.innerHTML=closeIcon;remove.setAttribute('aria-label',t('Remove reference {n}',{n:i+1}));
   remove.onclick=()=>{if(busy)return;if(item.file)URL.revokeObjectURL(item.url);references.splice(i,1);renderReferences();};
   tile.append(img,remove);$('editorImages').append(tile);
  }
 }
 $('editorMode').onchange=renderReferences;
 $('editorReferences').onchange=()=>{
  if(busy)return;const files=Array.from($('editorReferences').files);$('editorReferences').value='';
  pendingUpdate(1);referenceChain=referenceChain.then(async()=>{const errors=[];$('editorImageStatus').textContent=t('Preparing reference images…');
   for(const input of files){if(references.length>=30){errors.push(t('You can add up to 30 references.'));break;}try{const file=await window.HenshinMedia.prepareImage(input);references.push({file,url:URL.createObjectURL(file)});renderReferences();}catch(e){errors.push(`“${input.name}”: ${t(e.message)}`);}}
   $('editorImageStatus').textContent=errors.join(' ');
  }).catch(e=>{$('editorImageStatus').textContent=t(e.message);}).finally(()=>pendingUpdate(-1));
 };
 async function loadEdit(s){
  if(!editID||!owner(s)||loadingEdit)return loadingEdit;
  pendingUpdate(1);$('editorStatus').textContent=t('Loading template…');
  loadingEdit=(async()=>{
   const r=await fetch('/.netlify/functions/henshin-templates?id='+encodeURIComponent(editID),{cache:'no-store',headers:{Authorization:'Bearer '+s.access_token}}),data=await r.json();
   if(!r.ok||!data.ok)throw Error(data.error||t('Template not found.'));
   const item=data.template;
   for(const [input,url]of [['editorResult',item.video_url],['editorSource',item.source_video_url]]){videos.set(input,url);$(input).required=false;$(input+'Preview').src=url;$(input+'Media').hidden=false;}
   references=(item.image_urls||[]).map(url=>({file:null,url}));$('editorMode').value=item.mode;$('editorQuality').value=item.resolution;$('editorAudio').checked=item.keep_audio;$('editorPrompt').value=item.prompt||'';renderReferences();
   document.querySelector('.template-editor-head h1').textContent=t('Edit template');document.title=t('Edit template')+' | Hansora AI';$('editorPublish').textContent=t('Save changes');$('editorStatus').textContent=t('Saving rebuilds the library preview. Replace the example video if the original is blurry.');
  })().catch(e=>{$('editorStatus').textContent=t(e.message);$('editorForm').hidden=true;}).finally(()=>pendingUpdate(-1));
  return loadingEdit;
 }
 async function storedFile(url){
  const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(t('Could not read stored media.'));
  if(Number(r.headers.get('content-length'))>100*1024*1024)throw Error(t('Media exceeds 100 MB.'));
  const blob=await r.blob();if(blob.size>100*1024*1024)throw Error(t('Media exceeds 100 MB.'));
  return new File([blob],'example.mp4',{type:blob.type||'video/mp4'});
 }
 async function thumbnail(file){
  const video=document.createElement('video'),url=URL.createObjectURL(file);
  try{
   video.muted=true;video.playsInline=true;video.preload='auto';
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error(t('Could not read the example thumbnail.'))),10000);
    video.onerror=()=>{clearTimeout(timer);reject(Error(t('Could not read the example thumbnail.')));};
    video.onloadeddata=()=>{clearTimeout(timer);resolve();};video.src=url;
   });
   const canvas=document.createElement('canvas'),scale=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));if(!blob)throw Error(t('Could not create the example thumbnail.'));return new File([blob],'template-preview.jpg',{type:'image/jpeg'});
  }finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
 }
 $('editorForm').onsubmit=async event=>{
  event.preventDefault();if(busy||pending>0)return;busy=true;
  const elements=Array.from($('editorForm').elements);elements.forEach(e=>e.disabled=true);
  try{
   const s=await session();if(!owner(s))throw Error(t('Only the confirmed owner account can publish templates.'));
   const result=videos.get('editorResult'),source=videos.get('editorSource'),refs=references.map(item=>item.file),prompt=$('editorPrompt').value.trim(),mode=$('editorMode').value,resolution=$('editorQuality').value,keep=$('editorAudio').checked;
   if(!result||!source)throw Error(t('Add the example video and original source video.'));if(mode!=='edit'&&!refs.length)throw Error(t('Add at least one reference image.'));
   const upload=async file=>{try{const r=await window.kieUploadBridge.upload(file,{bucket:'video',timeoutMs:300000});if(!r.publicUrl)throw Error(t('Upload returned no file URL.'));return r.publicUrl;}catch(e){throw Error(t('Could not upload “{name}”. {error}',{name:file.name,error:t(/timeout|network|aborted|failed_0/.test(e.message)?t('Check your connection and try again.'):e.message||t('Please try again.'))}));}};
   $('editorStatus').textContent=t('Preparing example video…');const preparedResult=typeof result==='string'?await storedFile(result):await window.HenshinMedia.compress(result,{example:true});
   const poster=await thumbnail(preparedResult);
   $('editorStatus').textContent=t('Preparing a lightweight library preview…');const previewFile=await window.HenshinMedia.libraryPreview(preparedResult);
   $('editorStatus').textContent=t('Compressing source video…');const preparedSource=typeof source==='string'?null:await window.HenshinMedia.compress(source);
   $('editorStatus').textContent=t('Uploading template videos and references…');const video_url=typeof result==='string'?result:await upload(preparedResult),source_video_url=typeof source==='string'?source:await upload(preparedSource),poster_url=await upload(poster),image_urls=[];for(const ref of references)image_urls.push(ref.file?await upload(ref.file):ref.url);
   const preview_url=await upload(previewFile);
   const latest=await session();if(!owner(latest))throw Error(t('Owner session expired. Sign in again.'));
   const response=await fetch('/.netlify/functions/henshin-templates',{method:editID?'PATCH':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+latest.access_token},body:JSON.stringify({...(editID?{id:editID}:{}),video_url,source_video_url,poster_url,preview_url,image_urls,prompt,mode,resolution,keep_audio:keep})});
   const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||t('Could not publish template.'));
   try{sessionStorage.removeItem('hansora:henshin-templates:v2');localStorage.setItem('hansora:henshin-templates-changed',String(Date.now()));}catch{}
   $('editorStatus').textContent=data.cleanup_pending?t('Template saved. Old file cleanup is pending; save again to retry.'):t(editID?'Template updated. Open the Trendy examples to view it.':'Template published. Open the Trendy examples to view it.');
  }catch(e){$('editorStatus').textContent=t(e.message);}finally{busy=false;elements.forEach(e=>e.disabled=false);}
 };
 renderReferences();
 session().then(s=>{access(s);return loadEdit(s);}).catch(()=>access(null));sb.auth.onAuthStateChange((_event,s)=>{access(s);loadEdit(s);});
})();
