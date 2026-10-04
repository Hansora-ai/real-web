import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { decryptSecret, encryptSecret } from '../../lib/automation/crypto.mjs';
import { first, serviceUpdate, serviceUpsert, supabaseRequest } from '../../lib/automation/db.mjs';
import { exchangeMessengerCode, listMessengerPages, messengerConfig, subscribeMessengerPage } from '../../lib/automation/messenger.mjs';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

// "Connect Messenger": config (for the Facebook popup) → pages (the one-time code becomes a user token, kept
// encrypted for 30 minutes while the owner picks a Page) → select (the Page's token is stored and the Page subscribed).
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  try {
    const user = await authenticateRequest(event);
    if (!user) return json(401, { error: 'authentication_required' });
    let body; try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'invalid_json' }); }
    if (!isUuid(body.business_id)) return json(400, { error: 'invalid_business_id' });
    const business = await first(`/rest/v1/automation_businesses?id=eq.${body.business_id}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`);
    if (!business) return json(404, { error: 'business_not_found' });
    let config; try { config = messengerConfig(); } catch (_) { return json(503, { error: 'messenger_not_configured', message: 'Messenger is not switched on for Hansora yet.' }); }
    if (body.action === 'config') {
      if (!config.configurationId) return json(503, { error: 'messenger_not_configured', message: 'Messenger is not switched on for Hansora yet.' });
      return json(200, { app_id: config.appId, configuration_id: config.configurationId, graph_version: config.graphVersion });
    }
    const pendingKey = `pending:${business.id}`;
    if (body.action === 'pages') {
      const code = String(body.code || '').trim();
      if (!code || code.length > 4000) return json(400, { error: 'invalid_code' });
      const userToken = await exchangeMessengerCode(code);
      const pages = await listMessengerPages(userToken);
      if (!pages.length) return json(409, { error: 'no_pages', message: 'No Facebook Page was shared. Connect again and select your Page in the Facebook window.' });
      const resource = await serviceUpsert('automation_provider_resources', 'business_id,provider,resource_type,provider_resource_id', { business_id: business.id, provider: 'meta', resource_type: 'facebook_page', provider_resource_id: pendingKey, status: 'pending', safe_config: { expires_at: new Date(Date.now() + 30 * 60000).toISOString() }, last_synced_at: new Date().toISOString() });
      await serviceUpsert('automation_provider_credentials', 'provider_resource_id,credential_type', { business_id: business.id, provider_resource_id: resource.id, credential_type: 'access_token', ...encryptSecret(userToken), expires_at: new Date(Date.now() + 30 * 60000).toISOString() });
      return json(200, { pages: pages.map(page => ({ id: page.id, name: page.name, picture: page.picture, can_message: page.canMessage })) });
    }
    if (body.action === 'select') {
      const pageId = String(body.page_id || '');
      if (!/^\d{5,40}$/.test(pageId)) return json(400, { error: 'invalid_page' });
      const pending = await first(`/rest/v1/automation_provider_resources?business_id=eq.${business.id}&provider=eq.meta&resource_type=eq.facebook_page&provider_resource_id=eq.${encodeURIComponent(pendingKey)}&select=*&limit=1`);
      const credential = pending && await first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${pending.id}&credential_type=eq.access_token&select=*&limit=1`);
      if (!credential || Date.parse(pending.safe_config?.expires_at || 0) < Date.now()) return json(409, { error: 'connect_again', message: 'This took too long. Press Connect Messenger again.' });
      const page = (await listMessengerPages(decryptSecret(credential))).find(item => item.id === pageId);
      if (!page) return json(404, { error: 'page_not_found', message: 'That Page was not shared with Hansora.' });
      await subscribeMessengerPage({ pageId: page.id, pageToken: page.token });
      // One Page per AI employee: an earlier Page is disconnected.
      const old = await supabaseRequest(`/rest/v1/automation_provider_resources?business_id=eq.${business.id}&provider=eq.meta&resource_type=eq.facebook_page&status=eq.active&provider_resource_id=neq.${page.id}&select=id`);
      for (const row of Array.isArray(old) ? old : []) { await supabaseRequest(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${row.id}`, { method: 'DELETE' }); await serviceUpdate('automation_provider_resources', `id=eq.${row.id}`, { status: 'revoked', updated_at: new Date().toISOString() }); }
      const resource = await serviceUpsert('automation_provider_resources', 'business_id,provider,resource_type,provider_resource_id', { business_id: business.id, provider: 'meta', resource_type: 'facebook_page', provider_resource_id: page.id, status: 'active', safe_config: { page_name: page.name, picture: page.picture }, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      await serviceUpsert('automation_provider_credentials', 'provider_resource_id,credential_type', { business_id: business.id, provider_resource_id: resource.id, credential_type: 'access_token', ...encryptSecret(page.token), expires_at: null });
      await supabaseRequest(`/rest/v1/automation_provider_resources?id=eq.${pending.id}`, { method: 'DELETE' });
      await serviceUpdate('automation_channel_connections', `business_id=eq.${business.id}&channel_type=eq.messenger`, { status: 'connecting', provider: 'meta', connected_account_label: page.name, connected_at: null, last_error_code: null, updated_at: new Date().toISOString() });
      return json(200, { ok: true, account: { id: page.id, label: page.name, picture: page.picture } });
    }
    return json(400, { error: 'invalid_action' });
  } catch (error) {
    console.error('automation-messenger-connect error', { message: error?.message, providerMessage: error?.providerMessage });
    return json(Number(error?.status) || 500, { error: String(error?.message || 'messenger_connect_failed'), message: error?.providerMessage ? `Facebook said: ${error.providerMessage}` : 'Messenger could not be connected. Please try again.' });
  }
}
