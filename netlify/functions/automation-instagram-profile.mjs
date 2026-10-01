import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { decryptSecret } from '../../lib/automation/crypto.mjs';
import { first, rows, supabaseRequest } from '../../lib/automation/db.mjs';
import { getInstagramAccountCard } from '../../lib/automation/meta.mjs';

const HEADERS = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json = (statusCode, body) => ({statusCode, headers:HEADERS, body:JSON.stringify(body)});

// Returns the connected Instagram name + photo for each of the owner's businesses (photo links from Instagram expire,
// so the dashboard asks again instead of storing them).
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, {error:'method_not_allowed'});
  try {
    const user = await authenticateRequest(event);
    if (!user) return json(401, {error:'authentication_required'});
    let body; try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, {error:'invalid_json'}); }
    const ids = [...new Set(Array.isArray(body.business_ids) ? body.business_ids : [])].filter(isUuid).slice(0, 30);
    if (!ids.length) return json(200, {profiles:{}});
    const owned = rows(await supabaseRequest(`/rest/v1/automation_businesses?id=in.(${ids.join(',')})&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id`));
    const profiles = {};
    await Promise.all(owned.map(async business => {
      try {
        const account = await first(`/rest/v1/automation_provider_resources?business_id=eq.${business.id}&provider=eq.meta&resource_type=eq.instagram_account&status=eq.active&select=id,safe_config&limit=1`);
        if (!account) return;
        const fallback = {username:String(account.safe_config?.username || ''), name:'', picture:''};
        const credential = await first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${account.id}&credential_type=eq.access_token&select=*&limit=1`);
        if (!credential || (credential.expires_at && Date.parse(credential.expires_at) <= Date.now())) { profiles[business.id] = fallback; return; }
        const card = await getInstagramAccountCard(decryptSecret(credential)).catch(() => null);
        profiles[business.id] = card ? {...card, username:card.username || fallback.username} : fallback;
      } catch (error) {
        console.error('automation-instagram-profile business failed', {business:business.id, message:error?.message});
      }
    }));
    return json(200, {profiles});
  } catch (error) {
    console.error('automation-instagram-profile error', {message:error?.message,status:error?.status});
    return json(Number(error?.status) || 500, {error:'instagram_profile_unavailable'});
  }
}
