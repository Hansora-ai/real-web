import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'acorn';
import vm from 'node:vm';
import draftUI from '../../public/seedance-draft.js';

test('1080p action is only offered for a completed, unexpired native 480p draft',()=>{
  const now=Date.now();
  const row={status:'ready',result_url:'https://stored.test/result.mp4',meta:{source:'reapi',model:'doubao-seedance-2.5-face',run_id:'owned-run',draft:true,resolution:'480p',draft_expires_at:new Date(now+1000).toISOString()}};
  assert.equal(draftUI.eligible(row,now),true);
  for(const meta of [{draft:false},{draft:undefined},{resolution:'720p'},{source:'kie'},{source_feature:'henshin'},{draft_expires_at:new Date(now).toISOString()},{model:'doubao-seedance-2.0-face'}])assert.equal(draftUI.eligible({...row,meta:{...row.meta,...meta}},now),false);
  assert.equal(draftUI.eligible({...row,result_url:null},now),false);
  assert.equal(draftUI.eligible({...row,status:'failed'},now),false);
});

for(const locale of ['', '_ru', '_arm']) test(`only 480p Seedance 2.5 requests enable native draft finalization (${locale||'en'})`,async()=>{
  const html=await readFile(new URL(`../../public/search-models${locale}.html`,import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>!m[1].includes('src=')&&!m[1].includes('application/ld+json'));
  let source;
  for(const [,attrs,body] of scripts) {
    const ast=parse(body,{ecmaVersion:'latest',sourceType:attrs.includes('module')?'module':'script'});
    const fn=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='buildBodyForModel');
    if(fn)source=body.slice(fn.start,fn.end);
  }
  assert.ok(source);
  const sandbox={currentResolution:'480p',currentSeedanceVariant:'standard',seedanceFirstFrameFile:null,seedanceLastFrameFile:null,seedanceImageRefFiles:[],seedanceVideoRefFiles:[],seedanceAudioRefFiles:[],seedanceGenerateAudio:true,seedanceWebSearch:false,seedance25UsesSourceVideoSettings:()=>false};
  const context=vm.createContext(sandbox);vm.runInContext(source,context);
  const body=model=>vm.runInContext(`buildBodyForModel({id:${JSON.stringify(model)}},{uid:'owner',runId:'run-123456',urls:[],prompt:'A fox walks',duration:10,aspect:'16:9'})`,context);
  assert.equal(body('seedance25').draft,true);assert.equal(body('seedance20').draft,false);
  for(const quality of ['720p','1080p']){sandbox.currentResolution=quality;assert.equal(body('seedance25').draft,false);}
});
