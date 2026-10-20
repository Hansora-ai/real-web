import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'acorn';
import vm from 'node:vm';
import pricing from '../../public/wan-pricing.js';

for(const locale of ['', '_ru', '_arm']) test(`Wan UI quotes agree with server pricing and ignore stale file measurements (${locale || 'en'})`,async()=>{
 const html=await readFile(new URL(`../../public/search-models${locale}.html`,import.meta.url),'utf8');
 assert.match(html,/src="\/wan-pricing.js\?v=20261021"/);
 const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>!m[1].includes('src=')&&!m[1].includes('application/ld+json'));
 const nodes=[];
 for(const [,attrs,source] of scripts) {
  const ast=parse(source,{ecmaVersion:'latest',sourceType:attrs.includes('module')?'module':'script'});
  for(const node of ast.body)if(node.type==='FunctionDeclaration')nodes.push([node.id.name,source.slice(node.start,node.end)]);
 }
 const functions=Object.fromEntries(nodes),file={},other={};
 let reads=0;
 const sandbox={window:{WanPricing:pricing},Number,videoRefVideoFiles:[file],wan3VerifiedQuote:null,wan3VideoDurations:new WeakMap(),currentModel:{id:'wan-3'},currentDuration:10,currentResolution:'480p',readWan3VideoDuration:()=>{reads++;}, currentMotionModel:'', generationQuantity:1};
 const ctx=vm.createContext(sandbox);
 for(const name of ['wan3InputSeconds','getModelUnitCreditValue','checkerForCurrentModel']) {assert.ok(functions[name],name);vm.runInContext(functions[name],ctx);}
 assert.equal(vm.runInContext('getModelUnitCreditValue()',ctx),null,'unread media cannot be billed as zero');assert.ok(reads);
 sandbox.wan3VideoDurations.set(file,5.1);
 assert.equal(vm.runInContext('getModelUnitCreditValue()',ctx),9.1);
 sandbox.wan3VerifiedQuote={files:[file],seconds:5.2};assert.equal(vm.runInContext('getModelUnitCreditValue()',ctx),9.2);
 sandbox.videoRefVideoFiles=[other];assert.equal(vm.runInContext('getModelUnitCreditValue()',ctx),null,'new uploads invalidate server measurement');
 sandbox.videoRefVideoFiles=[];
 for(const resolution of ['480p','720p','1080p']) {sandbox.currentResolution=resolution;assert.equal(vm.runInContext('getModelUnitCreditValue()',ctx),pricing.quote({resolution,duration:10}).internalCredits);}
 assert.equal(vm.runInContext("checkerForCurrentModel({id:'wan-3'})",ctx),'reapi-check');
 assert.equal(vm.runInContext("checkerForCurrentModel({id:'veo31-lite'})",ctx),'kie-check');
 const validation=functions.validateWan3ReferenceDurations;
 vm.runInContext(validation,ctx);sandbox.videoRefAudioFiles=[];sandbox.readAudioFileDuration=async()=>null;sandbox.videoRefVideoFiles=[file];sandbox.readWan3VideoDuration=async()=>null;
 assert.equal((await vm.runInContext('validateWan3ReferenceDurations()',ctx)).ok,false);
 sandbox.readWan3VideoDuration=async()=>5;sandbox.currentDuration=26;
 assert.equal((await vm.runInContext('validateWan3ReferenceDurations()',ctx)).ok,false);
 sandbox.currentDuration=10;assert.equal((await vm.runInContext('validateWan3ReferenceDurations()',ctx)).ok,true);
});
