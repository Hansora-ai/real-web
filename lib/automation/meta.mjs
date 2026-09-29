import crypto from 'node:crypto';
import { safeEqual, sha256 } from './crypto.mjs';

const INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments'
];

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) { const error = new Error(`missing_${name.toLowerCase()}`); error.status = 503; throw error; }
  return value;
}

export function metaConfig() {
  return {
    appId: required('META_INSTAGRAM_APP_ID'),
    appSecret: required('META_INSTAGRAM_APP_SECRET'),
    redirectUri: required('META_INSTAGRAM_REDIRECT_URI'),
    verifyToken: required('META_WEBHOOK_VERIFY_TOKEN'),
    oauthSecret: required('HANSORA_AUTOMATION_OAUTH_SECRET'),
    graphVersion: String(process.env.META_GRAPH_VERSION || 'v23.0').replace(/^\/?/, '')
  };
}

function encodePart(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
export function createOAuthState(payload, now = Date.now()) {
  const config = metaConfig();
  const body = encodePart({ ...payload, provider: 'meta_instagram', nonce: crypto.randomBytes(18).toString('base64url'), iat: now, exp: now + 10 * 60 * 1000 });
  const signature = crypto.createHmac('sha256', config.oauthSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyOAuthState(state, now = Date.now()) {
  const config = metaConfig();
  const [body, signature, extra] = String(state || '').split('.');
  if (!body || !signature || extra) throw Object.assign(new Error('invalid_oauth_state'), { status: 400 });
  const expected = crypto.createHmac('sha256', config.oauthSecret).update(body).digest('base64url');
  if (!safeEqual(signature, expected)) throw Object.assign(new Error('invalid_oauth_state'), { status: 400 });
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (_) { throw Object.assign(new Error('invalid_oauth_state'), { status: 400 }); }
  if (payload.provider !== 'meta_instagram' || !payload.business_id || !payload.user_id || Number(payload.exp) < now) throw Object.assign(new Error('expired_oauth_state'), { status: 400 });
  return payload;
}

export function oauthStateHash(state) { return sha256(state); }

export function buildInstagramAuthorizationUrl(state) {
  const config = metaConfig();
  const url = new URL('https://www.instagram.com/oauth/authorize');
  url.search = new URLSearchParams({
    enable_fb_login: '0', force_authentication: '1', client_id: config.appId,
    redirect_uri: config.redirectUri, response_type: 'code',
    scope: INSTAGRAM_SCOPES.join(','), state
  }).toString();
  return url.toString();
}

async function jsonResponse(response, publicError) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(publicError); error.status = response.status >= 500 ? 502 : 400; error.providerStatus = response.status; throw error; }
  return body;
}

export async function exchangeInstagramCode(code, fetchImpl = fetch) {
  const config = metaConfig();
  const shortResponse = await fetchImpl('https://api.instagram.com/oauth/access_token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.appId, client_secret: config.appSecret, grant_type: 'authorization_code', redirect_uri: config.redirectUri, code: String(code) })
  });
  const short = await jsonResponse(shortResponse, 'instagram_code_exchange_failed');
  if (!short.access_token) throw Object.assign(new Error('instagram_token_missing'), { status: 502 });
  const longUrl = new URL('https://graph.instagram.com/access_token');
  longUrl.search = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: config.appSecret, access_token: short.access_token }).toString();
  const long = await jsonResponse(await fetchImpl(longUrl, { headers: { Accept: 'application/json' } }), 'instagram_long_token_failed');
  return { accessToken: long.access_token || short.access_token, expiresIn: Number(long.expires_in || short.expires_in || 0), instagramUserId: String(short.user_id || '') };
}

export async function getInstagramProfile(accessToken, fetchImpl = fetch) {
  const config = metaConfig();
  const url = new URL(`https://graph.instagram.com/${config.graphVersion}/me`);
  url.search = new URLSearchParams({ fields: 'user_id,username,account_type', access_token: accessToken }).toString();
  const data = await jsonResponse(await fetchImpl(url, { headers: { Accept: 'application/json' } }), 'instagram_profile_failed');
  const id = String(data.user_id || data.id || '');
  if (!id) throw Object.assign(new Error('instagram_profile_id_missing'), { status: 502 });
  return { id, username: String(data.username || ''), accountType: String(data.account_type || '') };
}

// Meta only sends DM and comment webhooks for an account after the app subscribes to it.
export const INSTAGRAM_WEBHOOK_FIELDS = ['messages', 'messaging_postbacks', 'messaging_seen', 'comments'];
export async function subscribeInstagramWebhooks(accessToken, fetchImpl = fetch) {
  const config = metaConfig();
  const url = new URL(`https://graph.instagram.com/${config.graphVersion}/me/subscribed_apps`);
  url.search = new URLSearchParams({ subscribed_fields: INSTAGRAM_WEBHOOK_FIELDS.join(','), access_token: accessToken }).toString();
  const data = await jsonResponse(await fetchImpl(url, { method: 'POST', headers: { Accept: 'application/json' } }), 'instagram_webhook_subscription_failed');
  if (data?.success === false) throw Object.assign(new Error('instagram_webhook_subscription_failed'), { status: 502 });
  return true;
}

export function verifyMetaSignature(rawBody, signatureHeader) {
  const signature = String(signatureHeader || '');
  if (!signature.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', metaConfig().appSecret).update(String(rawBody || '')).digest('hex')}`;
  return safeEqual(signature, expected);
}

export function extractInstagramMessages(payload) {
  if (!payload || payload.object !== 'instagram' || !Array.isArray(payload.entry)) return [];
  const output = [];
  for (const entry of payload.entry) {
    for (const event of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const message = event.message || {};
      const postback = event.postback || {};
      if (message.is_echo || !event.sender?.id || !event.recipient?.id) continue;
      const text = String(message.text || postback.title || '').trim();
      if (!text) continue;
      const externalEventId = String(message.mid || postback.mid || `postback:${sha256(JSON.stringify({sender:event.sender.id,recipient:event.recipient.id,payload:postback.payload||'',timestamp:event.timestamp||0})).slice(0,40)}`);
      output.push({ externalEventId, senderId: String(event.sender.id), recipientId: String(event.recipient.id), text: text.slice(0, 24000), quickReplyPayload:String(message.quick_reply?.payload || postback.payload || '').slice(0, 1000), timestamp: Number(event.timestamp || Date.now()), raw: event });
    }
  }
  return output;
}

export function extractInstagramComments(payload) {
  if (!payload || payload.object !== 'instagram' || !Array.isArray(payload.entry)) return [];
  const output = [];
  for (const entry of payload.entry) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      if (change?.field !== 'comments') continue;
      const value = change.value || {};
      const commentId = String(value.id || value.comment_id || '').trim();
      const mediaId = String(value.media?.id || value.media_id || '').trim();
      const senderId = String(value.from?.id || value.user_id || '').trim();
      if (!commentId || !mediaId || !senderId) continue;
      const rawTimestamp = Number(value.created_time || value.timestamp || entry.time || Math.floor(Date.now() / 1000));
      output.push({
        externalEventId: `comment:${commentId}`,
        commentId,
        accountId: String(entry.id || value.recipient_id || ''),
        mediaId,
        senderId,
        username: String(value.from?.username || value.username || '').slice(0, 200),
        text: String(value.text || '').trim().slice(0, 24000),
        timestamp: rawTimestamp > 10_000_000_000 ? rawTimestamp : rawTimestamp * 1000,
        raw: value
      });
    }
  }
  return output.filter(item => item.accountId);
}

export async function listInstagramMedia({ instagramUserId, accessToken, fetchImpl = fetch, limit = 50 }) {
  const config = metaConfig();
  const url = new URL(`https://graph.instagram.com/${config.graphVersion}/${encodeURIComponent(instagramUserId)}/media`);
  url.search = new URLSearchParams({
    fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp',
    limit: String(Math.min(100, Math.max(1, Number(limit) || 50)))
  }).toString();
  const data = await jsonResponse(await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }), 'instagram_media_failed');
  return (Array.isArray(data.data) ? data.data : []).map(item => ({
    id: String(item.id || ''), caption: String(item.caption || ''), media_type: String(item.media_type || ''),
    media_url: String(item.media_url || ''), thumbnail_url: String(item.thumbnail_url || ''),
    permalink: String(item.permalink || ''), timestamp: String(item.timestamp || '')
  })).filter(item => item.id);
}

export async function getInstagramMedia({ mediaId, accessToken, fetchImpl = fetch }) {
  const config = metaConfig();
  const url = new URL(`https://graph.instagram.com/${config.graphVersion}/${encodeURIComponent(mediaId)}`);
  url.search = new URLSearchParams({ fields: 'id,media_type,permalink,timestamp' }).toString();
  return jsonResponse(await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }), 'instagram_media_lookup_failed');
}

export async function replyToInstagramComment({ commentId, message, accessToken, fetchImpl = fetch }) {
  const config = metaConfig();
  const response = await fetchImpl(`https://graph.instagram.com/${config.graphVersion}/${encodeURIComponent(commentId)}/replies`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: String(message).slice(0, 1000) })
  });
  return jsonResponse(response, 'instagram_comment_reply_failed');
}

export async function sendInstagramPrivateReply({ instagramUserId, commentId, text, accessToken, quickReplies = [], buttons = [], fetchImpl = fetch }) {
  const config = metaConfig();
  const message = buildInstagramMessage({text,quickReplies,buttons});
  const response = await fetchImpl(`https://graph.instagram.com/${config.graphVersion}/${encodeURIComponent(instagramUserId)}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message })
  });
  return jsonResponse(response, 'instagram_private_reply_failed');
}

export async function sendInstagramMessage({ instagramUserId, recipientId, text, quickReplies = [], buttons = [], accessToken, fetchImpl = fetch }) {
  const config = metaConfig();
  const message = buildInstagramMessage({text,quickReplies,buttons});
  const response = await fetchImpl(`https://graph.instagram.com/${config.graphVersion}/${encodeURIComponent(instagramUserId)}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message })
  });
  return jsonResponse(response, 'instagram_send_failed');
}

export async function sendInstagramText(options) { return sendInstagramMessage(options); }

function normalizeQuickReplies(quickReplies) {
  return (Array.isArray(quickReplies) ? quickReplies : []).slice(0, 13).map((reply, index) => ({
    content_type: 'text', title: String(reply?.title || '').slice(0, 20),
    payload: String(reply?.payload || `HANSORA_REPLY_${index + 1}`).slice(0, 1000)
  })).filter(reply => reply.title);
}

function normalizeButtons(buttons) {
  return (Array.isArray(buttons) ? buttons : []).slice(0, 3).map(button => {
    const title = String(button?.title || '').trim().slice(0, 20);
    if (!title) return null;
    if (button?.type === 'web_url' && /^https:\/\//i.test(String(button.url || ''))) return {type:'web_url',url:String(button.url).trim(),title};
    if (button?.type === 'postback' && String(button.payload || '').trim()) return {type:'postback',title,payload:String(button.payload).slice(0,1000)};
    return null;
  }).filter(Boolean);
}

function buildInstagramMessage({text,quickReplies,buttons}) {
  const normalizedButtons = normalizeButtons(buttons);
  if (normalizedButtons.length) return {attachment:{type:'template',payload:{template_type:'button',text:String(text).slice(0,640),buttons:normalizedButtons}}};
  const message = {text:String(text).slice(0,1000)};
  const replies = normalizeQuickReplies(quickReplies);
  if (replies.length) message.quick_replies = replies;
  return message;
}

export { INSTAGRAM_SCOPES };
