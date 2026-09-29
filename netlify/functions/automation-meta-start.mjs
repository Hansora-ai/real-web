import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { first, serviceInsert } from '../../lib/automation/db.mjs';
import { buildInstagramAuthorizationUrl, createOAuthState, oauthStateHash } from '../../lib/automation/meta.mjs';

const HEADERS = { 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error:'method_not_allowed' });
  try {
    const user = await authenticateRequest(event); if (!user) return json(401,{error:'authentication_required'});
    let body; try { body=JSON.parse(event.body||'{}'); } catch (_) { return json(400,{error:'invalid_json'}); }
    if (!isUuid(body.business_id)) return json(400,{error:'invalid_business_id'});
    const business = await first(`/rest/v1/automation_businesses?id=eq.${encodeURIComponent(body.business_id)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`);
    if (!business) return json(404,{error:'business_not_found'});
    const state = createOAuthState({business_id:business.id,user_id:user.id});
    await serviceInsert('automation_oauth_states',{business_id:business.id,owner_user_id:user.id,provider:'meta_instagram',state_hash:oauthStateHash(state),expires_at:new Date(Date.now()+10*60*1000).toISOString()});
    return json(200,{authorization_url:buildInstagramAuthorizationUrl(state)});
  } catch (error) {
    console.error('automation-meta-start error',{message:error?.message,status:error?.status});
    return json(Number(error?.status)||500,{error:String(error?.message||'meta_connection_unavailable')});
  }
}
