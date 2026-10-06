import crypto from 'node:crypto';
import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { first } from '../../lib/automation/db.mjs';
import { MEDIA_BUCKET } from '../../lib/automation/media.mjs';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Product photos (private, next to the chat media): upload one, or delete some. Path: <business>/products/<product>/<random>.<ext>
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
    const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    if (body.action === 'delete') {
      const paths = (Array.isArray(body.paths) ? body.paths : []).map(String).filter(path => path.startsWith(`${business.id}/products/`) && !path.includes('..')).slice(0, 20);
      if (paths.length) await fetch(`${base}/storage/v1/object/${MEDIA_BUCKET}`, { method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) });
      return json(200, { ok: true, deleted: paths.length });
    }
    if (!isUuid(body.product_id)) return json(400, { error: 'invalid_product_id' });
    const type = String(body.content_type || '');
    if (!TYPES[type]) return json(400, { error: 'photo_type_not_supported', message: 'Use a JPG, PNG or WebP photo.' });
    const buffer = Buffer.from(String(body.content_base64 || ''), 'base64');
    if (!buffer.length) return json(400, { error: 'photo_empty' });
    if (buffer.length > 4 * 1024 * 1024) return json(413, { error: 'photo_too_large', message: 'The photo is larger than 4 MB.' });
    const path = `${business.id}/products/${body.product_id}/${crypto.randomUUID()}.${TYPES[type]}`;
    const response = await fetch(`${base}/storage/v1/object/${MEDIA_BUCKET}/${path}`, { method: 'POST', headers: { ...headers, 'Content-Type': type }, body: buffer });
    if (!response.ok) { console.error('product photo upload failed', { status: response.status }); return json(502, { error: 'photo_upload_failed', message: 'The photo could not be saved. Please try again.' }); }
    return json(200, { ok: true, path });
  } catch (error) {
    console.error('automation-product-photo error', { message: error?.message });
    return json(500, { error: 'photo_upload_failed', message: 'The photo could not be saved. Please try again.' });
  }
}
