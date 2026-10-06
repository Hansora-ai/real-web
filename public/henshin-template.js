(() => {
 'use strict';
 const $=id=>document.getElementById(id),config=window.HenshinConfig,sb=window.__HANSORA_SB__||window.supabase.createClient(config.url,config.key);
 const OWNER='hansora.ai.bot@gmail.com';let busy=false,references=[];
 const owner=s=>!!(s?.user.email_confirmed_at&&s.user.email?.toLowerCase()===OWNER);
 function access(s){$('editorForm').hidden=!owner(s);$('editorAccess').textContent=owner(s)?'Save the source, references and prompt people will use to recreate this example.':'Only the Hansora template owner can publish to this library. Sign in with the owner account to continue.';}
 async function session(){return (await sb.auth.getSession()).data.session;}
 async function videoValid(file){if(!file||!file.type.startsWith('video/')||file.size>100*1024*1024)throw Error('Choose videos smaller than 100 MB.');const d=await window.HenshinMedia.duration(file);if(d<4||d>30)throw Error('Videos must be 4–30 seconds.');return d;}
 async function imagesValid(files){if(!files.length||files.length>30)throw Error('Add 1–30 reference images.');for(const f of files){if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>10*1024*1024)throw Error('Use JPG, PNG or WebP images smaller than 10 MB.');const b=await createImageBitmap(f),r=b.width/b.height,valid=b.width>300&&b.width<6000&&b.height>300&&b.height<6000&&r>.4&&r<2.5;b.close();if(!valid)throw Error('Reference images must be 301–5999 px with an aspect ratio between 0.4 and 2.5.');}}
 const closeIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
 function clearVideo(input){
  const v=$(input+'Preview');if(v.dataset.blob)URL.revokeObjectURL(v.dataset.blob);delete v.dataset.blob;
  v.pause();v.removeAttribute('src');v.load();$(input+'Media').hidden=true;$(input).value='';
 }
 for(const input of ['editorResult','editorSource']){
  let selection=0;
  $(input+'Remove').onclick=()=>{if(!busy){selection++;clearVideo(input);}};
  $(input).onchange=async()=>{
   if(busy)return;const chosen=++selection,file=$(input).files[0],v=$(input+'Preview');
   if(v.dataset.blob)URL.revokeObjectURL(v.dataset.blob);delete v.dataset.blob;v.pause();v.removeAttribute('src');v.load();$(input+'Media').hidden=true;
   try{await videoValid(file);if(selection!==chosen)return;v.src=URL.createObjectURL(file);v.dataset.blob=v.src;$(input+'Media').hidden=false;$('editorStatus').textContent='';}
   catch(e){if(selection===chosen){clearVideo(input);$('editorStatus').textContent=e.message;}}
  };
 }
 function renderReferences(){
  $('editorImages').replaceChildren();$('editorReferences').required=references.length===0;
  for(const [i,item]of references.entries()){
   const tile=document.createElement('div'),img=document.createElement('img'),remove=document.createElement('button');
   tile.className='editor-image-tile';img.src=item.url;img.alt='Reference '+(i+1);
   remove.type='button';remove.className='remove-media';remove.innerHTML=closeIcon;remove.setAttribute('aria-label','Remove reference '+(i+1));
   remove.onclick=()=>{if(busy)return;URL.revokeObjectURL(item.url);references.splice(i,1);renderReferences();};
   tile.append(img,remove);$('editorImages').append(tile);
  }
 }
 $('editorReferences').onchange=async()=>{
  if(busy)return;const files=Array.from($('editorReferences').files);$('editorReferences').value='';
  try{await imagesValid([...references.map(item=>item.file),...files]);if(busy)return;
   references.push(...files.map(file=>({file,url:URL.createObjectURL(file)})));renderReferences();$('editorStatus').textContent='';
  }catch(e){$('editorStatus').textContent=e.message;}
 };
 $('editorMode').onchange=()=>{$('editorPrompt').required=$('editorMode').value!=='motion';};
 async function thumbnail(file){
  const video=document.createElement('video'),url=URL.createObjectURL(file);
  try{
   video.muted=true;video.playsInline=true;video.preload='auto';
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Could not read the example thumbnail.')),10000);
    video.onerror=()=>{clearTimeout(timer);reject(Error('Could not read the example thumbnail.'));};
    video.onloadeddata=()=>{clearTimeout(timer);resolve();};video.src=url;
   });
   const canvas=document.createElement('canvas'),scale=Math.min(1,420/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.78));if(!blob)throw Error('Could not create the example thumbnail.');return new File([blob],'template-preview.jpg',{type:'image/jpeg'});
  }finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
 }
 $('editorForm').onsubmit=async event=>{
  event.preventDefault();if(busy)return;busy=true;
  const elements=Array.from($('editorForm').elements);elements.forEach(e=>e.disabled=true);
  try{
   const s=await session();if(!owner(s))throw Error('Only the confirmed owner account can publish templates.');
   const result=$('editorResult').files[0],source=$('editorSource').files[0],refs=references.map(item=>item.file),prompt=$('editorPrompt').value.trim(),mode=$('editorMode').value,title=$('editorTitle').value.trim(),resolution=$('editorQuality').value,keep=$('editorAudio').checked;
   await videoValid(result);await videoValid(source);await imagesValid(refs);
   if(!title)throw Error('Add a template title.');if(mode!=='motion'&&!prompt)throw Error('Describe the requested change.');
   const upload=async file=>{const r=await window.kieUploadBridge.upload(file,{bucket:'video'});if(!r.publicUrl)throw Error('Upload failed.');return r.publicUrl;};
   $('editorStatus').textContent='Compressing example video…';const preparedResult=await window.HenshinMedia.compress(result);
   const poster=await thumbnail(preparedResult);
   $('editorStatus').textContent='Compressing source video…';const preparedSource=await window.HenshinMedia.compress(source);
   $('editorStatus').textContent='Uploading template videos and references…';const video_url=await upload(preparedResult),source_video_url=await upload(preparedSource),poster_url=await upload(poster),image_urls=[];for(const ref of refs)image_urls.push(await upload(ref));
   const latest=await session();if(!owner(latest))throw Error('Owner session expired. Sign in again.');
   const response=await fetch('/.netlify/functions/henshin-templates',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+latest.access_token},body:JSON.stringify({title,video_url,source_video_url,poster_url,image_urls,prompt,mode,resolution,keep_audio:keep})});
   const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Could not publish template.');
   $('editorStatus').textContent='Template published. Open the Motion Library to view it.';
  }catch(e){$('editorStatus').textContent=e.message;}finally{busy=false;elements.forEach(e=>e.disabled=false);}
 };
 session().then(access).catch(()=>access(null));sb.auth.onAuthStateChange((_event,s)=>access(s));
})();
