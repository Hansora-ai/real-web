import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { first, rows, serviceInsert, serviceUpdate, supabaseRequest } from '../../lib/automation/db.mjs';
import { acceptOnLiveKitTrunk, buyTelnyxNumber, telnyxConfigured } from '../../lib/automation/telnyx.mjs';
import { buyTwilioNumber, twilioConfigured } from '../../lib/automation/twilio.mjs';
import { decryptSecret, encryptSecret } from '../../lib/automation/crypto.mjs';
import { createImportTrunk, deleteImportTrunk, newSipCredentials, setTrunkNumbers, sipAddress } from '../../lib/automation/sip-import.mjs';

const HEADERS = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
const publicNumber = row => row?.e164 ? { e164: row.e164, country: row.country, assigned_at: row.assigned_at, imported: row.provider === 'sip', can_call: Boolean(row.livekit_outbound_trunk_id) } : null;
const MAX_IMPORTED_NUMBERS = 10;
const CONTACT_METHODS = new Set(['whatsapp', 'telegram', 'email']);
const CONTACT_WANTS = { local_number: 'wants_local_number', whatsapp_calls: 'wants_whatsapp_calls', forwarding_help: 'wants_forwarding_help' };
// Providers that can buy a number on demand, in order of preference, each with
// the countries it is allowed to buy in (no paperwork needed there) and the
// LiveKit inbound trunk its calls arrive on.
const countryList = value => String(value || '').split(',').map(code => code.trim().toUpperCase()).filter(code => /^[A-Z]{2}$/.test(code));
const numberProviders = () => [
  twilioConfigured() && { name: 'twilio', countries: countryList(process.env.TWILIO_COUNTRIES || 'US,CA'), buy: buyTwilioNumber, trunkId: String(process.env.LIVEKIT_TWILIO_TRUNK_ID).trim(), outboundTrunkId: String(process.env.LIVEKIT_TWILIO_OUTBOUND_TRUNK_ID || '').trim() },
  telnyxConfigured() && { name: 'telnyx', countries: countryList(process.env.TELNYX_COUNTRIES || 'US,CA'), buy: buyTelnyxNumber, trunkId: String(process.env.LIVEKIT_TELNYX_TRUNK_ID).trim() }
].filter(Boolean);
const buyableCountries = () => [...new Set(numberProviders().flatMap(provider => provider.countries))];

// The owner's phone lines: which Hansora numbers the business has (one per
// country), which countries still have free numbers, turning a number on
// (assign) or off (release), and contact requests for countries without numbers.
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

    const assignedNumbers = async () => rows(await supabaseRequest(`/rest/v1/automation_phone_numbers?business_id=eq.${encodeURIComponent(businessId)}&status=eq.assigned&select=e164,country,assigned_at,provider,livekit_outbound_trunk_id&order=assigned_at.asc&limit=50`)).map(publicNumber).filter(Boolean);
    // The phone channel is connected while the business has at least one number.
    const syncChannel = async numbers => serviceUpdate('automation_channel_connections', `business_id=eq.${encodeURIComponent(businessId)}&channel_type=eq.phone`, numbers.length
      ? { status: 'connected', connected_account_label: numbers.map(item => item.e164).join(', ').slice(0, 200), last_error_code: null }
      : { status: 'not_connected', connected_account_label: null });
    // The business's own SIP trunk (imported numbers): where to send calls and how to sign in.
    const importTrunk = () => first(`/rest/v1/automation_phone_sip_trunks?business_id=eq.${encodeURIComponent(businessId)}&select=*&limit=1`);
    const importDetails = trunk => trunk ? { address: sipAddress(), username: trunk.auth_username, password: decryptSecret(trunk), transport: 'UDP or TCP, port 5060' } : null;
    // After a number is added or removed, LiveKit's trunk lists exactly the imported numbers; with none left it is removed.
    const syncImportTrunk = async trunk => {
      if (!trunk) return;
      const imported = (await assignedNumbers()).filter(item => item.imported).map(item => item.e164);
      if (imported.length) return setTrunkNumbers({ trunkId: trunk.livekit_trunk_id, numbers: imported });
      await deleteImportTrunk({ trunkId: trunk.livekit_trunk_id, ruleId: trunk.livekit_dispatch_rule_id });
      await supabaseRequest(`/rest/v1/automation_phone_sip_trunks?business_id=eq.${encodeURIComponent(businessId)}`, { method: 'DELETE' });
    };
    if (event.httpMethod === 'GET') {
      const free = rows(await supabaseRequest('/rest/v1/automation_phone_numbers?status=eq.available&select=country&limit=1000'));
      const counts = free.reduce((all, row) => ({ ...all, [row.country]: (all[row.country] || 0) + 1 }), {});
      for (const country of buyableCountries()) counts[country] = counts[country] || 0;
      const countries = Object.entries(counts).map(([country, available]) => ({ country, available }));
      const requests = rows(await supabaseRequest(`/rest/v1/automation_phone_country_requests?user_id=eq.${encodeURIComponent(user.id)}&select=country,contact_method,contact_value,wants_local_number,wants_whatsapp_calls,wants_forwarding_help&limit=300`).catch(() => []));
      const numbers = await assignedNumbers();
      const sip = numbers.some(item => item.imported) ? importDetails(await importTrunk()) : null;
      return json(200, { numbers, number: numbers[0] || null, countries, requests, sip });
    }

    // "pick" records that the owner looked at a country, so Hansora sees demand even if they leave.
    if (body.action === 'pick') {
      const country = String(body.country || '').toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) return json(400, { error: 'invalid_country' });
      await supabaseRequest('/rest/v1/automation_phone_country_requests?on_conflict=user_id,country', {
        method: 'POST',
        body: { user_id: user.id, email: user.email, business_id: businessId, country },
        prefer: 'resolution=ignore-duplicates,return=representation'
      });
      return json(200, { country });
    }

    // "contact": the owner leaves a WhatsApp, Telegram or email so Hansora can set things up with them.
    if (body.action === 'contact') {
      const country = String(body.country || '').toUpperCase();
      const method = String(body.method || '');
      const value = String(body.value || '').trim().slice(0, 200);
      const flags = [].concat(body.wants || []).map(item => CONTACT_WANTS[item]).filter(Boolean);
      if (!/^[A-Z]{2}$/.test(country) || !CONTACT_METHODS.has(method) || !flags.length) return json(400, { error: 'invalid_contact' });
      const valid = method === 'email' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) : method === 'whatsapp' ? /^\+?[\d\s()-]{7,20}$/.test(value) : /^@?[A-Za-z0-9_]{4,32}$|^\+?[\d\s()-]{7,20}$/.test(value);
      if (!valid) return json(400, { error: 'invalid_contact' });
      await supabaseRequest('/rest/v1/automation_phone_country_requests?on_conflict=user_id,country', {
        method: 'POST',
        body: { user_id: user.id, email: user.email, business_id: businessId, country, contact_method: method, contact_value: value, ...Object.fromEntries(flags.map(item => [item, true])), updated_at: new Date().toISOString() },
        prefer: 'resolution=merge-duplicates,return=representation'
      });
      return json(200, { country, method, value, wants: body.wants });
    }

    if (body.action === 'activate') {
      const hasRecord = value => Array.isArray(value) ? value.length > 0 : Boolean(value?.id);
      if (!hasRecord(business.automation_agents) || !hasRecord(business.automation_business_knowledge)) return json(409, { error: 'phone_agent_configuration_incomplete' });
      const country = String(body.country || '').toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) return json(400, { error: 'invalid_country' });
      const assign = async () => { const result = await supabaseRequest('/rest/v1/rpc/automation_assign_phone_number', { method: 'POST', body: { p_business: businessId, p_country: country } }); return Array.isArray(result) ? result[0] : result; };
      let number = await assign();
      const providers = numberProviders().filter(provider => provider.countries.includes(country));
      const failures = [];
      if (!number?.e164 && providers.length) {
        // Buying costs Hansora money every month, so only for an owner with credits.
        const profile = await first(`/rest/v1/profiles?user_id=eq.${encodeURIComponent(user.id)}&select=credits&limit=1`);
        if (!(Number(profile?.credits) > 0)) return json(402, { error: 'credits_required' });
        for (const provider of providers) {
          const bought = await provider.buy(country).catch(error => { console.error('phone number purchase failed', { provider: provider.name, message: error?.message, code: error?.code }); failures.push(`${provider.name}: ${error?.message || 'failed'}`); return null; });
          if (!bought) continue;
          // A number LiveKit does not accept would ring into nothing, so it is kept out of use until fixed by hand.
          const accepted = await acceptOnLiveKitTrunk(bought.e164, { trunkId: provider.trunkId }).then(() => true, error => { console.error('livekit trunk update failed', { message: error?.message }); return false; });
          await serviceInsert('automation_phone_numbers', { e164: bought.e164, country, provider: provider.name, provider_number_id: bought.providerNumberId, livekit_outbound_trunk_id: provider.outboundTrunkId || null, status: accepted ? 'available' : 'disabled', label: accepted ? null : 'Not on the LiveKit trunk yet' }, { ignoreDuplicates: true });
          if (!accepted) return json(503, { error: 'phone_line_setup_failed' });
          number = await assign();
          break;
        }
      }
      if (!number?.e164) return json(409, { error: 'no_number_available', ...(failures.length ? { detail: failures.join('; ').slice(0, 300) } : {}) });
      const numbers = await assignedNumbers();
      await syncChannel(numbers);
      await serviceUpdate('automation_channel_connections', `business_id=eq.${encodeURIComponent(businessId)}&channel_type=eq.phone&connected_at=is.null`, { provider: number.provider || 'phone', connected_at: new Date().toISOString() });
      return json(200, { number: publicNumber(number), numbers });
    }

    // "import_sip": the owner's own SIP number. Hansora gives them an address, username and password for their provider.
    if (body.action === 'import_sip') {
      const hasRecord = value => Array.isArray(value) ? value.length > 0 : Boolean(value?.id);
      if (!hasRecord(business.automation_agents) || !hasRecord(business.automation_business_knowledge)) return json(409, { error: 'phone_agent_configuration_incomplete' });
      const e164 = `+${String(body.e164 || '').replace(/\D/g, '')}`;
      const country = String(body.country || '').toUpperCase();
      if (!/^\+[1-9][0-9]{7,14}$/.test(e164)) return json(400, { error: 'invalid_number' });
      if (!/^[A-Z]{2}$/.test(country)) return json(400, { error: 'invalid_country' });
      const existing = await first(`/rest/v1/automation_phone_numbers?e164=eq.${encodeURIComponent(e164)}&select=business_id,provider&limit=1`);
      if (existing) return json(409, { error: existing.business_id === businessId ? 'number_already_added' : 'number_in_use' });
      if ((await assignedNumbers()).filter(item => item.imported).length >= MAX_IMPORTED_NUMBERS) return json(409, { error: 'too_many_imported_numbers' });
      // The row first: the unique e164 stops two owners claiming the same number at once.
      const inserted = await serviceInsert('automation_phone_numbers', { e164, country, provider: 'sip', status: 'assigned', business_id: businessId, assigned_at: new Date().toISOString(), label: 'Imported SIP number' }).catch(() => null);
      if (!(Array.isArray(inserted) ? inserted.length : inserted)) return json(409, { error: 'number_in_use' });
      const undo = () => supabaseRequest(`/rest/v1/automation_phone_numbers?e164=eq.${encodeURIComponent(e164)}&business_id=eq.${encodeURIComponent(businessId)}&provider=eq.sip`, { method: 'DELETE' }).catch(() => null);
      try {
        const trunk = await importTrunk();
        if (trunk) await syncImportTrunk(trunk);
        else {
          const credentials = newSipCredentials();
          const created = await createImportTrunk({ businessId, numbers: [e164], ...credentials });
          const secret = encryptSecret(credentials.password);
          await serviceInsert('automation_phone_sip_trunks', { business_id: businessId, livekit_trunk_id: created.trunkId, livekit_dispatch_rule_id: created.ruleId, auth_username: credentials.username, ...secret }).catch(async error => { await deleteImportTrunk({ trunkId: created.trunkId, ruleId: created.ruleId }); throw error; });
        }
      } catch (error) {
        console.error('sip import failed', { message: error?.message });
        await undo();
        return json(503, { error: 'phone_line_setup_failed' });
      }
      const numbers = await assignedNumbers();
      await syncChannel(numbers);
      await serviceUpdate('automation_channel_connections', `business_id=eq.${encodeURIComponent(businessId)}&channel_type=eq.phone&connected_at=is.null`, { provider: 'sip', connected_at: new Date().toISOString() });
      return json(200, { numbers, sip: importDetails(await importTrunk()) });
    }

    // Turns off one number (body.e164), or every number of the business when none is named.
    if (body.action === 'release') {
      const e164 = body.e164 ? String(body.e164).trim() : null;
      if (e164 && !/^\+[1-9][0-9]{7,14}$/.test(e164)) return json(400, { error: 'invalid_number' });
      await supabaseRequest('/rest/v1/rpc/automation_release_phone_number', { method: 'POST', body: { p_business: businessId, p_e164: e164 } });
      await syncImportTrunk(await importTrunk()).catch(error => console.error('sip import trunk update failed', { message: error?.message }));
      const numbers = await assignedNumbers();
      await syncChannel(numbers);
      return json(200, { number: numbers[0] || null, numbers });
    }
    return json(400, { error: 'invalid_action' });
  } catch (error) {
    console.error('automation-phone-line error', { message: error?.message, status: error?.status });
    return json(500, { error: 'phone_line_unavailable' });
  }
}
