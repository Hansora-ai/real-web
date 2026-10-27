// Customers' profile photos (Instagram, Messenger, TikTok). The links these platforms give expire after a few days,
// so Hansora keeps its own small copy in a public bucket and saves that link on the contact: the Inbox and Contacts
// show the photo straight from storage, with no extra request. Path: <business>/<channel>-<customer>.<ext>.
import crypto from 'node:crypto';

export const AVATAR_BUCKET = 'automation-avatars';
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_BYTES = 2 * 1024 * 1024;

function storage() {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
  return { base, key };
}

// True for a photo already kept by Hansora (it never expires, so it is not looked up again).
export function isKeptAvatar(url) {
  const { base } = storage();
  return Boolean(base) && String(url || '').startsWith(`${base}/storage/v1/object/public/${AVATAR_BUCKET}/`);
}

// Downloads the photo and stores Hansora's copy. Returns the permanent link, or the original link when it could not
// be copied (so nothing is lost; it will be tried again next time).
export async function keepAvatar({ url, businessId, channel, customerId, fetchImpl = fetch }) {
  const original = /^https:\/\//.test(String(url || '')) ? String(url) : '';
  if (!original || isKeptAvatar(original)) return original;
  const { base, key } = storage();
  if (!base || !key || !/^[0-9a-f-]{36}$/i.test(String(businessId))) return original;
  try {
    const response = await fetchImpl(original, { signal: AbortSignal.timeout(5000) });
    const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!response.ok || !TYPES[type]) return original;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_BYTES) return original;
    const name = `${String(channel).replace(/[^a-z_]/g, '')}-${crypto.createHash('sha256').update(String(customerId)).digest('hex').slice(0, 32)}`;
    const path = `${businessId}/${name}.${TYPES[type]}`;
    const upload = await fetchImpl(`${base}/storage/v1/object/${AVATAR_BUCKET}/${path}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': type, 'Cache-Control': 'max-age=86400', 'x-upsert': 'true' }, body: buffer, signal: AbortSignal.timeout(8000) });
    if (!upload.ok) { console.warn('avatar copy not stored', { status: upload.status }); return original; }
    // The version makes browsers show a changed photo at once (same path when a customer changes their photo).
    return `${base}/storage/v1/object/public/${AVATAR_BUCKET}/${path}?v=${Date.now().toString(36)}`;
  } catch (error) { console.warn('avatar copy not stored', { message: error?.message }); return original; }
}
