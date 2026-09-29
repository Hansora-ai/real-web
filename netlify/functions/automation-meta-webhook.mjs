import { first, serviceInsert, serviceUpdate } from '../../lib/automation/db.mjs';
import { extractInstagramReads, recordFlowEvent } from '../../lib/automation/flow-stats.mjs';
import { extractInstagramComments, extractInstagramMessages, metaConfig, verifyMetaSignature } from '../../lib/automation/meta.mjs';

const kindOf=item=>item.message?(item.message.is_echo?'echo':item.message.text?'text':'message-without-text'):item.read?'read':item.postback?'postback':item.pass_thread_control?'handover-pass':item.take_thread_control?'handover-take':Object.keys(item).join('+');
const text=(statusCode,body)=>({statusCode,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'},body:String(body)});

export async function handler(event){
  if(event.httpMethod==='GET'){
    const q=event.queryStringParameters||{};let config;try{config=metaConfig();}catch(_){return text(503,'not configured');}
    return q['hub.mode']==='subscribe'&&q['hub.verify_token']===config.verifyToken&&q['hub.challenge']?text(200,q['hub.challenge']):text(403,'forbidden');
  }
  if(event.httpMethod!=='POST')return text(405,'method not allowed');
  try{
    if(!verifyMetaSignature(event.body||'',event.headers?.['x-hub-signature-256']||event.headers?.['X-Hub-Signature-256'])){console.warn('automation-meta-webhook rejected: signature does not match META_INSTAGRAM_APP_SECRET',{hasSignature:Boolean(event.headers?.['x-hub-signature-256']||event.headers?.['X-Hub-Signature-256'])});return text(401,'invalid signature');}
    let payload;try{payload=JSON.parse(event.body||'{}');}catch(_){return text(400,'invalid json');}
    // One line per delivery (ids and event kinds only, never message text) so setup problems are visible in Netlify logs.
    console.log('automation-meta-webhook received',JSON.stringify({object:payload.object,entries:(payload.entry||[]).map(entry=>({id:entry.id,messaging:(entry.messaging||[]).map(kindOf),standby:(entry.standby||[]).map(kindOf),changes:(entry.changes||[]).map(change=>change.field),other:Object.keys(entry).filter(key=>!['id','time','messaging','standby','changes'].includes(key))}))}));
    // "Seen" receipts: mark the message read and count it for automation stats. Never blocks the webhook.
    for(const read of extractInstagramReads(payload)){
      try{
        const sent=await first(`/rest/v1/automation_messages?provider=eq.meta&provider_message_id=eq.${encodeURIComponent(read.mid)}&direction=eq.outbound&select=id,business_id,status,metadata&limit=1`);
        if(!sent)continue;
        if(sent.status!=='read')await serviceUpdate('automation_messages',`id=eq.${sent.id}`,{status:'read'});
        if(sent.metadata?.workflow_id)await recordFlowEvent({businessId:sent.business_id,workflowId:sent.metadata.workflow_id,sessionId:sent.metadata.flow_session_id||null,nodeId:sent.metadata.node_id||'',eventType:'seen',idempotencyKey:`seen:${sent.id}`});
      }catch(error){console.error('instagram read receipt not recorded',{message:error?.message});}
    }
    const messages=extractInstagramMessages(payload);
    console.log('automation-meta-webhook customer messages to answer',messages.length);
    for(const message of messages){
      const inserted=await serviceInsert('automation_webhook_events',{provider:'meta',external_event_id:message.externalEventId,event_type:'instagram_message',payload:message,status:'received'},{ignoreDuplicates:true});
      const row=inserted||await first(`/rest/v1/automation_webhook_events?provider=eq.meta&external_event_id=eq.${encodeURIComponent(message.externalEventId)}&select=id,status&limit=1`);
      if(row&&['received','failed'].includes(row.status))await dispatchBackground(event,row.id,'automation-instagram-process-background');
    }
    const comments=extractInstagramComments(payload);
    for(const comment of comments){
      const inserted=await serviceInsert('automation_webhook_events',{provider:'meta',external_event_id:comment.externalEventId,event_type:'instagram_comment',payload:comment,status:'received'},{ignoreDuplicates:true});
      const row=inserted||await first(`/rest/v1/automation_webhook_events?provider=eq.meta&external_event_id=eq.${encodeURIComponent(comment.externalEventId)}&select=id,status&limit=1`);
      if(row&&['received','failed'].includes(row.status))await dispatchBackground(event,row.id,'automation-instagram-comment-process-background');
    }
    return text(200,'EVENT_RECEIVED');
  }catch(error){console.error('automation-meta-webhook error',{message:error?.message,status:error?.status});return text(500,'webhook error');}
}

async function dispatchBackground(event,eventId,functionName){
  const secret=String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET||'');
  const requestOrigin=(()=>{try{return new URL(event.rawUrl||'').origin}catch(_){return''}})();
  const site=String(process.env.URL||process.env.DEPLOY_PRIME_URL||requestOrigin).replace(/\/$/,'');
  if(!secret||!site)throw new Error('automation_background_not_configured');
  const response=await fetch(`${site}/.netlify/functions/${functionName}`,{method:'POST',headers:{'Content-Type':'application/json','x-hansora-internal-secret':secret},body:JSON.stringify({event_id:eventId})});
  if(!response.ok&&response.status!==202)throw new Error('automation_background_dispatch_failed');
}
