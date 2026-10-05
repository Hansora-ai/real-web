import crypto from 'node:crypto';
import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { first, serviceInsert, supabaseRequest } from '../../lib/automation/db.mjs';
import { ensureTelegramWebhook, telegramBot } from '../../lib/automation/telegram.mjs';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

// "Connect Telegram": a one-time link (valid 30 minutes) opens Hansora's bot; pressing Start links the owner's
// Telegram account, then adding the bot in Telegram Business → Chatbots completes it (see automation-telegram-webhook).
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
    if (body.action === 'status') {
      const [channel, resource] = await Promise.all([
        first(`/rest/v1/automation_channel_connections?business_id=eq.${business.id}&channel_type=eq.telegram&select=status,connected_account_label,last_error_code&limit=1`),
        first(`/rest/v1/automation_provider_resources?business_id=eq.${business.id}&provider=eq.telegram&resource_type=eq.telegram_account&status=in.(pending,active)&select=status,safe_config&order=updated_at.desc&limit=1`)
      ]);
      return json(200, { status: channel?.status || 'not_connected', label: channel?.connected_account_label || '', error: channel?.last_error_code || null, linked: Boolean(resource?.safe_config?.telegram_user_id), premium_missing: resource?.safe_config?.premium === false && !resource?.safe_config?.telegram_user_id, step: resource?.status === 'active' ? 'connected' : resource?.safe_config?.telegram_user_id ? 'add_bot' : resource ? 'open_link' : 'start' });
    }
    if (body.action !== 'start') return json(400, { error: 'invalid_action' });
    let bot;
    try { bot = await telegramBot(); } catch (error) { return json(503, { error: 'telegram_not_configured', message: 'Telegram is not switched on for Hansora yet.' }); }
    const requestOrigin = (() => { try { return new URL(event.rawUrl || '').origin; } catch (_) { return ''; } })();
    await ensureTelegramWebhook(String(process.env.URL || requestOrigin)).catch(error => console.error('telegram webhook setup failed', { message: error?.message, providerMessage: error?.providerMessage }));
    // Only one open link per AI employee; an active connection stays until Telegram reports it removed.
    await supabaseRequest(`/rest/v1/automation_provider_resources?business_id=eq.${business.id}&provider=eq.telegram&resource_type=eq.telegram_account&status=eq.pending`, { method: 'DELETE' });
    const code = crypto.randomBytes(18).toString('base64url');
    await serviceInsert('automation_provider_resources', { business_id: business.id, provider: 'telegram', resource_type: 'telegram_account', provider_resource_id: `link:${code}`, status: 'pending', safe_config: { link_code: code, link_expires_at: new Date(Date.now() + 30 * 60000).toISOString() } });
    return json(200, { ok: true, link: `https://t.me/${bot.username}?start=${code}`, bot_username: bot.username, business_mode: bot.canConnectToBusiness });
  } catch (error) {
    console.error('automation-telegram-connect error', { message: error?.message });
    return json(500, { error: 'telegram_connect_failed', message: 'Telegram could not be prepared. Please try again.' });
  }
}
