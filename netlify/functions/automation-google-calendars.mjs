import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { decryptSecret } from '../../lib/automation/crypto.mjs';
import { first, serviceUpdate } from '../../lib/automation/db.mjs';
import { listGoogleCalendars, refreshGoogleAccessToken } from '../../lib/automation/google-calendar.mjs';

const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(statusCode,body)=>({statusCode,headers:HEADERS,body:JSON.stringify(body)});

// List the owner's writable Google calendars, choose which one bookings sync to, or disconnect Google.
export async function handler(event){
  if(event.httpMethod==='OPTIONS')return json(204,{});if(event.httpMethod!=='POST')return json(405,{error:'method_not_allowed'});
  try{
    const user=await authenticateRequest(event);if(!user)return json(401,{error:'authentication_required'});
    let body;try{body=JSON.parse(event.body||'{}')}catch(_){return json(400,{error:'invalid_json'})}
    if(!isUuid(body.business_id))return json(400,{error:'invalid_business_id'});
    const business=await first(`/rest/v1/automation_businesses?id=eq.${body.business_id}&owner_user_id=eq.${user.id}&select=id&limit=1`);if(!business)return json(404,{error:'business_not_found'});
    const resource=await first(`/rest/v1/automation_provider_resources?business_id=eq.${business.id}&provider=eq.google_calendar&resource_type=eq.calendar&status=eq.active&select=*&limit=1`);
    if(!resource)return json(200,{connected:false,calendars:[]});
    if(body.action==='disconnect'){
      await serviceUpdate('automation_provider_resources',`id=eq.${resource.id}`,{status:'revoked',updated_at:new Date().toISOString()});
      await serviceUpdate('automation_tool_configs',`business_id=eq.${business.id}&tool_type=eq.calendar`,{provider_resource_id:null,updated_at:new Date().toISOString()});
      return json(200,{connected:false,calendars:[]});
    }
    const credential=await first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${resource.id}&credential_type=eq.refresh_token&select=*&limit=1`);
    if(!credential)return json(409,{error:'google_reconnect_required'});
    const calendars=await listGoogleCalendars(await refreshGoogleAccessToken(decryptSecret(credential)));
    if(body.action==='select'){
      const chosen=calendars.find(item=>item.id===String(body.calendar_id||''));if(!chosen)return json(400,{error:'calendar_not_found'});
      await serviceUpdate('automation_provider_resources',`id=eq.${resource.id}`,{safe_config:{...(resource.safe_config||{}),calendar_id:chosen.primary?'primary':chosen.id,calendar_name:chosen.name},updated_at:new Date().toISOString()});
      return json(200,{connected:true,selected:chosen.primary?'primary':chosen.id,calendars});
    }
    return json(200,{connected:true,selected:resource.safe_config?.calendar_id||'primary',calendars});
  }catch(error){console.error('automation-google-calendars error',{message:error?.message,status:error?.status,providerStatus:error?.providerStatus});return json(error?.message==='google_token_refresh_failed'?409:Number(error?.status)||500,{error:error?.message==='google_token_refresh_failed'?'google_reconnect_required':'google_calendars_unavailable'});}
}
