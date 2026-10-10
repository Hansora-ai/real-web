import { first, rows, serviceInsert, serviceUpdate, serviceUpsert, supabaseRequest } from '../../lib/automation/db.mjs';
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
import { listTikTokMessages, readTikTokMessage, sendTikTokImage, sendTikTokText, sendTikTokTyping, tiktokMediaUrl } from '../../lib/automation/tiktok.mjs';
import { tiktokAccountFor, tiktokTokenFor } from '../../lib/automation/tiktok-account.mjs';
import { makeProductPhotoSender } from '../../lib/automation/product-photos.mjs';

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const enc = value => encodeURIComponent(String(value));
const LABELS = { IMAGE: '📷 Photo', VIDEO: '🎬 Video', SHARE_POST: '↪️ Shared a TikTok post', STICKER: '🙂 Sticker', EMOJI: '🙂 Emoji', TEMPLATE: '📋 Message', OTHER: '📎 Message' };
// Only recent messages are taken from TikTok (older history stays in the TikTok app).
const RECENT_MS = 48 * 3600000;

// Answers a TikTok direct message (same steps as Messenger: save, understand media, one answer per turn, AI, send,
// charge). New messages are read from TikTok's API; replies the owner typed in the TikTok app pause the AI.
export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!internalAuthorized(event)) return json(401, { error: 'unauthorized' });
  const startedAt = Date.now();
  let eventId = '', stopTyping = () => {}, pendingReply = null;
  try {
    const body = JSON.parse(event.body || '{}'); eventId = String(body.event_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) return json(400, { error: 'invalid_event_id' });
    const webhook = await first(`/rest/v1/automation_webhook_events?id=eq.${eventId}&event_type=eq.tiktok_message&status=in.(received,failed)&select=*&limit=1`);
    if (!webhook) return json(200, { ok: true, replayed: true });
    const target = webhook.payload || {};
    const [, account] = await Promise.all([
      serviceUpdate('automation_webhook_events', `id=eq.${webhook.id}`, { status: 'processing', attempt_count: Number(webhook.attempt_count || 0) + 1, last_error: null }),
      tiktokAccountFor({ tiktokBusinessId: target.businessId })
    ]);
    if (!account) throw new Error('tiktok_account_not_connected');
    const token = await tiktokTokenFor(account);
    const businessId = account.business_id, tiktokBusinessId = account.provider_resource_id, conversationId = String(target.conversationId || '');
    const connection = await first(`/rest/v1/automation_channel_connections?business_id=eq.${businessId}&channel_type=eq.tiktok&select=*&limit=1`);

    // What is new in this conversation: customer messages and replies typed in the TikTok app, oldest first.
    const listed = (await listTikTokMessages({ businessId: tiktokBusinessId, conversationId, token })).messages.map(readTikTokMessage)
      .filter(item => item.id && item.timestamp > Date.now() - RECENT_MS).sort((a, b) => a.timestamp - b.timestamp);
    const known = new Set(listed.length ? rows(await supabaseRequest(`/rest/v1/automation_messages?business_id=eq.${businessId}&external_message_id=in.(${listed.map(item => `"${item.id}"`).join(',')})&select=external_message_id`)).map(row => row.external_message_id) : []);
    const fresh = listed.filter(item => !known.has(item.id));
    const customerSide = listed.find(item => !item.fromBusiness) || listed[0];
    if (!fresh.length || !customerSide) { await markProcessed(webhook.id, businessId); return json(200, { ok: true, nothing_new: true }); }

    const customerId = customerSide.customerId || conversationId;
    const customerName = customerSide.customerName || 'TikTok customer';
    // Keep tags and fields the team added to this contact.
    const knownContact = await first(`/rest/v1/automation_contacts?business_id=eq.${businessId}&channel_type=eq.tiktok&external_contact_id=eq.${encodeURIComponent(customerId)}&select=profile&limit=1`);
    const contact = await serviceUpsert('automation_contacts', 'business_id,channel_type,external_contact_id', { business_id: businessId, display_name: customerName, channel_type: 'tiktok', external_contact_id: customerId, last_seen_at: new Date(fresh[fresh.length - 1].timestamp).toISOString(), profile: { ...(knownContact?.profile || {}), tiktok_id: customerId, tiktok_conversation_id: conversationId, name: customerName, ...(customerSide.customerPicture ? { profile_pic: customerSide.customerPicture } : {}), profile_checked_at: new Date().toISOString() } });
    const shownOf = item => item.text || (item.type === 'SHARE_POST' && item.postUrl ? `${LABELS.SHARE_POST} ${item.postUrl}` : LABELS[item.type] || 'Message');
    const conversation = await serviceUpsert('automation_conversations', 'business_id,channel_type,external_thread_id', { business_id: businessId, contact_id: contact.id, channel_connection_id: connection?.id || null, channel_type: 'tiktok', external_thread_id: conversationId, status: 'open', last_message_preview: shownOf(fresh[fresh.length - 1]).slice(0, 1000), last_message_at: new Date(fresh[fresh.length - 1].timestamp).toISOString() });

    // Replies typed in the TikTok app (not sent by Hansora, not TikTok's automatic messages): shown, and the AI pauses.
    // Hansora's own reply may be saved a moment after TikTok lists it: wait, then a business message counts as the
    // owner's only if its id is still unknown and Hansora did not send the same text in this chat just now.
    let teamReplies = fresh.filter(item => item.fromBusiness && !item.automatic);
    if (teamReplies.length) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const ids = teamReplies.map(item => `"${item.id}"`).join(',');
      const savedNow = new Set(rows(await supabaseRequest(`/rest/v1/automation_messages?business_id=eq.${businessId}&external_message_id=in.(${ids})&select=external_message_id`)).map(row => row.external_message_id));
      const since = new Date(Date.now() - 3 * 60000).toISOString();
      const recentOwn = new Set(rows(await supabaseRequest(`/rest/v1/automation_messages?business_id=eq.${businessId}&direction=eq.outbound&occurred_at=gte.${enc(since)}&select=content,metadata`)).filter(row => row.metadata?.source !== 'tiktok_app').map(row => String(row.content || '').trim()));
      teamReplies = teamReplies.filter(item => !savedNow.has(item.id) && !(item.text && recentOwn.has(item.text.trim())));
    }
    for (const item of teamReplies) await serviceInsert('automation_messages', { business_id: businessId, conversation_id: conversation.id, external_message_id: item.id, idempotency_key: `tiktok:team:${item.id}`, direction: 'outbound', sender_type: 'human', content_type: 'text', content: shownOf(item), status: 'sent', billable: false, provider: 'tiktok', provider_message_id: item.id, metadata: { source: 'tiktok_app' }, occurred_at: new Date(item.timestamp).toISOString() }, { ignoreDuplicates: true });
    const customerMessages = fresh.filter(item => !item.fromBusiness);
    if (teamReplies.length && teamReplies[teamReplies.length - 1].timestamp > (customerMessages[customerMessages.length - 1]?.timestamp || 0)) {
      await serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { ai_enabled: false, status: 'human_handling', updated_at: new Date().toISOString() });
      await markProcessed(webhook.id, businessId); return json(200, { ok: true, team_replied: true });
    }
    if (!customerMessages.length) { await markProcessed(webhook.id, businessId); return json(200, { ok: true, nothing_new: true }); }

    // Earlier unseen customer messages are saved as they are; the newest one is the turn the AI answers.
    for (const item of customerMessages.slice(0, -1)) await serviceInsert('automation_messages', { business_id: businessId, conversation_id: conversation.id, external_message_id: item.id, idempotency_key: `tiktok:in:${item.id}`, direction: 'inbound', sender_type: 'customer', content_type: 'text', content: shownOf(item), status: 'received', billable: false, provider: 'tiktok', provider_message_id: item.id, metadata: { sender_id: customerId, conversation_id: conversationId }, occurred_at: new Date(item.timestamp).toISOString() }, { ignoreDuplicates: true });
    const message = customerMessages[customerMessages.length - 1];
    const occurredAt = new Date(message.timestamp).toISOString();
    const mediaKind = { IMAGE: 'image', VIDEO: 'video' }[message.type] || '';
    const hasMedia = Boolean(mediaKind && message.mediaId);
    const shown = shownOf(message);

    const settle = promise => promise.then(value => ({ value }), error => ({ error }));
    const take = result => { if (result.error) throw result.error; return result.value; };
    const price = automationPrices().aiReply;
    const aiResourceP = settle(ensureAgentUpToDate({ businessId }).catch(error => console.error('automation agent auto-update failed', { message: error?.message })).then(() => first(`/rest/v1/automation_provider_resources?business_id=eq.${businessId}&provider=eq.elevenlabs&resource_type=eq.agent&status=eq.active&select=*&limit=1`)));
    const affordableP = settle(canAfford(businessId, price));
    const send = { businessId: tiktokBusinessId, conversationId, token };
    const [inbound, memory, actions] = await Promise.all([
      serviceInsert('automation_messages', { business_id: businessId, conversation_id: conversation.id, external_message_id: message.id, idempotency_key: `tiktok:in:${message.id}`, direction: 'inbound', sender_type: 'customer', content_type: hasMedia ? mediaKind : 'text', content: shown, status: 'received', billable: false, provider: 'tiktok', provider_message_id: message.id, metadata: { sender_id: customerId, conversation_id: conversationId, ...(hasMedia ? { media_pending: true } : {}) }, occurred_at: occurredAt }, { ignoreDuplicates: true }),
      loadConversationMemory({ businessId, conversationId: conversation.id, contactId: contact.id, excludeExternalId: message.id }),
      prepareConversationActions({ businessId, conversationId: conversation.id, contactId: contact.id, channel: 'tiktok', contact: { name: customerName === 'TikTok customer' ? '' : customerName, externalId: customerId }, sendImage: makeProductPhotoSender({ businessId, conversationId: conversation.id, provider: 'tiktok', send: ({ url }) => sendTikTokImage({ ...send, url }) }) })
    ]);
    if (!inbound) { await markProcessed(webhook.id, businessId); return json(200, { ok: true, duplicate: true }); }
    // A paused chat comes back to the AI once the owner has been quiet for a while (like the other channels).
    if (!conversation.ai_enabled) {
      const lastHuman = await first(`/rest/v1/automation_messages?conversation_id=eq.${conversation.id}&sender_type=eq.human&select=metadata,created_at&order=created_at.desc&limit=1`).catch(() => null);
      if (phonePauseExpired(lastHuman)) { await serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { ai_enabled: true, status: 'open', updated_at: new Date().toISOString() }); conversation.ai_enabled = true; conversation.status = 'open'; }
    }
    const settings = connection?.settings || {};
    const aiWillReply = !(settings.automatic_replies === false || !conversation.ai_enabled || ['human_handling', 'resolved', 'archived'].includes(conversation.status) || connection?.status !== 'connected');
    if (aiWillReply) { sendTikTokTyping(send).catch(() => null); stopTyping = keepTyping(() => sendTikTokTyping(send), { everyMs: 4500, immediate: false }); }

    let media = null, understood = null, aiText = message.text;
    if (hasMedia) {
      try {
        const url = await tiktokMediaUrl({ ...send, messageId: message.id, mediaId: message.mediaId, mediaType: message.type });
        const context = await mediaContext({ businessId, history: memory.history }).catch(() => '');
        media = url ? await understandMedia({ url, kind: mediaKind, caption: message.text, context, store: { businessId, channel: 'tiktok', conversationId: conversation.id, key: message.id }, afterVisual: file => matchProductPhoto({ businessId, ...file, caption: message.text }) }) : null;
      } catch (error) { console.warn('tiktok media understanding failed', { message: error?.message }); }
      understood = media ? mediaMessage({ source: media.kind, media, caption: message.text }) : mediaFallback({ kind: mediaKind, caption: message.text });
      if (understood) aiText = understood.aiText;
      await serviceUpdate('automation_messages', `id=eq.${inbound.id}`, { content: understood?.content || shown, metadata: { sender_id: customerId, conversation_id: conversationId, media_pending: false, ...(media?.mediaPath ? { media_path: media.mediaPath, media_mime: media.mimeType } : {}) } }).catch(() => null);
      if (understood) await serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { last_message_preview: understood.content.slice(0, 1000) }).catch(() => null);
    } else if (message.type === 'SHARE_POST') aiText = message.text || 'What about this TikTok post?';
    if (!aiWillReply || !String(aiText || '').trim()) { await markProcessed(webhook.id, businessId); return json(200, { ok: true, ai_skipped: true }); }

    const turn = { conversationId: conversation.id, occurredAt: inbound.occurred_at || occurredAt, createdAt: inbound.created_at, messageId: inbound.id };
    if (await hasNewerCustomerMessage(turn)) { await markProcessed(webhook.id, businessId); return json(200, { ok: true, answered_by_newer_message: true }); }
    const liveMemory = await waitForPendingMedia(turn) ? await loadConversationMemory({ businessId, conversationId: conversation.id, contactId: contact.id, excludeExternalId: message.id }) : memory;
    const pendingQuestions = burstNote(await unansweredCustomerMessages(turn));
    pendingReply = { businessId, conversationId: conversation.id, customer: customerName, channel: 'TikTok' };
    const aiResource = take(await aiResourceP); const affordable = take(await affordableP);
    if (!aiResource) throw new Error('ai_provider_agent_not_ready');
    if (!affordable.ok) { pendingReply = null; await handleOutOfCredits({ businessId, conversationId: conversation.id, channel: 'TikTok', customer: customerName, notifyOwner }); await markProcessed(webhook.id, businessId); return json(200, { ok: true, out_of_credits: true }); }
    const mediaNote = understood ? understood.note : message.type === 'SHARE_POST' ? `The customer shared a TikTok post${message.postUrl ? ` (${message.postUrl})` : ''}. You cannot watch it; ask what they would like to know about it if it is not clear.` : (!message.text && message.type !== 'TEXT' ? 'The latest customer message is a sticker or another item you cannot open. Do not pretend to know its contents; ask the customer to describe it in text if needed.' : '');
    const context = buildConversationContext({ intro: ['Continue this TikTok direct message conversation. Keep the reply concise.', actions.contextLine, mediaNote].filter(Boolean), memory: liveMemory, after: [actions.liveBrief, pendingQuestions] });
    const generated = await generateAutomationReply({ businessId, rulesHash: aiResource.safe_config?.rules_hash || null, providerResourceId: aiResource.provider_resource_id, text: aiText, context, channel: 'tiktok', onToolCall: actions.onToolCall, checkTimes: actions.checkTimes, knownTimes: actions.knownTimes });
    const handedOff = generated.toolCalls?.some(call => call.name === 'handoff_to_human' && call.ok);
    const replyDelay = Math.min(30, Math.max(0, Number(settings.reply_delay) || 0)); const waitMs = replyDelay * 1000 - (Date.now() - startedAt); if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
    const current = await first(`/rest/v1/automation_conversations?id=eq.${conversation.id}&select=ai_enabled,status&limit=1`);
    if (!handedOff && (!current?.ai_enabled || ['human_handling', 'resolved', 'archived'].includes(current.status))) { pendingReply = null; await markProcessed(webhook.id, businessId); return json(200, { ok: true, ai_skipped: true }); }
    if (await hasNewerCustomerMessage(turn)) { pendingReply = null; await markProcessed(webhook.id, businessId); return json(200, { ok: true, answered_by_newer_message: true }); }
    if (!generated.text) { pendingReply = null; await markProcessed(webhook.id, businessId); return json(200, { ok: true, empty_reply: true }); }
    stopTyping(); stopTyping = () => {};
    const sent = await sendTikTokText({ ...send, text: generated.text });
    pendingReply = null;
    const outbound = await serviceInsert('automation_messages', { business_id: businessId, conversation_id: conversation.id, external_message_id: sent.messageId || null, idempotency_key: `tiktok:out:${message.id}`, direction: 'outbound', sender_type: 'ai', content_type: 'text', content: generated.text, status: 'sent', billable: true, provider: 'tiktok', model: generated.model || 'eleven-agents', provider_message_id: sent.messageId || null, metadata: { recipient_id: customerId, conversation_id: conversationId }, occurred_at: new Date().toISOString() }, { ignoreDuplicates: true });
    const charge = outbound ? await chargeCredits({ businessId, idempotencyKey: `usage:tiktok:${message.id}`, kind: 'ai_reply', credits: price, conversationId: conversation.id, reference: { channel: 'tiktok', message_id: outbound.id } }).catch(error => { console.error('automation credit charge failed', { message: error?.message }); return { ok: false, charged: 0 }; }) : null;
    if (outbound) await serviceInsert('automation_usage_events', { business_id: businessId, conversation_id: conversation.id, message_id: outbound.id, channel_type: 'tiktok', unit_type: 'ai_message', quantity: 1, billable_quantity: 1, estimated_cost_minor: 0, currency: 'AMD', provider: generated.engine === 'gemini' ? 'google' : 'elevenlabs', provider_usage_id: generated.conversationId || null, idempotency_key: `usage:tiktok:${message.id}`, credits: charge?.charged || 0, metadata: { tiktok_message_id: sent.messageId || null } }, { ignoreDuplicates: true });
    await serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { last_message_preview: generated.text.slice(0, 1000), last_message_at: new Date().toISOString() });
    await markProcessed(webhook.id, businessId);
    return json(200, { ok: true });
  } catch (error) {
    if (pendingReply && eventId) await flagFailedReply({ ...pendingReply, eventId });
    console.error('automation-tiktok-process error', { eventId, message: error?.message, providerCode: error?.providerCode, providerMessage: error?.providerMessage });
    if (eventId) await serviceUpdate('automation_webhook_events', `id=eq.${eventId}`, { status: 'failed', last_error: String(error?.message || 'processing_failed').slice(0, 2000) }).catch(() => null);
    return json(Number(error?.status) || 500, { error: 'tiktok_message_processing_failed' });
  } finally { stopTyping(); }
}

function internalAuthorized(event) { const expected = String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET || ''); const actual = String(event.headers?.['x-hansora-internal-secret'] || event.headers?.['X-Hansora-Internal-Secret'] || ''); return expected.length >= 32 && actual === expected; }
async function markProcessed(id, businessId) { await serviceUpdate('automation_webhook_events', `id=eq.${id}`, { business_id: businessId, status: 'processed', processed_at: new Date().toISOString(), last_error: null }); }
