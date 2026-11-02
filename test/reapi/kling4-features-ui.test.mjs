import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parse} from 'acorn';
import pricing from '../../public/kling4-pricing.js';
for(const feature of ['video-relight','background-change'])for(const locale of ['', '_ru','_arm'])test(`${feature}${locale}: quality, price, selection and authenticated polling agree`,async()=>{
 const html=await readFile(new URL(`../../public/${feature}${locale}.html`,import.meta.url),'utf8');
 const functions={};
 for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(script[1].includes('src='))continue;
  const ast=parse(script[2],{ecmaVersion:'latest'});
  for(const node of ast.body)if(node.type==='FunctionDeclaration')functions[node.id.name]=script[2].slice(node.start,node.end);
 }
 assert.match(html,/data-resolution="720p" class="active"/);assert.match(html,/data-resolution="1080p"/);assert.doesNotMatch(html,/data-resolution="4K"/);
 assert.doesNotMatch(html,/id="aspectRow"/);
 assert.match(html,/expected_credits:Math.round\(runCost\(\) \* 10\)/);
 assert.match(functions.checkResult,/Authorization:'Bearer '/);assert.match(functions.isVideoRelightRow||functions.isVideoEditRow,/meta.tool_feature/);
 const context=vm.createContext({window:{Kling4Pricing:pricing},videoDuration:120,trimStart:0,trimEnd:10,resolution:'720p',updateTrimUi:()=>{}});
 for(const name of ['selectedLength','runCost','setTrimWindow'])vm.runInContext(functions[name],context);
 assert.equal(vm.runInContext('runCost()*10',context),220);
 vm.runInContext("resolution='1080p'",context);assert.equal(vm.runInContext('runCost()*10',context),340);
 vm.runInContext('setTrimWindow(12,100)',context);assert.equal(vm.runInContext('selectedLength()',context),30);
 assert.equal(vm.runInContext('runCost()*10',context),1020);
 vm.runInContext("resolution='720p'",context);assert.equal(vm.runInContext('runCost()*10',context),660);
 vm.runInContext("resolution='1080p'",context);
 vm.runInContext('setTrimWindow(12,13)',context);assert.equal(vm.runInContext('selectedLength()',context),4);
 assert.equal(vm.runInContext('runCost()*10',context),136);
});
