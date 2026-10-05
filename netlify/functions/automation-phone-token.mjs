import crypto from 'node:crypto';
import { AccessToken, AgentDispatchClient, TrackSource } from 'livekit-server-sdk';
import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { first } from '../../lib/automation/db.mjs';
import { PHONE_AGENT_NAME, phoneTestMaxSeconds, phoneTestSettings } from '../../lib/automation/phone.mjs';

const HEADERS = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  try {
    const user = await authenticateRequest(event);
    if (!user) return json(401, { error: 'authentication_required' });
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'invalid_json' }); }
    const businessId = String(body.business_id || '');
    if (!isUuid(businessId)) return json(400, { error: 'invalid_business_id' });
    const business = await first(`/rest/v1/automation_businesses?id=eq.${encodeURIComponent(businessId)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id,name,automation_agents(id),automation_business_knowledge(id)&limit=1`);
    if (!business) return json(404, { error: 'business_not_found' });
    const hasRecord = value => Array.isArray(value) ? value.length > 0 : Boolean(value?.id);
    if (!hasRecord(business.automation_agents) || !hasRecord(business.automation_business_knowledge)) return json(409, { error: 'phone_agent_configuration_incomplete' });

    const url = String(process.env.LIVEKIT_URL || '').trim();
    const apiKey = String(process.env.LIVEKIT_API_KEY || '').trim();
    const apiSecret = String(process.env.LIVEKIT_API_SECRET || '').trim();
    if (!url || !apiKey || !apiSecret) return json(503, { error: 'phone_service_not_configured' });

    const room = `hansora-test-${businessId.slice(0, 8)}-${crypto.randomUUID()}`;
    const identity = `owner-${user.id.slice(0, 8)}-${crypto.randomUUID()}`;
    const maxSeconds = phoneTestMaxSeconds();
    const metadata = JSON.stringify({ business_id: businessId, owner_user_id: user.id, participant_identity: identity, direction: 'test', test_settings: body.settings ? phoneTestSettings(body.settings) : undefined });
    const dispatch = new AgentDispatchClient(url, apiKey, apiSecret);
    await dispatch.createDispatch(room, process.env.LIVEKIT_PHONE_AGENT_NAME || PHONE_AGENT_NAME, { metadata });

    const token = new AccessToken(apiKey, apiSecret, {
      identity,
      name: `${business.name} test caller`.slice(0, 120),
      metadata,
      attributes: { 'hansora.businessId': businessId, 'hansora.callDirection': 'test' },
      ttl: '10m'
    });
    token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: false, canPublishSources: [TrackSource.MICROPHONE] });
    return json(200, { url, room, token: await token.toJwt(), expires_in: 600, max_seconds: maxSeconds });
  } catch (error) {
    console.error('automation-phone-token error', { message: error?.message, status: error?.status });
    return json(Number(error?.status) || 500, { error: Number(error?.status) >= 400 && Number(error?.status) < 500 ? String(error.message) : 'phone_test_unavailable' });
  }
}
