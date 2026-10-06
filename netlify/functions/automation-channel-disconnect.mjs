import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { first, rows, serviceUpdate, supabaseRequest } from '../../lib/automation/db.mjs';

const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(statusCode,body)=>({statusCode,headers:HEADERS,body:JSON.stringify(body)});
const CHANNELS={instagram:{provider:'meta',resource:'instagram_account',types:['instagram_dm','instagram_comments']},whatsapp:{provider:'meta',resource:'whatsapp_account',types:['whatsapp']},telegram:{provider:'telegram',resource:'telegram_account',types:['telegram']},messenger:{provider:'meta',resource:'facebook_page',types:['messenger']}};

// Owner disconnects Instagram or WhatsApp: tokens are deleted immediately and the AI stops replying there.
// Conversations stay in the inbox unless the owner asks for deletion (see automation-data-deletion.html).
export async function handler(event){
  if(event.httpMethod==='OPTIONS')return json(204,{});if(event.httpMethod!=='POST')return json(405,{error:'method_not_allowed'});
  try{
    const user=await authenticateRequest(event);if(!user)return json(401,{error:'authentication_required'});
    let body;try{body=JSON.parse(event.body||'{}')}catch(_){return json(400,{error:'invalid_json'})}
    const channel=CHANNELS[body.channel];
    if(!isUuid(body.business_id)||!channel)return json(400,{error:'invalid_request'});
    const business=await first(`/rest/v1/automation_businesses?id=eq.${body.business_id}&owner_user_id=eq.${user.id}&select=id&limit=1`);if(!business)return json(404,{error:'business_not_found'});
    const resources=rows(await supabaseRequest(`/rest/v1/automation_provider_resources?business_id=eq.${business.id}&provider=eq.${channel.provider}&resource_type=eq.${channel.resource}&status=in.(active,pending)&select=id`));
    for(const resource of resources){
      await supabaseRequest(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${resource.id}`,{method:'DELETE'});
      await serviceUpdate('automation_provider_resources',`id=eq.${resource.id}`,{status:'revoked',updated_at:new Date().toISOString()});
    }
    await serviceUpdate('automation_channel_connections',`business_id=eq.${business.id}&channel_type=in.(${channel.types.join(',')})`,{status:'not_connected',connected_account_label:null,connected_at:null,updated_at:new Date().toISOString()});
    return json(200,{ok:true,disconnected:resources.length});
  }catch(error){console.error('automation-channel-disconnect error',{message:error?.message});return json(Number(error?.status)||500,{error:'disconnect_failed'});}
}
