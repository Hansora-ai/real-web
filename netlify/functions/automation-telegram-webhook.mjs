import crypto from 'node:crypto';
import { first, serviceInsert, serviceUpdate, supabaseRequest } from '../../lib/automation/db.mjs';
import { telegramApi, telegramBot, telegramWebhookSecret } from '../../lib/automation/telegram.mjs';

// The bot answers the owner in their Telegram app language (Armenian, Russian, else English). Telegram has no official
// Armenian interface, so menu names stay as people see them (English) in the Armenian texts.
const TEXTS = {
  en: {
    help: 'Hi! This is the Hansora assistant bot. To connect it, open Hansora → your AI employee → Channels → Telegram and press Connect.',
    expired: 'This link has expired. Open Hansora → Channels → Telegram and press Connect again.',
    premium: '⚠️ This Telegram account does not have Telegram Premium.\n\nTelegram only lets an assistant answer customers for you through Telegram Business, which is part of Premium. Get it in Telegram → Settings → Telegram Premium, then press Start in this chat again (or open the link from Hansora again).',
    step1: bot => `✅ Step 1 done. Now the last step:\n\nTelegram → Settings → Telegram Business → Chatbots → add @${bot}, choose which chats it may answer, and allow "Reply to messages".\n\nYour AI employee will then answer your customers here, as you.`,
    notLinked: 'This Telegram account is not linked to Hansora yet. Open Hansora → your AI employee → Channels → Telegram, press Connect and follow the link first.',
    connected: '✅ Connected. Go back to Hansora and press "Go live" to let your AI employee answer your Telegram customers.',
    allowReply: 'Almost done: in Telegram Business → Chatbots, allow the bot to "Reply to messages".'
  },
  hy: {
    help: 'Բարև։ Սա Hansora-ի օգնական բոտն է։ Միացնելու համար բացեք Hansora → ձեր AI աշխատակիցը → Channels → Telegram և սեղմեք Connect։',
    expired: 'Այս հղման ժամկետն անցել է։ Բացեք Hansora → Channels → Telegram և նորից սեղմեք Connect։',
    premium: '⚠️ Այս Telegram հաշիվը չունի Telegram Premium։\n\nTelegram-ը թույլ է տալիս, որ օգնականը ձեր փոխարեն պատասխանի հաճախորդներին միայն Telegram Business-ի միջոցով, որը Premium-ի մաս է։ Ակտիվացրեք այն Telegram → Settings → Telegram Premium բաժնում, ապա այս չատում կրկին սեղմեք Start (կամ նորից բացեք հղումը Hansora-ից)։',
    step1: bot => `✅ Առաջին քայլն ավարտված է։ Վերջին քայլը՝\n\nTelegram → Settings → Telegram Business → Chatbots → ավելացրեք @${bot}, ընտրեք, թե որ չատերին կարող է պատասխանել, և թույլատրեք «Reply to messages»։\n\nԴրանից հետո ձեր AI աշխատակիցը կպատասխանի ձեր հաճախորդներին այստեղ՝ ձեր անունից։`,
    notLinked: 'Այս Telegram հաշիվը դեռ միացված չէ Hansora-ին։ Բացեք Hansora → ձեր AI աշխատակիցը → Channels → Telegram, սեղմեք Connect և նախ անցեք հղումով։',
    connected: '✅ Միացված է։ Վերադարձեք Hansora և սեղմեք «Go live», որպեսզի ձեր AI աշխատակիցը սկսի պատասխանել Telegram-ի հաճախորդներին։',
    allowReply: 'Գրեթե պատրաստ է․ Telegram Business → Chatbots բաժնում թույլատրեք բոտին «Reply to messages»։'
  },
  ru: {
    help: 'Здравствуйте! Это бот-помощник Hansora. Чтобы подключить его, откройте Hansora → ваш AI-сотрудник → Channels → Telegram и нажмите Connect.',
    expired: 'Срок действия ссылки истёк. Откройте Hansora → Channels → Telegram и снова нажмите Connect.',
    premium: '⚠️ У этого аккаунта Telegram нет Telegram Premium.\n\nTelegram позволяет помощнику отвечать клиентам от вашего имени только через Telegram для бизнеса, а это часть Premium. Подключите его в Telegram → Настройки → Telegram Premium, затем снова нажмите «Старт» в этом чате (или снова откройте ссылку из Hansora).',
    step1: bot => `✅ Первый шаг выполнен. Последний шаг:\n\nTelegram → Настройки → Telegram для бизнеса → Чат-боты → добавьте @${bot}, выберите, в каких чатах он может отвечать, и разрешите «Отвечать на сообщения».\n\nПосле этого ваш AI-сотрудник будет отвечать клиентам здесь от вашего имени.`,
    notLinked: 'Этот аккаунт Telegram ещё не связан с Hansora. Откройте Hansora → ваш AI-сотрудник → Channels → Telegram, нажмите Connect и сначала перейдите по ссылке.',
    connected: '✅ Подключено. Вернитесь в Hansora и нажмите «Go live», чтобы AI-сотрудник начал отвечать вашим клиентам в Telegram.',
    allowReply: 'Почти готово: в Telegram для бизнеса → Чат-боты разрешите боту «Отвечать на сообщения».'
  }
};
const textsFor = user => TEXTS[String(user?.language_code || '').slice(0, 2).toLowerCase()] || TEXTS.en;
// Once the business is known, its AI employee's main language wins (the owner's Telegram app may be in English).
async function textsForBusiness(businessId, user) {
  const agent = businessId ? await first(`/rest/v1/automation_agents?business_id=eq.${encodeURIComponent(businessId)}&select=primary_language&limit=1`).catch(() => null) : null;
  return TEXTS[String(agent?.primary_language || '').slice(0, 2).toLowerCase()] || textsFor(user);
}

const ok = () => ({ statusCode: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: 'ok' });
const safeEqual = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };

// Telegram calls this for: /start <code> in the bot chat (links an owner's Telegram to their AI employee),
// business_connection (the owner added or removed the bot in Telegram Business) and business_message (customers).
export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'method not allowed' };
  const header = event.headers?.['x-telegram-bot-api-secret-token'] || event.headers?.['X-Telegram-Bot-Api-Secret-Token'] || '';
  if (!safeEqual(header, telegramWebhookSecret())) return { statusCode: 401, body: 'unauthorized' };
  let update; try { update = JSON.parse(event.body || '{}'); } catch (_) { return ok(); }
  try {
    if (update.message?.chat?.type === 'private' && /^\/start\b/.test(String(update.message.text || ''))) await handleStart(update.message);
    else if (update.business_connection) await handleConnection(update.business_connection);
    else if (update.business_message) await queueMessage(event, update.business_message);
  } catch (error) {
    // Telegram retries on errors; a message that could not be queued is retried, everything else is logged.
    console.error('automation-telegram-webhook error', { message: error?.message, providerMessage: error?.providerMessage });
    if (update.business_message) return { statusCode: 500, body: 'retry' };
  }
  return ok();
}

async function handleStart(message) {
  const code = String(message.text || '').split(/\s+/)[1] || '';
  const reply = text => telegramApi('sendMessage', { chat_id: message.chat.id, text }).catch(() => null);
  let t = textsFor(message.from);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) return reply(t.help);
  const resource = await first(`/rest/v1/automation_provider_resources?provider=eq.telegram&resource_type=eq.telegram_account&status=eq.pending&safe_config->>link_code=eq.${encodeURIComponent(code)}&select=*&limit=1`);
  if (!resource || Date.parse(resource.safe_config?.link_expires_at || 0) < Date.now()) return reply(t.expired);
  t = await textsForBusiness(resource.business_id, message.from);
  // Telegram Business (the AI answering as the owner) only works on accounts with Telegram Premium. Telegram tells
  // bots who has Premium, so this is checked here instead of failing silently at the next step.
  if (message.from?.is_premium !== true) {
    await serviceUpdate('automation_provider_resources', `id=eq.${resource.id}`, { safe_config: { ...resource.safe_config, premium: false, checked_user_id: String(message.from?.id || '') }, updated_at: new Date().toISOString() });
    return reply(t.premium);
  }
  await serviceUpdate('automation_provider_resources', `id=eq.${resource.id}`, { safe_config: { ...resource.safe_config, premium: true, telegram_user_id: String(message.from.id), telegram_username: String(message.from.username || ''), telegram_name: [message.from.first_name, message.from.last_name].filter(Boolean).join(' '), linked_at: new Date().toISOString() }, updated_at: new Date().toISOString() });
  const bot = await telegramBot().catch(() => ({ username: '' }));
  return reply(t.step1(bot.username));
}

async function handleConnection(connection) {
  const userId = String(connection.user?.id || '');
  let t = textsFor(connection.user);
  const notify = text => (connection.user_chat_id ? telegramApi('sendMessage', { chat_id: connection.user_chat_id, text }).catch(() => null) : null);
  const resource = await first(`/rest/v1/automation_provider_resources?provider=eq.telegram&resource_type=eq.telegram_account&status=in.(pending,active)&safe_config->>telegram_user_id=eq.${encodeURIComponent(userId)}&select=*&order=updated_at.desc&limit=1`);
  if (!resource) { if (connection.is_enabled) await notify(t.notLinked); return; }
  t = await textsForBusiness(resource.business_id, connection.user);
  const canReply = connection.rights ? Boolean(connection.rights.can_reply) : connection.can_reply !== false;
  const label = resource.safe_config?.telegram_username ? `@${resource.safe_config.telegram_username}` : (resource.safe_config?.telegram_name || 'Telegram');
  if (!connection.is_enabled) {
    await serviceUpdate('automation_provider_resources', `id=eq.${resource.id}`, { status: 'revoked', updated_at: new Date().toISOString() });
    await serviceUpdate('automation_channel_connections', `business_id=eq.${resource.business_id}&channel_type=eq.telegram`, { status: 'not_connected', connected_account_label: null, connected_at: null, updated_at: new Date().toISOString() });
    return;
  }
  // A reconnect can reuse the same connection id: an old, disconnected row with it would block this one.
  await supabaseRequest(`/rest/v1/automation_provider_resources?business_id=eq.${resource.business_id}&provider=eq.telegram&resource_type=eq.telegram_account&provider_resource_id=eq.${encodeURIComponent(String(connection.id))}&id=neq.${resource.id}`, { method: 'DELETE' }).catch(() => null);
  await serviceUpdate('automation_provider_resources', `id=eq.${resource.id}`, { provider_resource_id: String(connection.id), status: 'active', safe_config: { ...resource.safe_config, business_connection_id: String(connection.id), user_chat_id: String(connection.user_chat_id || ''), can_reply: canReply, connected_at: new Date().toISOString() }, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  await serviceUpdate('automation_channel_connections', `business_id=eq.${resource.business_id}&channel_type=eq.telegram`, { status: 'connecting', provider: 'telegram', connected_account_label: label, connected_at: new Date().toISOString(), last_error_code: canReply ? null : 'telegram_reply_not_allowed', updated_at: new Date().toISOString() });
  await notify(canReply ? t.connected : t.allowReply);
}

async function queueMessage(event, message) {
  if (!message.business_connection_id || message.chat?.type !== 'private') return;
  // Sent by a bot on the owner's behalf (our own replies and photos): not a customer message and not the owner typing.
  if (message.sender_business_bot) return;
  const externalEventId = `telegram:${message.business_connection_id}:${message.chat.id}:${message.message_id}`;
  const inserted = await serviceInsert('automation_webhook_events', { provider: 'telegram', external_event_id: externalEventId, event_type: 'telegram_business_message', payload: message, status: 'received' }, { ignoreDuplicates: true });
  const row = inserted || await first(`/rest/v1/automation_webhook_events?provider=eq.telegram&external_event_id=eq.${encodeURIComponent(externalEventId)}&select=id,status&limit=1`);
  if (!row || !['received', 'failed'].includes(row.status)) return;
  const secret = String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET || '');
  const requestOrigin = (() => { try { return new URL(event.rawUrl || '').origin; } catch (_) { return ''; } })();
  const site = String(process.env.URL || process.env.DEPLOY_PRIME_URL || requestOrigin).replace(/\/$/, '');
  if (!secret || !site) throw new Error('automation_background_not_configured');
  const response = await fetch(`${site}/.netlify/functions/automation-telegram-process-background`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hansora-internal-secret': secret }, body: JSON.stringify({ event_id: row.id }) });
  if (!response.ok && response.status !== 202) throw new Error('automation_background_dispatch_failed');
}
