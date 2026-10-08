import crypto from 'node:crypto';
import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { first, rows, serviceInsert, serviceUpsert, supabaseRequest } from '../../lib/automation/db.mjs';
import { generateAutomationReply } from '../../lib/automation/provider.mjs';
import { automationPrices, canAfford, chargeCredits, toDisplay } from '../../lib/automation/billing.mjs';
import { prepareConversationActions } from '../../lib/automation/tools.mjs';
import { buildConversationContext, loadConversationMemory } from '../../lib/automation/history.mjs';
import { ensureAgentUpToDate } from '../../lib/automation/agent-sync.mjs';

const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(statusCode,body)=>({statusCode,headers:HEADERS,body:JSON.stringify(body)});

export async function handler(event){
  if(event.httpMethod==='OPTIONS')return json(204,{});
  if(event.httpMethod!=='POST')return json(405,{error:'method_not_allowed'});
  try{
    const user=await authenticateRequest(event);if(!user)return json(401,{error:'authentication_required'});
    let body;try{body=JSON.parse(event.body||'{}')}catch(_){return json(400,{error:'invalid_json'})}
    const businessId=String(body.business_id||'');
    const text=String(body.message||'').trim();
    if(!isUuid(businessId))return json(400,{error:'invalid_business_id'});
    if(!text||text.length>4000)return json(400,{error:'invalid_message'});
    const business=await first(`/rest/v1/automation_businesses?id=eq.${encodeURIComponent(businessId)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id,name&limit=1`);
    if(!business)return json(404,{error:'business_not_found'});
    await ensureAgentUpToDate({businessId}).catch(error=>console.error('automation agent auto-update failed',{message:error?.message}));
    const aiResource=await first(`/rest/v1/automation_provider_resources?business_id=eq.${encodeURIComponent(businessId)}&provider=eq.elevenlabs&resource_type=eq.agent&status=eq.active&select=*&limit=1`);
    if(!aiResource)return json(409,{error:'ai_provider_agent_not_ready'});
    const price=automationPrices().testReply;
    const affordable=await canAfford(businessId,price);
    if(!affordable.ok)return json(402,{error:'not_enough_credits',balance:toDisplay(affordable.balance)});

    const contact=await serviceUpsert('automation_contacts','business_id,channel_type,external_contact_id',{business_id:businessId,display_name:'Live test',channel_type:'manual',external_contact_id:`test:${user.id}`,last_seen_at:new Date().toISOString(),profile:{source:'workspace_live_test'}});
    const conversation=await serviceUpsert('automation_conversations','business_id,channel_type,external_thread_id',{business_id:businessId,contact_id:contact.id,channel_type:'test',external_thread_id:`test:${user.id}`,status:'open',ai_enabled:true,last_message_preview:text.slice(0,1000),last_message_at:new Date().toISOString()});
    const requestId=crypto.randomUUID();
    await serviceInsert('automation_messages',{business_id:businessId,conversation_id:conversation.id,idempotency_key:`test:in:${requestId}`,direction:'inbound',sender_type:'customer',content_type:'text',content:text,status:'received',billable:false,metadata:{source:'workspace_live_test'},occurred_at:new Date().toISOString()});
    // Actions run in test mode: availability is real, but bookings, orders, leads and handoffs are not saved or notified.
    const actions=await prepareConversationActions({businessId,conversationId:conversation.id,contactId:contact.id,channel:'test',contact:{name:''},dryRun:true});
    const memory=await loadConversationMemory({businessId,conversationId:conversation.id});
    const context=buildConversationContext({intro:['This is a private live test by the business owner. Answer exactly as the configured business assistant.','Continue this conversation.',actions.contextLine],memory,after:[actions.liveBrief]});
    // engine: try one engine; compare: both answer the same message (actions run in test mode, so nothing is saved
    // twice). Only the first answer is stored and charged.
    const engine=['gemini','elevenlabs'].includes(body.engine)?body.engine:null;
    const ask=which=>generateAutomationReply({businessId,rulesHash:aiResource.safe_config?.rules_hash||null,providerResourceId:aiResource.provider_resource_id,text,context,channel:'test',onToolCall:actions.onToolCall,checkTimes:actions.checkTimes,knownTimes:actions.knownTimes,engine:which}).then(reply=>reply,error=>({text:'',error:String(error?.message||'failed')}));
    let compare=null,generated;
    if(body.compare===true){const timed=which=>{const started=Date.now();return ask(which).then(reply=>({...reply,ms:Date.now()-started}));};const [eleven,gem]=await Promise.all([timed('elevenlabs'),timed('gemini')]);compare={elevenlabs:{text:eleven.text,ms:eleven.ms,error:eleven.error,engine:eleven.engine||null},gemini:{text:gem.text,ms:gem.ms,error:gem.error,engine:gem.engine||null,fallback:Boolean(gem.fallback),usage:gem.usage||null,timings:gem.timings||null}};generated=eleven.text?eleven:gem;if(!generated.text)throw Object.assign(new Error(eleven.error||gem.error||'test_chat_failed'),{status:502});}
    else{const started=Date.now();generated={...generated,ms:Date.now()-started};}generated=await generateAutomationReply({businessId,rulesHash:aiResource.safe_config?.rules_hash||null,providerResourceId:aiResource.provider_resource_id,text,context,channel:'test',onToolCall:actions.onToolCall,checkTimes:actions.checkTimes,knownTimes:actions.knownTimes,engine});
    const outbound=await serviceInsert('automation_messages',{business_id:businessId,conversation_id:conversation.id,idempotency_key:`test:out:${requestId}`,direction:'outbound',sender_type:'ai',content_type:'text',content:generated.text,status:'generated',billable:true,provider:'elevenlabs',model:generated.model||'eleven-agents',provider_message_id:generated.conversationId||null,metadata:{source:'workspace_live_test'},occurred_at:new Date().toISOString()});
    const charge=await chargeCredits({businessId,idempotencyKey:`usage:test:${requestId}`,kind:'test_reply',credits:price,conversationId:conversation.id,reference:{channel:'test',message_id:outbound.id}}).catch(()=>({ok:false,charged:0}));
    await serviceInsert('automation_usage_events',{business_id:businessId,conversation_id:conversation.id,message_id:outbound.id,channel_type:'test',unit_type:'ai_message',quantity:1,billable_quantity:1,estimated_cost_minor:0,currency:'AMD',provider:'elevenlabs',provider_usage_id:generated.conversationId||null,idempotency_key:`usage:test:${requestId}`,credits:charge.charged||0,metadata:{source:'workspace_live_test'}},{ignoreDuplicates:true});
    return json(200,{reply:generated.text,engine:generated.engine||null,ms:generated.ms||null,timings:generated.timings||null,fallback:Boolean(generated.fallback),compare,counted:true,credits_used:toDisplay(charge.charged||0),balance:charge.balance!=null?toDisplay(charge.balance):null,conversation_id:conversation.id,actions:generated.toolCalls||[]});
  }catch(error){
    console.error('automation-test-chat error',{message:error?.message,status:error?.status,providerStatus:error?.providerStatus});
    return json(Number(error?.status)||500,{error:String(error?.message||'test_chat_failed')});
  }
}
