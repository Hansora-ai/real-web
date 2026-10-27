import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { decryptSecret } from '../../lib/automation/crypto.mjs';
import { first, rows, serviceUpdate, supabaseRequest } from '../../lib/automation/db.mjs';
import { getInstagramSenderProfile } from '../../lib/automation/meta.mjs';
import { isKeptAvatar, keepAvatar } from '../../lib/automation/avatars.mjs';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
const BATCH = 24;

// Repairs Instagram contacts whose photo link expired (or was never copied): looks the photo up again and keeps
// Hansora's own copy. Called by the Inbox and Contacts in the background; each contact is tried at most once a day.
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  try {
    const user = await authenticateRequest(event);
    if (!user) return json(401, { error: 'authentication_required' });
    let body; try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'invalid_json' }); }
    if (!isUuid(body.business_id)) return json(400, { error: 'invalid_business_id' });
    const business = await first(`/rest/v1/automation_businesses?id=eq.${encodeURIComponent(body.business_id)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`);
    if (!business) return json(404, { error: 'business_not_found' });
    const account = await first(`/rest/v1/automation_provider_resources?business_id=eq.${business.id}&provider=eq.meta&resource_type=eq.instagram_account&status=eq.active&select=id&limit=1`);
    if (!account) return json(200, { photos: {} });
    const credential = await first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${account.id}&credential_type=eq.access_token&select=*&limit=1`);
    if (!credential || (credential.expires_at && Date.parse(credential.expires_at) <= Date.now())) return json(200, { photos: {} });
    const accessToken = decryptSecret(credential);
    const dayAgo = Date.now() - 86_400_000;
    const people = rows(await supabaseRequest(`/rest/v1/automation_contacts?business_id=eq.${business.id}&channel_type=eq.instagram_dm&select=id,external_contact_id,profile&order=last_seen_at.desc&limit=300`))
      .filter(item => !isKeptAvatar(item.profile?.profile_pic) && !(Date.parse(item.profile?.photo_checked_at || '') > dayAgo))
      .slice(0, BATCH);
    const photos = {};
    // A few at a time, so the whole batch stays well inside the function time limit.
    for (let index = 0; index < people.length; index += 6) {
      await Promise.all(people.slice(index, index + 6).map(async item => {
        const found = await getInstagramSenderProfile({ senderId: item.external_contact_id, accessToken });
        const photo = found?.profilePic ? await keepAvatar({ url: found.profilePic, businessId: business.id, channel: 'instagram', customerId: item.external_contact_id }) : '';
        const kept = isKeptAvatar(photo);
        const profile = { ...(item.profile || {}), photo_checked_at: new Date().toISOString(), ...(kept ? { profile_pic: photo } : {}), ...(found?.username && !item.profile?.username ? { username: found.username } : {}) };
        await serviceUpdate('automation_contacts', `id=eq.${item.id}&business_id=eq.${business.id}`, { profile }).catch(() => null);
        if (kept) photos[item.id] = photo;
      }));
    }
    return json(200, { photos, more: people.length === BATCH });
  } catch (error) {
    console.error('automation-contact-photos error', { message: error?.message });
    return json(500, { error: 'contact_photos_failed' });
  }
}
