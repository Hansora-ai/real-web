import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { decryptSecret } from '../../lib/automation/crypto.mjs';
import { first, serviceUpdate } from '../../lib/automation/db.mjs';
import { cancelGoogleEvent, refreshGoogleAccessToken } from '../../lib/automation/google-calendar.mjs';

const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(statusCode,body)=>({statusCode,headers:HEADERS,body:JSON.stringify(body)});
const STATUSES=['new','in_progress','waiting','confirmed','completed','cancelled'];

// Owner updates to a lead, order or booking. Cancelling a booking frees the slot and removes the Google event.
export async function handler(event){
  if(event.httpMethod==='OPTIONS')return json(204,{});if(event.httpMethod!=='POST')return json(405,{error:'method_not_allowed'});
  try{
    const user=await authenticateRequest(event);if(!user)return json(401,{error:'authentication_required'});
    let body;try{body=JSON.parse(event.body||'{}')}catch(_){return json(400,{error:'invalid_json'})}
    if(!isUuid(body.business_id)||!isUuid(body.outcome_id))return json(400,{error:'invalid_request'});
    const business=await first(`/rest/v1/automation_businesses?id=eq.${body.business_id}&owner_user_id=eq.${user.id}&select=id&limit=1`);if(!business)return json(404,{error:'business_not_found'});
    const outcome=await first(`/rest/v1/automation_outcomes?id=eq.${body.outcome_id}&business_id=eq.${business.id}&select=*&limit=1`);if(!outcome)return json(404,{error:'record_not_found'});
    const patch={updated_at:new Date().toISOString()};
    if(body.status!==undefined){if(!STATUSES.includes(body.status))return json(400,{error:'invalid_status'});patch.status=body.status;}
    if(body.private_note!==undefined)patch.private_note=String(body.private_note||'').slice(0,8000);
    if(body.assignee!==undefined)patch.assignee=String(body.assignee||'').slice(0,120);
    let saved;
    try{saved=(await serviceUpdate('automation_outcomes',`id=eq.${outcome.id}&business_id=eq.${business.id}`,patch))[0];}
    catch(error){if(error?.status===409)return json(409,{error:'time_already_booked'});throw error;}
    if(outcome.outcome_type==='booking'&&patch.status==='cancelled'&&outcome.status!=='cancelled'&&outcome.external_calendar_event_id){
      const resource=await first(`/rest/v1/automation_provider_resources?business_id=eq.${business.id}&provider=eq.google_calendar&status=eq.active&select=*&limit=1`);
      const credential=resource&&await first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${resource.id}&credential_type=eq.refresh_token&select=*&limit=1`);
      if(credential)await cancelGoogleEvent({accessToken:await refreshGoogleAccessToken(decryptSecret(credential)),calendarId:resource.safe_config?.calendar_id||'primary',eventId:outcome.external_calendar_event_id}).catch(error=>console.error('google event cancel failed',{message:error?.message}));
    }
    return json(200,{ok:true,record:saved});
  }catch(error){console.error('automation-outcome-update error',{message:error?.message,status:error?.status});return json(Number(error?.status)||500,{error:'record_update_failed'});}
}
