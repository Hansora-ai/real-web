import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesCommentText, pickReplyVariation, planFlowAdvance, preparePrivateReply } from '../../lib/automation/comment-flow.mjs';

test('comment matching supports any, contains, exact, and exclusions',()=>{
  assert.equal(matchesCommentText({match_type:'any'},'Hello'),true);
  assert.equal(matchesCommentText({match_type:'contains',keywords:['price','catalog']},'Please send the PRICE'),true);
  assert.equal(matchesCommentText({match_type:'exact',keywords:['price']},'Price'),true);
  assert.equal(matchesCommentText({match_type:'exact',keywords:['price']},'Price please'),false);
  assert.equal(matchesCommentText({match_type:'contains',keywords:['price']},'Price spam',['spam']),false);
});

test('private reply separates safe links from Instagram quick replies',()=>{
  const result=preparePrivateReply({text:'Choose an option',actions:[{id:'prices',type:'quick_reply',label:'Prices'},{type:'website',label:'Catalog',url:'https://example.com/catalog'},{type:'website',label:'Unsafe',url:'javascript:alert(1)'},{type:'handoff',label:'Person'}]});
  assert.equal(result.text,'Choose an option');
  assert.deepEqual(result.quickReplies,[{title:'Prices',payload:'HANSORA_FLOW:prices'}]);
  assert.deepEqual(result.buttons,[{type:'postback',title:'Prices',payload:'HANSORA_FLOW:prices'},{type:'web_url',title:'Catalog',url:'https://example.com/catalog',actionId:''}]);
});

test('public reply rotation is deterministic for webhook retries',()=>{
  const values=['One','Two','Three'];
  assert.equal(pickReplyVariation(values,'comment-42'),pickReplyVariation(values,'comment-42'));
});

test('flow planner waits for conditions and reaches AI only after a customer reply',()=>{
  const nodes=[{type:'condition',operator:'contains',value:'price'},{type:'message',text:'Here is the price.'},{type:'ai',instruction:'Answer questions.'}];
  assert.deepEqual(planFlowAdvance({nodes,startIndex:0,inboundText:'hello'}),{actions:[],status:'awaiting_reply',nextIndex:0});
  const matched=planFlowAdvance({nodes,startIndex:0,inboundText:'What is the price?'});
  assert.equal(matched.actions[0].type,'message');
  assert.equal(matched.status,'awaiting_reply');
  assert.equal(matched.nextIndex,2);
  const ai=planFlowAdvance({nodes,startIndex:2,inboundText:'Is delivery included?'});
  assert.equal(ai.actions[0].type,'ai');
  assert.equal(ai.status,'ai_active');
});

test('flow planner creates a durable delay before later messages',()=>{
  const result=planFlowAdvance({nodes:[{type:'delay',amount:2,unit:'hour'},{type:'message',text:'Checking in'}],startIndex:0,inboundText:'yes'});
  assert.equal(result.actions[0].delayMs,7_200_000);
  assert.equal(result.status,'waiting');
  assert.equal(result.nextIndex,1);
});

test('message buttons route to their connected steps',()=>{
  const nodes=[
    {id:'opening',type:'message',text:'Choose',actions:[{id:'details',type:'quick_reply',label:'Details',nextId:'pause'}],replyNextId:'ai'},
    {id:'ai',type:'ai',instruction:'Help naturally'},
    {id:'pause',type:'delay',amount:1,unit:'minute',nextId:'details-message'},
    {id:'details-message',type:'message',text:'Here are the details'}
  ];
  const result=planFlowAdvance({nodes,startIndex:0,inboundText:'Details',inboundPayload:'HANSORA_FLOW:details'});
  assert.equal(result.actions[0].type,'delay');
  assert.equal(result.status,'waiting');
  assert.equal(result.nextIndex,3);
});

test('typed replies can route directly from a message to AI',()=>{
  const nodes=[{id:'opening',type:'message',text:'How can I help?',replyNextId:'ai'},{id:'ai',type:'ai',instruction:'Answer the question'}];
  const result=planFlowAdvance({nodes,startIndex:0,inboundText:'What is the price?'});
  assert.equal(result.actions[0].type,'ai');
  assert.equal(result.status,'ai_active');
  assert.equal(result.nextIndex,1);
});

test('conditions follow separate yes and no connections',()=>{
  const nodes=[
    {id:'condition',type:'condition',operator:'contains',value:'yes',yesId:'accepted',noId:'declined'},
    {id:'accepted',type:'message',text:'Great'},
    {id:'declined',type:'handoff',note:'Needs help'}
  ];
  const yes=planFlowAdvance({nodes,startIndex:0,inboundText:'yes please'});
  assert.equal(yes.actions[0].text,'Great');
  const no=planFlowAdvance({nodes,startIndex:0,inboundText:'not now'});
  assert.equal(no.actions[0].type,'handoff');
  assert.equal(no.status,'human_handling');
});
