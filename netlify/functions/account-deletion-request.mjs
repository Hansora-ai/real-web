import { authenticateRequest } from '../../lib/sales-agent/auth.mjs';
import { supabaseRequest } from '../../lib/automation/db.mjs';

// "Delete account" from the Hansora phone app (Apple 5.1.1(v), Google Play account deletion).
// The signed-in person asks to delete either their Automation data (AI employees, chats, orders) or their whole
// Hansora account. The request is stored (public.account_deletion_requests) and the owner gets a Telegram message
// (same settings as the sale alert) to complete it within 30 days. Nothing is deleted automatically.
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
export const SCOPES = ['automation', 'account'];

export function deletionMessage({ scope, email, userId }) {
  return [scope === 'account' ? '🗑 Delete WHOLE Hansora account' : '🗑 Delete Automation data only', email || '(no email)', `user ${userId}`, 'Requested in the app · complete within 30 days'].join('\n');
}

async function tellOwner(text) {
  const chatId = String(process.env.SALES_TELEGRAM_CHAT_ID || '').trim();
  const token = String(process.env.SALES_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!chatId || !token) return false;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000),
      body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
    });
    return response.ok;
  } catch (_) { return false; }
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  try {
    const user = await authenticateRequest(event);
    if (!user) return json(401, { error: 'authentication_required' });
    let body; try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'invalid_json' }); }
    const scope = String(body.scope || '');
    if (!SCOPES.includes(scope)) return json(400, { error: 'invalid_scope' });
    try {
      await supabaseRequest('/rest/v1/account_deletion_requests', { method: 'POST', body: { user_id: user.id, email: user.email || null, scope, source: 'app' }, prefer: 'return=minimal' });
    } catch (error) {
      // Already requested: the open request stays as it is.
      if (error?.status !== 409) throw error;
      return json(200, { ok: true, scope, already_requested: true });
    }
    await tellOwner(deletionMessage({ scope, email: user.email, userId: user.id }));
    return json(200, { ok: true, scope });
  } catch (error) {
    console.error('account deletion request failed', { message: error?.message });
    return json(500, { error: 'deletion_request_failed' });
  }
}
