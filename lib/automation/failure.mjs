// When the AI could not answer a customer (provider down, unexpected error), nobody may be left waiting: the chat is
// marked "Needs you" in the Inbox and the owner gets an alert. The AI still answers the customer's next message.
import { first, serviceUpdate } from './db.mjs';
import { notifyOwner } from './notify.mjs';

export async function flagFailedReply({ businessId, conversationId, customer, channel, eventId }) {
  try {
    await serviceUpdate('automation_conversations', `id=eq.${conversationId}&business_id=eq.${businessId}`, { status: 'needs_attention' });
    const business = await first(`/rest/v1/automation_businesses?id=eq.${businessId}&select=name&limit=1`).catch(() => null);
    await notifyOwner({ businessId, event: 'handoff_requested', idempotencyKey: `reply_failed:${eventId}`, data: { businessId, conversationId, outcomeId: null, business: business?.name || '', channel, customer: customer || 'Customer', reference: '', details: 'The AI could not answer this message. Please reply to the customer yourself.' } });
  } catch (error) { console.error('automation failed-reply alert error', { message: error?.message }); }
}
