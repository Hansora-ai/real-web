const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
if(!globalThis.self)globalThis.self={location:{href:'file:///henshin/ffmpeg-core.js'}};
const createCore=require('../../public/vendor/henshin/ffmpeg-core.js');
const wasm=fs.readFileSync(path.resolve('public/vendor/henshin/ffmpeg-core.wasm'));
const core=()=>createCore({wasmBinary:wasm});
function client(durations=[]){
 class FFmpeg{
  async load(){this.core=await core();}
  async writeFile(p,b){this.core.FS.writeFile(p,b);}
  async readFile(p){return this.core.FS.readFile(p);}
  async ffprobe(args){this.core.reset();this.core.ffprobe(...args);}
  async exec(args,timeout){this.core.reset();this.core.setTimeout(timeout);return this.core.exec(...args);}
  terminate(){this.core=null;}
 }
 const document={createElement:()=>({load(){},removeAttribute(){},set src(value){this.duration=durations.shift();queueMicrotask(()=>this.onloadedmetadata());}})};
 const window={FFmpegWASM:{FFmpeg}},context={window,document,Blob,File,Uint8Array,TextDecoder,URL,setTimeout,clearTimeout};
 vm.runInNewContext(fs.readFileSync('public/henshin-media.js','utf8'),context);return window.HenshinMedia;
}
test('A wide AVI becomes a model-compatible H.264 MP4 without losing duration or audio',async()=>{
 const c=await core();c.FS.writeFile('source.mp4',fs.readFileSync('test/henshin/fixtures/source.mp4'));c.reset();assert.equal(c.exec('-i','source.mp4','-vf','scale=1000:100,setsar=1','-c:v','mpeg4','-c:a','pcm_s16le','wide.avi'),0);
 const media=client(),file=new File([c.FS.readFile('wide.avi')],'wide.avi',{type:''}),result=await media.compress(file);
 c.FS.writeFile('result.mp4',new Uint8Array(await result.arrayBuffer()));c.reset();c.ffprobe('-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height,r_frame_rate','-of','json','result.mp4','-o','probe.json');
 const data=JSON.parse(new TextDecoder().decode(c.FS.readFile('probe.json'))),video=data.streams.find(s=>s.codec_type==='video');
 assert.equal(result.type,'video/mp4');assert.equal(video.codec_name,'h264');assert.ok(video.width/video.height>.4&&video.width/video.height<2.5);assert.ok(video.width*video.height>=409600&&video.width*video.height<=927408);assert.equal(video.r_frame_rate,'30/1');assert.ok(data.streams.some(s=>s.codec_type==='audio'&&s.codec_name==='aac'));assert.ok(Math.abs(Number(data.format.duration)-5)<.1);assert.equal(await media.compress(result),result);
});
test('An overlong video is rejected instead of silently cutting off its ending',async()=>{
 const c=await core();c.reset();assert.equal(c.exec('-f','lavfi','-i','color=c=black:s=32x32:r=1','-t','31','-c:v','libx264','long.mp4'),0);
 await assert.rejects(client().compress(new File([c.FS.readFile('long.mp4')],'long.mp4',{type:'video/mp4'})),/31.*4–30/);
});

test('A video below 30 seconds is accepted when its Opus audio tail extends past 30 seconds',async()=>{
 const c=await core(),bytes=fs.readFileSync('test/henshin/fixtures/audio-tail.mp4');
 c.FS.writeFile('original.mp4',bytes);c.reset();c.ffprobe('-v','error','-show_entries','format=duration:stream=codec_type,duration','-of','json','original.mp4','-o','original.json');
 const original=JSON.parse(new TextDecoder().decode(c.FS.readFile('original.json')));
 assert.ok(Number(original.format.duration)>30);assert.ok(Number(original.streams.find(s=>s.codec_type==='video').duration)<30);
 const result=await client([Number(original.format.duration),29.934]).prepareVideo(new File([bytes],'audio-tail.mp4',{type:'video/mp4'}));
 c.FS.writeFile('prepared.mp4',new Uint8Array(await result.file.arrayBuffer()));c.reset();c.ffprobe('-v','error','-show_entries','format=duration:stream=codec_type,codec_name','-of','json','prepared.mp4','-o','prepared.json');
 const prepared=JSON.parse(new TextDecoder().decode(c.FS.readFile('prepared.json')));
 assert.ok(Number(prepared.format.duration)<=30);assert.ok(Number(prepared.format.duration)>29.9);
 assert.deepEqual(prepared.streams.map(s=>s.codec_name),['h264','aac']);assert.ok(result.seconds<=30);
});


test('Square, 4:3, 3:4 and ultrawide videos keep their proportions during preparation',async()=>{
 const c=await core();c.FS.writeFile('source.mp4',fs.readFileSync('test/henshin/fixtures/source.mp4'));
 for(const [width,height] of [[400,400],[640,480],[480,640],[840,360]]){
  c.reset();assert.equal(c.exec('-i','source.mp4','-vf',`scale=${width}:${height},setsar=1`,'-c:v','libx264','-an','-y','shape.mp4'),0);
  const file=await client().compress(new File([c.FS.readFile('shape.mp4')],'shape.mp4',{type:'video/mp4'}));c.FS.writeFile('prepared.mp4',new Uint8Array(await file.arrayBuffer()));
  c.reset();c.ffprobe('-v','error','-show_entries','stream=width,height','-of','json','prepared.mp4','-o','shape.json');const v=JSON.parse(new TextDecoder().decode(c.FS.readFile('shape.json'))).streams[0];assert.ok(Math.abs(v.width/v.height-width/height)<.01);assert.ok(v.width*v.height>=409600&&v.width*v.height<=927408);
 }
});
test('Library playback gets a small silent preview while the complete video remains available',async()=>{
 const source=fs.readFileSync('test/henshin/fixtures/source.mp4'),original=new File([source],'original.mp4',{type:'video/mp4'}),result=await client().libraryPreview(original);
 assert.deepEqual(Buffer.from(await original.arrayBuffer()),source);assert.ok(result.size<source.length);
 const c=await core();c.FS.writeFile('preview.mp4',new Uint8Array(await result.arrayBuffer()));c.reset();c.ffprobe('-v','error','-show_entries','format=duration:stream=codec_type,width,height','-of','json','preview.mp4','-o','preview.json');
 const data=JSON.parse(new TextDecoder().decode(c.FS.readFile('preview.json')));assert.ok(Number(data.format.duration)<=4.1);assert.deepEqual(data.streams.map(s=>s.codec_type),['video']);assert.equal(Math.max(data.streams[0].width,data.streams[0].height),360);
});
