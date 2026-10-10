// TikTok Business Messaging (TikTok API for Business, v1.3): a business owner connects their own TikTok Business
// account; customers' direct messages are answered by the AI employee like on Instagram.
// Webhook events only tell us WHICH conversation changed. The messages themselves are always read from TikTok's API
// with the business's own token, so a fake webhook can never inject content, and any webhook shape works.
import crypto from 'node:crypto';

const API = 'https://business-api.tiktok.com/open_api/v1.3/';
export const TIKTOK_TEXT_LIMIT = 6000;

export function tiktokConfig() {
  const appId = String(process.env.TIKTOK_APP_ID || '').trim();
  const secret = String(process.env.TIKTOK_APP_SECRET || '').trim();
  if (!appId || !secret) throw Object.assign(new Error('tiktok_not_configured'), { status: 503 });
  // The "TikTok account holder authorization URL" copied from the app page in the TikTok for Business developer
  // portal. redirect_uri and state are set here.
  const authUrl = String(process.env.TIKTOK_AUTH_URL || '').trim();
  return { appId, secret, authUrl };
}

export function tiktokAuthorizationUrl({ redirectUri, state }) {
  const { appId, authUrl } = tiktokConfig();
  if (!/^https:\/\//.test(authUrl)) throw Object.assign(new Error('tiktok_auth_url_missing'), { status: 503 });
  const url = new URL(authUrl);
  if (!url.searchParams.get('app_id') && !url.searchParams.get('client_key')) url.searchParams.set('app_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

async function call(path, { token = '', method = 'GET', query = null, body = null, form = null, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const url = new URL(path, API);
  for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  const headers = { Accept: 'application/json', ...(token ? { 'Access-Token': token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) };
  const response = await fetchImpl(url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(timeoutMs) });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || Number(payload.code) !== 0) {
    const error = new Error('tiktok_request_failed');
    error.status = response.status >= 500 || !response.ok ? 502 : 400;
    error.providerStatus = response.status;
    error.providerCode = payload?.code ?? null;
    error.providerMessage = String(payload?.message || '').slice(0, 300) || null;
    throw error;
  }
  return payload.data ?? {};
}

const tokenFields = data => ({
  accessToken: String(data.access_token || ''), refreshToken: String(data.refresh_token || ''),
  expiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : null,
  refreshExpiresAt: data.refresh_token_expires_in ? new Date(Date.now() + Number(data.refresh_token_expires_in) * 1000).toISOString() : null,
  businessId: String(data.open_id || ''), scope: data.scope ?? null
});

export async function exchangeTikTokCode({ code, redirectUri, fetchImpl = fetch }) {
  const { appId, secret } = tiktokConfig();
  const data = await call('tt_user/oauth2/token/', { method: 'POST', body: { client_id: appId, client_secret: secret, grant_type: 'authorization_code', auth_code: code, redirect_uri: redirectUri }, fetchImpl });
  const tokens = tokenFields(data);
  if (!tokens.accessToken || !tokens.businessId) throw Object.assign(new Error('tiktok_token_missing'), { status: 502 });
  return tokens;
}

export async function refreshTikTokToken({ refreshToken, fetchImpl = fetch }) {
  const { appId, secret } = tiktokConfig();
  return tokenFields(await call('tt_user/oauth2/refresh_token/', { method: 'POST', body: { client_id: appId, client_secret: secret, grant_type: 'refresh_token', refresh_token: refreshToken }, fetchImpl }));
}

// Name, @username and photo of the connected Business Account (best effort; the connection works without it).
export async function getTikTokBusinessProfile({ businessId, token, fetchImpl = fetch }) {
  try {
    const data = await call('business/get/', { token, query: { business_id: businessId, fields: ['username', 'display_name', 'profile_image'] }, fetchImpl });
    return { username: String(data.username || ''), name: String(data.display_name || ''), picture: /^https:\/\//.test(String(data.profile_image || '')) ? String(data.profile_image) : '' };
  } catch (_) { return { username: '', name: '', picture: '' }; }
}

export async function listTikTokMessages({ businessId, conversationId, token, fetchImpl = fetch }) {
  const data = await call('business/message/content/list/', { token, query: { business_id: businessId, conversation_id: conversationId }, fetchImpl });
  return { messages: Array.isArray(data.messages) ? data.messages : [], participants: Array.isArray(data.participants) ? data.participants : [] };
}

export async function sendTikTokText({ businessId, conversationId, text, token, fetchImpl = fetch }) {
  const body = String(text || '').slice(0, TIKTOK_TEXT_LIMIT);
  const data = await call('business/message/send/', { method: 'POST', token, body: { business_id: businessId, recipient_type: 'CONVERSATION', recipient: conversationId, message_type: 'TEXT', text: { body } }, fetchImpl });
  return { messageId: String(data?.message?.message_id || '') };
}

// "Typing…" shows for about five seconds; keepTyping repeats it while the AI prepares the answer.
export async function sendTikTokTyping({ businessId, conversationId, token, fetchImpl = fetch }) {
  await call('business/message/send/', { method: 'POST', token, body: { business_id: businessId, recipient_type: 'CONVERSATION', recipient: conversationId, message_type: 'SENDER_ACTION', sender_action: 'TYPING' }, fetchImpl, timeoutMs: 8000 });
}

// Product photos: TikTok needs the image uploaded first (JPG/PNG), then sent by its media_id.
export async function sendTikTokImage({ businessId, conversationId, url, token, fetchImpl = fetch }) {
  const file = await fetchImpl(url, { signal: AbortSignal.timeout(20000) });
  if (!file.ok) throw Object.assign(new Error('tiktok_image_unavailable'), { status: 502 });
  const type = String(file.headers.get('content-type') || 'image/jpeg').split(';')[0];
  if (!['image/jpeg', 'image/png'].includes(type)) throw Object.assign(new Error('tiktok_image_type_not_supported'), { status: 400 });
  const form = new FormData();
  form.append('business_id', businessId); form.append('media_type', 'IMAGE');
  form.append('file', new Blob([await file.arrayBuffer()], { type }), type === 'image/png' ? 'photo.png' : 'photo.jpg');
  const uploaded = await call('business/message/media/upload/', { method: 'POST', token, form, fetchImpl, timeoutMs: 30000 });
  if (!uploaded.media_id) throw Object.assign(new Error('tiktok_image_upload_failed'), { status: 502 });
  const data = await call('business/message/send/', { method: 'POST', token, body: { business_id: businessId, recipient_type: 'CONVERSATION', recipient: conversationId, message_type: 'IMAGE', image: { media_id: uploaded.media_id } }, fetchImpl });
  return { messageId: String(data?.message?.message_id || '') };
}

// A temporary link to a photo or video a customer sent, so the AI can look at it.
export async function tiktokMediaUrl({ businessId, conversationId, messageId, mediaId, mediaType, token, fetchImpl = fetch }) {
  const data = await call('business/message/media/download/', { method: 'POST', token, body: { business_id: businessId, conversation_id: conversationId, message_id: messageId, media_id: mediaId, media_type: mediaType }, fetchImpl });
  return /^https:\/\//.test(String(data.download_url || '')) ? String(data.download_url) : '';
}

// One TikTok message in the shape the processor uses. Customers are PERSONAL_ACCOUNT, the business is BUSINESS_ACCOUNT.
export function readTikTokMessage(message = {}) {
  const type = String(message.message_type || message.MessageType || 'OTHER').toUpperCase();
  const from = message.from_user || {};
  const media = type === 'IMAGE' ? message.image : type === 'VIDEO' ? message.video : null;
  return {
    id: String(message.message_id || ''),
    conversationId: String(message.conversation_id || ''),
    fromBusiness: String(from.role || '').toUpperCase() === 'BUSINESS_ACCOUNT',
    customerId: String((String(from.role || '').toUpperCase() === 'BUSINESS_ACCOUNT' ? message.to_user?.id : from.id) || ''),
    customerName: String((String(from.role || '').toUpperCase() === 'BUSINESS_ACCOUNT' ? message.to_user?.display_name : from.display_name) || ''),
    customerPicture: String((String(from.role || '').toUpperCase() === 'BUSINESS_ACCOUNT' ? message.to_user?.profile_image : from.profile_image) || ''),
    type, text: String(message.text?.body || ''),
    mediaId: String(media?.media_id || ''), mediaType: type,
    postUrl: String(message.share_post?.embed_url || ''),
    automatic: Boolean(message.auto_message_type),
    timestamp: Number(message.timestamp) || Date.now()
  };
}

// The webhook only has to tell us which Business Account and conversation changed. TikTok's exact event shape is
// read defensively (any nesting); messages are fetched from the API afterwards.
export function extractTikTokEvents(payload) {
  const found = new Map();
  const visit = (node, businessHint = '') => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(item => visit(item, businessHint)); return; }
    let business = String(node.business_id || node.user_openid || node.open_id || businessHint || '');
    for (const side of [node.to_user, node.from_user]) if (!business && String(side?.role || '').toUpperCase() === 'BUSINESS_ACCOUNT' && side.id) business = String(side.id);
    const conversation = String(node.conversation_id || '');
    if (conversation && business) found.set(`${business}|${conversation}`, { businessId: business, conversationId: conversation, messageId: String(node.message_id || '') });
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') visit(value, business);
      else if (typeof value === 'string' && value.trim().startsWith('{')) { try { visit(JSON.parse(value), business); } catch (_) {} }
    }
  };
  visit(payload);
  return [...found.values()];
}

// TikTok signs webhooks as "t=<unix>,s=<hex>" over "<t>.<body>" with the app secret. A request without the header is
// accepted (the content is never trusted anyway); a wrong signature is rejected.
export function tiktokSignatureState(rawBody, header, secret = String(process.env.TIKTOK_APP_SECRET || '')) {
  const value = String(header || '');
  if (!value) return 'absent';
  const parts = Object.fromEntries(value.split(',').map(item => item.trim().split('=')));
  if (!parts.t || !parts.s || !secret) return 'invalid';
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(String(parts.s));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'valid' : 'invalid';
}

// Signed, short-lived "state" for the connect redirect (which business, which owner).
export function signTikTokState({ businessId, userId }, secret = String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET || '')) {
  const body = Buffer.from(JSON.stringify({ b: businessId, u: userId, e: Date.now() + 15 * 60000 })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function readTikTokState(state, secret = String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET || '')) {
  const [body, mac] = String(state || '').split('.');
  if (!body || !mac || !secret) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (expected.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null;
  try { const data = JSON.parse(Buffer.from(body, 'base64url').toString()); return data.e > Date.now() ? { businessId: data.b, userId: data.u } : null; } catch (_) { return null; }
}
