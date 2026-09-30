// Called when an automation goes live or is paused: makes sure the Instagram account receives every event the
// automations need (DMs, comments, Live comments, ig.me link openings) and publishes the conversation starters
// ("ice breakers") of the live automations. Owner-only; returns no tokens.
import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { decryptSecret } from '../../lib/automation/crypto.mjs';
import { first, rows, supabaseRequest } from '../../lib/automation/db.mjs';
import { setInstagramIceBreakers, subscribeInstagramWebhooks } from '../../lib/automation/meta.mjs';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  try {
    const user = await authenticateRequest(event);
    if (!user) return json(401, { error: 'authentication_required' });
    const body = JSON.parse(event.body || '{}');
    if (!isUuid(body.business_id)) return json(400, { error: 'invalid_business_id' });
    const business = await first(`/rest/v1/automation_businesses?id=eq.${body.business_id}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`);
    if (!business) return json(404, { error: 'business_not_found' });
    const account = await first(`/rest/v1/automation_provider_resources?business_id=eq.${business.id}&provider=eq.meta&resource_type=eq.instagram_account&status=eq.active&select=id&limit=1`);
    if (!account) return json(200, { connected: false });
    const credential = await first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${account.id}&credential_type=eq.access_token&select=*&limit=1`);
    if (!credential) return json(200, { connected: true, token: 'missing' });
    const accessToken = decryptSecret(credential);
    const result = {};
    try { result.subscribed = await subscribeInstagramWebhooks(accessToken); }
    catch (error) { result.subscribe_error = error.providerMessage || error.message; }
    const starters = rows(await supabaseRequest(`/rest/v1/automation_comment_workflows?business_id=eq.${business.id}&status=eq.active&select=id,safety_config&order=updated_at.desc`))
      .filter(row => row.safety_config?.trigger_type === 'ice_breaker' && String(row.safety_config?.trigger?.question || '').trim())
      .slice(0, 4).map(row => ({ question: row.safety_config.trigger.question, payload: `HANSORA_START:${row.id}` }));
    // Only touches Instagram's starters when Hansora manages them (never wipes starters set elsewhere by accident).
    if (starters.length || body.trigger_type === 'ice_breaker') try { await setInstagramIceBreakers({ accessToken, questions: starters }); result.conversation_starters = starters.length; }
    catch (error) { result.conversation_starters_error = error.providerDetails?.message || error.message; }
    return json(200, { connected: true, ...result });
  } catch (error) {
    console.error('automation-instagram-sync error', { message: error?.message });
    return json(500, { error: 'instagram_sync_failed' });
  }
}
