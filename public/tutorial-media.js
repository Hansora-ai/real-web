/* Tutorial uploads: shrink videos in the browser (same FFmpeg build as Henshin) before they reach storage. */
(() => {
 'use strict';
 let chain=Promise.resolve(),loader=null;
 function ffmpegScript(){
  if(window.FFmpegWASM)return Promise.resolve();
  loader??=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/vendor/henshin/ffmpeg.js';s.onload=resolve;s.onerror=()=>{loader=null;s.remove();reject(Error('Could not load the video compressor. Check your connection and try again.'));};document.head.append(s);});
  return loader;
 }
 // presets: cover = muted card/hero loop; video = tutorial or reference video with sound.
 const PRESETS={cover:{maxSide:960,crf:30,fps:30,audio:false},video:{maxSide:1280,crf:28,fps:30,audio:true}};
 async function compressVideo(file,kind='video',onProgress=()=>{}){
  const p=PRESETS[kind]||PRESETS.video;
  const task=chain.then(async()=>{
   await ffmpegScript();
   const ff=new window.FFmpegWASM.FFmpeg();
   ff.on('progress',({progress})=>{if(Number.isFinite(progress))onProgress(Math.max(0,Math.min(1,progress)));});
   try{
    await ff.load({coreURL:'/vendor/henshin/ffmpeg-core.js',wasmURL:'/vendor/henshin/ffmpeg-core.wasm'});
    await ff.writeFile('source',new Uint8Array(await file.arrayBuffer()));
    const fit=`min(1,${p.maxSide}/max(iw,ih))`;
    const vf=`scale=w='trunc(iw*${fit}/2)*2':h='trunc(ih*${fit}/2)*2',fps=${p.fps}`;
    const audio=p.audio?['-map','0:a:0?','-c:a','aac','-b:a','96k']:['-an'];
    const code=await ff.exec(['-i','source','-map','0:v:0',...audio,'-vf',vf,'-c:v','libx264','-preset','veryfast','-crf',String(p.crf),'-pix_fmt','yuv420p','-movflags','+faststart','out.mp4'],900000);
    if(code)throw Error('Could not compress this video. Export it as MP4 (H.264) and try again.');
    const out=new File([await ff.readFile('out.mp4')],(file.name||'video').replace(/\.[^.]+$/,'')+'.mp4',{type:'video/mp4'});
    return out.size<file.size||file.type!=='video/mp4'?out:file;
   }finally{ff.terminate();}
  });
  chain=task.catch(()=>{});return task;
 }
 window.TutorialMedia={compressVideo};
})();
