import { decryptSecret } from '../../lib/automation/crypto.mjs';
import { matchesCommentText, pickReplyVariation, preparePrivateReply, openingMessageIndex } from '../../lib/automation/comment-flow.mjs';
import { withTrackedLinks } from '../../lib/automation/flow-stats.mjs';
import { first, rows, serviceInsert, serviceUpdate, serviceUpsert, supabaseRequest } from '../../lib/automation/db.mjs';
import { getInstagramMedia, replyToInstagramComment, sendInstagramPrivateReply } from '../../lib/automation/meta.mjs';

const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)});

export async function handler(event){
  if(event.httpMethod!=='POST')return json(405,{error:'method_not_allowed'});
  if(!internalAuthorized(event))return json(401,{error:'unauthorized'});
  let eventId='';
  try{
    const body=JSON.parse(event.body||'{}');eventId=String(body.event_id||'');
    if(!/^[0-9a-f-]{36}$/i.test(eventId))return json(400,{error:'invalid_event_id'});
    const webhook=await first(`/rest/v1/automation_webhook_events?id=eq.${encodeURIComponent(eventId)}&event_type=eq.instagram_comment&status=in.(received,failed)&select=*&limit=1`);
    if(!webhook)return json(200,{ok:true,replayed:true});
    await serviceUpdate('automation_webhook_events',`id=eq.${webhook.id}`,{status:'processing',attempt_count:Number(webhook.attempt_count||0)+1,last_error:null});
    const comment=webhook.payload||{};
    const account=await first(`/rest/v1/automation_provider_resources?provider=eq.meta&resource_type=eq.instagram_account&provider_resource_id=eq.${encodeURIComponent(comment.accountId)}&status=eq.active&select=*&limit=1`);
    if(!account)throw new Error('instagram_account_not_connected');
    const connection=await first(`/rest/v1/automation_channel_connections?business_id=eq.${account.business_id}&channel_type=eq.instagram_comments&status=eq.connected&select=*&limit=1`);
    if(!connection)throw new Error('instagram_comments_not_active');
    const credential=await first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${account.id}&credential_type=eq.access_token&select=*&limit=1`);
    if(!credential)throw new Error('instagram_token_not_found');
    if(credential.expires_at&&Date.parse(credential.expires_at)<=Date.now())throw new Error('instagram_token_expired');
    const accessToken=decryptSecret(credential);
    const workflows=rows(await supabaseRequest(`/rest/v1/automation_comment_workflows?business_id=eq.${account.business_id}&status=eq.active&select=*&order=updated_at.desc`));
    let handled=0;
    for(const workflow of workflows){
      const outcome=await runWorkflow({workflow,comment,account,connection,accessToken});
      if(outcome){handled+=1;break;}
    }
    await markProcessed(webhook.id,account.business_id);
    return json(200,{ok:true,handled});
  }catch(error){
    console.error('automation-instagram-comment-process error',{eventId,message:error?.message,status:error?.status,providerStatus:error?.providerStatus});
    if(eventId)await serviceUpdate('automation_webhook_events',`id=eq.${encodeURIComponent(eventId)}`,{status:'failed',last_error:String(error?.message||'processing_failed').slice(0,2000)}).catch(()=>null);
    return json(Number(error?.status)||500,{error:'instagram_comment_processing_failed'});
  }
}

async function runWorkflow({workflow,comment,account,connection,accessToken}){
  const safety=workflow.safety_config||{};
  if(safety.ignore_own!==false&&String(comment.senderId)===String(account.provider_resource_id))return false;
  if(!matchesCommentText(workflow,comment.text,safety.exclude_keywords))return false;
  if(!await matchesPost(workflow,comment,accessToken))return false;
  if(safety.first_comment_only!==false){
    const prior=await first(`/rest/v1/automation_comment_executions?workflow_id=eq.${workflow.id}&media_id=eq.${encodeURIComponent(comment.mediaId)}&external_contact_id=eq.${encodeURIComponent(comment.senderId)}&status=in.(processing,completed,partial)&select=id&limit=1`);
    if(prior)return false;
  }
  const execution=await serviceInsert('automation_comment_executions',{business_id:account.business_id,workflow_id:workflow.id,comment_id:comment.commentId,media_id:comment.mediaId,external_contact_id:comment.senderId,comment_text:comment.text,status:'processing'},{ignoreDuplicates:true});
  if(!execution)return false;
  const occurredAt=new Date(Number(comment.timestamp)||Date.now()).toISOString();
  const contact=await serviceUpsert('automation_contacts','business_id,channel_type,external_contact_id',{business_id:account.business_id,display_name:comment.username||'Instagram customer',channel_type:'instagram_comments',external_contact_id:comment.senderId,last_seen_at:occurredAt,profile:{instagram_scoped_id:comment.senderId,username:comment.username||'',latest_media_id:comment.mediaId}});
  const conversation=await serviceUpsert('automation_conversations','business_id,channel_type,external_thread_id',{business_id:account.business_id,contact_id:contact.id,channel_connection_id:connection.id,channel_type:'instagram_comments',external_thread_id:comment.senderId,status:'open',last_message_preview:String(comment.text||'').slice(0,1000),last_message_at:occurredAt});
  await serviceInsert('automation_messages',{business_id:account.business_id,conversation_id:conversation.id,external_message_id:comment.commentId,idempotency_key:`meta:instagram:comment:${comment.commentId}`,direction:'inbound',sender_type:'customer',content_type:'text',content:comment.text,status:'received',billable:false,provider:'meta',provider_message_id:comment.commentId,metadata:{media_id:comment.mediaId,workflow_id:workflow.id,username:comment.username||''},occurred_at:occurredAt},{ignoreDuplicates:true});

  let publicReplyId=null;let privateMessageId=null;const errors=[];
  const variations=Array.isArray(workflow.public_reply_variations)?workflow.public_reply_variations.filter(Boolean):[];
  if(safety.public_reply_enabled!==false&&variations.length){
    try{const reply=await replyToInstagramComment({commentId:comment.commentId,message:pickReplyVariation(variations,comment.commentId),accessToken});publicReplyId=String(reply.id||'');}
    catch(error){errors.push(String(error?.message||'public_reply_failed'));}
  }
  const flowNodes=Array.isArray(workflow.dm_steps)?workflow.dm_steps:[];
  const messageIndex=openingMessageIndex(flowNodes);
  const messageNode=messageIndex>=0?flowNodes[messageIndex]:null;
  if(messageNode){
    try{
      const prepared=withTrackedLinks(preparePrivateReply(messageNode),{businessId:account.business_id,workflowId:workflow.id,nodeId:messageNode.id||''});
      const sent=await sendInstagramPrivateReply({instagramUserId:account.provider_resource_id,commentId:comment.commentId,text:prepared.text,quickReplies:prepared.quickReplies,buttons:prepared.buttons,accessToken});
      privateMessageId=String(sent.message_id||'');
      await serviceInsert('automation_messages',{business_id:account.business_id,conversation_id:conversation.id,external_message_id:privateMessageId||null,idempotency_key:`meta:instagram:comment-private:${comment.commentId}`,direction:'outbound',sender_type:'system',content_type:(prepared.buttons.length||prepared.quickReplies.length)?'interactive':'text',content:prepared.text,status:'sent',billable:false,provider:'meta',provider_message_id:privateMessageId||null,metadata:{workflow_id:workflow.id,node_id:messageNode.id||null,node_index:messageIndex,comment_id:comment.commentId,quick_replies:prepared.quickReplies,buttons:prepared.buttons},occurred_at:new Date().toISOString()},{ignoreDuplicates:true});
      await serviceInsert('automation_flow_sessions',{business_id:account.business_id,workflow_id:workflow.id,comment_execution_id:execution.id,conversation_id:conversation.id,external_contact_id:comment.senderId,current_node_index:messageIndex,status:'awaiting_reply',context:{comment_id:comment.commentId,media_id:comment.mediaId,awaiting_node_id:messageNode.id||null,handoff_labels:(messageNode.actions||[]).filter(action=>action?.type==='handoff').map(action=>String(action.label||'').trim()).filter(Boolean)}},{ignoreDuplicates:true});
      await serviceUpdate('automation_conversations',`id=eq.${conversation.id}`,{last_message_preview:prepared.text.slice(0,1000),last_message_at:new Date().toISOString()});
    }catch(error){errors.push(String(error?.message||'private_reply_failed'));}
  }
  const status=errors.length?(publicReplyId||privateMessageId?'partial':'failed'):'completed';
  await serviceUpdate('automation_comment_executions',`id=eq.${execution.id}`,{status,public_reply_id:publicReplyId||null,private_message_id:privateMessageId||null,last_error:errors.join('; ').slice(0,2000)||null,completed_at:new Date().toISOString()});
  await serviceUpdate('automation_comment_workflows',`id=eq.${workflow.id}`,{triggered_count:Number(workflow.triggered_count||0)+1,last_triggered_at:new Date().toISOString()});
  return true;
}

async function matchesPost(workflow,comment,accessToken){
  if(workflow.post_scope==='all')return true;
  const selected=Array.isArray(workflow.selected_post_ids)?workflow.selected_post_ids:[];
  if(workflow.post_scope==='selected')return selected.includes(comment.mediaId);
  if(selected.length)return selected.includes(comment.mediaId);
  const media=await getInstagramMedia({mediaId:comment.mediaId,accessToken});
  const publishedAt=Date.parse(media.timestamp||'');
  const activatedAt=Date.parse(workflow.activated_at||workflow.updated_at||'');
  if(!Number.isFinite(publishedAt)||!Number.isFinite(activatedAt)||publishedAt<=activatedAt)return false;
  await serviceUpdate('automation_comment_workflows',`id=eq.${workflow.id}&selected_post_ids=eq.%7B%7D`,{selected_post_ids:[comment.mediaId]});
  return true;
}

function internalAuthorized(event){const expected=String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET||'');const actual=String(event.headers?.['x-hansora-internal-secret']||event.headers?.['X-Hansora-Internal-Secret']||'');return expected.length>=32&&actual===expected;}
async function markProcessed(id,businessId){await serviceUpdate('automation_webhook_events',`id=eq.${id}`,{business_id:businessId,status:'processed',processed_at:new Date().toISOString(),last_error:null});}
