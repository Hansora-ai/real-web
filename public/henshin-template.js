(() => {
 'use strict';
 const $=id=>document.getElementById(id),config=window.HenshinConfig,sb=window.__HANSORA_SB__||window.supabase.createClient(config.url,config.key);
 const OWNER='hansora.ai.bot@gmail.com';let busy=false,objectURLs=[];
 const owner=s=>!!(s?.user.email_confirmed_at&&s.user.email?.toLowerCase()===OWNER);
 function access(s){$('editorForm').hidden=!owner(s);$('editorAccess').textContent=owner(s)?'Save the source, references and prompt people will use to recreate this example.':'Only the Hansora template owner can publish to this library. Sign in with the owner account to continue.';}
 async function session(){return (await sb.auth.getSession()).data.session;}
 async function videoValid(file){if(!file||!file.type.startsWith('video/')||file.size>100*1024*1024)throw Error('Choose videos smaller than 100 MB.');const d=await window.HenshinMedia.duration(file);if(d<4||d>30)throw Error('Videos must be 4–30 seconds.');return d;}
 async function imagesValid(files){if(!files.length||files.length>30)throw Error('Add 1–30 reference images.');for(const f of files){if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>10*1024*1024)throw Error('Use JPG, PNG or WebP images smaller than 10 MB.');const b=await createImageBitmap(f),r=b.width/b.height,valid=b.width>300&&b.width<6000&&b.height>300&&b.height<6000&&r>.4&&r<2.5;b.close();if(!valid)throw Error('Reference images must be 301–5999 px with an aspect ratio between 0.4 and 2.5.');}}
 for(const [input,preview] of [['editorResult','editorResultPreview'],['editorSource','editorSourcePreview']])$(input).onchange=async()=>{const v=$(preview);if(v.dataset.blob)URL.revokeObjectURL(v.dataset.blob);v.hidden=true;v.removeAttribute('src');try{const file=$(input).files[0];await videoValid(file);v.src=URL.createObjectURL(file);v.dataset.blob=v.src;v.hidden=false;$('editorStatus').textContent='';}catch(e){$(input).value='';$('editorStatus').textContent=e.message;}};
 $('editorReferences').onchange=async()=>{objectURLs.forEach(URL.revokeObjectURL);objectURLs=[];$('editorImages').replaceChildren();try{const files=Array.from($('editorReferences').files);await imagesValid(files);for(const [i,file]of files.entries()){const img=document.createElement('img');img.src=URL.createObjectURL(file);objectURLs.push(img.src);img.alt='Reference '+(i+1);$('editorImages').append(img);}$('editorStatus').textContent='';}catch(e){$('editorReferences').value='';$('editorStatus').textContent=e.message;}};
 $('editorMode').onchange=()=>{$('editorPrompt').required=$('editorMode').value!=='motion';};
 $('editorForm').onsubmit=async event=>{
  event.preventDefault();if(busy)return;busy=true;
  const elements=Array.from($('editorForm').elements);elements.forEach(e=>e.disabled=true);
  try{
   const s=await session();if(!owner(s))throw Error('Only the confirmed owner account can publish templates.');
   const result=$('editorResult').files[0],source=$('editorSource').files[0],refs=Array.from($('editorReferences').files),prompt=$('editorPrompt').value.trim(),mode=$('editorMode').value,title=$('editorTitle').value.trim(),resolution=$('editorQuality').value,keep=$('editorAudio').checked;
   await videoValid(result);await videoValid(source);await imagesValid(refs);
   if(!title)throw Error('Add a template title.');if(mode!=='motion'&&!prompt)throw Error('Describe the requested change.');
   const upload=async file=>{const r=await window.kieUploadBridge.upload(file,{bucket:'video'});if(!r.publicUrl)throw Error('Upload failed.');return r.publicUrl;};
   $('editorStatus').textContent='Compressing example video…';const preparedResult=await window.HenshinMedia.compress(result);
   $('editorStatus').textContent='Compressing source video…';const preparedSource=await window.HenshinMedia.compress(source);
   $('editorStatus').textContent='Uploading template videos and references…';const video_url=await upload(preparedResult),source_video_url=await upload(preparedSource),image_urls=[];for(const ref of refs)image_urls.push(await upload(ref));
   const latest=await session();if(!owner(latest))throw Error('Owner session expired. Sign in again.');
   const response=await fetch('/.netlify/functions/henshin-templates',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+latest.access_token},body:JSON.stringify({title,video_url,source_video_url,image_urls,prompt,mode,resolution,keep_audio:keep})});
   const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Could not publish template.');
   $('editorStatus').textContent='Template published. Open the Motion Library to view it.';
  }catch(e){$('editorStatus').textContent=e.message;}finally{busy=false;elements.forEach(e=>e.disabled=false);}
 };
 session().then(access).catch(()=>access(null));sb.auth.onAuthStateChange((_event,s)=>access(s));
})();
