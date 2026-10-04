// The AI sending catalog product photos into a chat (send_product_photos). Uploaded photos are private: they get a
// short-lived signed link that the channel downloads right away. The sent photo is recorded in the chat so the owner
// sees it in the inbox and the AI remembers it. It is stored under product_photo_* (never media_path), so the
// 30-day cleanup of customer media can never delete a product photo.
import crypto from 'node:crypto';
import * as db from './db.mjs';
import { MEDIA_BUCKET } from './media.mjs';

export async function productPhotoUrl(photo, fetchImpl = fetch) {
  if (/^https:\/\//i.test(String(photo?.url || ''))) return String(photo.url);
  if (!photo?.path) return '';
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
  const response = await fetchImpl(`${base}/storage/v1/object/sign/${MEDIA_BUCKET}/${String(photo.path).split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) });
  const data = await response.json().catch(() => ({}));
  const signed = data.signedURL || data.signedUrl || '';
  return response.ok && signed ? `${base}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}` : '';
}

// Returns the sendImage function given to the AI's actions. send({ url, caption }) does the channel-specific sending
// and returns { messageId }.
export function makeProductPhotoSender({ businessId, conversationId, provider, send }, overrides = {}) {
  const d = { serviceInsert: db.serviceInsert, fetchImpl: fetch, ...overrides };
  return async ({ photo, caption = '' }) => {
    const url = await productPhotoUrl(photo, d.fetchImpl);
    if (!url) throw new Error('product_photo_unavailable');
    const sent = await send({ url, caption: String(caption).slice(0, 200) });
    await d.serviceInsert('automation_messages', {
      business_id: businessId, conversation_id: conversationId, external_message_id: sent?.messageId || null,
      idempotency_key: `product-photo:${conversationId}:${crypto.randomUUID()}`, direction: 'outbound', sender_type: 'ai',
      content_type: 'image', content: `📷 ${caption || 'Product photo'}`, status: 'sent', billable: false, provider,
      provider_message_id: sent?.messageId || null,
      metadata: photo.path ? { product_photo_path: photo.path } : { product_photo_url: url }, occurred_at: new Date().toISOString()
    }).catch(error => console.warn('product photo not recorded', { message: error?.message }));
    return sent;
  };
}
