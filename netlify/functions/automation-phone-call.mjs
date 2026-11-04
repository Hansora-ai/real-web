import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { first } from '../../lib/automation/db.mjs';
import { startOutgoingCall } from '../../lib/automation/phone-dial.mjs';

const HEADERS = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
const STATUS = { invalid_number: 400, purpose_required: 400, no_outgoing_line: 409, other_country: 409, credits_required: 402, too_many_calls: 429, phone_service_not_configured: 503 };

// The owner asks the AI to call someone now: a contact of this business (inbox) or a typed number (phone page).
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
    const business = await first(`/rest/v1/automation_businesses?id=eq.${encodeURIComponent(businessId)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id,automation_agents(id),automation_business_knowledge(id)&limit=1`);
    if (!business) return json(404, { error: 'business_not_found' });
    const hasRecord = value => Array.isArray(value) ? value.length > 0 : Boolean(value?.id);
    if (!hasRecord(business.automation_agents) || !hasRecord(business.automation_business_knowledge)) return json(409, { error: 'phone_agent_configuration_incomplete' });
    let contact = null;
    if (body.contact_id) {
      if (!isUuid(String(body.contact_id))) return json(400, { error: 'invalid_contact' });
      contact = await first(`/rest/v1/automation_contacts?id=eq.${encodeURIComponent(body.contact_id)}&business_id=eq.${encodeURIComponent(businessId)}&select=id,display_name,primary_phone&limit=1`);
      if (!contact) return json(404, { error: 'contact_not_found' });
    }
    const result = await startOutgoingCall({ businessId, to: body.to || contact?.primary_phone, purpose: body.purpose, contactName: contact?.display_name || '' });
    return json(200, result);
  } catch (error) {
    if (STATUS[error?.code]) return json(STATUS[error.code], { error: error.code });
    console.error('automation-phone-call error', { message: error?.message, status: error?.status });
    return json(500, { error: 'phone_call_unavailable' });
  }
}
