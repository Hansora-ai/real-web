import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { first } from '../../lib/automation/db.mjs';
import { MEDIA_BUCKET } from '../../lib/automation/media.mjs';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

// Short-lived links to the photos and voice notes customers sent, for the owner's inbox only. The files are in a
// private bucket; a path is only signed when it belongs to one of the owner's AI employees.
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
    const prefix = `${business.id}/`;
    const paths = [...new Set((Array.isArray(body.paths) ? body.paths : []).map(String))].filter(path => path.startsWith(prefix) && !path.includes('..') && path.length < 400).slice(0, 50);
    if (!paths.length) return json(200, { urls: {} });
    const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
    const response = await fetch(`${base}/storage/v1/object/sign/${MEDIA_BUCKET}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600, paths }) });
    const result = await response.json().catch(() => []);
    if (!response.ok) { console.error('automation-media-url sign failed', { status: response.status }); return json(502, { error: 'media_unavailable' }); }
    const urls = {};
    for (const item of Array.isArray(result) ? result : []) if (item?.path && item.signedURL) urls[item.path] = `${base}/storage/v1${item.signedURL.startsWith('/') ? '' : '/'}${item.signedURL}`;
    return json(200, { urls });
  } catch (error) {
    console.error('automation-media-url error', { message: error?.message });
    return json(500, { error: 'media_unavailable' });
  }
}
