import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { first } from '../../lib/automation/db.mjs';
import { listTikTokVideos } from '../../lib/automation/tiktok.mjs';
import { tiktokAccountFor, tiktokTokenFor } from '../../lib/automation/tiktok-account.mjs';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

// The connected TikTok account's videos, newest first, for the "choose videos" picker of a TikTok comment automation.
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  try {
    const user = await authenticateRequest(event);
    if (!user) return json(401, { error: 'authentication_required' });
    let body; try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'invalid_json' }); }
    if (!isUuid(body.business_id)) return json(400, { error: 'invalid_business_id' });
    const business = await first(`/rest/v1/automation_businesses?id=eq.${encodeURIComponent(body.business_id)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`);
    if (!business) return json(404, { error: 'business_not_found' });
    const account = await tiktokAccountFor({ businessId: business.id });
    if (!account) return json(409, { error: 'tiktok_not_connected', message: 'Connect your TikTok account first.' });
    const cursor = /^\d{1,16}$/.test(String(body.cursor || '')) ? Number(body.cursor) : null;
    const page = await listTikTokVideos({ businessId: account.provider_resource_id, token: await tiktokTokenFor(account), cursor });
    return json(200, { media: page.videos, cursor: page.hasMore ? page.cursor : null });
  } catch (error) {
    console.error('automation-tiktok-media error', { message: error?.message, providerCode: error?.providerCode, providerMessage: error?.providerMessage });
    return json(Number(error?.status) || 500, { error: Number(error?.status) >= 500 ? 'tiktok_videos_unavailable' : String(error?.message || 'tiktok_videos_failed') });
  }
}
