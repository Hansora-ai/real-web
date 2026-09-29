import { encryptSecret, sha256 } from '../../lib/automation/crypto.mjs';
import { first, serviceInsert, serviceUpdate, serviceUpsert } from '../../lib/automation/db.mjs';
import { exchangeGoogleCode } from '../../lib/automation/google-calendar.mjs';

function redirect(location){return{statusCode:302,headers:{Location:location,'Cache-Control':'no-store'},body:''};}
function errorPage(statusCode,message){return{statusCode,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'},body:`<!doctype html><meta charset="utf-8"><title>Google Calendar connection failed</title><body style="background:#08090c;color:#eef2f8;font:16px Arial;padding:48px"><h1>Google Calendar connection failed</h1><p>${escapeHtml(message)}</p><a style="color:#8eb6ef" href="/automation-dashboard.html">Return to Automation</a></body>`};}

export async function handler(event){
  if(event.httpMethod!=='GET')return errorPage(405,'Method not allowed.');
  try{
    const params=event.queryStringParameters||{};
    if(params.error)return errorPage(400,params.error==='access_denied'?'Access was not granted.':params.error);
    if(!params.code||!params.state)return errorPage(400,'The authorization response is incomplete.');
    const stored=await first(`/rest/v1/automation_oauth_states?state_hash=eq.${sha256(params.state)}&provider=eq.google_calendar&consumed_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*&limit=1`);
    if(!stored)return errorPage(400,'This authorization request expired or was already used.');
    const claimed=await serviceUpdate('automation_oauth_states',`id=eq.${stored.id}&consumed_at=is.null`,{consumed_at:new Date().toISOString()});
    if(!claimed.length)return errorPage(400,'This authorization request expired or was already used.');
    const token=await exchangeGoogleCode(params.code);
    // One Google connection per business; the owner picks which calendar to use on the tools page (default: primary).
    const resource=await serviceUpsert('automation_provider_resources','business_id,provider,resource_type,provider_resource_id',{business_id:stored.business_id,provider:'google_calendar',resource_type:'calendar',provider_resource_id:'google-calendar',status:'active',safe_config:{calendar_id:'primary',calendar_name:'Primary calendar'},last_synced_at:new Date().toISOString()});
    if(!resource)throw new Error('provider_resource_not_saved');
    await serviceUpsert('automation_provider_credentials','provider_resource_id,credential_type',{business_id:stored.business_id,provider_resource_id:resource.id,credential_type:'refresh_token',...encryptSecret(token.refreshToken),expires_at:null});
    const existing=await first(`/rest/v1/automation_tool_configs?business_id=eq.${stored.business_id}&tool_type=eq.calendar&select=id&limit=1`);
    if(existing)await serviceUpdate('automation_tool_configs',`id=eq.${existing.id}`,{provider_resource_id:resource.id,updated_at:new Date().toISOString()});
    else await serviceInsert('automation_tool_configs',{business_id:stored.business_id,tool_type:'calendar',enabled:false,provider_resource_id:resource.id,config:{}});
    return redirect(`/automation-tools.html?${new URLSearchParams({business:stored.business_id,google:'connected'})}`);
  }catch(error){console.error('automation-google-callback error',{message:error?.message,status:error?.status,providerStatus:error?.providerStatus});return errorPage(Number(error?.status)||500,error?.message==='google_refresh_token_missing'?'Google did not grant offline access. Remove Hansora from your Google account permissions and connect again.':'Google Calendar could not be connected. Please try again.');}
}
function escapeHtml(value){return String(value||'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
