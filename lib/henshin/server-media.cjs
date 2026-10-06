const fs=require('node:fs');
const path=require('node:path');
const {BASE,KEY,mediaURL}=require('./common.cjs');
if(!globalThis.self)globalThis.self={location:{href:'file:///henshin/ffmpeg-core.js'}};
const createCore=require('../../public/vendor/henshin/ffmpeg-core.js');
const BUCKET=process.env.KIE_HISTORY_BUCKET||'generation-history';
async function readMedia(url,timeout=20000){
 if(!mediaURL(url))throw Error('Invalid stored media.');
 const res=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(timeout)});
 if(!res.ok)throw Error('Could not read stored media.');
 const limit=100*1024*1024;
 if(Number(res.headers.get('content-length'))>limit)throw Error('Media exceeds 100 MB.');
 const reader=res.body.getReader(),parts=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('Media exceeds 100 MB.');}parts.push(Buffer.from(value));}
 if(!size)throw Error('Stored media is empty.');
 return Buffer.concat(parts);
}
async function withCore(work){
 const core=await createCore({wasmBinary:fs.readFileSync(path.join(process.cwd(),'public/vendor/henshin/ffmpeg-core.wasm'))});
 try{return await work(core);}finally{for(const file of core.FS.readdir('/')){if(!['.','..','tmp','home','dev','proc'].includes(file)){try{core.FS.unlink('/'+file);}catch{}}}}
}
function probe(core,file){
 core.reset();
 try{core.FS.unlink('probe.json');}catch{}
 // This core's ffprobe leaves its return register at -1 even on success;
 // require a fresh valid JSON report instead of interpreting that register.
 core.ffprobe('-v','error','-show_entries','format=duration:stream=codec_type','-of','json',file,'-o','probe.json');
 return JSON.parse(new TextDecoder().decode(core.FS.readFile('probe.json')));
}
function exec(core,...args){core.reset();core.setTimeout(120000);if(core.exec(...args))throw Error('Could not process the soundtrack.');}
async function store(uid,id,name,bytes,type,timeout=20000){
 const encoded=[uid,id,name].map(encodeURIComponent).join('/');
 const res=await fetch(`${BASE}/storage/v1/object/${encodeURIComponent(BUCKET)}/${encoded}`,{method:'POST',signal:AbortSignal.timeout(timeout),headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':type,'x-upsert':'true'},body:Buffer.from(bytes)});
 if(!res.ok)throw Error('Could not save processed media.');
 return `${BASE}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${encoded}`;
}
async function prepareSource(url,{uid,id,keepAudio}){
 const bytes=await readMedia(url,10000);
 return withCore(async core=>{
  core.FS.writeFile('source',bytes);
  const data=probe(core,'source'),seconds=Number(data.format?.duration),hasAudio=data.streams?.some(s=>s.codec_type==='audio');
  if(!data.streams?.some(s=>s.codec_type==='video')||!Number.isFinite(seconds)||seconds<4||seconds>30)throw Error('Source video must be 4–30 seconds.');
  if(!hasAudio)return {seconds,hasAudio:false,videoURL:url,audioURL:null,timingAudioURL:null};
  exec(core,'-i','source','-map','0:v:0','-c:v','copy','-an','-movflags','+faststart','silent.mp4');
  const uploads=[store(uid,id,'silent-source.mp4',core.FS.readFile('silent.mp4'),'video/mp4',10000)];
  if(keepAudio){
   // Save the original compressed audio stream without re-encoding it.
   exec(core,'-i','source','-map','0:a:0','-vn','-c:a','copy','audio.m4a');
   const audioBytes=Buffer.from(core.FS.readFile('audio.m4a'));
   exec(core,'-i','source','-map','0:a:0','-vn','-c:a','libmp3lame','-b:a','192k','timing.mp3');
   uploads.push(store(uid,id,'source-audio.m4a',audioBytes,'audio/mp4',10000),store(uid,id,'timing.mp3',core.FS.readFile('timing.mp3'),'audio/mpeg',10000));
  }
  const [videoURL,audioURL=null,timingAudioURL=null]=await Promise.all(uploads);
  return {seconds,hasAudio:true,videoURL,audioURL,timingAudioURL};
 });
}
async function restoreSoundtrack(row){
 const m=row.meta||{},video=m.generated_video_url||row.result_url;
 // The worker reads only server-archived media from this Supabase project.
 const [generated,audio]=await Promise.all([readMedia(video),readMedia(m.source_audio_url)]);
 return withCore(async core=>{
  core.FS.writeFile('result.mp4',generated);core.FS.writeFile('audio',audio);
  const duration=Number(probe(core,'result.mp4').format?.duration),seconds=Number(m.source_video_duration);
  if(!Number.isFinite(seconds)||!Number.isFinite(duration)||Math.abs(duration-seconds)>.3)throw Object.assign(Error('The generated duration differs from the source. The original soundtrack could not be synchronized.'),{permanent:true});
  exec(core,'-i','result.mp4','-i','audio','-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-af','apad','-t',String(seconds),'-movflags','+faststart','final.mp4');
  const final=probe(core,'final.mp4');
  if(!final.streams?.some(s=>s.codec_type==='video')||!final.streams?.some(s=>s.codec_type==='audio')||Math.abs(Number(final.format?.duration)-seconds)>.3)throw Error('The finished video could not be verified.');
  return store(row.user_id,row.id,'henshin-final.mp4',core.FS.readFile('final.mp4'),'video/mp4');
 });
}
module.exports={prepareSource,restoreSoundtrack,readMedia,withCore,probe};
