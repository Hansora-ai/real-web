import test from 'node:test';
import assert from 'node:assert/strict';
import { generateElevenLabsSalesReply, websiteConversationContext } from '../../lib/sales-agent/elevenlabs-provider.mjs';
import { HANSORA_SUPPORT_BUSINESS_ID, runChannelSupportTool, usesSharedSupportAgent, sharedSupportTools } from '../../lib/sales-agent/automation-bridge.mjs';
import { askElevenLabsText, syncElevenLabsTools, elevenLabsClientTools } from '../../lib/automation/providers/elevenlabs.mjs';

test('all support tools conform to ElevenLabs object and array schemas, including nested reply actions', () => {
  const tools = elevenLabsClientTools(sharedSupportTools());
  const check = schema => {
    if (schema.type === 'object' || schema.type === 'array') {
      const allowed = new Set(schema.type === 'object' ? ['type', 'description', 'properties', 'required'] : ['type', 'description', 'items']);
      for (const key of Object.keys(schema)) assert(allowed.has(key), `Unsupported ${schema.type} field: ${key}`);
    }
    assert(schema.description);
    if (schema.enum) assert(schema.enum.every(value => typeof value === 'string'), 'ElevenLabs enum values must be strings');
    for (const value of Object.values(schema.properties || {})) check(value);
    if (schema.items) check(schema.items);
  };
  tools.forEach(tool => check(tool.parameters));
  const reply = tools.find(tool => tool.name === 'submit_sales_reply').parameters;
  assert.deepEqual(reply.properties.recommended_model.type, ['string', 'null']);
  assert(reply.properties.actions.items.properties.type.enum.includes('open_model'));
  assert(reply.properties.memory.required.includes('purchase_intent'));
  const category = tools.find(tool => tool.name === 'get_available_models').parameters.properties.category;
  assert.deepEqual(category.type, ['string', 'null']);
  assert.deepEqual(category.enum, ['image', 'video']);
  // The Kie/OpenAI definition keeps its original JSON Schema semantics.
  assert(sharedSupportTools().find(tool => tool.name === 'get_available_models').parameters.properties.category.enum.includes(null));
});

test('provider rejection retains its actual status and reason and identifies the operation without secrets', async () => {
  const before = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'secret-test-key';
  try {
    await assert.rejects(syncElevenLabsTools({
      tools: [{ name: 'check', description: 'Check', parameters: { type: 'object', properties: {} } }],
      existingToolIds: { check: 'private-tool-id' },
      fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ detail: { status: 'missing_permissions', message: 'Tool write permission required' } }) })
    }), error => {
      assert.equal(error.providerStatus, 403);
      assert.equal(error.providerOperation, 'PATCH /tools/:id');
      assert.match(error.providerMessage, /missing_permissions/);
      assert(!JSON.stringify(error).includes('secret-test-key'));
      assert(!JSON.stringify(error).includes('private-tool-id'));
      return true;
    });
  } finally {
    if (before === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = before;
  }
});

const options = () => ({ messages: [{role:'user',content:'Hello'},{role:'assistant',content:'How can I help?'},{role:'user',content:'My balance?'}], language:'hy', summary:'Budget video', salesMemory:{main_goal:'Reels'}, authenticated:true, executeTool:async()=>({ok:true}) });
const resource = async path => {
  assert.match(path, new RegExp(`business_id=eq.${HANSORA_SUPPORT_BUSINESS_ID}`));
  assert.match(path,/provider=eq.elevenlabs/);
  return {provider_resource_id:'agent-shared'};
};
const submitted = {message:'Balance checked.',language:'hy',intent:'account',memory:{main_goal:'Reels'},actions:[{type:'open_pricing',label:'Pricing',model:null,package:null}]};

test('same server-resolved agent receives visitor history, executes trusted account callback and retains buttons', async () => {
  let syncCalls=0;
  const called=[];
  const result=await generateElevenLabsSalesReply({...options(),executeTool:async(name,args)=>{called.push({name,args});return {ok:true,balance:120};}}, {
    first:resource,
    ensureAgentUpToDate:async({businessId})=>{assert.equal(businessId,HANSORA_SUPPORT_BUSINESS_ID);syncCalls++;},
    askElevenLabsText:async request=>{
      assert.equal(request.agentId,'agent-shared');assert.equal(request.channel,'website');
      assert.equal(request.finalToolName,'submit_sales_reply');assert.equal(request.text,'My balance?');
      assert.match(request.context,/How can I help/);assert.match(request.context,/account available: yes/);
      assert(!request.context.includes('My balance?'),'latest message is sent only once');
      assert.deepEqual(await request.onToolCall('get_user_credit_balance',{user_id:'attacker'}),{ok:true,balance:120});
      assert.equal((await request.onToolCall('create_order',{})).error,'tool_unavailable_on_website');
      assert.equal((await request.onToolCall('submit_sales_reply',submitted)).ok,true);
      return {text:'irrelevant trailing text',toolCalls:[{name:'get_user_credit_balance',ok:true}]};
    }
  });
  assert.equal(syncCalls,1);assert.equal(called.length,1);
  assert.equal(result.provider,'elevenlabs');assert.equal(result.reply.message,submitted.message);
  assert.equal(result.reply.actions[0].type,'open_pricing');assert.equal(result.toolCalls.length,1);
});

test('missing agent or failed synchronization never switches to a different provider',async()=>{
  let contacted=false;
  const ask=async()=>{contacted=true;};
  await assert.rejects(generateElevenLabsSalesReply(options(),{first:async()=>null,askElevenLabsText:ask}),/not_ready/);
  await assert.rejects(generateElevenLabsSalesReply(options(),{first:resource,ensureAgentUpToDate:async()=>{throw Error('sync failed');},askElevenLabsText:ask}),/sync failed/);
  assert.equal(contacted,false);
});

test('plain text remains a valid website reply; invalid structured output is rejected',async()=>{
  const result=await generateElevenLabsSalesReply({...options(),authenticated:false},{first:resource,ensureAgentUpToDate:async()=>{},askElevenLabsText:async r=>{
    assert.match(r.context,/account available: no/);
    assert.equal((await r.onToolCall('submit_sales_reply',{message:''})).error,'invalid_reply');
    return {text:'Please sign in to check your balance.',toolCalls:[]};
  }});
  assert.equal(result.reply.message,'Please sign in to check your balance.');
  assert.deepEqual(result.reply.actions,[]);assert.equal(result.reply.memory.main_goal,'Reels');
});

test('public-channel tools cannot use the business owner as the customer; other businesses are isolated',async()=>{
  const before=process.env.SALES_AGENT_PROVIDER;
  process.env.SALES_AGENT_PROVIDER='elevenlabs';
  try {
    let count=0;
    const run=async(name,args,scope)=>{count++;assert.equal(scope.user,null);return {ok:false,error:'login_required'};};
    assert(usesSharedSupportAgent(HANSORA_SUPPORT_BUSINESS_ID));
    assert(!usesSharedSupportAgent('different-business'));
    assert.equal(await runChannelSupportTool('get_user_credit_balance',{}, {businessId:'different-business'},run),null);
    assert.equal((await runChannelSupportTool('get_user_credit_balance',{user_id:'owner'}, {businessId:HANSORA_SUPPORT_BUSINESS_ID,user:{id:'owner'}},run)).error,'login_required');
    assert.equal(await runChannelSupportTool('submit_sales_reply',{}, {businessId:HANSORA_SUPPORT_BUSINESS_ID},run),null);
    assert.equal(count,1);assert(sharedSupportTools().some(tool=>tool.name==='get_model_current_price'));
  } finally { if(before===undefined)delete process.env.SALES_AGENT_PROVIDER;else process.env.SALES_AGENT_PROVIDER=before; }
});

test('visitor context contains only bounded history supplied by this website session',()=>{
  const context=websiteConversationContext({...options(),messages:[...Array.from({length:25},(_,i)=>({role:'user',content:`item-${i}`})),{role:'user',content:'latest'}]});
  assert(!context.includes('item-0"'));assert(!context.includes('latest"'));assert(context.includes('item-24'));
});

test('WebSocket structured submission finishes without waiting for a redundant agent text reply',async()=>{
  const before=process.env.ELEVENLABS_API_KEY;process.env.ELEVENLABS_API_KEY='test-only';
  let socket;
  class FakeSocket {
    constructor(){socket=this;this.listeners={};this.sent=[];queueMicrotask(()=>this.emit('open',{}));}
    addEventListener(name,fn){this.listeners[name]=fn;}
    emit(name,event){return this.listeners[name]?.(event);}
    send(text){
      const message=JSON.parse(text);this.sent.push(message);
      if(message.type==='conversation_initiation_client_data')queueMicrotask(()=>this.emit('message',{data:JSON.stringify({type:'conversation_initiation_metadata',conversation_initiation_metadata_event:{conversation_id:'conversation-1'}})}));
      if(message.type==='user_message')queueMicrotask(()=>this.emit('message',{data:JSON.stringify({type:'client_tool_call',client_tool_call:{tool_name:'submit_sales_reply',tool_call_id:'call-1',parameters:submitted}})}));
    }
    close(){this.closed=true;}
  }
  try {
    const result=await askElevenLabsText({agentId:'agent-shared',text:'Hi',channel:'website',finalToolName:'submit_sales_reply',WebSocketImpl:FakeSocket,timeoutMs:200,onToolCall:async()=>({ok:true}),fetchImpl:async()=>({ok:true,json:async()=>({signed_url:'wss://example.test'})})});
    assert.equal(result.conversationId,'conversation-1');assert.equal(result.toolCalls[0].name,'submit_sales_reply');
    assert(socket.closed);assert(socket.sent.some(m=>m.type==='client_tool_result'));
  } finally {if(before===undefined)delete process.env.ELEVENLABS_API_KEY;else process.env.ELEVENLABS_API_KEY=before;}
});

test('long histories stay below the transport context cap without losing channel rules',()=>{
  const context=websiteConversationContext({...options(),summary:'s'.repeat(10000),salesMemory:{main_goal:'x'.repeat(10000)},messages:[...Array.from({length:30},()=>({role:'user',content:'c'.repeat(10000)})),{role:'user',content:'latest'}]});
  assert(context.length<40000);assert(context.startsWith('Trusted channel: website.'));
});

test('explicit Kie configuration keeps the existing provider request and response contract',async()=>{
  const { generateSalesReply }=await import('../../lib/sales-agent/provider.mjs');
  const saved={provider:process.env.SALES_AGENT_PROVIDER,key:process.env.KIE_API_KEY,fetch:globalThis.fetch};
  process.env.SALES_AGENT_PROVIDER='kie';process.env.KIE_API_KEY='test-only';
  let requested;
  globalThis.fetch=async(url,init)=>{requested={url,body:JSON.parse(init.body)};return {ok:true,json:async()=>({output_text:JSON.stringify(submitted),usage:{input_tokens:10,output_tokens:5},credits_consumed:0.1})};};
  try {
    const result=await generateSalesReply({...options(),instructions:'existing-playbook'});
    assert.equal(result.provider,'kie');assert.equal(result.reply.message,submitted.message);
    assert.equal(requested.body.instructions,'existing-playbook');assert.match(requested.url,/api\.kie\.ai/);
    assert.equal(result.usage.input,10);
  } finally {
    globalThis.fetch=saved.fetch;
    if(saved.provider===undefined)delete process.env.SALES_AGENT_PROVIDER;else process.env.SALES_AGENT_PROVIDER=saved.provider;
    if(saved.key===undefined)delete process.env.KIE_API_KEY;else process.env.KIE_API_KEY=saved.key;
  }
});

test('an agent recreated during synchronization is resolved again before answering',async()=>{
  let reads=0;
  await generateElevenLabsSalesReply(options(),{first:async()=>({provider_resource_id:++reads===1?'deleted-agent':'replacement-agent'}),ensureAgentUpToDate:async()=>true,askElevenLabsText:async request=>{assert.equal(request.agentId,'replacement-agent');return {text:'Hello',toolCalls:[]};}});
  assert.equal(reads,2);
});
