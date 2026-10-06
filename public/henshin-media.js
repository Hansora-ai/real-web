/* Local media conversion. FFmpeg jobs are serialized to bound worker memory. */
(() => {
 'use strict';
 const i18n=window.HenshinI18n,t=i18n?.t||((key,values={})=>key.replace(/\{([a-z]+)\}/g,(m,k)=>Object.hasOwn(values,k)?String(values[k]):m));
 const MB=1024*1024,converted=new WeakSet(),imageCache=new WeakMap(),scripts=new Map();
 let chain=Promise.resolve();
 function script(src){
  if(!scripts.has(src))scripts.set(src,new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>{scripts.delete(src);s.remove();reject(Error(t('Could not load media tools. Check your connection and try again.')));};document.head.append(s);}));
  return scripts.get(src);
 }
 async function process(work){
  const task=chain.then(async()=>{
   if(!window.FFmpegWASM)await script('/vendor/henshin/ffmpeg.js');
   const ff=new window.FFmpegWASM.FFmpeg();
   try{await ff.load({coreURL:'/vendor/henshin/ffmpeg-core.js',wasmURL:'/vendor/henshin/ffmpeg-core.wasm'});return await work(ff);}finally{ff.terminate();}
  });chain=task.catch(()=>{});return task;
 }
 function size(file,limit,kind){if(!(file instanceof Blob)||!file.size)throw Error(t('Choose a '+kind+' file.'));if(file.size>limit*MB)throw Error(t('“{name}” is larger than {limit} MB. Choose a smaller file.',{name:file.name||kind,limit}));}
 // Chrome keeps a disk-backed File only as a reference; if the file is moved,
 // re-saved or synced (iCloud/Downloads) before publishing, later reads fail
 // with NotReadableError. Copy it into memory once, right after selection.
 async function inMemory(file,kind){
  try{return new File([await file.arrayBuffer()],file.name||kind,{type:file.type,lastModified:file.lastModified});}
  catch{throw Error(t('Could not read “{name}”. Copy it to your Desktop, then choose it again.',{name:file.name||kind}));}
 }
 function typed(file){
  const types={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',bmp:'image/bmp',tif:'image/tiff',tiff:'image/tiff',avif:'image/avif',heic:'image/heic',heif:'image/heif',mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',mkv:'video/x-matroska',avi:'video/x-msvideo',m4v:'video/mp4'};
  const declared=file.type.toLowerCase(),mime=({'image/jpg':'image/jpeg','image/pjpeg':'image/jpeg','image/x-png':'image/png'}[declared])||((!declared||declared==='application/octet-stream')?types[file.name?.split('.').pop().toLowerCase()]||declared:declared);
  return mime===file.type?file:new File([file],file.name||'media',{type:mime});
 }
 async function duration(blob){
  return new Promise((resolve,reject)=>{
   const v=document.createElement('video'),url=URL.createObjectURL(blob);
   const cleanup=()=>{clearTimeout(timer);v.onloadedmetadata=v.onerror=null;v.removeAttribute('src');v.load();URL.revokeObjectURL(url);};
   const timer=setTimeout(()=>{cleanup();reject(Error(t('Could not read video duration.')));},8000);
   v.preload='metadata';v.onloadedmetadata=()=>{const d=v.duration;cleanup();Number.isFinite(d)&&d>0?resolve(d):reject(Error(t('Invalid video duration.')));};v.onerror=()=>{cleanup();reject(Error(t('This browser cannot preview the original video codec.')));};v.src=url;
  });
 }
 function validDuration(d){if(!Number.isFinite(d)||d<=0)throw Error(t('Could not read this video. Try exporting it as MP4 (H.264).'));if(d<4||d>30)throw Error(t('This video is {seconds} seconds. Henshin needs a 4–30 second clip; trim it before uploading.',{seconds:d.toFixed(1)}));return d;}
 async function compress(file){
  if(converted.has(file))return file;
  size(file,200,'video');
  return process(async ff=>{
   await ff.writeFile('source',new Uint8Array(await file.arrayBuffer()));
   await ff.ffprobe(['-v','error','-show_entries','format=duration:stream=codec_type,duration','-of','json','source','-o','probe.json']);
   let data;try{data=JSON.parse(new TextDecoder().decode(await ff.readFile('probe.json')));}catch{throw Error(t('Could not read this video. Try exporting it as MP4 (H.264).'));}
   const stream=data.streams?.find(s=>s.codec_type==='video');if(!stream)throw Error(t('This file has no readable video track.'));
   const seconds=validDuration(Number.isFinite(Number(stream.duration))?Number(stream.duration):Number(data.format?.duration));
   // Autorotation precedes the filter. Letterbox unusual shapes without cropping
   // or stretching; normalize pixel aspect, resolution, frame rate and codecs.
   const filter="scale=w='trunc(iw*sar/2)*2':h='trunc(ih/2)*2',setsar=1,pad=w='max(iw,ceil(ih*0.405/2)*2)':h='max(ih,ceil(iw/2.45/2)*2)':x='(ow-iw)/2':y='(oh-ih)/2',scale=w='trunc(sqrt(921600*iw/ih)/2)*2':h='trunc(sqrt(921600*ih/iw)/2)*2',fps=30";
   const code=await ff.exec(['-i','source','-map','0:v:0','-map','0:a:0?','-t',String(seconds),'-vf',filter,'-c:v','libx264','-pix_fmt','yuv420p','-preset','veryfast','-crf','25','-c:a','aac','-b:a','128k','-movflags','+faststart','prepared.mp4'],180000);
   if(code)throw Error(t('Could not convert this video codec. Export it as MP4 (H.264) and try again.'));
   const result=new File([await ff.readFile('prepared.mp4')],(file.name||'source').replace(/\.[^.]+$/,'')+'.mp4',{type:'video/mp4'});
   size(result,100,'processed video');converted.add(result);return result;
  });
 }
 async function prepareVideo(input){
  size(input,200,'video');let file=typed(await inMemory(input,'video')),d;
  try{d=await duration(file);}catch{file=await compress(file);d=await duration(file);}
  return {file,seconds:validDuration(d)};
 }
 async function decode(blob){
  try{return await createImageBitmap(blob);}catch{}
  const url=URL.createObjectURL(blob),img=new Image();
  try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});return {width:img.naturalWidth,height:img.naturalHeight,image:img,close(){img.src='';}};}finally{URL.revokeObjectURL(url);}
 }
 async function prepareImage(input){
  if(imageCache.has(input))return imageCache.get(input);
  size(input,30,'image');let file=typed(await inMemory(input,'image')),bitmap;
  try{bitmap=await decode(file);}catch{
   if(/heic|heif/i.test(file.type+' '+file.name)){
    if(!window.heic2any)await script('/vendor/henshin/heic2any.min.js');
    let blob;try{blob=await window.heic2any({blob:file,toType:'image/jpeg',quality:.94});}catch{throw Error(t('Could not convert this HEIC photo. Export it as JPG and try again.'));}
    file=new File([Array.isArray(blob)?blob[0]:blob],'reference.jpg',{type:'image/jpeg'});
   }else{
    file=await process(async ff=>{await ff.writeFile('image',new Uint8Array(await file.arrayBuffer()));const code=await ff.exec(['-i','image','-frames:v','1','decoded.png'],30000);if(code)throw Error(t('Could not read this image. Try JPG, PNG, WebP, HEIC, GIF, BMP, TIFF or AVIF.'));return new File([await ff.readFile('decoded.png')],'reference.png',{type:'image/png'});});
   }
   bitmap=await decode(file);
  }
  try{
   const w=bitmap.width,h=bitmap.height,r=w/h;if(!w||!h)throw Error(t('This image is empty.'));
   if(['image/jpeg','image/png','image/webp'].includes(file.type)&&file.size<=10*MB&&w>300&&h>300&&w<6000&&h<6000&&r>.4&&r<2.5){imageCache.set(input,file);return file;}
   const paddedW=Math.max(w,h*.405),paddedH=Math.max(h,w/2.45),scale=Math.min(4096/Math.max(paddedW,paddedH),Math.max(1,320/Math.min(paddedW,paddedH)));
   const canvas=document.createElement('canvas');canvas.width=Math.round(paddedW*scale);canvas.height=Math.round(paddedH*scale);
   const ctx=canvas.getContext('2d');if(!ctx)throw Error(t('Could not prepare this image.'));ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap.image||bitmap,(canvas.width-w*scale)/2,(canvas.height-h*scale)/2,w*scale,h*scale);
   let blob;for(const quality of [.94,.85,.72]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=10*MB)break;}
   if(!blob||blob.size>10*MB)throw Error(t('Could not compress this image. Export it as JPG and try again.'));
   const result=new File([blob],(input.name||'reference').replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'});imageCache.set(input,result);imageCache.set(result,result);return result;
  }finally{bitmap.close();}
 }
 async function libraryPreview(file){
  return process(async ff=>{
   await ff.writeFile('source',new Uint8Array(await file.arrayBuffer()));
   const code=await ff.exec(['-i','source','-map','0:v:0','-an','-t','4','-vf',"scale=w='if(gte(iw,ih),360,-2)':h='if(gte(iw,ih),-2,360)',fps=12",'-c:v','libx264','-pix_fmt','yuv420p','-preset','veryfast','-crf','30','-movflags','+faststart','preview.mp4'],60000);
   if(code)throw Error(t('Could not create the library preview.'));
   return new File([await ff.readFile('preview.mp4')],'template-motion-preview.mp4',{type:'video/mp4'});
  });
 }
 window.HenshinMedia={duration,compress,prepareVideo,prepareImage,libraryPreview};
})();
