import { first, serviceInsert, serviceUpdate, serviceUpsert } from '../../lib/automation/db.mjs';
import { generateAutomationReply } from '../../lib/automation/provider.mjs';
import { automationPrices, canAfford, chargeCredits, handleOutOfCredits } from '../../lib/automation/billing.mjs';
import { notifyOwner } from '../../lib/automation/notify.mjs';
import { prepareConversationActions } from '../../lib/automation/tools.mjs';
import { keepTyping } from '../../lib/automation/typing.mjs';
import { flagFailedReply } from '../../lib/automation/failure.mjs';
import { buildConversationContext, loadConversationMemory } from '../../lib/automation/history.mjs';
import { ensureAgentUpToDate } from '../../lib/automation/agent-sync.mjs';
import { mediaFallback, mediaMessage, understandMedia } from '../../lib/automation/media.mjs';
import { matchProductPhoto } from '../../lib/automation/product-match.mjs';
import { burstNote, hasNewerCustomerMessage, mediaContext, unansweredCustomerMessages, waitForPendingMedia } from '../../lib/automation/turns.mjs';
import { phonePauseExpired } from '../../lib/automation/whatsapp.mjs';
import { sendTelegramPhoto, sendTelegramText, sendTelegramTyping, telegramDisplayName, telegramFileUrl, telegramMessageParts } from '../../lib/automation/telegram.mjs';
import { makeProductPhotoSender } from '../../lib/automation/product-photos.mjs';

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

// Answers one Telegram Business message (same steps as WhatsApp: save, understand media, one answer per turn, AI,
// send, charge). Messages the owner sends from their own Telegram are shown as the team's replies and pause the AI.
export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!internalAuthorized(event)) return json(401, { error: 'unauthorized' });
  const startedAt = Date.now();
  let eventId = '', stopTyping = () => {}, pendingReply = null;
  try {
    const body = JSON.parse(event.body || '{}'); eventId = String(body.event_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) return json(400, { error: 'invalid_event_id' });
    const webhook = await first(`/rest/v1/automation_webhook_events?id=eq.${eventId}&event_type=eq.telegram_business_message&status=in.(received,failed)&select=*&limit=1`);
    if (!webhook) return json(200, { ok: true, replayed: true });
    const message = webhook.payload || {};
    const [, account] = await Promise.all([
      serviceUpdate('automation_webhook_events', `id=eq.${webhook.id}`, { status: 'processing', attempt_count: Number(webhook.attempt_count || 0) + 1, last_error: null }),
      first(`/rest/v1/automation_provider_resources?provider=eq.telegram&resource_type=eq.telegram_account&provider_resource_id=eq.${encodeURIComponent(String(message.business_connection_id))}&status=eq.active&select=*&limit=1`)
    ]);
    if (!account) throw new Error('telegram_account_not_connected');
    const connection = await first(`/rest/v1/automation_channel_connections?business_id=eq.${account.business_id}&channel_type=eq.telegram&select=*&limit=1`);
    const chatId = String(message.chat?.id || '');
    const fromOwner = String(message.from?.id || '') === String(account.safe_config?.telegram_user_id || '');
    const parts = telegramMessageParts(message);
    const occurredAt = new Date((Number(message.date) || Date.now() / 1000) * 1000).toISOString();
    const customerName = telegramDisplayName(message.chat);
    const contactQuery = `/rest/v1/automation_contacts?business_id=eq.${account.business_id}&channel_type=eq.telegram&external_contact_id=eq.${encodeURIComponent(chatId)}&select=*&limit=1`;
    const known = await first(contactQuery);
    const contact = await serviceUpsert('automation_contacts', 'business_id,channel_type,external_contact_id', { business_id: account.business_id, display_name: known?.display_name && fromOwner ? known.display_name : customerName, channel_type: 'telegram', external_contact_id: chatId, last_seen_at: fromOwner ? known?.last_seen_at || occurredAt : occurredAt, profile: { ...(known?.profile || {}), telegram_id: chatId, ...(message.chat?.username ? { username: message.chat.username } : {}) } });
    const shown = parts.text || parts.label || 'Message';
    const conversation = await serviceUpsert('automation_conversations', 'business_id,channel_type,external_thread_id', { business_id: account.business_id, contact_id: contact.id, channel_connection_id: connection?.id || null, channel_type: 'telegram', external_thread_id: chatId, last_message_preview: shown.slice(0, 1000), last_message_at: occurredAt, ...(fromOwner ? {} : { status: 'open' }) });

    // The owner wrote from their own Telegram: shown as the team's message; the AI steps back in this chat.
    if (fromOwner) {
      await serviceInsert('automation_messages', { business_id: account.business_id, conversation_id: conversation.id, external_message_id: String(message.message_id), idempotency_key: `telegram:echo:${message.business_connection_id}:${chatId}:${message.message_id}`, direction: 'outbound', sender_type: 'human', content_type: 'text', content: shown, status: 'sent', billable: false, provider: 'telegram', provider_message_id: String(message.message_id), metadata: { source: 'telegram_app', sent_at: occurredAt }, occurred_at: occurredAt }, { ignoreDuplicates: true });
      if (!/^\/(start|help)\b/.test(shown)) await serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { ai_enabled: false, status: 'human_handling', updated_at: new Date().toISOString() });
      await markProcessed(webhook.id, account.business_id); return json(200, { ok: true, owner_message: true });
    }

    const settle = promise => promise.then(value => ({ value }), error => ({ error }));
    const take = result => { if (result.error) throw result.error; return result.value; };
    const price = automationPrices().aiReply;
    const aiResourceP = settle(ensureAgentUpToDate({ businessId: account.business_id }).catch(error => console.error('automation agent auto-update failed', { message: error?.message })).then(() => first(`/rest/v1/automation_provider_resources?business_id=eq.${account.business_id}&provider=eq.elevenlabs&resource_type=eq.agent&status=eq.active&select=*&limit=1`)));
    const affordableP = settle(canAfford(account.business_id, price));
    const hasMedia = ['audio', 'image', 'video'].includes(parts.kind) && Boolean(parts.fileId);
    const [inbound, memory, actions] = await Promise.all([
      serviceInsert('automation_messages', { business_id: account.business_id, conversation_id: conversation.id, external_message_id: String(message.message_id), idempotency_key: `telegram:in:${message.business_connection_id}:${chatId}:${message.message_id}`, direction: 'inbound', sender_type: 'customer', content_type: hasMedia ? parts.kind : 'text', content: shown, status: 'received', billable: false, provider: 'telegram', provider_message_id: String(message.message_id), metadata: { chat_id: chatId, ...(hasMedia ? { media_pending: true } : {}) }, occurred_at: occurredAt }, { ignoreDuplicates: true }),
      loadConversationMemory({ businessId: account.business_id, conversationId: conversation.id, contactId: contact.id, excludeExternalId: String(message.message_id) }),
      prepareConversationActions({ businessId: account.business_id, conversationId: conversation.id, contactId: contact.id, channel: 'telegram', contact: { name: customerName, externalId: chatId }, sendImage: makeProductPhotoSender({ businessId: account.business_id, conversationId: conversation.id, provider: 'telegram', send: ({ url, caption }) => sendTelegramPhoto({ businessConnectionId: message.business_connection_id, chatId, url, caption }) }) })
    ]);
    if (!inbound) { await markProcessed(webhook.id, account.business_id); return json(200, { ok: true, duplicate: true }); }
    // A paused chat comes back to the AI once the owner has been quiet for a while (like WhatsApp on the phone).
    if (!conversation.ai_enabled) {
      const lastHuman = await first(`/rest/v1/automation_messages?conversation_id=eq.${conversation.id}&sender_type=eq.human&select=metadata,created_at&order=created_at.desc&limit=1`).catch(() => null);
      if (phonePauseExpired(lastHuman)) { await serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { ai_enabled: true, status: 'open', updated_at: new Date().toISOString() }); conversation.ai_enabled = true; conversation.status = 'open'; }
    }
    const settings = connection?.settings || {};
    const aiWillReply = !(settings.automatic_replies === false || !conversation.ai_enabled || ['human_handling', 'resolved', 'archived'].includes(conversation.status) || connection?.status !== 'connected');
    const typingTarget = { businessConnectionId: message.business_connection_id, chatId };
    if (aiWillReply) { sendTelegramTyping(typingTarget).catch(() => null); stopTyping = keepTyping(() => sendTelegramTyping(typingTarget), { everyMs: 4500, immediate: false }); }

    let media = null, understood = null, aiText = parts.text;
    if (hasMedia) {
      try {
        const [url, context] = await Promise.all([telegramFileUrl(parts.fileId), mediaContext({ businessId: account.business_id, history: memory.history }).catch(() => '')]);
        media = await understandMedia({ url, kind: parts.kind, caption: parts.text, context, store: { businessId: account.business_id, channel: 'telegram', conversationId: conversation.id, key: `${chatId}_${message.message_id}` }, afterVisual: file => matchProductPhoto({ businessId: account.business_id, ...file, caption: parts.text }) });
      } catch (error) { console.warn('telegram media understanding failed', { message: error?.message }); }
      understood = media ? mediaMessage({ source: media.kind, media, caption: parts.text }) : mediaFallback({ kind: parts.kind, caption: parts.text });
      if (understood) aiText = understood.aiText;
      await serviceUpdate('automation_messages', `id=eq.${inbound.id}`, { content: understood?.content || shown, metadata: { chat_id: chatId, media_pending: false, ...(media?.mediaPath ? { media_path: media.mediaPath, media_mime: media.mimeType } : {}) } }).catch(() => null);
      if (understood) await serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { last_message_preview: understood.content.slice(0, 1000) }).catch(() => null);
    }
    if (!aiWillReply || !String(aiText || '').trim()) { await markProcessed(webhook.id, account.business_id); return json(200, { ok: true, ai_skipped: true }); }

    const turn = { conversationId: conversation.id, occurredAt: inbound.occurred_at || occurredAt, createdAt: inbound.created_at, messageId: inbound.id };
    if (await hasNewerCustomerMessage(turn)) { await markProcessed(webhook.id, account.business_id); return json(200, { ok: true, answered_by_newer_message: true }); }
    const liveMemory = await waitForPendingMedia(turn) ? await loadConversationMemory({ businessId: account.business_id, conversationId: conversation.id, contactId: contact.id, excludeExternalId: String(message.message_id) }) : memory;
    const pendingQuestions = burstNote(await unansweredCustomerMessages(turn));
    pendingReply = { businessId: account.business_id, conversationId: conversation.id, customer: customerName, channel: 'Telegram' };
    const aiResource = take(await aiResourceP); const affordable = take(await affordableP);
    if (!aiResource) throw new Error('ai_provider_agent_not_ready');
    if (!affordable.ok) { pendingReply = null; await handleOutOfCredits({ businessId: account.business_id, conversationId: conversation.id, channel: 'Telegram', customer: customerName, notifyOwner }); await markProcessed(webhook.id, account.business_id); return json(200, { ok: true, out_of_credits: true }); }
    const mediaNote = understood ? understood.note : (parts.kind !== 'text' && !parts.text ? 'The latest customer message is a file, sticker, location or contact you cannot open. Do not pretend to know its contents; ask the customer to describe it in text if needed.' : '');
    const context = buildConversationContext({ intro: ['Continue this Telegram conversation. Keep the reply concise.', actions.contextLine, mediaNote].filter(Boolean), memory: liveMemory, after: [actions.liveBrief, pendingQuestions] });
    const generated = await generateAutomationReply({ providerResourceId: aiResource.provider_resource_id, text: aiText, context, channel: 'telegram', onToolCall: actions.onToolCall, checkTimes: actions.checkTimes, knownTimes: actions.knownTimes });
    const handedOff = generated.toolCalls?.some(call => call.name === 'handoff_to_human' && call.ok);
    const replyDelay = Math.min(30, Math.max(0, Number(settings.reply_delay) || 0)); const waitMs = replyDelay * 1000 - (Date.now() - startedAt); if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
    const current = await first(`/rest/v1/automation_conversations?id=eq.${conversation.id}&select=ai_enabled,status&limit=1`);
    if (!handedOff && (!current?.ai_enabled || ['human_handling', 'resolved', 'archived'].includes(current.status))) { pendingReply = null; await markProcessed(webhook.id, account.business_id); return json(200, { ok: true, ai_skipped: true }); }
    if (await hasNewerCustomerMessage(turn)) { pendingReply = null; await markProcessed(webhook.id, account.business_id); return json(200, { ok: true, answered_by_newer_message: true }); }
    if (!generated.text) { pendingReply = null; await markProcessed(webhook.id, account.business_id); return json(200, { ok: true, empty_reply: true }); }
    stopTyping(); stopTyping = () => {};
    const sent = await sendTelegramText({ ...typingTarget, text: generated.text });
    pendingReply = null;
    const outbound = await serviceInsert('automation_messages', { business_id: account.business_id, conversation_id: conversation.id, external_message_id: sent.messageId || null, idempotency_key: `telegram:out:${message.business_connection_id}:${chatId}:${message.message_id}`, direction: 'outbound', sender_type: 'ai', content_type: 'text', content: generated.text, status: 'sent', billable: true, provider: 'telegram', model: 'eleven-agents', provider_message_id: sent.messageId || null, metadata: { chat_id: chatId, elevenlabs_conversation_id: generated.conversationId || null }, occurred_at: new Date().toISOString() }, { ignoreDuplicates: true });
    const charge = outbound ? await chargeCredits({ businessId: account.business_id, idempotencyKey: `usage:telegram:${message.business_connection_id}:${chatId}:${message.message_id}`, kind: 'ai_reply', credits: price, conversationId: conversation.id, reference: { channel: 'telegram', message_id: outbound.id } }).catch(error => { console.error('automation credit charge failed', { message: error?.message }); return { ok: false, charged: 0 }; }) : null;
    if (outbound) await serviceInsert('automation_usage_events', { business_id: account.business_id, conversation_id: conversation.id, message_id: outbound.id, channel_type: 'telegram', unit_type: 'ai_message', quantity: 1, billable_quantity: 1, estimated_cost_minor: 0, currency: 'AMD', provider: 'elevenlabs', provider_usage_id: generated.conversationId || null, idempotency_key: `usage:telegram:${message.business_connection_id}:${chatId}:${message.message_id}`, credits: charge?.charged || 0, metadata: { telegram_message_id: sent.messageId || null } }, { ignoreDuplicates: true });
    await serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { last_message_preview: generated.text.slice(0, 1000), last_message_at: new Date().toISOString() });
    await markProcessed(webhook.id, account.business_id);
    return json(200, { ok: true });
  } catch (error) {
    if (pendingReply && eventId) await flagFailedReply({ ...pendingReply, eventId });
    console.error('automation-telegram-process error', { eventId, message: error?.message, providerMessage: error?.providerMessage });
    if (eventId) await serviceUpdate('automation_webhook_events', `id=eq.${eventId}`, { status: 'failed', last_error: String(error?.message || 'processing_failed').slice(0, 2000) }).catch(() => null);
    return json(Number(error?.status) || 500, { error: 'telegram_message_processing_failed' });
  } finally { stopTyping(); }
}

function internalAuthorized(event) { const expected = String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET || ''); const actual = String(event.headers?.['x-hansora-internal-secret'] || event.headers?.['X-Hansora-Internal-Secret'] || ''); return expected.length >= 32 && actual === expected; }
async function markProcessed(id, businessId) { await serviceUpdate('automation_webhook_events', `id=eq.${id}`, { business_id: businessId, status: 'processed', processed_at: new Date().toISOString(), last_error: null }); }
