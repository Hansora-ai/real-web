import { first, serviceInsert, serviceUpdate } from '../../lib/automation/db.mjs';
import { generateAutomationReply } from '../../lib/automation/provider.mjs';
import { canAfford, chargeCredits, handleOutOfCredits, automationPricesFor } from '../../lib/automation/billing.mjs';
import { notifyOwner } from '../../lib/automation/notify.mjs';
import { prepareConversationActions } from '../../lib/automation/tools.mjs';
import { flagFailedReply } from '../../lib/automation/failure.mjs';
import { buildConversationContext, loadConversationMemory } from '../../lib/automation/history.mjs';
import { ensureAgentUpToDate } from '../../lib/automation/agent-sync.mjs';
import { burstNote, hasNewerCustomerMessage, unansweredCustomerMessages } from '../../lib/automation/turns.mjs';
import { phonePauseExpired } from '../../lib/automation/whatsapp.mjs';
import { sendWaitingNote } from '../../lib/automation/waiting-note.mjs';
import { makeProductPhotoSender } from '../../lib/automation/product-photos.mjs';

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

// Answers one website chat message (same steps as Telegram: one answer per turn, AI with the business's actions,
// charge the same credits as a DM). "Sending" is saving the reply: the visitor's bubble picks it up (chat.js polls).
export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!internalAuthorized(event)) return json(401, { error: 'unauthorized' });
  const startedAt = Date.now();
  let eventId = '', pendingReply = null;
  try {
    const body = JSON.parse(event.body || '{}'); eventId = String(body.event_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) return json(400, { error: 'invalid_event_id' });
    const webhook = await first(`/rest/v1/automation_webhook_events?id=eq.${eventId}&provider=eq.website&event_type=eq.website_message&status=in.(received,failed)&select=*&limit=1`);
    if (!webhook) return json(200, { ok: true, replayed: true });
    const { business_id: businessId, conversation_id: conversationId, contact_id: contactId, message_id: messageId } = webhook.payload || {};
    await serviceUpdate('automation_webhook_events', `id=eq.${webhook.id}`, { status: 'processing', attempt_count: Number(webhook.attempt_count || 0) + 1, last_error: null });
    const [inbound, conversation, contact, connection] = await Promise.all([
      first(`/rest/v1/automation_messages?id=eq.${messageId}&business_id=eq.${businessId}&select=*&limit=1`),
      first(`/rest/v1/automation_conversations?id=eq.${conversationId}&business_id=eq.${businessId}&select=*&limit=1`),
      first(`/rest/v1/automation_contacts?id=eq.${contactId}&business_id=eq.${businessId}&select=*&limit=1`),
      first(`/rest/v1/automation_channel_connections?business_id=eq.${businessId}&channel_type=eq.website&select=*&limit=1`)
    ]);
    if (!inbound || !conversation || !contact) throw new Error('website_message_not_found');
    const customerName = contact.display_name && contact.display_name !== 'Website visitor' ? contact.display_name : 'Website visitor';

    // A paused chat comes back to the AI once the team has been quiet for a while (like the other channels).
    if (!conversation.ai_enabled) {
      const lastHuman = await first(`/rest/v1/automation_messages?conversation_id=eq.${conversation.id}&sender_type=eq.human&select=metadata,created_at&order=created_at.desc&limit=1`).catch(() => null);
      if (phonePauseExpired(lastHuman)) { await serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { ai_enabled: true, status: 'open', updated_at: new Date().toISOString() }); conversation.ai_enabled = true; conversation.status = 'open'; }
    }
    const settings = connection?.settings || {};
    const aiWillReply = !(settings.automatic_replies === false || !conversation.ai_enabled || ['human_handling', 'resolved', 'archived'].includes(conversation.status) || connection?.status !== 'connected');
    if (!aiWillReply) {
      if (connection?.status === 'connected') await sendWaitingNote({ businessId, conversation, settings, provider: 'website', send: async () => {} });
      await markProcessed(webhook.id, businessId); return json(200, { ok: true, ai_skipped: true });
    }

    const settle = promise => promise.then(value => ({ value }), error => ({ error }));
    const take = result => { if (result.error) throw result.error; return result.value; };
    const rates = await automationPricesFor(businessId); const price = rates.aiReply;
    const aiResourceP = settle(ensureAgentUpToDate({ businessId }).catch(error => console.error('automation agent auto-update failed', { message: error?.message })).then(() => first(`/rest/v1/automation_provider_resources?business_id=eq.${businessId}&provider=eq.elevenlabs&resource_type=eq.agent&status=eq.active&select=*&limit=1`)));
    const affordableP = settle(canAfford(businessId, price));
    const [memory, actions] = await Promise.all([
      loadConversationMemory({ businessId, conversationId: conversation.id, contactId: contact.id }),
      prepareConversationActions({ businessId, conversationId: conversation.id, contactId: contact.id, channel: 'website', contact: { name: customerName === 'Website visitor' ? '' : customerName, externalId: contact.external_contact_id, phone: contact.primary_phone || '', email: contact.primary_email || '' }, sendImage: makeProductPhotoSender({ businessId, conversationId: conversation.id, provider: 'website', send: async () => ({ messageId: null }) }) })
    ]);

    const turn = { conversationId: conversation.id, occurredAt: inbound.occurred_at, createdAt: inbound.created_at, messageId: inbound.id };
    if (await hasNewerCustomerMessage(turn)) { await markProcessed(webhook.id, businessId); return json(200, { ok: true, answered_by_newer_message: true }); }
    const pendingQuestions = burstNote(await unansweredCustomerMessages(turn));
    pendingReply = { businessId, conversationId: conversation.id, customer: customerName, channel: 'Website' };
    const aiResource = take(await aiResourceP); const affordable = take(await affordableP);
    if (!aiResource) throw new Error('ai_provider_agent_not_ready');
    if (!affordable.ok) { pendingReply = null; await handleOutOfCredits({ businessId, conversationId: conversation.id, channel: 'Website', customer: customerName, notifyOwner }); await markProcessed(webhook.id, businessId); return json(200, { ok: true, out_of_credits: true }); }
    const known = [contact.primary_phone ? `The visitor's phone number is ${contact.primary_phone}.` : '', contact.primary_email ? `The visitor's email is ${contact.primary_email}.` : ''].filter(Boolean).join(' ');
    const page = inbound.metadata?.page ? `They are on this page of the business's website: ${inbound.metadata.page}.` : '';
    const context = buildConversationContext({ intro: ['Continue this chat with a visitor of the business\'s own website (the chat bubble on their site). Keep the reply concise.', page, known ? `${known} Do not ask for details you already have.` : '', actions.contextLine].filter(Boolean), memory, after: [actions.liveBrief, pendingQuestions] });
    const generated = await generateAutomationReply({ businessId, rulesHash: aiResource.safe_config?.rules_hash || null, providerResourceId: aiResource.provider_resource_id, text: inbound.content, context, channel: 'website', onToolCall: actions.onToolCall, checkTimes: actions.checkTimes, knownTimes: actions.knownTimes });
    const handedOff = generated.toolCalls?.some(call => call.name === 'handoff_to_human' && call.ok);
    const replyDelay = Math.min(30, Math.max(0, Number(settings.reply_delay) || 0)); const waitMs = replyDelay * 1000 - (Date.now() - startedAt); if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
    const current = await first(`/rest/v1/automation_conversations?id=eq.${conversation.id}&select=ai_enabled,status&limit=1`);
    if (!handedOff && (!current?.ai_enabled || ['human_handling', 'resolved', 'archived'].includes(current.status))) { pendingReply = null; await markProcessed(webhook.id, businessId); return json(200, { ok: true, ai_skipped: true }); }
    if (await hasNewerCustomerMessage(turn)) { pendingReply = null; await markProcessed(webhook.id, businessId); return json(200, { ok: true, answered_by_newer_message: true }); }
    if (!generated.text) { pendingReply = null; await markProcessed(webhook.id, businessId); return json(200, { ok: true, empty_reply: true }); }
    pendingReply = null;
    const outbound = await serviceInsert('automation_messages', { business_id: businessId, conversation_id: conversation.id, idempotency_key: `website:out:${inbound.id}`, direction: 'outbound', sender_type: 'ai', content_type: 'text', content: generated.text, status: 'sent', billable: true, provider: 'website', model: generated.model || 'eleven-agents', provider_message_id: null, metadata: { source: 'website', elevenlabs_conversation_id: generated.conversationId || null }, occurred_at: new Date().toISOString() }, { ignoreDuplicates: true });
    const charge = outbound ? await chargeCredits({ businessId, idempotencyKey: `usage:website:${inbound.id}`, kind: 'ai_reply', credits: price, conversationId: conversation.id, reference: { channel: 'website', message_id: outbound.id } }).catch(error => { console.error('automation credit charge failed', { message: error?.message }); return { ok: false, charged: 0 }; }) : null;
    if (outbound) await serviceInsert('automation_usage_events', { business_id: businessId, conversation_id: conversation.id, message_id: outbound.id, channel_type: 'website', unit_type: 'ai_message', quantity: 1, billable_quantity: 1, estimated_cost_minor: 0, currency: 'AMD', provider: generated.engine === 'gemini' ? 'google' : 'elevenlabs', provider_usage_id: generated.conversationId || null, idempotency_key: `usage:website:${inbound.id}`, credits: charge?.charged || 0, metadata: { source: 'website' } }, { ignoreDuplicates: true });
    await serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { last_message_preview: generated.text.slice(0, 1000), last_message_at: new Date().toISOString() });
    await markProcessed(webhook.id, businessId);
    return json(200, { ok: true });
  } catch (error) {
    if (pendingReply && eventId) await flagFailedReply({ ...pendingReply, eventId });
    console.error('automation-website-process error', { eventId, message: error?.message });
    if (eventId) await serviceUpdate('automation_webhook_events', `id=eq.${eventId}`, { status: 'failed', last_error: String(error?.message || 'processing_failed').slice(0, 2000) }).catch(() => null);
    return json(Number(error?.status) || 500, { error: 'website_message_processing_failed' });
  }
}

function internalAuthorized(event) { const expected = String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET || ''); const actual = String(event.headers?.['x-hansora-internal-secret'] || event.headers?.['X-Hansora-Internal-Secret'] || ''); return expected.length >= 32 && actual === expected; }
async function markProcessed(id, businessId) { await serviceUpdate('automation_webhook_events', `id=eq.${id}`, { business_id: businessId, status: 'processed', processed_at: new Date().toISOString(), last_error: null }); }
