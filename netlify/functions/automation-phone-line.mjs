import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { first, rows, serviceInsert, serviceUpdate, supabaseRequest } from '../../lib/automation/db.mjs';
import { buyTelnyxNumber, telnyxConfigured } from '../../lib/automation/telnyx.mjs';

const HEADERS = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
const publicNumber = row => row?.e164 ? { e164: row.e164, country: row.country, assigned_at: row.assigned_at } : null;
// Countries where a number may be bought from Telnyx on demand (no paperwork needed there).
const buyableCountries = () => telnyxConfigured() ? String(process.env.TELNYX_COUNTRIES || 'US,CA').split(',').map(code => code.trim().toUpperCase()).filter(code => /^[A-Z]{2}$/.test(code)) : [];

// The owner's phone line: which Hansora number the business has, which countries
// still have free numbers, and turning the line on (assign) or off (release).
// Numbers are only ever assigned here, with the service role.
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (!['GET', 'POST'].includes(event.httpMethod)) return json(405, { error: 'method_not_allowed' });
  try {
    const user = await authenticateRequest(event);
    if (!user) return json(401, { error: 'authentication_required' });
    let body = {};
    if (event.httpMethod === 'POST') { try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'invalid_json' }); } }
    const businessId = String((event.httpMethod === 'GET' ? event.queryStringParameters?.business_id : body.business_id) || '');
    if (!isUuid(businessId)) return json(400, { error: 'invalid_business_id' });
    const business = await first(`/rest/v1/automation_businesses?id=eq.${encodeURIComponent(businessId)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id,automation_agents(id),automation_business_knowledge(id)&limit=1`);
    if (!business) return json(404, { error: 'business_not_found' });

    const assigned = () => first(`/rest/v1/automation_phone_numbers?business_id=eq.${encodeURIComponent(businessId)}&status=eq.assigned&select=e164,country,assigned_at&limit=1`);
    if (event.httpMethod === 'GET') {
      const free = rows(await supabaseRequest('/rest/v1/automation_phone_numbers?status=eq.available&select=country&limit=1000'));
      const counts = free.reduce((all, row) => ({ ...all, [row.country]: (all[row.country] || 0) + 1 }), {});
      for (const country of buyableCountries()) counts[country] = counts[country] || 0;
      const countries = Object.entries(counts).map(([country, available]) => ({ country, available }));
      return json(200, { number: publicNumber(await assigned()), countries });
    }

    if (body.action === 'activate') {
      const hasRecord = value => Array.isArray(value) ? value.length > 0 : Boolean(value?.id);
      if (!hasRecord(business.automation_agents) || !hasRecord(business.automation_business_knowledge)) return json(409, { error: 'phone_agent_configuration_incomplete' });
      const country = String(body.country || '').toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) return json(400, { error: 'invalid_country' });
      const assign = async () => { const result = await supabaseRequest('/rest/v1/rpc/automation_assign_phone_number', { method: 'POST', body: { p_business: businessId, p_country: country } }); return Array.isArray(result) ? result[0] : result; };
      let number = await assign();
      if (!number?.e164 && buyableCountries().includes(country)) {
        // Buying costs Hansora money every month, so only for an owner with credits.
        const profile = await first(`/rest/v1/profiles?user_id=eq.${encodeURIComponent(user.id)}&select=credits&limit=1`);
        if (!(Number(profile?.credits) > 0)) return json(402, { error: 'credits_required' });
        const bought = await buyTelnyxNumber(country);
        if (bought) {
          await serviceInsert('automation_phone_numbers', { e164: bought.e164, country, provider: 'telnyx', provider_number_id: bought.providerNumberId, status: 'available' }, { ignoreDuplicates: true });
          number = await assign();
        }
      }
      if (!number?.e164) return json(409, { error: 'no_number_available' });
      await serviceUpdate('automation_channel_connections', `business_id=eq.${encodeURIComponent(businessId)}&channel_type=eq.phone`, { status: 'connected', provider: number.provider || 'phone', connected_account_label: number.e164, connected_at: new Date().toISOString(), last_error_code: null });
      return json(200, { number: publicNumber(number) });
    }

    if (body.action === 'release') {
      await supabaseRequest('/rest/v1/rpc/automation_release_phone_number', { method: 'POST', body: { p_business: businessId } });
      await serviceUpdate('automation_channel_connections', `business_id=eq.${encodeURIComponent(businessId)}&channel_type=eq.phone`, { status: 'not_connected', connected_account_label: null });
      return json(200, { number: null });
    }
    return json(400, { error: 'invalid_action' });
  } catch (error) {
    console.error('automation-phone-line error', { message: error?.message, status: error?.status });
    return json(500, { error: 'phone_line_unavailable' });
  }
}
