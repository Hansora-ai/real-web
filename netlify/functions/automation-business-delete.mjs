import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { first, rows, supabaseRequest } from '../../lib/automation/db.mjs';
import { deleteImportTrunk } from '../../lib/automation/sip-import.mjs';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// The owner deletes one AI employee for good. Its phone numbers are turned off first (Hansora's go back to the pool,
// imported ones are removed from LiveKit), then the business row is deleted; the database removes everything that
// belongs to it: channel connections and their tokens, chats, orders and bookings, products, automations, calls.
// The owner confirms by typing the AI employee's name.
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  try {
    const user = await authenticateRequest(event);
    if (!user) return json(401, { error: 'authentication_required' });
    if (Buffer.byteLength(event.body || '', 'utf8') > 4096) return json(413, { error: 'request_too_large' });
    let body; try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'invalid_json' }); }
    if (!isUuid(body.business_id)) return json(400, { error: 'invalid_business_id' });
    const business = await first(`/rest/v1/automation_businesses?id=eq.${body.business_id}&owner_user_id=eq.${user.id}&select=id,name&limit=1`);
    if (!business) return json(404, { error: 'business_not_found' });
    if (!sameName(body.confirm_name, String(business.name || '').trim() || 'DELETE')) return json(400, { error: 'name_does_not_match' });

    await supabaseRequest('/rest/v1/rpc/automation_release_phone_number', { method: 'POST', body: { p_business: business.id, p_e164: null } });
    const trunks = rows(await supabaseRequest(`/rest/v1/automation_phone_sip_trunks?business_id=eq.${business.id}&select=livekit_trunk_id,livekit_dispatch_rule_id`));
    for (const trunk of trunks) await deleteImportTrunk({ trunkId: trunk.livekit_trunk_id, ruleId: trunk.livekit_dispatch_rule_id }).catch(error => console.warn('business delete: trunk cleanup failed', { message: error?.message }));

    await supabaseRequest(`/rest/v1/automation_businesses?id=eq.${business.id}&owner_user_id=eq.${user.id}`, { method: 'DELETE' });
    return json(200, { ok: true });
  } catch (error) {
    console.error('automation-business-delete error', { message: error?.message, status: error?.status });
    return json(500, { error: 'delete_failed' });
  }
}
