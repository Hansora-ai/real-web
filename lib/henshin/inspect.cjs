const fs=require('node:fs');
const path=require('node:path');
const {mediaURL}=require('./common.cjs');
// The published single-thread WASM core targets Web Workers; supplying its
// bytes directly avoids browser I/O and lets ffprobe run entirely in memory.
if(!globalThis.self) globalThis.self={location:{href:'file:///henshin/ffmpeg-core.js'}};
const createCore=require('../../public/vendor/henshin/ffmpeg-core.js');
async function inspect(url) {
 if(!mediaURL(url)) throw Error('Invalid uploaded video.');
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok) throw Error('Could not read uploaded video.');
 const limit=100*1024*1024;
 if(Number(response.headers.get('content-length'))>limit) throw Error('Video exceeds 100 MB.');
 const reader=response.body.getReader(),parts=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('Video exceeds 100 MB.');}parts.push(Buffer.from(value));}
 const core=await createCore({wasmBinary:fs.readFileSync(path.join(process.cwd(),'public/vendor/henshin/ffmpeg-core.wasm'))});
 try {
  core.FS.writeFile('source',Buffer.concat(parts));core.ffprobe('-v','error','-show_entries','format=duration:stream=codec_type,width,height,sample_aspect_ratio','-of','json','source','-o','probe.json');
  const data=JSON.parse(new TextDecoder().decode(core.FS.readFile('probe.json')));
  const seconds=Number(data.format?.duration);
  if(!data.streams?.some(s=>s.codec_type==='video')||!Number.isFinite(seconds)||seconds<4||seconds>30)throw Error('Source video must be 4–30 seconds.');
  const video=data.streams.find(s=>s.codec_type==='video'),sar=String(video.sample_aspect_ratio||'1:1').split(':').map(Number);
  return {seconds,hasAudio:data.streams.some(s=>s.codec_type==='audio'),aspectRatio:video.width*(sar[0]&&sar[1]?sar[0]/sar[1]:1)/video.height};
 }finally{try{core.FS.unlink('source');core.FS.unlink('probe.json');}catch{}}
}
module.exports={inspect};
