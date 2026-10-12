import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PreviewAudio} from '../../public/caption-studio/preview-audio.mjs';
import {generationMedia,readGenerations} from '../../public/caption-studio/generations.mjs';

test('preview routes separate sources through independent gains and a master mute',async()=>{
  const sources=[];const gains=[];
  const node=()=>({connected:[],connect(n){this.connected.push(n);},disconnect(){this.disconnected=true;}});
  class Context {
    state='suspended';currentTime=10;destination=node();
    resume(){this.state='running';}
    createGain(){const n={...node(),gain:{value:1,setValueAtTime(v){this.value=v;}}};gains.push(n);return n;}
    createAnalyser(){return {...node(),fftSize:256,getFloatTimeDomainData(a){a.fill(.2);}};}
    createMediaElementSource(element){const n={...node(),element};sources.push(n);return n;}
  }
  const audio=new PreviewAudio(Context),video={volume:1,muted:false},music={volume:1,muted:false};
  await audio.unlock();audio.set(video,.8);audio.set(music,.25);
  assert.equal(sources.length,2);assert.equal(gains[1].gain.value,.8);assert.equal(gains[2].gain.value,.25);
  audio.set(music,0);assert.equal(sources.length,2);assert.equal(gains[2].gain.value,0);assert.equal(gains[1].gain.value,.8);
  audio.mute(true);assert.equal(gains[0].gain.value,0);audio.mute(false);assert.equal(gains[0].gain.value,1);
  assert.ok(Math.abs(audio.level()-.2)<.0001);audio.remove(music);assert.equal(sources[1].disconnected,true);
});
test('generation picker keeps completed results and queries only the signed-in owner',async()=>{
  const rows=[{id:'a',kind:'video',result_url:'https://media.example/a.mp4',meta:{result_urls:['https://media.example/a.mp4','https://media.example/b.mp4']}},{id:'b',kind:'audio',result_url:'https://media.example/a.mp3'},{id:'c',kind:'image',result_url:'javascript:alert(1)'},{id:'d',kind:'video',result_url:'https://media.example/d.mp4',meta:{status:'processing'}}];
  assert.deepEqual(generationMedia(rows).map(r=>r.kind),['video','video','audio']);
  const calls=[];const query={select(v){calls.push(['select',v]);return this;},eq(k,v){calls.push([k,v]);return this;},order(){return this;},async limit(){return {data:rows};}};
  const client={auth:{async getSession(){return {data:{session:{user:{id:'owner'}}}};}},from(table){calls.push(['table',table]);return query;}};
  assert.equal((await readGenerations(client)).length,3);assert.ok(calls.some(([k,v])=>k==='user_id'&&v==='owner'));
  await assert.rejects(()=>readGenerations({auth:{async getSession(){return {data:{session:null}};}}}),/Sign in/);
});
