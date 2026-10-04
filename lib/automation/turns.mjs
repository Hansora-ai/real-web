// One answer per customer turn. Customers often send a photo and then a question, or two short messages in a row;
// each arrives as its own webhook. Every message is answered by the newest one in the turn: an older message's
// processor steps aside when a newer customer message exists (checked before and after the AI writes, so nothing
// is sent or charged twice), and the newest one waits for photos / voice notes of the same turn that are still
// being understood, so its answer knows about them.
import * as db from './db.mjs';

export const PENDING_MEDIA_MAX_MS = 20000;
const POLL_MS = 1200;
const enc = value => encodeURIComponent(String(value));

// True when the customer wrote again after this message (same conversation).
export async function hasNewerCustomerMessage({ conversationId, occurredAt, createdAt, messageId }, overrides = {}) {
  const d = { first: db.first, ...overrides };
  if (!conversationId || !occurredAt) return false;
  const later = createdAt ? `or=(occurred_at.gt.${enc(occurredAt)},and(occurred_at.eq.${enc(occurredAt)},created_at.gt.${enc(createdAt)}))` : `occurred_at=gt.${enc(occurredAt)}`;
  const row = await d.first(`/rest/v1/automation_messages?conversation_id=eq.${enc(conversationId)}&sender_type=eq.customer&${later}${messageId ? `&id=neq.${enc(messageId)}` : ''}&select=id&limit=1`).catch(() => null);
  return Boolean(row);
}

// Waits (up to PENDING_MEDIA_MAX_MS) while an earlier photo / voice note of this turn is still being understood.
// Returns true if it had to wait, so the caller reloads the conversation before answering.
export async function waitForPendingMedia({ conversationId, occurredAt, messageId }, overrides = {}) {
  const d = { first: db.first, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), now: Date.now, maxMs: PENDING_MEDIA_MAX_MS, ...overrides };
  if (!conversationId || !occurredAt) return false;
  const since = new Date(Date.parse(occurredAt) - 120000).toISOString();
  const started = d.now();
  let waited = false;
  while (d.now() - started < d.maxMs) {
    const pending = await d.first(`/rest/v1/automation_messages?conversation_id=eq.${enc(conversationId)}&sender_type=eq.customer&metadata->>media_pending=eq.true&occurred_at=gte.${enc(since)}&occurred_at=lte.${enc(occurredAt)}${messageId ? `&id=neq.${enc(messageId)}` : ''}&select=id&limit=1`).catch(() => null);
    if (!pending) return waited;
    waited = true;
    await d.sleep(POLL_MS);
  }
  return waited;
}

// The latest chat lines plus the business basics, given to Gemini so it can say what a photo means in this chat.
export async function mediaContext({ businessId, history = '' }, overrides = {}) {
  const d = { first: db.first, ...overrides };
  const [business, knowledge] = await Promise.all([
    d.first(`/rest/v1/automation_businesses?id=eq.${enc(businessId)}&select=name,description&limit=1`).catch(() => null),
    d.first(`/rest/v1/automation_business_knowledge?business_id=eq.${enc(businessId)}&select=services_and_prices,frequently_asked_questions&limit=1`).catch(() => null)
  ]);
  return [
    business?.name ? `Business: ${business.name}${business.description ? ` — ${String(business.description).slice(0, 400)}` : ''}` : '',
    knowledge?.services_and_prices ? `Products, services and prices:\n${String(knowledge.services_and_prices).slice(0, 2500)}` : '',
    history ? `Latest messages:\n${String(history).split('\n').slice(-8).join('\n')}` : ''
  ].filter(Boolean).join('\n\n');
}

// The customer's messages since the last reply (oldest first), including this one. When there are several, the
// answer must cover all of them: "how can I get that" + "when do I see the issue" get one reply answering both.
export async function unansweredCustomerMessages({ conversationId, occurredAt }, overrides = {}) {
  const d = { supabaseRequest: db.supabaseRequest, rows: db.rows, ...overrides };
  if (!conversationId || !occurredAt) return [];
  const recent = d.rows(await d.supabaseRequest(`/rest/v1/automation_messages?conversation_id=eq.${enc(conversationId)}&occurred_at=lte.${enc(occurredAt)}&direction=neq.internal&select=sender_type,content&order=occurred_at.desc&limit=12`).catch(() => []));
  const burst = [];
  for (const item of recent) { if (item.sender_type !== 'customer') break; burst.unshift(String(item.content || '').trim()); }
  return burst.filter(Boolean);
}

export function burstNote(messages = []) {
  if (messages.length < 2) return '';
  return `The customer sent ${messages.length} messages in a row that have no reply yet:\n${messages.map((text, index) => `${index + 1}. ${text.slice(0, 1500)}`).join('\n')}\nAnswer all of them together in this one reply, in a natural order. Do not ignore the earlier ones.`;
}
