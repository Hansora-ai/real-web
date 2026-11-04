import crypto from 'node:crypto';
import { AgentDispatchClient } from 'livekit-server-sdk';
import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { first, rows, supabaseRequest } from '../../lib/automation/db.mjs';
import { automationPricesFor, canAfford } from '../../lib/automation/billing.mjs';
import { PHONE_AGENT_NAME, normalizePhoneNumber } from '../../lib/automation/phone.mjs';
import { outgoingLineFor } from '../../lib/automation/phone-outgoing.mjs';

const HEADERS = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
const MAX_CALLS_PER_10_MINUTES = 5;

// The owner asks the AI to call someone (a customer back, from the inbox). The AI dials from one of the
// business's numbers that can call out, in the same country, and says why it is calling.
// POST { business_id, to?, contact_id?, purpose }
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

    // Who to call: a contact of this business, or a number typed by the owner.
    let contact = null;
    if (body.contact_id) {
      if (!isUuid(String(body.contact_id))) return json(400, { error: 'invalid_contact' });
      contact = await first(`/rest/v1/automation_contacts?id=eq.${encodeURIComponent(body.contact_id)}&business_id=eq.${encodeURIComponent(businessId)}&select=id,display_name,primary_phone&limit=1`);
      if (!contact) return json(404, { error: 'contact_not_found' });
    }
    const to = normalizePhoneNumber(body.to || contact?.primary_phone);
    if (!/^\+[1-9][0-9]{7,14}$/.test(to)) return json(400, { error: 'invalid_number' });
    const purpose = String(body.purpose || '').trim().slice(0, 500);
    if (!purpose) return json(400, { error: 'purpose_required' });

    const numbers = rows(await supabaseRequest(`/rest/v1/automation_phone_numbers?business_id=eq.${encodeURIComponent(businessId)}&status=eq.assigned&select=e164,country,livekit_outbound_trunk_id,allow_international&limit=50`));
    if (!numbers.some(number => number.livekit_outbound_trunk_id)) return json(409, { error: 'no_outgoing_line' });
    const line = outgoingLineFor(numbers, to);
    if (!line) return json(409, { error: 'other_country' });

    const perMinute = (await automationPricesFor(businessId)).voiceMinute;
    const funds = await canAfford(businessId, perMinute);
    if (!funds.ok) return json(402, { error: 'credits_required' });
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const recent = rows(await supabaseRequest(`/rest/v1/automation_calls?business_id=eq.${encodeURIComponent(businessId)}&direction=eq.outbound&started_at=gte.${encodeURIComponent(since)}&select=id&limit=${MAX_CALLS_PER_10_MINUTES}`));
    if (recent.length >= MAX_CALLS_PER_10_MINUTES) return json(429, { error: 'too_many_calls' });

    const url = String(process.env.LIVEKIT_URL || '').trim();
    const apiKey = String(process.env.LIVEKIT_API_KEY || '').trim();
    const apiSecret = String(process.env.LIVEKIT_API_SECRET || '').trim();
    if (!url || !apiKey || !apiSecret) return json(503, { error: 'phone_service_not_configured' });
    const room = `hansora-out-${businessId.slice(0, 8)}-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ business_id: businessId, direction: 'outbound', to, from: line.e164, trunk_id: line.livekit_outbound_trunk_id, purpose, contact_name: String(contact?.display_name || '').slice(0, 120) });
    await new AgentDispatchClient(url, apiKey, apiSecret).createDispatch(room, process.env.LIVEKIT_PHONE_AGENT_NAME || PHONE_AGENT_NAME, { metadata });
    return json(200, { calling: to, from: line.e164 });
  } catch (error) {
    console.error('automation-phone-call error', { message: error?.message, status: error?.status });
    return json(500, { error: 'phone_call_unavailable' });
  }
}
