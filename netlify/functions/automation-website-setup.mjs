// The owner's Website chat settings (dashboard → AI employee → Channels → Website).
// POST { business_id, action: 'get' }  → settings, status and the script tag to paste (creates the widget key once).
// POST { business_id, action: 'save', settings } → checks and saves them.
// POST { business_id, action: 'live' | 'pause' } → turns the chat bubble on or off on the owner's websites.
import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { first, serviceUpdate, serviceUpsert } from '../../lib/automation/db.mjs';
import { sanitizeSettings, snippet } from '../../lib/automation/website.mjs';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  try {
    const user = await authenticateRequest(event); if (!user) return json(401, { error: 'authentication_required' });
    let body; try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'invalid_json' }); }
    if (!isUuid(body.business_id)) return json(400, { error: 'invalid_business_id' });
    const business = await first(`/rest/v1/automation_businesses?id=eq.${body.business_id}&owner_user_id=eq.${user.id}&select=id,name&limit=1`);
    if (!business) return json(404, { error: 'business_not_found' });
    let connection = await first(`/rest/v1/automation_channel_connections?business_id=eq.${business.id}&channel_type=eq.website&select=*&limit=1`);
    const site = String(process.env.URL || 'https://hansora.co').replace(/\/$/, '');
    const view = row => ({ status: row.status, settings: row.settings, snippet: snippet({ site, key: row.settings.widget_key }), business_name: business.name });

    // First visit: the row exists for every business (migration 34), the widget key is made once and kept.
    if (!connection || !connection.settings?.widget_key) {
      const settings = sanitizeSettings({ ...(connection?.settings || {}), title: connection?.settings?.title || business.name }, connection?.settings || {});
      connection = await serviceUpsert('automation_channel_connections', 'business_id,channel_type', { business_id: business.id, channel_type: 'website', setup_order: 8, status: connection?.status || 'not_connected', settings, updated_at: new Date().toISOString() });
    }
    if (body.action === 'get') return json(200, view(connection));

    if (body.action === 'save') {
      const settings = sanitizeSettings(body.settings || {}, connection.settings || {});
      // A live bubble needs at least one website; removing the last one pauses it.
      const status = connection.status === 'connected' && !settings.allowed_domains.length ? 'paused' : connection.status;
      const saved = await serviceUpdate('automation_channel_connections', `id=eq.${connection.id}`, { settings, status, connected_account_label: settings.allowed_domains[0] || null, updated_at: new Date().toISOString() });
      return json(200, view(Array.isArray(saved) ? saved[0] || { ...connection, settings, status } : saved || { ...connection, settings, status }));
    }

    if (body.action === 'live' || body.action === 'pause') {
      if (body.action === 'live' && !(connection.settings?.allowed_domains || []).length) return json(400, { error: 'add_a_website_first', message: 'Add the website where you put the chat bubble first.' });
      const status = body.action === 'live' ? 'connected' : 'paused';
      const saved = await serviceUpdate('automation_channel_connections', `id=eq.${connection.id}`, { status, ...(status === 'connected' && !connection.connected_at ? { connected_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString() });
      return json(200, view(Array.isArray(saved) ? saved[0] || { ...connection, status } : saved || { ...connection, status }));
    }
    return json(400, { error: 'unknown_action' });
  } catch (error) {
    console.error('automation-website-setup error', { message: error?.message, status: error?.status });
    return json(Number(error?.status) || 500, { error: 'website_setup_failed' });
  }
}
