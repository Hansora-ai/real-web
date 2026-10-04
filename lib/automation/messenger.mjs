// Facebook Messenger for a business's Facebook Page, through the same Meta app as WhatsApp (Facebook Login for
// Business). The owner picks a Page; Hansora stores that Page's token (encrypted) and answers its Messenger chats.
import crypto from 'node:crypto';

function required(name, fallback = '') {
  const value = String(process.env[name] || fallback || '').trim();
  if (!value) throw Object.assign(new Error(`missing_${name.toLowerCase()}`), { status: 503 });
  return value;
}
export function messengerConfig() {
  return {
    appId: required('META_WHATSAPP_APP_ID', process.env.META_APP_ID),
    appSecret: required('META_WHATSAPP_APP_SECRET', process.env.META_APP_SECRET),
    configurationId: String(process.env.META_MESSENGER_CONFIGURATION_ID || '').trim(),
    verifyToken: required('META_MESSENGER_WEBHOOK_VERIFY_TOKEN', process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN),
    graphVersion: String(process.env.META_GRAPH_VERSION || 'v23.0').replace(/^\/?/, '')
  };
}

async function graph(path, { method = 'GET', params = {}, body, token = '', fetchImpl = fetch, error = 'messenger_request_failed' } = {}) {
  const config = messengerConfig();
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${path.replace(/^\//, '')}`);
  url.search = new URLSearchParams(params).toString();
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  const response = await fetchImpl(url, { method, headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal }).finally(() => clearTimeout(timer));
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw Object.assign(new Error(error), { status: response.status >= 500 ? 502 : 400, providerStatus: response.status, providerMessage: String(data.error?.message || '').slice(0, 300), providerCode: data.error?.code });
  return data;
}

// Facebook Login for Business returns a one-time code; it becomes a long-lived user token (about 60 days),
// from which each Page's token is read (Page tokens from a long-lived user token do not expire).
export async function exchangeMessengerCode(code, fetchImpl = fetch) {
  const config = messengerConfig();
  const short = await graph('oauth/access_token', { params: { client_id: config.appId, client_secret: config.appSecret, code: String(code) }, fetchImpl, error: 'messenger_code_exchange_failed' });
  if (!short.access_token) throw Object.assign(new Error('messenger_token_missing'), { status: 502 });
  const long = await graph('oauth/access_token', { params: { grant_type: 'fb_exchange_token', client_id: config.appId, client_secret: config.appSecret, fb_exchange_token: short.access_token }, fetchImpl, error: 'messenger_token_exchange_failed' }).catch(() => null);
  return String(long?.access_token || short.access_token);
}
export async function listMessengerPages(userToken, fetchImpl = fetch) {
  const data = await graph('me/accounts', { params: { fields: 'id,name,picture{url},access_token,tasks', limit: '100' }, token: userToken, fetchImpl, error: 'messenger_pages_failed' });
  return (Array.isArray(data.data) ? data.data : []).filter(page => page.id && page.access_token).map(page => ({ id: String(page.id), name: String(page.name || ''), picture: String(page.picture?.data?.url || ''), token: String(page.access_token), canMessage: !Array.isArray(page.tasks) || page.tasks.includes('MESSAGING') || page.tasks.includes('MODERATE') }));
}
export function subscribeMessengerPage({ pageId, pageToken, fetchImpl = fetch }) {
  return graph(`${pageId}/subscribed_apps`, { method: 'POST', params: { subscribed_fields: 'messages,messaging_postbacks,message_echoes' }, token: pageToken, fetchImpl, error: 'messenger_subscribe_failed' });
}
export async function sendMessengerText({ pageId, pageToken, recipientId, text, fetchImpl = fetch }) {
  const data = await graph(`${pageId}/messages`, { method: 'POST', body: { recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text: String(text).slice(0, 2000) } }, token: pageToken, fetchImpl, error: 'messenger_send_failed' });
  return { messageId: String(data.message_id || '') };
}
export function sendMessengerAction({ pageId, pageToken, recipientId, action = 'typing_on', fetchImpl = fetch }) {
  return graph(`${pageId}/messages`, { method: 'POST', body: { recipient: { id: recipientId }, sender_action: action }, token: pageToken, fetchImpl, error: 'messenger_action_failed' });
}
export async function getMessengerProfile({ senderId, pageToken, fetchImpl = fetch }) {
  try {
    const data = await graph(senderId, { params: { fields: 'first_name,last_name,profile_pic' }, token: pageToken, fetchImpl });
    return { name: [data.first_name, data.last_name].filter(Boolean).join(' '), picture: /^https:\/\//.test(data.profile_pic || '') ? data.profile_pic : '' };
  } catch (_) { return null; }
}

export function verifyMessengerSignature(rawBody, header) {
  const signature = String(header || '');
  if (!signature.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', messengerConfig().appSecret).update(String(rawBody || '')).digest('hex')}`;
  const a = Buffer.from(signature), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Page webhook → customer messages and "echoes" (messages the Page sent). Echoes sent by Hansora itself are ignored;
// echoes from the Page inbox / Meta Business Suite are the team replying by hand.
export function extractMessengerEvents(payload, ownAppId = '') {
  if (!payload || payload.object !== 'page' || !Array.isArray(payload.entry)) return [];
  const output = [];
  for (const entry of payload.entry) {
    for (const event of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const message = event.message || {}, postback = event.postback || {};
      const pageId = String(entry.id || '');
      if (message.is_echo) {
        if (String(message.app_id || '') === String(ownAppId) || !message.mid) continue;
        output.push({ type: 'echo', externalEventId: String(message.mid), pageId, customerId: String(event.recipient?.id || ''), text: String(message.text || (message.attachments?.length ? '📎 Sent an attachment' : '')).slice(0, 24000), timestamp: Number(event.timestamp || Date.now()) });
        continue;
      }
      if (!event.sender?.id || event.sender.id === pageId || message.is_deleted) continue;
      const attachment = Array.isArray(message.attachments) ? message.attachments[0] : null;
      const text = String(message.text || postback.title || '').trim();
      if (!text && !attachment) continue;
      output.push({ type: 'message', externalEventId: String(message.mid || postback.mid || `postback:${event.sender.id}:${event.timestamp}`), pageId, senderId: String(event.sender.id), text: text.slice(0, 24000), attachmentType: String(attachment?.type || ''), attachmentUrl: String(attachment?.payload?.url || '').slice(0, 1500), quickReplyPayload: String(message.quick_reply?.payload || postback.payload || '').slice(0, 1000), timestamp: Number(event.timestamp || Date.now()) });
    }
  }
  return output;
}
