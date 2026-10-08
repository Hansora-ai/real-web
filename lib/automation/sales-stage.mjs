// Where each chat stands on the way to the business's goal (an order, a booking, contact details), read once the
// chat has been quiet for 30 minutes (automation-sales-stage, every 10 minutes) – one cheap check per conversation
// instead of one after every reply. Orders and bookings mark the chat Done at once. Shown in the inbox as stage tabs and badges.
//   new        just started / only greetings or general questions
//   interested asking about specific products, services, prices or availability
//   ready      has chosen and is asking how to order/book/pay/deliver, or giving their details
//   done       an order or booking was made (or contact details saved when that is the goal)
//   lost       said no, not interested, or what they want is not available and they accepted that
// "Went quiet" is not stored: the inbox shows interested/ready chats with no customer message for 24 hours as quiet.
import * as db from './db.mjs';
import { geminiGenerate } from './media.mjs';
import { formatHistory } from './history.mjs';

export const SALES_STAGES = ['new', 'interested', 'ready', 'done', 'lost'];
const enc = value => encodeURIComponent(String(value));
const LITE_MODELS = [process.env.GEMINI_TEXT_MODEL, 'gemini-2.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3-flash-lite', 'gemini-2.5-flash-lite', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-flash-latest'];

export function stagePrompt({ businessName = '', businessType = '', history = '', saved = [] }) {
  return [
    `You read a customer chat of ${businessName || 'a business'}${businessType ? ` (${businessType})` : ''} and say where the customer stands on the way to buying, booking or leaving their contact.`,
    'Stages: "new" (only greetings or general questions), "interested" (asks about specific products, services, prices or availability), "ready" (has chosen and asks how to order, book, pay or get it delivered, or is giving their details), "done" (an order or booking was made), "lost" (said no or not interested, or what they want is not available and they accepted that).',
    saved.length ? `Already saved for this customer: ${saved.join('; ')}.` : 'Nothing is saved for this customer yet.',
    'Also give "interest": what they want, in at most 8 words in English (for example "Milan armchair, green, 2 pieces"), and "value": the total price of what they want if the chat states it (a number), else null, with "currency" as a 3-letter code or null.',
    'Reply with JSON only: {"stage": "...", "interest": "...", "value": number or null, "currency": "..." or null}.',
    `Chat (oldest first):\n${String(history).slice(-12000)}`
  ].join('\n\n');
}

export function parseStage(text) {
  let data; try { data = JSON.parse(String(text || '').replace(/^```(?:json)?|```$/g, '').trim()); } catch (_) { return null; }
  if (!SALES_STAGES.includes(data?.stage)) return null;
  const value = Number(data.value);
  return { stage: data.stage, interest: String(data.interest || '').replace(/\s+/g, ' ').trim().slice(0, 200), value: Number.isFinite(value) && value > 0 && value < 1e12 ? Math.round(value * 100) / 100 : null, currency: /^[A-Z]{3}$/.test(String(data.currency || '')) ? data.currency : null };
}

let columnsMissing = false;
export async function updateSalesStage({ businessId, conversationId }, overrides = {}) {
  const d = { first: db.first, rows: db.rows, supabaseRequest: db.supabaseRequest, serviceUpdate: db.serviceUpdate, generate: geminiGenerate, ...overrides };
  if (columnsMissing || !businessId || !conversationId) return null;
  try {
    const [business, messages, outcomes] = await Promise.all([
      d.first(`/rest/v1/automation_businesses?id=eq.${enc(businessId)}&select=name,category&limit=1`).catch(() => null),
      d.supabaseRequest(`/rest/v1/automation_messages?conversation_id=eq.${enc(conversationId)}&direction=neq.internal&select=sender_type,content,occurred_at&order=occurred_at.desc&limit=40`).then(d.rows),
      d.supabaseRequest(`/rest/v1/automation_outcomes?business_id=eq.${enc(businessId)}&conversation_id=eq.${enc(conversationId)}&status=neq.cancelled&select=outcome_type,title&limit=10`).then(d.rows).catch(() => [])
    ]);
    if (!messages.length) return null;
    const saved = outcomes.map(item => `${item.outcome_type}: ${item.title}`);
    // An order or booking in this chat is the goal reached, whatever the wording.
    const reached = outcomes.some(item => ['order', 'booking'].includes(item.outcome_type));
    const result = await d.generate({ parts: [{ text: stagePrompt({ businessName: business?.name, businessType: business?.category, history: formatHistory(messages.reverse()), saved }) }], json: true, models: LITE_MODELS, label: 'sales stage', timeoutMs: 15000 });
    const parsed = parseStage(result?.text) || (reached ? { stage: 'done', interest: '', value: null, currency: null } : null);
    if (!parsed) return null;
    if (reached && parsed.stage !== 'lost') parsed.stage = 'done';
    await d.serviceUpdate('automation_conversations', `id=eq.${enc(conversationId)}&business_id=eq.${enc(businessId)}`, { sales_stage: parsed.stage, sales_interest: parsed.interest, sales_value: parsed.value, sales_currency: parsed.currency, sales_updated_at: new Date().toISOString() });
    return parsed;
  } catch (error) {
    // Before SQL 13 the columns do not exist: stop trying until the next deploy.
    if (/sales_stage|column/i.test(JSON.stringify(error?.details || '') + String(error?.message || ''))) columnsMissing = true;
    console.warn('sales stage not updated', { message: error?.message });
    return null;
  }
}
