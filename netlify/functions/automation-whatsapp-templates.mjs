import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { decryptSecret } from '../../lib/automation/crypto.mjs';
import { first } from '../../lib/automation/db.mjs';
import { listWhatsAppTemplates } from '../../lib/automation/whatsapp.mjs';

const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(statusCode,body)=>({statusCode,headers:HEADERS,body:JSON.stringify(body)});

// Approved templates the team can send after the 24-hour customer service window has closed.
export async function handler(event){
  if(event.httpMethod==='OPTIONS')return json(204,{});if(event.httpMethod!=='POST')return json(405,{error:'method_not_allowed'});
  try{
    const user=await authenticateRequest(event);if(!user)return json(401,{error:'authentication_required'});
    let body;try{body=JSON.parse(event.body||'{}')}catch(_){return json(400,{error:'invalid_json'})}
    if(!isUuid(body.business_id))return json(400,{error:'invalid_business_id'});
    const business=await first(`/rest/v1/automation_businesses?id=eq.${body.business_id}&owner_user_id=eq.${user.id}&select=id&limit=1`);if(!business)return json(404,{error:'business_not_found'});
    const account=await first(`/rest/v1/automation_provider_resources?business_id=eq.${business.id}&provider=eq.meta&resource_type=eq.whatsapp_account&status=eq.active&select=*&limit=1`);if(!account)return json(409,{error:'whatsapp_not_connected'});
    const wabaId=String(account.safe_config?.waba_id||'');if(!wabaId)return json(409,{error:'whatsapp_not_connected'});
    const credential=await first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${account.id}&credential_type=eq.access_token&select=*&limit=1`);if(!credential)return json(409,{error:'channel_token_not_found'});
    const templates=await listWhatsAppTemplates({wabaId,accessToken:decryptSecret(credential)});
    return json(200,{templates});
  }catch(error){console.error('automation-whatsapp-templates error',{message:error?.message,status:error?.status,providerStatus:error?.providerStatus});return json(Number(error?.status)||500,{error:'whatsapp_templates_unavailable'});}
}
