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
import { decryptSecret } from '../../lib/automation/crypto.mjs';
import { getMessengerProfile, sendMessengerAction, sendMessengerImage, sendMessengerText } from '../../lib/automation/messenger.mjs';
import { makeProductPhotoSender } from '../../lib/automation/product-photos.mjs';

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

// Answers one Facebook Messenger message (same steps as Telegram and WhatsApp: save, understand media, one answer per
// turn, AI, send, charge). Team replies typed in the Page inbox are handled by the webhook (they pause the AI).
export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!internalAuthorized(event)) return json(401, { error: 'unauthorized' });
  const startedAt = Date.now();
  let eventId = '', stopTyping = () => {}, pendingReply = null;
  try {
    const body = JSON.parse(event.body || '{}'); eventId = String(body.event_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) return json(400, { error: 'invalid_event_id' });
    const webhook = await first(`/rest/v1/automation_webhook_events?id=eq.${eventId}&event_type=eq.messenger_message&status=in.(received,failed)&select=*&limit=1`);
    if (!webhook) return json(200, { ok: true, replayed: true });
    const message = webhook.payload || {};
    const [, account] = await Promise.all([
      serviceUpdate('automation_webhook_events', `id=eq.${webhook.id}`, { status: 'processing', attempt_count: Number(webhook.attempt_count || 0) + 1, last_error: null }),
      first(`/rest/v1/automation_provider_resources?provider=eq.meta&resource_type=eq.facebook_page&provider_resource_id=eq.${encodeURIComponent(String(message.pageId))}&status=eq.active&select=*&limit=1`)
    ]);
    if (!account) throw new Error('messenger_page_not_connected');
    const [connection, credential] = await Promise.all([
      first(`/rest/v1/automation_channel_connections?business_id=eq.${account.business_id}&channel_type=eq.messenger&select=*&limit=1`),
      first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${account.id}&credential_type=eq.access_token&select=*&limit=1`)
    ]);
    if (!credential) throw new Error('messenger_token_not_found');
    const pageToken = decryptSecret(credential);
    const chatId = String(message.senderId || '');
    const mediaKind = { audio: 'audio', image: 'image', video: 'video' }[message.attachmentType] || '';
    const labels = { audio: '🎤 Voice message', image: '📷 Photo', video: '🎬 Video', file: '📎 File', location: '📍 Location' };
    const parts = { text: message.text, kind: mediaKind || (message.attachmentType ? 'file' : 'text'), label: labels[message.attachmentType] || (message.attachmentType ? '📎 Attachment' : '') };
    const occurredAt = new Date(Number(message.timestamp) || Date.now()).toISOString();
    const contactQuery = `/rest/v1/automation_contacts?business_id=eq.${account.business_id}&channel_type=eq.messenger&external_contact_id=eq.${encodeURIComponent(chatId)}&select=*&limit=1`;
    const known = await first(contactQuery);
    // Name and photo looked up once a day at most.
    const fresh = Date.parse(known?.profile?.profile_checked_at || '') > Date.now() - 86_400_000;
    const profile = fresh ? null : await getMessengerProfile({ senderId: chatId, pageToken });
    const customerName = profile?.name || known?.display_name || 'Messenger customer';
    const contact = await serviceUpsert('automation_contacts', 'business_id,channel_type,external_contact_id', { business_id: account.business_id, display_name: customerName, channel_type: 'messenger', external_contact_id: chatId, last_seen_at: occurredAt, profile: { ...(known?.profile || {}), messenger_psid: chatId, ...(profile ? { name: profile.name, profile_pic: profile.picture, profile_checked_at: new Date().toISOString() } : {}) } });
    const shown = parts.text || parts.label || 'Message';
    const conversation = await serviceUpsert('automation_conversations', 'business_id,channel_type,external_thread_id', { business_id: account.business_id, contact_id: contact.id, channel_connection_id: connection?.id || null, channel_type: 'messenger', external_thread_id: chatId, status: 'open', last_message_preview: shown.slice(0, 1000), last_message_at: occurredAt });

    const settle = promise => promise.then(value => ({ value }), error => ({ error }));
    const take = result => { if (result.error) throw result.error; return result.value; };
    const price = automationPrices().aiReply;
    const aiResourceP = settle(ensureAgentUpToDate({ businessId: account.business_id }).catch(error => console.error('automation agent auto-update failed', { message: error?.message })).then(() => first(`/rest/v1/automation_provider_resources?business_id=eq.${account.business_id}&provider=eq.elevenlabs&resource_type=eq.agent&status=eq.active&select=*&limit=1`)));
    const affordableP = settle(canAfford(account.business_id, price));
    const hasMedia = Boolean(mediaKind) && /^https:\/\//.test(message.attachmentUrl || '');
    const [inbound, memory, actions] = await Promise.all([
      serviceInsert('automation_messages', { business_id: account.business_id, conversation_id: conversation.id, external_message_id: message.externalEventId, idempotency_key: `messenger:in:${message.externalEventId}`, direction: 'inbound', sender_type: 'customer', content_type: hasMedia ? parts.kind : 'text', content: shown, status: 'received', billable: false, provider: 'meta', provider_message_id: message.externalEventId, metadata: { sender_id: chatId, page_id: message.pageId, ...(hasMedia ? { media_pending: true } : {}) }, occurred_at: occurredAt }, { ignoreDuplicates: true }),
      loadConversationMemory({ businessId: account.business_id, conversationId: conversation.id, contactId: contact.id, excludeExternalId: message.externalEventId }),
      prepareConversationActions({ businessId: account.business_id, conversationId: conversation.id, contactId: contact.id, channel: 'messenger', contact: { name: customerName === 'Messenger customer' ? '' : customerName, externalId: chatId }, sendImage: makeProductPhotoSender({ businessId: account.business_id, conversationId: conversation.id, provider: 'meta', send: ({ url }) => sendMessengerImage({ pageId: message.pageId, pageToken, recipientId: chatId, url }) }) })
    ]);
    if (!inbound) { await markProcessed(webhook.id, account.business_id); return json(200, { ok: true, duplicate: true }); }
    // A paused chat comes back to the AI once the owner has been quiet for a while (like WhatsApp on the phone).
    if (!conversation.ai_enabled) {
      const lastHuman = await first(`/rest/v1/automation_messages?conversation_id=eq.${conversation.id}&sender_type=eq.human&select=metadata,created_at&order=created_at.desc&limit=1`).catch(() => null);
      if (phonePauseExpired(lastHuman)) { await serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { ai_enabled: true, status: 'open', updated_at: new Date().toISOString() }); conversation.ai_enabled = true; conversation.status = 'open'; }
    }
    const settings = connection?.settings || {};
    const aiWillReply = !(settings.automatic_replies === false || !conversation.ai_enabled || ['human_handling', 'resolved', 'archived'].includes(conversation.status) || connection?.status !== 'connected');
    const typingTarget = { pageId: message.pageId, pageToken, recipientId: chatId };
    if (aiWillReply) { sendMessengerAction(typingTarget).catch(() => null); stopTyping = keepTyping(() => sendMessengerAction(typingTarget), { everyMs: 15000, immediate: false }); }

    let media = null, understood = null, aiText = parts.text;
    if (hasMedia) {
      try {
        const context = await mediaContext({ businessId: account.business_id, history: memory.history }).catch(() => '');
        media = await understandMedia({ url: message.attachmentUrl, kind: mediaKind, caption: parts.text, context, store: { businessId: account.business_id, channel: 'messenger', conversationId: conversation.id, key: message.externalEventId }, afterVisual: file => matchProductPhoto({ businessId: account.business_id, ...file, caption: parts.text }) });
      } catch (error) { console.warn('messenger media understanding failed', { message: error?.message }); }
      understood = media ? mediaMessage({ source: media.kind, media, caption: parts.text }) : mediaFallback({ kind: mediaKind, caption: parts.text });
      if (understood) aiText = understood.aiText;
      await serviceUpdate('automation_messages', `id=eq.${inbound.id}`, { content: understood?.content || shown, metadata: { sender_id: chatId, page_id: message.pageId, media_pending: false, ...(media?.mediaPath ? { media_path: media.mediaPath, media_mime: media.mimeType } : {}) } }).catch(() => null);
      if (understood) await serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { last_message_preview: understood.content.slice(0, 1000) }).catch(() => null);
    }
    if (!aiWillReply || !String(aiText || '').trim()) { await markProcessed(webhook.id, account.business_id); return json(200, { ok: true, ai_skipped: true }); }

    const turn = { conversationId: conversation.id, occurredAt: inbound.occurred_at || occurredAt, createdAt: inbound.created_at, messageId: inbound.id };


    if (await hasNewerCustomerMessage(turn)) { await markProcessed(webhook.id, account.business_id); return json(200, { ok: true, answered_by_newer_message: true }); }
    const liveMemory = await waitForPendingMedia(turn) ? await loadConversationMemory({ businessId: account.business_id, conversationId: conversation.id, contactId: contact.id, excludeExternalId: message.externalEventId }) : memory;
    const pendingQuestions = burstNote(await unansweredCustomerMessages(turn));
    pendingReply = { businessId: account.business_id, conversationId: conversation.id, customer: customerName, channel: 'Messenger' };
    const aiResource = take(await aiResourceP); const affordable = take(await affordableP);
    if (!aiResource) throw new Error('ai_provider_agent_not_ready');
    if (!affordable.ok) { pendingReply = null; await handleOutOfCredits({ businessId: account.business_id, conversationId: conversation.id, channel: 'Messenger', customer: customerName, notifyOwner }); await markProcessed(webhook.id, account.business_id); return json(200, { ok: true, out_of_credits: true }); }
    const mediaNote = understood ? understood.note : (parts.kind !== 'text' && !parts.text ? 'The latest customer message is a file, sticker, location or contact you cannot open. Do not pretend to know its contents; ask the customer to describe it in text if needed.' : '');
    const context = buildConversationContext({ intro: ['Continue this Facebook Messenger conversation. Keep the reply concise.', actions.contextLine, mediaNote].filter(Boolean), memory: liveMemory, after: [actions.liveBrief, pendingQuestions] });
    const generated = await generateAutomationReply({ businessId: account.business_id, providerResourceId: aiResource.provider_resource_id, text: aiText, context, channel: 'messenger', onToolCall: actions.onToolCall, checkTimes: actions.checkTimes, knownTimes: actions.knownTimes });
    const handedOff = generated.toolCalls?.some(call => call.name === 'handoff_to_human' && call.ok);
    const replyDelay = Math.min(30, Math.max(0, Number(settings.reply_delay) || 0)); const waitMs = replyDelay * 1000 - (Date.now() - startedAt); if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
    const current = await first(`/rest/v1/automation_conversations?id=eq.${conversation.id}&select=ai_enabled,status&limit=1`);
    if (!handedOff && (!current?.ai_enabled || ['human_handling', 'resolved', 'archived'].includes(current.status))) { pendingReply = null; await markProcessed(webhook.id, account.business_id); return json(200, { ok: true, ai_skipped: true }); }
    if (await hasNewerCustomerMessage(turn)) { pendingReply = null; await markProcessed(webhook.id, account.business_id); return json(200, { ok: true, answered_by_newer_message: true }); }
    if (!generated.text) { pendingReply = null; await markProcessed(webhook.id, account.business_id); return json(200, { ok: true, empty_reply: true }); }
    stopTyping(); stopTyping = () => {};
    const sent = await sendMessengerText({ ...typingTarget, text: generated.text });
    pendingReply = null;
    const outbound = await serviceInsert('automation_messages', { business_id: account.business_id, conversation_id: conversation.id, external_message_id: sent.messageId || null, idempotency_key: `messenger:out:${message.externalEventId}`, direction: 'outbound', sender_type: 'ai', content_type: 'text', content: generated.text, status: 'sent', billable: true, provider: 'meta', model:generated.model||'eleven-agents', provider_message_id: sent.messageId || null, metadata: { recipient_id: chatId, page_id: message.pageId, elevenlabs_conversation_id: generated.conversationId || null }, occurred_at: new Date().toISOString() }, { ignoreDuplicates: true });
    const charge = outbound ? await chargeCredits({ businessId: account.business_id, idempotencyKey: `usage:messenger:${message.externalEventId}`, kind: 'ai_reply', credits: price, conversationId: conversation.id, reference: { channel: 'messenger', message_id: outbound.id } }).catch(error => { console.error('automation credit charge failed', { message: error?.message }); return { ok: false, charged: 0 }; }) : null;
    if (outbound) await serviceInsert('automation_usage_events', { business_id: account.business_id, conversation_id: conversation.id, message_id: outbound.id, channel_type: 'messenger', unit_type: 'ai_message', quantity: 1, billable_quantity: 1, estimated_cost_minor: 0, currency: 'AMD', provider:generated.engine==='gemini'?'google':'elevenlabs', provider_usage_id: generated.conversationId || null, idempotency_key: `usage:messenger:${message.externalEventId}`, credits: charge?.charged || 0, metadata: { messenger_message_id: sent.messageId || null } }, { ignoreDuplicates: true });
    await serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { last_message_preview: generated.text.slice(0, 1000), last_message_at: new Date().toISOString() }); // after the reply, never slows it
    await markProcessed(webhook.id, account.business_id);
    return json(200, { ok: true });
  } catch (error) {
    if (pendingReply && eventId) await flagFailedReply({ ...pendingReply, eventId });
    console.error('automation-messenger-process error', { eventId, message: error?.message, providerMessage: error?.providerMessage });
    if (eventId) await serviceUpdate('automation_webhook_events', `id=eq.${eventId}`, { status: 'failed', last_error: String(error?.message || 'processing_failed').slice(0, 2000) }).catch(() => null);
    return json(Number(error?.status) || 500, { error: 'messenger_message_processing_failed' });
  } finally { stopTyping(); }
}

function internalAuthorized(event) { const expected = String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET || ''); const actual = String(event.headers?.['x-hansora-internal-secret'] || event.headers?.['X-Hansora-Internal-Secret'] || ''); return expected.length >= 32 && actual === expected; }
async function markProcessed(id, businessId) { await serviceUpdate('automation_webhook_events', `id=eq.${id}`, { business_id: businessId, status: 'processed', processed_at: new Date().toISOString(), last_error: null }); }
