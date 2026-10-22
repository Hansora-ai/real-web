import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'acorn';
import vm from 'node:vm';
import pricing from '../../public/kling4-pricing.js';
for(const locale of ['', '_ru', '_arm'])test(`Kling 4.0 UI quote, reference mapping and navigation (${locale||'en'})`,async()=>{
 const html=await readFile(new URL(`../../public/search-models${locale}.html`,import.meta.url),'utf8');
 const functions={};
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(match[1].includes('src=')||match[1].includes('ld+json'))continue;
  const ast=parse(match[2],{ecmaVersion:'latest',sourceType:match[1].includes('module')?'module':'script'});
  for(const node of ast.body)if(node.type==='FunctionDeclaration')functions[node.id.name]=match[2].slice(node.start,node.end);
 }
 const file={},other={};
 const sandbox={window:{Kling4Pricing:pricing},currentModel:{id:'kling40'},currentDuration:10,currentResolution:'720p',videoRefVideoFiles:[file],videoRefImageFiles:[{}],videoRefAudioFiles:[{}],wan3VerifiedQuote:null,wan3VideoDurations:new WeakMap(),readWan3VideoDuration:()=>{},document:{getElementById:()=>({checked:false})}};
 const ctx=vm.createContext(sandbox);
 for(const name of ['getModelUnitCreditValue','wan3InputSeconds','buildBodyForModel'])vm.runInContext(functions[name],ctx);
 assert.equal(vm.runInContext('getModelUnitCreditValue()',ctx),null);
 sandbox.wan3VideoDurations.set(file,10);assert.equal(vm.runInContext('getModelUnitCreditValue()',ctx),22.7);
 sandbox.currentResolution='1080p';assert.equal(vm.runInContext('getModelUnitCreditValue()',ctx),34);
 sandbox.wan3VerifiedQuote={files:[file],seconds:15};assert.equal(vm.runInContext('getModelUnitCreditValue()',ctx),42.5);
 sandbox.videoRefVideoFiles=[other];assert.equal(vm.runInContext('getModelUnitCreditValue()',ctx),null);
 sandbox.videoRefVideoFiles=[file];sandbox.params={uid:'user',runId:'run',prompt:'@image_1 edits @video_1',urls:['image','video','voice'],aspect:'auto',duration:10};
 const payload=vm.runInContext('buildBodyForModel(currentModel,params)',ctx);
 assert.equal(JSON.stringify(payload.image_urls),'["image"]');assert.equal(JSON.stringify(payload.video_urls),'["video"]');assert.equal(JSON.stringify(payload.audio_urls),'["voice"]');assert.equal(payload.keep_original_sound,true);
 assert.doesNotMatch(html,/kling4Options|kling4KeepSound|kling4ReferenceHint/);
 assert.match(html,/VIDEO_MODEL_ORDER = \['seedance25', 'kling40', 'henshin'/);
 assert.match(html,new RegExp(`__navTo:'/henshin${locale}\\.html'`));
 assert.match(html,/svg\.download-progress-spinner[\s\S]*animation:download-progress-rotate/);
});
