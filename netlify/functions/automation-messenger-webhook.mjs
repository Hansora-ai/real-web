import { first, serviceInsert, serviceUpdate } from '../../lib/automation/db.mjs';
import { extractMessengerEvents, messengerConfig, verifyMessengerSignature } from '../../lib/automation/messenger.mjs';

const text = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: String(body) });

// Facebook Page (Messenger) webhook. Customer messages are queued for the background processor; replies the team
// typed in the Page inbox or Meta Business Suite are shown in the Hansora inbox and pause the AI in that chat.
export async function handler(event) {
  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {}; let config; try { config = messengerConfig(); } catch (_) { return text(503, 'not configured'); }
    return q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === config.verifyToken && q['hub.challenge'] ? text(200, q['hub.challenge']) : text(403, 'forbidden');
  }
  if (event.httpMethod !== 'POST') return text(405, 'method not allowed');
  try {
    if (!verifyMessengerSignature(event.body || '', event.headers?.['x-hub-signature-256'] || event.headers?.['X-Hub-Signature-256'])) return text(401, 'invalid signature');
    let payload; try { payload = JSON.parse(event.body || '{}'); } catch (_) { return text(400, 'invalid json'); }
    for (const item of extractMessengerEvents(payload, messengerConfig().appId)) {
      if (item.type === 'echo') { await saveTeamReply(item).catch(error => console.error('messenger echo not saved', { message: error?.message })); continue; }
      const inserted = await serviceInsert('automation_webhook_events', { provider: 'meta', external_event_id: `messenger:${item.externalEventId}`, event_type: 'messenger_message', payload: item, status: 'received' }, { ignoreDuplicates: true });
      const row = inserted || await first(`/rest/v1/automation_webhook_events?provider=eq.meta&external_event_id=eq.${encodeURIComponent(`messenger:${item.externalEventId}`)}&select=id,status&limit=1`);
      if (row && ['received', 'failed'].includes(row.status)) await dispatchBackground(event, row.id);
    }
    return text(200, 'EVENT_RECEIVED');
  } catch (error) { console.error('automation-messenger-webhook error', { message: error?.message }); return text(500, 'webhook error'); }
}

async function saveTeamReply(item) {
  const account = await first(`/rest/v1/automation_provider_resources?provider=eq.meta&resource_type=eq.facebook_page&provider_resource_id=eq.${encodeURIComponent(item.pageId)}&status=eq.active&select=id,business_id&limit=1`);
  if (!account || !item.customerId) return;
  const conversation = await first(`/rest/v1/automation_conversations?business_id=eq.${account.business_id}&channel_type=eq.messenger&external_thread_id=eq.${encodeURIComponent(item.customerId)}&select=id&limit=1`);
  if (!conversation) return;
  const sentAt = new Date(item.timestamp).toISOString();
  const saved = await serviceInsert('automation_messages', { business_id: account.business_id, conversation_id: conversation.id, external_message_id: item.externalEventId, idempotency_key: `messenger:echo:${item.externalEventId}`, direction: 'outbound', sender_type: 'human', content_type: 'text', content: item.text || 'Message', status: 'sent', billable: false, provider: 'meta', provider_message_id: item.externalEventId, metadata: { source: 'messenger_page_inbox', sent_at: sentAt }, occurred_at: sentAt }, { ignoreDuplicates: true });
  if (saved) await serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { ai_enabled: false, status: 'human_handling', last_message_preview: String(item.text || '').slice(0, 1000), last_message_at: sentAt, updated_at: new Date().toISOString() });
}

async function dispatchBackground(event, eventId) {
  const secret = String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET || '');
  const requestOrigin = (() => { try { return new URL(event.rawUrl || '').origin; } catch (_) { return ''; } })();
  const site = String(process.env.URL || process.env.DEPLOY_PRIME_URL || requestOrigin).replace(/\/$/, '');
  if (!secret || !site) throw new Error('automation_background_not_configured');
  const response = await fetch(`${site}/.netlify/functions/automation-messenger-process-background`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hansora-internal-secret': secret }, body: JSON.stringify({ event_id: eventId }) });
  if (!response.ok && response.status !== 202) throw new Error('automation_background_dispatch_failed');
}
