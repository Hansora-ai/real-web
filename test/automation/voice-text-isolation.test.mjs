import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../../public/automation-agent.js',import.meta.url),'utf8');

async function workspace(voice) {
  const nodes=new Map(),requests=[];
  function element(selector) {
    if (!nodes.has(selector)) nodes.set(selector,{textContent:'',innerHTML:'',value:'',hidden:false,disabled:false,style:{},listeners:{},children:[],
      classList:{add(){},toggle(){}},addEventListener(name,fn){this.listeners[name]=fn;},
      querySelector:child=>element(`${selector} ${child}`),appendChild(node){this.children.push(node);},focus(){},remove(){},scrollIntoView(){}});
    return nodes.get(selector);
  }
  const business={id:'123e4567-e89b-42d3-a456-426614174000',name:'Existing business',status:'active',automation_agents:[{display_name:'Existing employee',supported_languages:['en']}],automation_business_knowledge:[{services_and_prices:'Existing prices'}],automation_channel_connections:[{channel_type:'instagram_comments',status:'connected',setup_order:2}]};
  const from=table=>{
    const result={data:table==='automation_businesses'?business:table==='automation_tool_configs'?[]:null,count:0,error:null};
    return{select(){return this;},eq(){return this;},in(){return this;},maybeSingle:async()=>result,then:resolve=>Promise.resolve(resolve(result))};
  };
  const api={isLocalPreview:false,requireUser:async()=>({id:'owner'}),db:{from},client:{from},displayError:error=>error.message,languageName:value=>value,businessType:()=>({label:'Business'}),
    authenticatedFetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return{ok:true,status:200,json:async()=>url.endsWith('automation-test-chat')?{reply:'The existing text reply',actions:[]}:{documents:[]}};}};
  const sandbox={window:{HansoraAutomation:api,HansoraUI:{icon:()=>'',countUp(){},typing:()=>({remove(){}})},HansoraVoiceTest:voice},
    document:{querySelector:element,createElement:()=>({textContent:'',remove(){}})},location:{pathname:'/automation-agent.html',search:`?id=${business.id}`,protocol:'https:'},sessionStorage:{getItem:()=>null,removeItem(){}},URLSearchParams,Date,Intl,console:{warn(){}},setTimeout};
  await vm.runInNewContext(source,sandbox);
  return{element,requests};
}

for (const [name,voice] of [['voice script missing',undefined],['voice initialization fails',{mount(){throw Error('voice unavailable');}}]]) {
  test(`existing text testing and comment links work when ${name}`,async()=>{
    const w=await workspace(voice);
    assert.match(w.element('#channel-stack').innerHTML,/automation-workflows\.html/);
    assert.match(w.element('#channel-stack').innerHTML,/Instagram comments/);
    assert.equal(w.element('#voice-talk-call').disabled,true);
    w.element('#test-message').value='What are your prices?';
    await w.element('#test-form').listeners.submit({preventDefault(){}});
    const textRequest=w.requests.find(request=>request.url.endsWith('automation-test-chat'));
    assert.equal(textRequest.body.message,'What are your prices?');
    assert.equal(textRequest.body.business_id,'123e4567-e89b-42d3-a456-426614174000');
    assert.ok(w.element('#test-conversation').children.some(node=>node.textContent==='The existing text reply'));
    assert.equal(w.element('#test-form button[type="submit"]').disabled,false);
    assert.ok(w.requests.every(request=>!request.url.includes('phone-token')));
  });
}
