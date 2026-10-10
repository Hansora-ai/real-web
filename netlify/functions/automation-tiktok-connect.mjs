import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { first } from '../../lib/automation/db.mjs';
import { signTikTokState, tiktokAuthorizationUrl } from '../../lib/automation/tiktok.mjs';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

export function tiktokRedirectUri(event) {
  const site = String(process.env.URL || (() => { try { return new URL(event.rawUrl || '').origin; } catch (_) { return ''; } })()).replace(/\/$/, '');
  return `${site}/.netlify/functions/automation-tiktok-callback`;
}

// "Connect TikTok": returns TikTok's authorization page for this AI employee. TikTok sends the owner back to
// automation-tiktok-callback, which stores the account.
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
    let url;
    try { url = tiktokAuthorizationUrl({ redirectUri: tiktokRedirectUri(event), state: signTikTokState({ businessId: business.id, userId: user.id }) }); }
    catch (_) { return json(503, { error: 'tiktok_not_configured', message: 'TikTok is not switched on for Hansora yet. It opens as soon as TikTok approves Hansora.' }); }
    return json(200, { url });
  } catch (error) {
    console.error('automation-tiktok-connect error', { message: error?.message });
    return json(Number(error?.status) || 500, { error: 'tiktok_connect_failed', message: 'TikTok could not be connected. Please try again.' });
  }
}
