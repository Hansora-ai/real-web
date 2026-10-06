/* Local single-thread ffmpeg.wasm; jobs are serialized to isolate temporary files. */
(() => {
 let chain=Promise.resolve();
 function script() {
  return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/vendor/henshin/ffmpeg.js';s.onload=resolve;s.onerror=()=>reject(Error('Could not load media tools.'));document.head.append(s);});
 }
 async function process(work) {
  const task=chain.then(async()=>{
   if(!window.FFmpegWASM) await script();
   const ff=new window.FFmpegWASM.FFmpeg();
   try {
    await ff.load({coreURL:'/vendor/henshin/ffmpeg-core.js',wasmURL:'/vendor/henshin/ffmpeg-core.wasm'});
    return await work(ff);
   } finally {ff.terminate();}
  });
  chain=task.catch(()=>{});return task;
 }
 async function bytes(input){
  if(input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
  const r=await fetch(input);if(!r.ok) throw Error('Could not download media for processing.');
  const blob=await r.blob();if(blob.size>100*1024*1024) throw Error('Video exceeds the 100 MB processing limit.');
  return new Uint8Array(await blob.arrayBuffer());
 }
 async function duration(blob) {
  return new Promise((resolve,reject)=>{
   const v=document.createElement('video'),url=URL.createObjectURL(blob);
   const cleanup=()=>{clearTimeout(timer);v.removeAttribute('src');v.load();URL.revokeObjectURL(url);};
   const timer=setTimeout(()=>{cleanup();reject(Error('Could not read video duration.'));},15000);
   v.preload='metadata';v.onloadedmetadata=()=>{const d=v.duration;cleanup();Number.isFinite(d)?resolve(d):reject(Error('Invalid video duration.'));};v.onerror=()=>{cleanup();reject(Error('This video format could not be read.'));};v.src=url;
  });
 }
 window.HenshinMedia={duration,
  compress: file=>process(async ff=>{
   await ff.writeFile('source',await bytes(file));
   await ff.ffprobe(['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json','source','-o','dimensions.json']);
   const dims=JSON.parse(new TextDecoder().decode(await ff.readFile('dimensions.json'))).streams?.[0];
   const ratio=dims?.width/dims?.height;
   if(!Number.isFinite(ratio)||ratio<.4||ratio>2.5)throw Error('Source video aspect ratio must be between 0.4 and 2.5.');
   const code=await ff.exec(['-i','source','-t','30','-vf',"scale=w='trunc(sqrt(921600*iw/ih)/2)*2':h='trunc(sqrt(921600*ih/iw)/2)*2',fps=30",'-c:v','libx264','-preset','veryfast','-crf','25','-c:a','aac','-b:a','128k','-movflags','+faststart','template.mp4'],180000);
   if(code) throw Error('Template compression failed. Try an MP4 video.');
   return new File([await ff.readFile('template.mp4')],'template.mp4',{type:'video/mp4'});
  })
 };
})();
