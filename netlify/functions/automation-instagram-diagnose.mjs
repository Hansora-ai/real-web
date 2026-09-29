// Asks Meta directly how the connected Instagram account is set up, so webhook problems can be
// diagnosed without guessing: which webhook fields the account is subscribed to, and whether the
// messaging API can see the latest DMs. Owner-only; returns no tokens.
import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { decryptSecret } from '../../lib/automation/crypto.mjs';
import { first } from '../../lib/automation/db.mjs';
import { metaConfig } from '../../lib/automation/meta.mjs';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body, null, 2) });

async function graph(path, params) {
  const url = new URL(`https://graph.instagram.com/${metaConfig().graphVersion}${path}`);
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  return response.ok ? { ok: true, data } : { ok: false, status: response.status, error: data?.error?.message || 'request_failed', code: data?.error?.code || null };
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  try {
    const user = await authenticateRequest(event);
    if (!user) return json(401, { error: 'authentication_required' });
    const body = JSON.parse(event.body || '{}');
    if (!isUuid(body.business_id)) return json(400, { error: 'invalid_business_id' });
    const business = await first(`/rest/v1/automation_businesses?id=eq.${body.business_id}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`);
    if (!business) return json(404, { error: 'business_not_found' });
    const account = await first(`/rest/v1/automation_provider_resources?business_id=eq.${business.id}&provider=eq.meta&resource_type=eq.instagram_account&status=eq.active&select=id,provider_resource_id,safe_config&limit=1`);
    if (!account) return json(200, { connected: false });
    const credential = await first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${account.id}&credential_type=eq.access_token&select=*&limit=1`);
    if (!credential) return json(200, { connected: true, account: account.safe_config?.username, token: 'missing' });
    const accessToken = decryptSecret(credential);
    const me = await graph('/me', { fields: 'user_id,username,account_type', access_token: accessToken });
    const subscribed = await graph('/me/subscribed_apps', { access_token: accessToken });
    const conversations = await graph('/me/conversations', { platform: 'instagram', fields: 'updated_time,messages.limit(3){from,created_time,message}', limit: '3', access_token: accessToken });
    // Each lookup is independent so one failure never hides the rest of the report.
    const safe = promise => promise.catch(error => ({ lookup_failed: error?.message || 'error' }));
    const dm = await safe(first(`/rest/v1/automation_channel_connections?business_id=eq.${business.id}&channel_type=eq.instagram_dm&select=status,connected_account_label&limit=1`));
    const lastEvent = await safe(first(`/rest/v1/automation_webhook_events?provider=eq.meta&event_type=eq.instagram_message&select=status,last_error,received_at&order=received_at.desc&limit=1`));
    return json(200, {
      connected: true,
      hansora_account_id: account.provider_resource_id,
      instagram_dm_channel: dm || 'missing',
      hansora_account_username: account.safe_config?.username || null,
      meta_profile: me.ok ? me.data : me,
      webhook_subscription: subscribed.ok ? subscribed.data : subscribed,
      latest_conversations: conversations.ok ? (conversations.data?.data || []).map(conversation => ({
        updated_time: conversation.updated_time,
        messages: (conversation.messages?.data || []).map(message => ({ from: message.from?.username || message.from?.id, at: message.created_time, text: String(message.message || '').slice(0, 60) }))
      })) : conversations,
      last_instagram_message_event: lastEvent || null
    });
  } catch (error) {
    console.error('automation-instagram-diagnose error', { message: error?.message });
    return json(500, { error: 'diagnose_failed', message: error?.message });
  }
}
