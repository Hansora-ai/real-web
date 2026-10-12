import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { newProject, duration } from '../../public/caption-studio/core.mjs';
const run = promisify(execFile);
const available = await run('ffmpeg',['-version']).then(()=>true,()=>false);
test('native single-pass export combines trimmed silent and audible clips, captions and MP4 music', {skip:!available, timeout:30000}, async () => {
  const dir=await mkdtemp(join(tmpdir(),'caption-render-test-'));
  const server=spawn(process.execPath,['scripts/caption-studio-dev.mjs'],{env:{...process.env,CAPTION_STUDIO_PORT:'4189'},stdio:['ignore','pipe','pipe']});
  server.stderr.on('data', d => console.error(String(d)));
  try {
    await once(server.stdout,'data');
    const base='http://127.0.0.1:4189';
    await run('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=blue:s=320x180:r=30:d=2','-c:v','libx264','-preset','ultrafast',join(dir,'silent.mp4')]);
    await run('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=red:s=320x180:r=30:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-preset','ultrafast','-c:a','aac',join(dir,'speech.mp4')]);
    // A solid PNG overlay gives a deterministic pixel check for compositing.
    await run('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=lime:s=480x270','-frames:v','1',join(dir,'overlay.png')]);
    const p=newProject();p.aspect='16:9';p.resolution=480;
    p.clips=[{assetId:'silent',start:.5,end:1.5,volume:1},{assetId:'speech',start:.5,end:2,volume:0}];
    p.music={assetId:'music',volume:.5};
    const form=new FormData();form.append('meta',JSON.stringify({project:p,assets:[{id:'silent'},{id:'speech'}],times:[0,duration(p)]}));
    for(const [field,file] of [['media0','silent.mp4'],['media1','speech.mp4'],['music','speech.mp4'],['overlay0.png','overlay.png']]) form.append(field,new Blob([await readFile(join(dir,file))]),field);
    const response=await fetch(base+'/api/caption-studio/render',{method:'POST',body:form});
    assert.equal(response.status,200);
    const events=(await response.text()).trim().split('\n').map(JSON.parse);
    assert.ok(events.at(-1).url,JSON.stringify(events));
    const result=await fetch(base+events.at(-1).url);const file=join(dir,'out.mp4');await writeFile(file,new Uint8Array(await result.arrayBuffer()));
    const probe=JSON.parse((await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file])).stdout);
    assert.ok(Math.abs(Number(probe.format.duration)-2.5)<.04);
    assert.equal(probe.streams[0].width,854);assert.equal(probe.streams[0].height,480);
    assert.equal(probe.streams[0].codec_name,'h264');assert.equal(probe.streams[1].codec_name,'aac');
    const pixels=await run('ffmpeg',['-v','error','-ss','0.4','-i',file,'-frames:v','1','-vf','crop=2:2:10:10','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer'});
    assert.ok(pixels.stdout[1]>150 && pixels.stdout[0]<80); // green overlay
    const levels=await run('ffmpeg',['-i',file,'-af','volumedetect','-f','null','-']);
    assert.ok(!/mean_volume: -inf/.test(levels.stderr)); // MP4 background sound survived mute
    assert.equal((await fetch(base+events.at(-1).url)).status,404); // one-use cleanup
    assert.equal((await fetch(base+'/api/caption-studio/render',{method:'POST',headers:{origin:'https://unrelated.example'}})).status,403);
    const malformed=new FormData();malformed.append('../../unsafe',new Blob(['test']),'file');
    assert.equal((await fetch(base+'/api/caption-studio/render',{method:'POST',body:malformed})).status,400);
    const mixed=newProject();mixed.aspect='16:9';mixed.resolution=480;
    mixed.clips=[{assetId:'silent',start:0,end:1},{assetId:'still',start:0,end:3,style:{width:100,x:50,y:50}},{assetId:'speech',start:0,end:1}];
    mixed.audio=[{assetId:'musicA',start:1.5,end:3,in:.25,volume:.4},{assetId:'musicB',start:2,end:4,in:0,volume:.2}];
    const mixedForm=new FormData();mixedForm.append('meta',JSON.stringify({project:mixed,assets:[{id:'silent'},{id:'still',kind:'image'},{id:'speech'}],audioAssets:[{id:'musicA'},{id:'musicB'}],times:[0,5]}));
    for(const [field,file] of [['media0','silent.mp4'],['media1','overlay.png'],['media2','speech.mp4'],['audio0','speech.mp4'],['audio1','speech.mp4']]) mixedForm.append(field,new Blob([await readFile(join(dir,file))]),field);
    const mixedResponse=await fetch(base+'/api/caption-studio/render',{method:'POST',body:mixedForm});
    const mixedEvents=(await mixedResponse.text()).trim().split('\n').map(JSON.parse);
    assert.ok(mixedEvents.at(-1).url,JSON.stringify(mixedEvents));
    const mixedFile=join(dir,'mixed.mp4');await writeFile(mixedFile,new Uint8Array(await (await fetch(base+mixedEvents.at(-1).url)).arrayBuffer()));
    const stillPixel=await run('ffmpeg',['-v','error','-ss','2','-i',mixedFile,'-frames:v','1','-vf','crop=2:2:100:100','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer'});
    assert.ok(stillPixel.stdout[1]>150 && stillPixel.stdout[0]<80);
    const length=JSON.parse((await run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',mixedFile])).stdout);
    assert.ok(Math.abs(Number(length.format.duration)-5)<.04);
    // Compare decoded samples, not slider labels: 25% gain must be 12 dB quieter.
    await run('ffmpeg',['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=1','-f','lavfi','-i','sine=frequency=880:duration=1','-filter_complex','[0:a][1:a]concat=n=2:v=0:a=1',join(dir,'two-tones.wav')]);
    const audioResult=async(volume,inPoint=0,length=1)=>{
      const project=newProject();project.aspect='1:1';project.resolution=480;
      project.audio=[{assetId:'tone',start:0,end:length,in:inPoint,out:inPoint+length,volume,loop:false}];
      const request=new FormData();request.append('meta',JSON.stringify({project,assets:[],audioAssets:[{id:'tone'}],times:[0,length]}));
      request.append('audio0',new Blob([await readFile(join(dir,'two-tones.wav'))]),'tone.wav');
      const response=await fetch(base+'/api/caption-studio/render',{method:'POST',body:request});
      const events=(await response.text()).trim().split('\n').map(JSON.parse);assert.ok(events.at(-1).url,JSON.stringify(events));
      const out=join(dir,`gain-${volume}-${inPoint}.mp4`);await writeFile(out,new Uint8Array(await (await fetch(base+events.at(-1).url)).arrayBuffer()));
      const pcm=(await run('ffmpeg',['-v','error','-i',out,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{encoding:'buffer'})).stdout;
      const data=new Float32Array(pcm.buffer,pcm.byteOffset,pcm.length/4);const middle=data.subarray(4800,Math.min(data.length,48000)-4800);
      const rms=Math.sqrt(middle.reduce((sum,v)=>sum+v*v,0)/middle.length);
      const duration=Number(JSON.parse((await run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',out])).stdout).format.duration);
      let crossings=0;for(let i=1;i<middle.length;i++)if(middle[i-1]<0 && middle[i]>=0)crossings++;
      const frequency=crossings*48000/middle.length;
      return {rms,duration,frequency};
    };
    const loud=await audioResult(1),quiet=await audioResult(.25),muted=await audioResult(0),trimmed=await audioResult(1,1.2,.5);
    assert.ok(Math.abs(20*Math.log10(quiet.rms/loud.rms)+12.041)<.5);
    assert.ok(muted.rms<.00001);assert.ok(Math.abs(trimmed.duration-.5)<.04);
    assert.ok(Math.abs(trimmed.rms/loud.rms-1)<.1);
    assert.ok(Math.abs(loud.frequency-440)<5);assert.ok(Math.abs(trimmed.frequency-880)<5); // correct source section, same pitch
    const cancelProject = structuredClone(p);
    cancelProject.clips = Array.from({length:12}, () => p.clips).flat();
    const cancelForm = new FormData();
    cancelForm.append('meta',JSON.stringify({project:cancelProject,assets:[{id:'silent'},{id:'speech'}],times:[0,duration(cancelProject)]}));
    for (const [field, blob] of form.entries()) if (field !== 'meta') cancelForm.append(field,blob,field);
    const controller = new AbortController();
    const pending = await fetch(base+'/api/caption-studio/render',{method:'POST',body:cancelForm,signal:controller.signal});
    const reader = pending.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value),/Rendering locally/);
    controller.abort();
    await new Promise(resolve => setTimeout(resolve,150));
    const retry = await fetch(base+'/api/caption-studio/render',{method:'POST',body:form});
    const retryEvents = (await retry.text()).trim().split('\n').map(JSON.parse);
    assert.ok(retryEvents.at(-1).url, JSON.stringify(retryEvents));
    await (await fetch(base+retryEvents.at(-1).url)).arrayBuffer();
  } finally {server.kill();await rm(dir,{recursive:true,force:true});}
});
