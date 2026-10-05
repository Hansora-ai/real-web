import { first, serviceInsert, serviceUpdate } from '../../lib/automation/db.mjs';
import { isInternalCall } from '../../lib/automation/schedule.mjs';

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const enc = value => encodeURIComponent(String(value));

// A message sent from the business's Instagram account. Hansora saves the Instagram id of everything it sends (AI
// replies, inbox replies, automations, product photos); an echo with an unknown id was typed by the owner in the
// Instagram app. Then the AI stops in that chat until the owner turns it back on in the inbox.
export async function processInstagramEcho(echo, overrides = {}) {
  const d = { first, serviceInsert, serviceUpdate, sleep, ownAppId: String(process.env.META_INSTAGRAM_APP_ID || ''), ...overrides };
  if (echo.appId && d.ownAppId && echo.appId === d.ownAppId) return { ours: true };
  const account = await d.first(`/rest/v1/automation_provider_resources?provider=eq.meta&resource_type=eq.instagram_account&provider_resource_id=eq.${enc(echo.businessId)}&status=eq.active&select=id,business_id&limit=1`);
  if (!account) return { ignored: 'account_not_connected' };
  // A reply Hansora just sent may be saved a moment after Instagram reports it: look again before deciding.
  for (const wait of [0, 3000, 5000]) {
    if (wait) await d.sleep(wait);
    const own = await d.first(`/rest/v1/automation_messages?business_id=eq.${account.business_id}&or=(external_message_id.eq.${enc(echo.mid)},provider_message_id.eq.${enc(echo.mid)})&select=id&limit=1`).catch(() => null);
    if (own) return { ours: true, businessId: account.business_id };
  }
  const conversation = await d.first(`/rest/v1/automation_conversations?business_id=eq.${account.business_id}&channel_type=eq.instagram_dm&external_thread_id=eq.${enc(echo.customerId)}&select=id,ai_enabled,status&limit=1`);
  if (!conversation) return { ignored: 'no_conversation', businessId: account.business_id };
  const at = new Date(Number(echo.timestamp) || Date.now()).toISOString();
  await d.serviceInsert('automation_messages', { business_id: account.business_id, conversation_id: conversation.id, external_message_id: echo.mid, provider_message_id: echo.mid, idempotency_key: `meta:instagram:echo:${echo.mid}`, direction: 'outbound', sender_type: 'human', content_type: 'text', content: echo.text || 'Message', status: 'sent', billable: false, provider: 'meta', metadata: { source: 'instagram_app' }, occurred_at: at }, { ignoreDuplicates: true });
  await d.serviceUpdate('automation_conversations', `id=eq.${conversation.id}`, { ai_enabled: false, status: 'human_handling', summary: 'You replied from the Instagram app, so the AI is paused in this chat. Turn it back on in the inbox when you want it to answer again.', last_message_preview: String(echo.text || 'Message').slice(0, 1000), last_message_at: at });
  return { paused: true, businessId: account.business_id, conversationId: conversation.id };
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!isInternalCall(event)) return json(401, { error: 'unauthorized' });
  let eventId = '';
  try {
    eventId = String(JSON.parse(event.body || '{}').event_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) return json(400, { error: 'invalid_event_id' });
    const webhook = await first(`/rest/v1/automation_webhook_events?id=eq.${eventId}&event_type=eq.instagram_echo&status=in.(received,failed)&select=*&limit=1`);
    if (!webhook) return json(200, { ok: true, replayed: true });
    await serviceUpdate('automation_webhook_events', `id=eq.${webhook.id}`, { status: 'processing', attempt_count: Number(webhook.attempt_count || 0) + 1 });
    const result = await processInstagramEcho(webhook.payload || {});
    if (result.paused) console.log('owner replied from Instagram: AI paused in this chat', { conversationId: result.conversationId });
    await serviceUpdate('automation_webhook_events', `id=eq.${webhook.id}`, { ...(result.businessId ? { business_id: result.businessId } : {}), status: 'processed', processed_at: new Date().toISOString(), last_error: null });
    return json(200, { ok: true, ...result });
  } catch (error) {
    console.error('automation-instagram-echo error', { message: error?.message });
    if (eventId) await serviceUpdate('automation_webhook_events', `id=eq.${eventId}`, { status: 'failed', last_error: String(error?.message || 'echo_failed').slice(0, 1000) }).catch(() => null);
    return json(500, { error: 'echo_failed' });
  }
}
