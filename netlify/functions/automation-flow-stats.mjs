import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { first, rows, supabaseRequest } from '../../lib/automation/db.mjs';
import { summarizeFlowStats } from '../../lib/automation/flow-stats.mjs';

const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(statusCode,body)=>({statusCode,headers:HEADERS,body:JSON.stringify(body)});

// Per-step results for one comment automation (owner only): comments, DMs sent/seen/failed, button taps.
export async function handler(event){
  if(event.httpMethod==='OPTIONS')return json(204,{});if(event.httpMethod!=='POST')return json(405,{error:'method_not_allowed'});
  try{
    const user=await authenticateRequest(event);if(!user)return json(401,{error:'authentication_required'});
    let body;try{body=JSON.parse(event.body||'{}')}catch(_){return json(400,{error:'invalid_json'})}
    if(!isUuid(body.business_id)||!isUuid(body.workflow_id))return json(400,{error:'invalid_request'});
    const business=await first(`/rest/v1/automation_businesses?id=eq.${body.business_id}&owner_user_id=eq.${user.id}&select=id&limit=1`);if(!business)return json(404,{error:'business_not_found'});
    const workflow=await first(`/rest/v1/automation_comment_workflows?id=eq.${body.workflow_id}&business_id=eq.${business.id}&select=id,dm_steps&limit=1`);if(!workflow)return json(404,{error:'workflow_not_found'});
    const w=workflow.id;
    const [executions,messages,events,sessions]=await Promise.all([
      supabaseRequest(`/rest/v1/automation_comment_executions?workflow_id=eq.${w}&select=status,public_reply_id,private_message_id&limit=20000`),
      supabaseRequest(`/rest/v1/automation_messages?business_id=eq.${business.id}&direction=eq.outbound&metadata->>workflow_id=eq.${w}&select=status,metadata&limit=50000`),
      supabaseRequest(`/rest/v1/automation_flow_events?workflow_id=eq.${w}&select=node_id,action_id,event_type&limit=50000`),
      supabaseRequest(`/rest/v1/automation_flow_sessions?workflow_id=eq.${w}&select=status,current_node_index&limit=20000`)
    ]);
    return json(200,summarizeFlowStats({nodes:workflow.dm_steps,executions:rows(executions),messages:rows(messages),events:rows(events),sessions:rows(sessions)}));
  }catch(error){console.error('automation-flow-stats error',{message:error?.message});return json(Number(error?.status)||500,{error:'stats_unavailable'});}
}
