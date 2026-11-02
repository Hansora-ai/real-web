import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parse} from 'acorn';
import pricing from '../../public/kling4-pricing.js';
for(const feature of ['video-relight','background-change'])for(const locale of ['', '_ru','_arm'])test(`${feature}${locale}: whole-video validation, price and authenticated polling agree`,async()=>{
 const html=await readFile(new URL(`../../public/${feature}${locale}.html`,import.meta.url),'utf8');
 const functions={};
 for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(script[1].includes('src='))continue;
  const ast=parse(script[2],{ecmaVersion:'latest'});
  for(const node of ast.body)if(node.type==='FunctionDeclaration')functions[node.id.name]=script[2].slice(node.start,node.end);
 }
 assert.match(html,/data-resolution="720p" class="active"/);assert.match(html,/data-resolution="1080p"/);assert.doesNotMatch(html,/data-resolution="4K"/);
 assert.doesNotMatch(html,/id="aspectRow"|id="trimOverlay"|id="changeTrimBtn"|video_start:|video_end:|video_list:/);
 assert.match(html,/source_video_duration:videoDuration/);
 assert.match(html,/expected_credits:Math.round\(runCost\(\) \* 10\)/);
 assert.match(functions.checkResult,/Authorization:'Bearer '/);assert.match(functions.isVideoRelightRow||functions.isVideoEditRow,/meta.tool_feature/);
 const probes=[],messages=[],noop=()=>{};
 const els={videoDrop:{classList:{add:noop,remove:noop}},videoThumb:{removeAttribute:noop,load:noop},videoName:{},videoTiming:{},run:{}};
 const context=vm.createContext({window:{Kling4Pricing:pricing},videoDuration:0,videoFile:null,videoObjectUrl:'',resolution:'720p',els,URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL:noop},document:{createElement:()=>{const video={duration:0};probes.push(video);return video;}},setStatus:(...args)=>messages.push(args)});
 for(const name of ['fmt','runCost','displayedRunCost','updateRunLabel','updateTimingLabel','clearVideoFile','setVideoFile']){if(functions[name])vm.runInContext(functions[name],context);}
 for(const duration of [4,5.4,10,30]){
  vm.runInContext("setVideoFile({name:'video.mp4',type:'video/mp4'})",context);
  const probe=probes.at(-1);probe.duration=duration;probe.onloadedmetadata();
  assert.equal(vm.runInContext('videoDuration',context),duration);assert.ok(vm.runInContext('videoFile',context));
  for(const [resolution,perSecond] of [['720p',22],['1080p',34]]){
   context.resolution=resolution;vm.runInContext('updateRunLabel()',context);
   assert.equal(vm.runInContext('runCost()*10',context),Math.ceil(duration-1e-7)*perSecond);
   assert.ok(els.run.textContent.includes(String(Math.ceil(duration-1e-7)*perSecond)));
  }
 }
 for(const duration of [0,3.99,30.01,180,NaN]){
  vm.runInContext("setVideoFile({name:'bad.mp4',type:'video/mp4'})",context);const probe=probes.at(-1);probe.duration=duration;probe.onloadedmetadata();
  assert.equal(vm.runInContext('videoFile',context),null);assert.equal(messages.at(-1)[1],'bad');assert.match(messages.at(-1)[0],/4–30/);
 }
});
