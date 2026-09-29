import crypto from 'node:crypto';
import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { sha256 } from '../../lib/automation/crypto.mjs';
import { first, serviceInsert } from '../../lib/automation/db.mjs';
import { buildGoogleAuthorizationUrl } from '../../lib/automation/google-calendar.mjs';

const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(statusCode,body)=>({statusCode,headers:HEADERS,body:JSON.stringify(body)});

export async function handler(event){
  if(event.httpMethod==='OPTIONS')return json(204,{});if(event.httpMethod!=='POST')return json(405,{error:'method_not_allowed'});
  try{
    const user=await authenticateRequest(event);if(!user)return json(401,{error:'authentication_required'});
    let body;try{body=JSON.parse(event.body||'{}')}catch(_){return json(400,{error:'invalid_json'})}
    if(!isUuid(body.business_id))return json(400,{error:'invalid_business_id'});
    const business=await first(`/rest/v1/automation_businesses?id=eq.${body.business_id}&owner_user_id=eq.${user.id}&select=id&limit=1`);if(!business)return json(404,{error:'business_not_found'});
    // Opaque single-use state; only its hash is stored and the callback claims it once.
    const state=crypto.randomBytes(32).toString('base64url');
    const authorizationUrl=buildGoogleAuthorizationUrl(state);
    await serviceInsert('automation_oauth_states',{business_id:business.id,owner_user_id:user.id,provider:'google_calendar',state_hash:sha256(state),expires_at:new Date(Date.now()+10*60*1000).toISOString()});
    return json(200,{authorization_url:authorizationUrl});
  }catch(error){console.error('automation-google-start error',{message:error?.message,status:error?.status});return json(Number(error?.status)||500,{error:Number(error?.status)===503?String(error.message):'google_connection_unavailable'});}
}
