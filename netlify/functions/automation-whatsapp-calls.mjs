// WhatsApp calls for the owner's connected WhatsApp number (see lib/automation/whatsapp-calling.mjs).
// GET  ?business_id=…                        → { connected, number, calling: { enabled, enabled_at, last_error } }
// POST { business_id, action: "enable" }     → turns calls on at Meta and LiveKit; Meta's refusal comes back as is
// POST { business_id, action: "disable" }    → turns them off
import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { first, serviceUpdate } from '../../lib/automation/db.mjs';
import { decryptSecret } from '../../lib/automation/crypto.mjs';
import { disableWhatsAppCalls, enableWhatsAppCalls, explainMetaError } from '../../lib/automation/whatsapp-calling.mjs';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
const graphVersion = () => String(process.env.META_WHATSAPP_GRAPH_VERSION || process.env.META_GRAPH_VERSION || 'v23.0').replace(/^\/?/, '');

export const handler = event => handle(event);

export async function handle(event, deps = {}) {
  const d = { authenticateRequest, first, serviceUpdate, decryptSecret, enableWhatsAppCalls, disableWhatsAppCalls, ...deps };
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (!['GET', 'POST'].includes(event.httpMethod)) return json(405, { error: 'method_not_allowed' });
  try {
    const user = await d.authenticateRequest(event);
    if (!user) return json(401, { error: 'authentication_required' });
    let body = {};
    if (event.httpMethod === 'POST') { try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'invalid_json' }); } }
    const businessId = String((event.httpMethod === 'GET' ? event.queryStringParameters?.business_id : body.business_id) || '');
    if (!isUuid(businessId)) return json(400, { error: 'invalid_business_id' });
    const business = await d.first(`/rest/v1/automation_businesses?id=eq.${encodeURIComponent(businessId)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`);
    if (!business) return json(404, { error: 'business_not_found' });

    const account = await d.first(`/rest/v1/automation_provider_resources?business_id=eq.${encodeURIComponent(businessId)}&provider=eq.meta&resource_type=eq.whatsapp_account&status=eq.active&select=*&order=updated_at.desc&limit=1`);
    const config = account?.safe_config || {};
    const calling = config.calling || {};
    const view = (extra = {}) => ({
      connected: Boolean(account),
      number: account ? { display: config.display_phone_number || '', name: config.verified_name || '', coexistence: Boolean(config.coexistence) } : null,
      calling: { enabled: Boolean(calling.enabled), enabled_at: calling.enabled_at || null, last_error: calling.last_error || null },
      ...extra
    });
    if (event.httpMethod === 'GET') return json(200, view());
    if (!account) return json(409, { error: 'whatsapp_not_connected', ...view() });

    const credential = await d.first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${encodeURIComponent(account.id)}&credential_type=eq.access_token&select=*&limit=1`);
    if (!credential) return json(409, { error: 'whatsapp_token_missing', ...view() });
    const accessToken = d.decryptSecret(credential);
    const save = next => d.serviceUpdate('automation_provider_resources', `id=eq.${encodeURIComponent(account.id)}`, { safe_config: { ...config, calling: next } });

    if (body.action === 'enable') {
      // Turning it on again starts clean: the previous trunk and rule (if any) are removed first.
      if (calling.trunk_id || calling.rule_id) await d.disableWhatsAppCalls({ trunkId: calling.trunk_id, ruleId: calling.rule_id }).catch(() => null);
      try {
        const result = await d.enableWhatsAppCalls({ businessId, phoneNumberId: account.provider_resource_id, displayNumber: config.display_phone_number, accessToken, graphVersion: graphVersion() });
        const next = { enabled: true, e164: result.e164, trunk_id: result.trunkId, rule_id: result.ruleId, enabled_at: new Date().toISOString(), last_error: null };
        await save(next);
        console.log('whatsapp calls turned on', { businessId, sip: result.sipStatus, calling: result.callingStatus });
        calling.enabled = true; calling.enabled_at = next.enabled_at; calling.last_error = null;
        return json(200, view());
      } catch (error) {
        const meta = explainMetaError(error);
        const lastError = meta || { step: 'hansora', meta_message: '', meta_details: '', hint: 'Hansora could not finish turning calls on. Please try again in a minute.' };
        console.error('whatsapp calls could not be turned on', { businessId, step: lastError.step, metaCode: lastError.meta_code ?? null, metaMessage: lastError.meta_message || null, message: error?.message });
        await save({ enabled: false, last_error: { ...lastError, at: new Date().toISOString() } }).catch(() => null);
        calling.enabled = false; calling.last_error = { ...lastError, at: new Date().toISOString() };
        return json(409, { error: 'whatsapp_calls_not_enabled', ...view() });
      }
    }

    if (body.action === 'disable') {
      const { metaError } = await d.disableWhatsAppCalls({ phoneNumberId: account.provider_resource_id, accessToken, graphVersion: graphVersion(), trunkId: calling.trunk_id, ruleId: calling.rule_id });
      if (metaError) console.warn('whatsapp calls: Meta did not confirm turning off', { businessId, message: metaError.metaMessage || metaError.message });
      await save({ enabled: false, last_error: null, disabled_at: new Date().toISOString() });
      calling.enabled = false; calling.enabled_at = null; calling.last_error = null;
      return json(200, view());
    }
    return json(400, { error: 'invalid_action' });
  } catch (error) {
    console.error('automation-whatsapp-calls error', { message: error?.message, status: error?.status });
    return json(500, { error: 'whatsapp_calls_unavailable' });
  }
}
