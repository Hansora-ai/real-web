// Every AI reply is a fresh ElevenLabs conversation, so Hansora hands over the chat itself: the whole
// conversation (newest messages kept first when it is very long) plus what was already saved for this
// customer, such as orders, bookings and leads. That lets the AI continue orders across many messages.
import * as db from './db.mjs';

export const HISTORY_MAX_MESSAGES = 200;
export const HISTORY_MAX_CHARS = 30000;
const LABELS = { customer: 'Customer', ai: 'Assistant', human: 'Team', system: 'System' };

// Newest messages are kept first; if the chat does not fit, the oldest part is left out and marked.
export function formatHistory(messages = [], maxChars = HISTORY_MAX_CHARS) {
  const lines = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const item = messages[index];
    const content = String(item?.content || '').trim();
    if (!content) continue;
    const line = `${LABELS[item.sender_type] || 'Customer'}: ${content}`;
    if (used + line.length + 1 > maxChars) { lines.unshift('(Earlier messages are omitted.)'); break; }
    lines.unshift(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

export function formatSavedOutcomes(outcomes = []) {
  if (!outcomes.length) return '';
  const names = { order: 'Order', booking: 'Booking', lead: 'Lead' };
  const lines = outcomes.map(item => {
    const when = item.scheduled_start ? `, ${new Date(item.scheduled_start).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '';
    const reference = item.reference_number ? ` #${item.reference_number}` : '';
    return `- ${names[item.outcome_type] || 'Record'}${reference} (${item.status}${when}): ${item.title}`;
  });
  return ['Already saved for this customer (do not create these again; update or refer to them):', ...lines].join('\n');
}

// Returns the history text (without the newest customer message, which is sent as the message itself)
// and the saved-outcomes note.
export async function loadConversationMemory({ businessId, conversationId, contactId = null, excludeLatest = true }, overrides = {}) {
  const d = { supabaseRequest: db.supabaseRequest, rows: db.rows, ...overrides };
  const messages = d.rows(await d.supabaseRequest(`/rest/v1/automation_messages?conversation_id=eq.${encodeURIComponent(conversationId)}&select=sender_type,content,occurred_at&order=occurred_at.desc&limit=${HISTORY_MAX_MESSAGES + 1}`)).reverse();
  const history = formatHistory(excludeLatest ? messages.slice(0, -1) : messages);
  const scope = contactId ? `contact_id=eq.${encodeURIComponent(contactId)}` : `conversation_id=eq.${encodeURIComponent(conversationId)}`;
  const outcomes = d.rows(await d.supabaseRequest(`/rest/v1/automation_outcomes?business_id=eq.${encodeURIComponent(businessId)}&${scope}&status=neq.cancelled&select=outcome_type,title,status,reference_number,scheduled_start&order=created_at.desc&limit=10`).catch(() => []));
  return { history, saved: formatSavedOutcomes(outcomes), messageCount: messages.length };
}

// The full context block handed to the AI with each customer message.
export function buildConversationContext({ intro = [], memory }) {
  return [
    ...intro,
    memory.saved,
    memory.history ? `Conversation so far (oldest first):\n${memory.history}` : 'This is the start of the conversation.'
  ].filter(Boolean).join('\n\n');
}
