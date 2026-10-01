import { encryptSecret } from '../../lib/automation/crypto.mjs';
import { first, serviceUpsert, serviceUpdate } from '../../lib/automation/db.mjs';
import { exchangeInstagramCode, getInstagramProfile, oauthStateHash, subscribeInstagramWebhooks, verifyOAuthState } from '../../lib/automation/meta.mjs';

function redirect(location){return{statusCode:302,headers:{Location:location,'Cache-Control':'no-store'},body:''};}
function errorPage(statusCode,message){return{statusCode,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'},body:`<!doctype html><meta charset="utf-8"><link rel="icon" href="/favicon.png" type="image/png"><title>Instagram connection failed</title><body style="background:#08090c;color:#eef2f8;font:16px Arial;padding:48px"><h1>Instagram connection failed</h1><p>${escapeHtml(message)}</p><a style="color:#8eb6ef" href="/automation-dashboard.html">Return to Automation</a></body>`};}

export async function handler(event){
  if(event.httpMethod!=='GET')return errorPage(405,'Method not allowed.');
  try{
    const params=event.queryStringParameters||{};
    if(params.error)return errorPage(400,params.error_description||params.error);
    if(!params.code||!params.state)return errorPage(400,'The authorization response is incomplete.');
    const state=verifyOAuthState(params.state);
    const stored=await first(`/rest/v1/automation_oauth_states?state_hash=eq.${oauthStateHash(params.state)}&provider=eq.meta_instagram&consumed_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*&limit=1`);
    if(!stored||stored.business_id!==state.business_id||stored.owner_user_id!==state.user_id)return errorPage(400,'This authorization request expired or was already used.');
    const claimed=await serviceUpdate('automation_oauth_states',`id=eq.${stored.id}&consumed_at=is.null`,{consumed_at:new Date().toISOString()});
    if(!claimed.length)return errorPage(400,'This authorization request expired or was already used.');
    const token=await exchangeInstagramCode(params.code);
    const profile=await getInstagramProfile(token.accessToken);
    const expiresAt=token.expiresIn?new Date(Date.now()+token.expiresIn*1000).toISOString():null;
    await serviceUpdate(
      'automation_provider_resources',
      `business_id=eq.${encodeURIComponent(state.business_id)}&provider=eq.meta&resource_type=eq.instagram_account&status=eq.active`,
      {status:'revoked'}
    );
    const resource=await serviceUpsert('automation_provider_resources','business_id,provider,resource_type,provider_resource_id',{
      business_id:state.business_id,provider:'meta',resource_type:'instagram_account',provider_resource_id:profile.id,status:'active',safe_config:{username:profile.username,account_type:profile.accountType,token_expires_at:expiresAt},last_synced_at:new Date().toISOString()
    });
    if(!resource)throw Object.assign(new Error('provider_resource_not_saved'),{status:500});
    await serviceUpsert('automation_provider_credentials','provider_resource_id,credential_type',{business_id:state.business_id,provider_resource_id:resource.id,credential_type:'access_token',...encryptSecret(token.accessToken),expires_at:expiresAt});
    // Without this subscription Meta never sends this account's DMs and comments to Hansora.
    const subscribed=await subscribeInstagramWebhooks(token.accessToken).then(fields=>{console.log('automation-meta-callback subscribed Instagram webhooks',{account:profile.username,fields});return true;}).catch(error=>{console.error('automation-meta-callback webhook subscription failed',{message:error?.message,providerStatus:error?.providerStatus,providerMessage:error?.providerMessage});return false;});
    const connectionUpdate={status:'connecting',provider:'meta',connected_account_label:profile.username?`@${profile.username}`:profile.id,connected_at:new Date().toISOString(),last_error_code:subscribed?null:'webhook_subscription_failed'};
    await serviceUpdate('automation_channel_connections',`business_id=eq.${encodeURIComponent(state.business_id)}&channel_type=in.(instagram_dm,instagram_comments)`,connectionUpdate);
    const query=new URLSearchParams({channel:'instagram',business:state.business_id,authorized:'1',account:connectionUpdate.connected_account_label});
    return redirect(`/automation-connect.html?${query}`);
  }catch(error){console.error('automation-meta-callback error',{message:error?.message,status:error?.status,providerStatus:error?.providerStatus});return errorPage(Number(error?.status)||500,error?.message||'Instagram connection failed.');}
}
function escapeHtml(value){return String(value||'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
