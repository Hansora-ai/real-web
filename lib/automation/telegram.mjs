// Telegram through "Telegram Business": one Hansora bot (TELEGRAM_BOT_TOKEN, Business Mode on in @BotFather) is
// connected by each owner to their own Telegram account (Settings → Telegram Business → Chatbots). The AI then answers
// customers as the owner – same name and photo – and no business ever handles a token. Needs Telegram Premium.
import crypto from 'node:crypto';

const API = 'https://api.telegram.org';
export function telegramConfig() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) throw Object.assign(new Error('telegram_not_configured'), { status: 503 });
  return { token };
}
// Telegram sends this back in a header on every webhook call; derived from the internal secret (no extra setting).
export function telegramWebhookSecret() {
  const base = String(process.env.TELEGRAM_WEBHOOK_SECRET || process.env.HANSORA_AUTOMATION_INTERNAL_SECRET || '');
  return base ? crypto.createHash('sha256').update(`telegram:${base}`).digest('hex').slice(0, 48) : '';
}

export async function telegramApi(method, payload = {}, fetchImpl = fetch) {
  const { token } = telegramConfig();
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  const response = await fetchImpl(`${API}/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal }).finally(() => clearTimeout(timer));
  const data = await response.json().catch(() => ({}));
  if (!data.ok) throw Object.assign(new Error(`telegram_${method}_failed`), { status: response.status >= 500 ? 502 : 400, providerMessage: String(data.description || '').slice(0, 300) });
  return data.result;
}

let botCache = null;
export async function telegramBot(fetchImpl = fetch) {
  if (botCache) return botCache;
  const me = await telegramApi('getMe', {}, fetchImpl);
  botCache = { id: me.id, username: me.username, canConnectToBusiness: Boolean(me.can_connect_to_business) };
  return botCache;
}

export async function ensureTelegramWebhook(siteUrl, fetchImpl = fetch) {
  const url = `${String(siteUrl).replace(/\/$/, '')}/.netlify/functions/automation-telegram-webhook`;
  const info = await telegramApi('getWebhookInfo', {}, fetchImpl).catch(() => null);
  const wanted = ['message', 'business_connection', 'business_message', 'edited_business_message'];
  if (info?.url === url && wanted.every(type => (info.allowed_updates || []).includes(type))) return { url, changed: false };
  await telegramApi('setWebhook', { url, secret_token: telegramWebhookSecret(), allowed_updates: wanted, drop_pending_updates: false }, fetchImpl);
  return { url, changed: true };
}

export async function sendTelegramText({ businessConnectionId, chatId, text, fetchImpl = fetch }) {
  const result = await telegramApi('sendMessage', { business_connection_id: businessConnectionId, chat_id: chatId, text: String(text).slice(0, 4096), link_preview_options: { is_disabled: true } }, fetchImpl);
  return { messageId: String(result?.message_id || '') };
}
export async function sendTelegramPhoto({ businessConnectionId, chatId, url, caption = '', fetchImpl = fetch }) {
  const result = await telegramApi('sendPhoto', { business_connection_id: businessConnectionId, chat_id: chatId, photo: String(url), ...(caption ? { caption: String(caption).slice(0, 1024) } : {}) }, fetchImpl);
  return { messageId: String(result?.message_id || '') };
}
export function sendTelegramTyping({ businessConnectionId, chatId, fetchImpl = fetch }) {
  return telegramApi('sendChatAction', { business_connection_id: businessConnectionId, chat_id: chatId, action: 'typing' }, fetchImpl);
}
// A file id → a download link (valid for about an hour; files up to 20 MB).
export async function telegramFileUrl(fileId, fetchImpl = fetch) {
  const file = await telegramApi('getFile', { file_id: fileId }, fetchImpl);
  const { token } = telegramConfig();
  return file?.file_path ? `${API}/file/bot${token}/${file.file_path}` : '';
}

// What a Telegram message is: its text, and the media to understand (voice, photo, video…).
export function telegramMessageParts(message = {}) {
  const caption = String(message.caption || '').trim();
  if (message.text) return { text: String(message.text).slice(0, 24000), kind: 'text' };
  if (message.voice) return { text: caption, kind: 'audio', fileId: message.voice.file_id, label: '🎤 Voice message' };
  if (message.audio) return { text: caption, kind: 'audio', fileId: message.audio.file_id, label: '🎵 Audio' };
  if (message.video_note) return { text: caption, kind: 'video', fileId: message.video_note.file_id, label: '🎬 Video message' };
  if (message.photo?.length) { const best = [...message.photo].sort((a, b) => (b.file_size || b.width * b.height) - (a.file_size || a.width * a.height)).find(item => !item.file_size || item.file_size < 10 * 1024 * 1024); return { text: caption, kind: 'image', fileId: best?.file_id, label: '📷 Photo' }; }
  if (message.video) return { text: caption, kind: 'video', fileId: message.video.file_id, label: '🎬 Video' };
  if (message.sticker) return { text: message.sticker.emoji || '', kind: message.sticker.is_animated || message.sticker.is_video ? 'sticker' : 'image', fileId: message.sticker.is_animated || message.sticker.is_video ? '' : message.sticker.file_id, label: `Sticker ${message.sticker.emoji || ''}`.trim() };
  if (message.document) return { text: caption, kind: 'file', label: `📎 File: ${String(message.document.file_name || '').slice(0, 120)}` };
  if (message.location) return { text: '', kind: 'location', label: '📍 Shared a location' };
  if (message.contact) return { text: '', kind: 'contact', label: `👤 Shared a contact: ${[message.contact.first_name, message.contact.phone_number].filter(Boolean).join(' ')}` };
  return { text: caption, kind: 'other', label: '' };
}

export function telegramDisplayName(user = {}) {
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || (user.username ? `@${user.username}` : 'Telegram customer');
}
