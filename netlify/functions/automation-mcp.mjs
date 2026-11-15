// Hansora Automation MCP server (the "Hansora Automation" ChatGPT app), served at https://hansora.co/automation/mcp.
// Separate from the Creative server (hansora-mcp.mjs, /mcp); it shares the same login (Supabase OAuth) and credits.
//
// What it may show: everything about the owner's own setup (AI employees, knowledge, phone calls, website chats).
// Customer chats from Instagram, WhatsApp, TikTok, Telegram and Messenger are only counted, never shown, because
// those platforms restrict passing their chat data to third parties (see lib/automation-mcp/data.mjs).
import crypto from 'node:crypto';
import { McpServer, createMcpHandler, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { AuthUnavailableError, authenticateToken } from '../../lib/hansora-mcp/data.mjs';
import { syncBusinessAgent } from '../../lib/automation/agent-sync.mjs';
import { startOutgoingCall } from '../../lib/automation/phone-dial.mjs';
import { handler as knowledgeFunction } from './automation-knowledge.mjs';
import { handler as testChatFunction } from './automation-test-chat.mjs';
import { handler as replyFunction } from './automation-conversation-reply.mjs';
import { handler as recordUpdateFunction } from './automation-outcome-update.mjs';
import { handler as phoneLineFunction } from './automation-phone-line.mjs';
import { handler as instagramSyncFunction } from './automation-instagram-sync.mjs';
import {
  RECORD_KINDS, RECORD_STATUSES, addProduct, archiveAutomation, automationView, createAutomation, businessTools, deleteProduct, getAutomaticCalls, listAutomations, listProducts,
  listRecords, ownedAutomation, ownedProduct, ownedRecord, productView, recordView, setAutomaticCalls, setAutomationOn, setBusinessTools, updateProduct
} from '../../lib/automation-mcp/business.mjs';
import {
  ACCOUNT_LINE, ACCOUNT_URL, LANGUAGES, SITE, TONES, account, activity, callView, createEmployee, employeeDetails, employeeSummary, getEmployee, links,
  listCalls, listEmployees, listWebsiteChats, ownedCall, ownedWebsiteChat, phoneLines, resolveEmployee, setChatAnsweredBy,
  updateEmployee, chatView, websiteChatMessages
} from '../../lib/automation-mcp/data.mjs';

export const MCP_URL = new URL('/automation/mcp', SITE);
// ChatGPT gives up on a tool call after roughly a minute; answer well before that.
const TOOL_BUDGET_MS = 25000;

const SERVER_INSTRUCTIONS = [
  'Hansora Automation gives a business an AI employee that answers customers on Instagram, WhatsApp, Telegram, TikTok, a website chat and the phone.',
  'Start with get_overview when the user asks how things are going. Most accounts have one AI employee, so ai_employee_id can be left out; pass it when the account has several.',
  'Credits are shown as they appear on hansora.co. Tools here are free; AI replies, test messages and phone minutes use credits.',
  'Never offer, suggest or promote buying credits, a plan or an upgrade, and never link to a pricing or checkout page. When credits run out, say so as a fact and give the account link from the tool result.',
  'Privacy: customer chats from Instagram, WhatsApp, TikTok, Telegram and Messenger cannot be read or answered here because of those platforms\' rules. You get how many are waiting and a link to the Hansora inbox; give the user that link. Website chats and phone calls can be read here.',
  'Orders, bookings and leads that came from those platforms are listed without the customer\'s name and phone number; the user sees them in Hansora.',
  'Connecting a channel, buying credits and the comment flow builder happen on hansora.co; give the link from the tool result.',
  'When something is missing or wrong in an AI employee and a tool here can fix it, offer to fix it yourself; send the user to hansora.co only for what the tools cannot do.',
  'Before start_ai_call and reply_to_website_chat, confirm the exact number or text with the user. Answer in the user\'s language.'
].join(' ');

function jsonText(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

const INFRASTRUCTURE_ERROR = /automation_database|data_request_failed|server_misconfigured|abort|timeout|timed out|fetch failed|network|socket|ECONN|ENOTFOUND/i;
function toolError(error) {
  // An expected situation with a clear next step for ChatGPT (not shown as a failure).
  if (error?.publicMessage) return jsonText({ ok: false, error: error.code, next_step: error.publicMessage, ...(error.extra || {}) });
  const message = error instanceof Error ? error.message : String(error || 'unknown_error');
  if (INFRASTRUCTURE_ERROR.test(message)) {
    console.warn('automation_mcp_busy', JSON.stringify({ reason: message.slice(0, 200) }));
    return jsonText({ ok: false, error: 'hansora_busy', next_step: 'Tell the user, in their language, that Hansora could not do this for a moment. Wait a few seconds and try the same request once more; if it fails again, ask them to try again in a minute.' });
  }
  console.error('automation_mcp_tool_error', message.slice(0, 300));
  return { isError: true, content: [{ type: 'text', text: message.slice(0, 300) }] };
}

function withBudget(promise, ms = TOOL_BUDGET_MS) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('took_too_long'), { tookTooLong: true })), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// Runs one of the website's own functions in this process, as the signed-in user, so a tool behaves exactly like
// the matching button on hansora.co.
async function runFunction(fn, token, body, { method = 'POST' } = {}) {
  const event = { httpMethod: method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } };
  const response = await fn(method === 'GET' ? { ...event, queryStringParameters: body } : { ...event, body: JSON.stringify(body) });
  let data = {};
  try { data = JSON.parse(response.body || '{}'); } catch { data = {}; }
  return { ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, data };
}

const KNOWLEDGE_ERRORS = {
  ai_employee_not_ready: 'This AI employee is not prepared yet. Call update_ai_employee (with no changes) to prepare it, then add the knowledge again.',
  knowledge_limit_reached: 'This AI employee already has 50 knowledge items. Remove one first.',
  knowledge_url_invalid: 'The link must be a full https:// address.',
  knowledge_text_empty: 'There was no text to add.',
  knowledge_text_too_long: 'The text is too long (300,000 characters at most). Split it into parts.',
  knowledge_document_not_found: 'This knowledge item was not found. Call get_ai_employee to see the current ones.'
};
const CALL_ERRORS = {
  invalid_number: 'The phone number is not valid. Ask for it in international format, for example +1 555 010 2030.',
  purpose_required: 'Ask the user what the AI should say or ask on this call.',
  no_outgoing_line: 'This AI employee has no phone number that can call out yet. The user can get one on the Phone page.',
  other_country: 'The AI employee\'s phone number can only call numbers in its own country.',
  credits_required: `There are not enough credits to start a call. ${ACCOUNT_LINE}`,
  too_many_calls: 'Too many calls were started in the last 10 minutes (5 at most). Try again in a few minutes.',
  phone_service_not_configured: 'Phone calls are unavailable right now. Ask the user to try again later.'
};
const REPLY_ERRORS = {
  invalid_reply: 'The reply must be 1 to 1000 characters.',
  manual_reply_unavailable: 'The reply could not be sent right now. Try once more in a few seconds.'
};

const RECORD_ERRORS = {
  time_already_booked: 'That time is already booked, so the status could not be changed.',
  invalid_status: 'This status is not valid.'
};
const NUMBER_ERRORS = {
  phone_agent_configuration_incomplete: 'Finish setting up the AI employee first (call update_ai_employee), then get a number.',
  invalid_country: 'Pass a two-letter country code, for example US.',
  credits_required: `A phone number needs credits on the account. ${ACCOUNT_LINE}`,
  no_number_available: 'No number is available in this country right now. On the Phone page the user can ask for one or connect their own number.',
  phone_line_setup_failed: 'The number could not be prepared right now. Ask the user to try again later.'
};

const PHONE_KNOWLEDGE_NOTE = 'Knowledge items (texts, files, links) are used in chats only. On phone calls the AI employee knows only the main fields (services_and_prices, opening_hours, delivery_and_service_areas, faq, policies, instructions). For anything it must say on calls, such as prices, put the text itself into services_and_prices or faq with update_ai_employee.';

const documentView = item => ({ knowledge_id: item.id, name: item.name || '', type: item.type, ...(item.url ? { url: item.url } : {}), added_at: item.added_at || null });

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const OUTBOUND = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const employeeId = z.string().optional().describe('The AI employee. Leave out when the account has only one.');

const employeeFields = {
  category: z.string().max(120).optional().describe('Kind of business, for example "Dental clinic" or "Online clothing shop".'),
  description: z.string().max(4000).optional().describe('What the business does, in a few sentences.'),
  contact_phone: z.string().max(80).optional(),
  contact_email: z.string().max(320).optional(),
  timezone: z.string().max(80).optional().describe('IANA time zone of the business, for example "America/New_York". Use the user\'s time zone when known.'),
  assistant_name: z.string().max(120).optional().describe('The name the AI employee introduces itself with.'),
  primary_language: z.enum(LANGUAGES).optional().describe('Main language of the AI employee: en, ru or hy.'),
  supported_languages: z.array(z.enum(LANGUAGES)).max(3).optional(),
  tone: z.enum(TONES).optional(),
  services_and_prices: z.string().max(12000).optional().describe('Services or products with prices.'),
  opening_hours: z.string().max(4000).optional(),
  delivery_and_service_areas: z.string().max(4000).optional(),
  faq: z.string().max(8000).optional().describe('Frequent questions with their answers.'),
  policies: z.string().max(8000).optional().describe('Returns, cancellations, payment and similar rules.'),
  custom_instructions: z.string().max(12000).optional().describe('How the AI employee should behave: what to ask, what to offer, when to hand over to a person.'),
  prohibited_instructions: z.string().max(8000).optional().describe('What the AI employee must never say or do.')
};

export function createAutomationServer(ctx) {
  const userId = String(ctx.authInfo?.extra?.userId || '');
  const token = String(ctx.authInfo?.token || '');
  const server = new McpServer({ name: 'Hansora Automation', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS });
  // Every tool: errors become a clear answer for ChatGPT, and each call is logged (name, outcome, time).
  const register = (name, config, callback) => server.registerTool(name, config, async (input, extra) => {
    const startedAt = Date.now();
    let result;
    try { result = await callback(input || {}, extra); } catch (error) { result = toolError(error); }
    console.info('automation_mcp_tool', JSON.stringify({ tool: name, user: userId.slice(0, 8), ok: !result?.isError && result?.structuredContent?.ok !== false, error: result?.structuredContent?.error || undefined, ms: Date.now() - startedAt }));
    return result;
  });

  // Brings the AI in line with what was just saved (the website does the same after Save).
  const prepare = async (businessId) => {
    try { await withBudget(syncBusinessAgent({ businessId, userId }), 18000); return { ready: true }; }
    catch (error) {
      console.warn('automation_mcp_prepare_failed', JSON.stringify({ reason: String(error?.message || error).slice(0, 200) }));
      return { ready: false, note: 'Saved. Preparing the AI employee took longer than usual; it finishes on its own with the next customer message, or call update_ai_employee again in a minute.' };
    }
  };

  register('get_overview', {
    title: 'Hansora Automation overview',
    description: 'Use this when the user asks how their business or AI employee is doing, what needs their attention, or for a daily summary. Returns each AI employee with its connected channels, how many chats wait for a person (per channel), new orders, bookings, leads and calls in the last 24 hours, and the credit balance.',
    inputSchema: z.object({}),
    annotations: READ
  }, async () => {
    const employees = await listEmployees(userId);
    const ids = employees.map(row => row.id);
    const [counts, money] = await Promise.all([activity(ids), account(userId, ids)]);
    if (!employees.length) return jsonText({ ok: true, ai_employees: [], credits: money.credits, plan: money.plan, next_step: 'This account has no AI employee yet. Offer to create one now with create_ai_employee: ask for the business name, what it sells and its opening hours.' });
    return jsonText({
      ok: true,
      ai_employees: employees.map(row => ({ ...employeeSummary(row), ...counts[row.id] })),
      credits: money.credits,
      plan: money.plan,
      note: 'Chats from Instagram, WhatsApp, TikTok, Telegram and Messenger are answered in the Hansora inbox (links.inbox). Website chats can be opened here with list_website_chats.'
    });
  });

  register('list_ai_employees', {
    title: 'List AI employees',
    description: 'Use this to see the AI employees of the connected Hansora account with their ids, status and connected channels.',
    inputSchema: z.object({}),
    annotations: READ
  }, async () => jsonText({ ok: true, ai_employees: (await listEmployees(userId)).map(employeeSummary) }));

  register('get_ai_employee', {
    title: 'Get an AI employee',
    description: 'Use this to read everything an AI employee knows and how it is set up: business details, services and prices, opening hours, FAQ, policies, instructions, languages, tone, knowledge files and links, and phone numbers. Read it before suggesting or making changes.',
    inputSchema: z.object({ ai_employee_id: employeeId }),
    annotations: READ
  }, async ({ ai_employee_id }) => {
    const row = await resolveEmployee(userId, ai_employee_id);
    const [knowledge, numbers] = await Promise.all([
      runFunction(knowledgeFunction, token, { business_id: row.id, action: 'list' }).catch(() => ({ ok: false, data: {} })),
      phoneLines(row.id).catch(() => [])
    ]);
    return jsonText({ ok: true, ai_employee: { ...employeeDetails(row), knowledge_items: (knowledge.data.documents || []).map(documentView), phone_numbers: numbers }, knowledge_note: PHONE_KNOWLEDGE_NOTE });
  });

  register('create_ai_employee', {
    title: 'Create an AI employee',
    description: 'Use this to create a new AI employee for a business. Only business_name is required, but the more the user tells (what they sell with prices, opening hours, FAQ, how to behave), the better it answers; ask for the missing basics first, or draft them from what the user already said and confirm. After creating, tell the user to connect a channel with the returned link, and offer to try it with test_ai_employee.',
    inputSchema: z.object({ business_name: z.string().min(1).max(120), ...employeeFields }),
    annotations: WRITE
  }, async (input) => {
    const id = await createEmployee(userId, input);
    const prepared = await prepare(id);
    const row = await getEmployee(userId, id);
    return jsonText({
      ok: true,
      created: true,
      ai_employee: row ? employeeDetails(row) : { ai_employee_id: id, links: links(id) },
      ...prepared,
      next_step: 'Tell the user the AI employee is created. It starts answering customers after they connect a channel (Instagram, WhatsApp, Telegram, TikTok, website chat or phone) at links.connect_channels. Offer to test it right here with test_ai_employee.'
    });
  });

  register('update_ai_employee', {
    title: 'Update an AI employee',
    description: 'Use this to change an AI employee: business details, services and prices, opening hours, FAQ, policies, instructions, languages or tone. Send only the fields that change; each field you send replaces the whole old text of that field, so to add something, read it with get_ai_employee first and send the full new text.',
    inputSchema: z.object({ ai_employee_id: employeeId, business_name: z.string().min(1).max(120).optional(), ...employeeFields }),
    annotations: { ...WRITE, destructiveHint: true }
  }, async ({ ai_employee_id, ...changes }) => {
    const row = await resolveEmployee(userId, ai_employee_id);
    const changed = await updateEmployee(userId, row, changes);
    const prepared = await prepare(row.id);
    const fresh = await getEmployee(userId, row.id);
    return jsonText({ ok: true, changed_fields: changed, ai_employee: employeeDetails(fresh || row), ...prepared });
  });

  register('add_knowledge', {
    title: 'Add knowledge to an AI employee',
    description: 'Use this to teach an AI employee from a longer text (a menu, price list, policy, product descriptions) or from a public website page. The AI employee uses this knowledge in chats; phone calls do not use it, so facts needed on calls (prices, hours) go into the main fields with update_ai_employee. Pass text, or url (https), not both.',
    inputSchema: z.object({
      ai_employee_id: employeeId,
      name: z.string().max(120).optional().describe('Short name for this knowledge, for example "Price list 2026".'),
      text: z.string().max(300000).optional(),
      url: z.string().max(2000).optional().describe('A public https:// page to read.')
    }),
    annotations: { ...WRITE, openWorldHint: true }
  }, async ({ ai_employee_id, name, text, url }) => {
    if (Boolean(text) === Boolean(url)) return jsonText({ ok: false, error: 'text_or_url', next_step: 'Pass either text or url.' });
    const row = await resolveEmployee(userId, ai_employee_id);
    const result = await withBudget(runFunction(knowledgeFunction, token, { business_id: row.id, action: 'add', kind: url ? 'url' : 'text', name, text, url }));
    if (!result.ok) return jsonText({ ok: false, error: result.data.error || 'knowledge_unavailable', next_step: KNOWLEDGE_ERRORS[result.data.error] || 'The knowledge could not be added right now. Try once more; if it fails again, the user can add it on hansora.co.', ...(result.data.detail ? { detail: String(result.data.detail).slice(0, 300) } : {}) });
    return jsonText({ ok: true, knowledge_items: (result.data.documents || []).map(documentView), note: PHONE_KNOWLEDGE_NOTE });
  });

  register('remove_knowledge', {
    title: 'Remove knowledge from an AI employee',
    description: 'Use this to delete one knowledge item (text, file or link) from an AI employee. Get the knowledge_id from get_ai_employee. This cannot be undone.',
    inputSchema: z.object({ ai_employee_id: employeeId, knowledge_id: z.string().min(1).max(200) }),
    annotations: { ...WRITE, destructiveHint: true }
  }, async ({ ai_employee_id, knowledge_id }) => {
    const row = await resolveEmployee(userId, ai_employee_id);
    const result = await withBudget(runFunction(knowledgeFunction, token, { business_id: row.id, action: 'remove', document_id: knowledge_id }));
    if (!result.ok) return jsonText({ ok: false, error: result.data.error || 'knowledge_unavailable', next_step: KNOWLEDGE_ERRORS[result.data.error] || 'The knowledge could not be removed right now. Try once more.' });
    return jsonText({ ok: true, knowledge_items: (result.data.documents || []).map(documentView) });
  });

  register('test_ai_employee', {
    title: 'Test an AI employee',
    description: 'Use this to send a message to an AI employee as if you were a customer and get its real answer, for example to check it after a change. It is a private test: bookings, orders and leads are not saved. Each message costs the same credits as one AI reply. To continue the same test conversation, pass the session_id from the previous result; leave it out to start fresh.',
    inputSchema: z.object({ ai_employee_id: employeeId, message: z.string().min(1).max(4000), session_id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional() }),
    annotations: WRITE
  }, async ({ ai_employee_id, message, session_id }) => {
    const row = await resolveEmployee(userId, ai_employee_id);
    const session = session_id || `chatgpt-${crypto.randomUUID().slice(0, 12)}`;
    let result;
    try { result = await withBudget(runFunction(testChatFunction, token, { business_id: row.id, message, session })); }
    catch (error) {
      if (error?.tookTooLong) return jsonText({ ok: false, error: 'slow_answer', session_id: session, next_step: 'The AI employee took too long to answer this time. Try the same message once more.' });
      throw error;
    }
    if (!result.ok) {
      const steps = {
        not_enough_credits: `There are not enough credits for a test message. ${ACCOUNT_LINE}`,
        ai_provider_agent_not_ready: 'This AI employee is not prepared yet. Call update_ai_employee (with no changes) to prepare it, then test again.'
      };
      return jsonText({ ok: false, error: result.data.error || 'test_failed', session_id: session, next_step: steps[result.data.error] || 'The test did not work this time. Try once more.' });
    }
    return jsonText({ ok: true, reply: result.data.reply, actions_it_would_take: result.data.actions || [], credits_used: result.data.credits_used, credits_left: result.data.balance, session_id: session });
  });

  register('get_account', {
    title: 'Get Hansora credits and plan',
    description: 'Use this to read the credit balance, the Automation plan, what each action costs in credits, and this month\'s usage per AI employee.',
    inputSchema: z.object({}),
    annotations: READ
  }, async () => jsonText({ ok: true, ...(await account(userId, (await listEmployees(userId)).map(row => row.id))) }));

  register('list_website_chats', {
    title: 'List website chats',
    description: 'Use this to see chats from the chat bubble on the business\'s own website: who is waiting for a person, and the latest message of each. Chats from Instagram, WhatsApp, TikTok, Telegram and Messenger are not listed here (platform rules); for those use get_overview and the inbox link.',
    inputSchema: z.object({ ai_employee_id: employeeId, only_waiting: z.boolean().default(false).describe('Only chats that wait for a person.'), limit: z.number().int().min(1).max(50).default(20) }),
    annotations: READ
  }, async ({ ai_employee_id, only_waiting, limit }) => {
    const row = await resolveEmployee(userId, ai_employee_id);
    return jsonText({ ok: true, website_chats: await listWebsiteChats(row.id, { onlyWaiting: only_waiting, limit }), inbox: links(row.id).inbox });
  });

  register('get_website_chat', {
    title: 'Read a website chat',
    description: 'Use this to read the messages of one website chat (chat_id from list_website_chats), for example before replying or to summarize what the visitor wants.',
    inputSchema: z.object({ chat_id: z.string(), limit: z.number().int().min(1).max(100).default(50) }),
    annotations: READ
  }, async ({ chat_id, limit }) => {
    const chat = await ownedWebsiteChat(userId, chat_id);
    return jsonText({ ok: true, chat: chatView(chat), messages: await websiteChatMessages(chat.id, limit) });
  });

  register('reply_to_website_chat', {
    title: 'Reply to a website chat',
    description: 'Use this to send the user\'s own reply to a website visitor. The visitor sees it in the chat bubble within a few seconds. Sending a reply takes the chat over from the AI (the AI stops answering this chat until it is handed back with set_website_chat_answered_by). Show the user the exact text and get their OK before sending.',
    inputSchema: z.object({ chat_id: z.string(), message: z.string().min(1).max(1000) }),
    annotations: OUTBOUND
  }, async ({ chat_id, message }) => {
    const chat = await ownedWebsiteChat(userId, chat_id);
    if (chat.ai_enabled !== false || ['resolved', 'archived'].includes(chat.status)) await setChatAnsweredBy(chat, 'person');
    const result = await withBudget(runFunction(replyFunction, token, { business_id: chat.business_id, conversation_id: chat.id, message }));
    if (!result.ok) return jsonText({ ok: false, error: result.data.error || 'reply_failed', next_step: REPLY_ERRORS[result.data.error] || 'The reply could not be sent. Try once more.' });
    return jsonText({ ok: true, sent: true, answered_by: 'person', note: 'The AI no longer answers this chat. Hand it back with set_website_chat_answered_by when the user is done.' });
  });

  register('set_website_chat_answered_by', {
    title: 'Hand a website chat to the AI or a person',
    description: 'Use this to choose who answers one website chat: "ai" hands it back to the AI employee, "person" takes it over so the AI stops answering.',
    inputSchema: z.object({ chat_id: z.string(), answered_by: z.enum(['ai', 'person']) }),
    annotations: WRITE
  }, async ({ chat_id, answered_by }) => {
    const chat = await ownedWebsiteChat(userId, chat_id);
    await setChatAnsweredBy(chat, answered_by);
    return jsonText({ ok: true, chat_id: chat.id, answered_by });
  });

  register('start_ai_call', {
    title: 'Have the AI employee call someone',
    description: 'Use this when the user wants their AI employee to phone someone now: give the phone number and what the AI should say or ask (for example "Confirm tomorrow\'s 3 pm appointment and ask if they need parking"). The AI employee calls from the business\'s Hansora number, talks, and the summary and transcript appear in list_calls a minute or two after the call ends. Phone minutes use credits. Confirm the number and the purpose with the user before calling.',
    inputSchema: z.object({
      ai_employee_id: employeeId,
      phone_number: z.string().min(5).max(30).describe('International format, for example +15550102030.'),
      purpose: z.string().min(3).max(500).describe('What the AI should say, ask and find out on this call.'),
      person_name: z.string().max(120).optional().describe('Name of the person being called, if known.')
    }),
    annotations: OUTBOUND
  }, async ({ ai_employee_id, phone_number, purpose, person_name }) => {
    const row = await resolveEmployee(userId, ai_employee_id);
    try {
      const started = await withBudget(startOutgoingCall({ businessId: row.id, to: phone_number, purpose, contactName: person_name || '' }));
      return jsonText({ ok: true, calling: started.calling, from: started.from, next_step: 'Tell the user the AI employee is calling now. When they ask what happened, call list_calls (the result appears a minute or two after the call ends).' });
    } catch (error) {
      const code = String(error?.code || error?.message || '');
      if (CALL_ERRORS[code]) return jsonText({ ok: false, error: code, next_step: CALL_ERRORS[code], links: { phone: links(row.id).phone, account: ACCOUNT_URL } });
      throw error;
    }
  });

  register('list_calls', {
    title: 'List phone calls',
    description: 'Use this to see recent phone calls of an AI employee: incoming calls it answered and calls it made, with time, length, number, purpose and summary. Use get_call for the full transcript.',
    inputSchema: z.object({ ai_employee_id: employeeId, direction: z.enum(['all', 'incoming', 'outgoing']).default('all'), limit: z.number().int().min(1).max(30).default(10) }),
    annotations: READ
  }, async ({ ai_employee_id, direction, limit }) => {
    const row = await resolveEmployee(userId, ai_employee_id);
    const [calls, numbers] = await Promise.all([listCalls(row.id, { limit, direction }), phoneLines(row.id).catch(() => [])]);
    return jsonText({ ok: true, calls, phone_numbers: numbers, links: { phone: links(row.id).phone } });
  });

  register('get_call', {
    title: 'Read a phone call',
    description: 'Use this to read one phone call in full (call_id from list_calls): what the AI employee and the other person said, and the summary.',
    inputSchema: z.object({ call_id: z.string() }),
    annotations: READ
  }, async ({ call_id }) => jsonText({ ok: true, call: callView(await ownedCall(userId, call_id), { transcript: true }) }));

  // ---------- Orders, bookings and leads ----------

  register('list_orders_bookings_leads', {
    title: 'List orders, bookings and leads',
    description: 'Use this to see what the AI employee collected: orders, bookings (appointments, reservations) and leads, newest first. Filter by kind, status and creation date. Records that came from Instagram, WhatsApp, TikTok, Telegram or Messenger show the item, time and status but not the customer\'s name and phone (platform rules); the user opens those in Hansora with the returned link.',
    inputSchema: z.object({
      ai_employee_id: employeeId,
      kind: z.enum(['all', ...RECORD_KINDS]).default('all'),
      status: z.enum(['any', ...RECORD_STATUSES]).default('any'),
      created_from: z.string().optional().describe('Only records created at or after this time (ISO 8601, for example 2026-11-15T00:00:00Z).'),
      created_to: z.string().optional().describe('Only records created at or before this time (ISO 8601).'),
      limit: z.number().int().min(1).max(50).default(20)
    }),
    annotations: READ
  }, async ({ ai_employee_id, kind, status, created_from, created_to, limit }) => {
    const row = await resolveEmployee(userId, ai_employee_id);
    const date = value => (value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : '');
    return jsonText({ ok: true, records: await listRecords(row.id, { kind, status, from: date(created_from), to: date(created_to), limit }), timezone: row.timezone || 'UTC', open_in_hansora: links(row.id).orders_and_bookings });
  });

  register('update_order_booking_lead', {
    title: 'Update an order, booking or lead',
    description: 'Use this to change the status of one order, booking or lead (record_id from list_orders_bookings_leads), or to save a private note on it. Cancelling a booking frees its time slot and puts ordered products back in stock. Confirm with the user before cancelling.',
    inputSchema: z.object({ record_id: z.string(), status: z.enum(RECORD_STATUSES).optional(), note: z.string().max(8000).optional().describe('Private note for the team; replaces the old note.') }),
    annotations: { ...WRITE, destructiveHint: true }
  }, async ({ record_id, status, note }) => {
    if (status === undefined && note === undefined) return jsonText({ ok: false, error: 'nothing_to_change', next_step: 'Pass status, note or both.' });
    const record = await ownedRecord(userId, record_id);
    const result = await withBudget(runFunction(recordUpdateFunction, token, { business_id: record.business_id, outcome_id: record.id, ...(status !== undefined ? { status } : {}), ...(note !== undefined ? { private_note: note } : {}) }));
    if (!result.ok) return jsonText({ ok: false, error: result.data.error || 'update_failed', next_step: RECORD_ERRORS[result.data.error] || 'The record could not be updated right now. Try once more.' });
    return jsonText({ ok: true, record: recordView(await ownedRecord(userId, record.id)) });
  });

  // ---------- Products ----------

  register('list_products', {
    title: 'List products',
    description: 'Use this to see the product catalog the AI employee can offer and sell: names, prices, stock and variants. Also says whether the AI employee offers products to customers at all (ai_offers_products).',
    inputSchema: z.object({ ai_employee_id: employeeId, search: z.string().max(80).optional().describe('Part of a name, category or SKU.'), limit: z.number().int().min(1).max(100).default(30) }),
    annotations: READ
  }, async ({ ai_employee_id, search, limit }) => {
    const row = await resolveEmployee(userId, ai_employee_id);
    return jsonText({ ok: true, ...(await listProducts(row.id, { search, limit })), products_page: `${SITE}/automation-products.html?business=${row.id}` });
  });

  const productFields = {
    description: z.string().max(5000).optional(),
    category: z.string().max(200).optional(),
    sku: z.string().max(120).optional(),
    price: z.number().min(0).nullable().optional(),
    currency: z.string().regex(/^[A-Za-z]{3}$/).optional().describe('Three-letter currency code, for example USD. Ask the user if unknown.'),
    stock: z.number().int().min(0).nullable().optional().describe('How many are in stock; leave out or null when stock is not tracked.'),
    shown_to_customers: z.boolean().optional().describe('false hides the product from customers without deleting it.'),
    payment_link: z.string().max(1000).optional().describe('An https:// link where the customer pays for this product.')
  };

  register('add_product', {
    title: 'Add a product',
    description: 'Use this to add one product to the catalog so the AI employee can offer and sell it. For several products, call it once per product. Photos and variants are added on the products page.',
    inputSchema: z.object({ ai_employee_id: employeeId, name: z.string().min(1).max(300), ...productFields }),
    annotations: WRITE
  }, async ({ ai_employee_id, ...input }) => {
    const row = await resolveEmployee(userId, ai_employee_id);
    const product = await addProduct(row.id, input);
    const tools = await businessTools(row.id).catch(() => ({}));
    return jsonText({ ok: true, product, ai_offers_products: tools.products === 'on', ...(tools.products === 'on' ? {} : { next_step: 'The AI employee does not offer products to customers yet. Ask the user if it should, then call set_business_tools with products: true.' }) });
  });

  register('update_product', {
    title: 'Update a product',
    description: 'Use this to change one product (product_id from list_products): name, price, stock, description, or hide it from customers. Send only the fields that change.',
    inputSchema: z.object({ product_id: z.string(), name: z.string().min(1).max(300).optional(), ...productFields }),
    annotations: { ...WRITE, destructiveHint: true }
  }, async ({ product_id, ...input }) => jsonText({ ok: true, product: await updateProduct(await ownedProduct(userId, product_id), input) }));

  register('delete_product', {
    title: 'Delete a product',
    description: 'Use this to delete one product from the catalog for good (product_id from list_products). To only hide it, use update_product with shown_to_customers: false. Confirm with the user first.',
    inputSchema: z.object({ product_id: z.string() }),
    annotations: { ...WRITE, destructiveHint: true }
  }, async ({ product_id }) => {
    const product = await ownedProduct(userId, product_id);
    await deleteProduct(product);
    return jsonText({ ok: true, deleted: productView(product).name });
  });

  // ---------- What the AI employee may do ----------

  register('get_business_tools', {
    title: 'See what the AI employee may do',
    description: 'Use this to see which abilities of an AI employee are on: taking orders, making bookings, collecting leads, handing a chat to a person, and offering products.',
    inputSchema: z.object({ ai_employee_id: employeeId }),
    annotations: READ
  }, async ({ ai_employee_id }) => {
    const row = await resolveEmployee(userId, ai_employee_id);
    return jsonText({ ok: true, tools: await businessTools(row.id), settings_page: `${SITE}/automation-tools.html?business=${row.id}` });
  });

  register('set_business_tools', {
    title: 'Turn AI employee abilities on or off',
    description: 'Use this to turn abilities of an AI employee on or off: orders, bookings, leads, handoff_to_person, products. Send only the ones that change. An ability that was never set up (bookings need working hours, orders need the details to collect) must first be set up on the settings page; the result says which.',
    inputSchema: z.object({ ai_employee_id: employeeId, orders: z.boolean().optional(), bookings: z.boolean().optional(), leads: z.boolean().optional(), handoff_to_person: z.boolean().optional(), products: z.boolean().optional() }),
    annotations: WRITE
  }, async ({ ai_employee_id, ...changes }) => {
    const row = await resolveEmployee(userId, ai_employee_id);
    const result = await setBusinessTools(row.id, changes);
    const prepared = Object.keys(result.changed).length ? await prepare(row.id) : {};
    return jsonText({ ok: true, ...result, tools: await businessTools(row.id), ...prepared });
  });

  // ---------- Comment automations ----------

  register('list_comment_automations', {
    title: 'List comment automations',
    description: 'Use this to see the comment automations (Instagram and TikTok): which are on, what comments they react to, what they reply, and how many times each ran. New simple ones are made with create_comment_automation; multi-step flows are built and edited in the builder on hansora.co.',
    inputSchema: z.object({ ai_employee_id: employeeId }),
    annotations: READ
  }, async ({ ai_employee_id }) => {
    const row = await resolveEmployee(userId, ai_employee_id);
    return jsonText({ ok: true, comment_automations: (await listAutomations(row.id)).map(automationView), builder: `${SITE}/automation-workflows.html?business=${row.id}` });
  });

  register('create_comment_automation', {
    title: 'Create a comment automation',
    description: 'Use this to create an automation that answers comments on the business\'s posts. On Instagram: when a comment matches, it can reply publicly under the comment and sends the person one private message, optionally with a link button. On TikTok: it replies publicly under the comment (TikTok allows no private message). Ask the user for the trigger words (or "any comment"), the texts, and whether to turn it on now; it is created switched off unless turn_on is true. Each run uses credits. Multi-step flows with several messages and buttons are built in the builder on hansora.co.',
    inputSchema: z.object({
      ai_employee_id: employeeId,
      platform: z.enum(['instagram', 'tiktok']).default('instagram'),
      name: z.string().max(200).optional(),
      reacts_to: z.enum(['contains', 'exact', 'any']).default('contains').describe('contains: the comment includes one of the keywords. exact: the comment is exactly a keyword (Instagram only). any: every comment.'),
      keywords: z.array(z.string().max(80)).max(20).optional().describe('Words or phrases that start it, for example ["price", "how much"]. Not needed for "any".'),
      posts: z.enum(['all', 'next']).default('all').describe('all: every post. next: only the next post published after this is turned on.'),
      public_replies: z.array(z.string().max(300)).max(3).optional().describe('Up to 3 short replies posted under the comment; one is picked each time. Optional on Instagram, required on TikTok unless ai_writes_reply.'),
      private_message: z.string().max(640).optional().describe('Instagram only, required there: the private message sent to the person who commented.'),
      button_label: z.string().max(20).optional().describe('Instagram only: label of a link button under the private message, for example "Open price list".'),
      button_url: z.string().max(1000).optional().describe('Instagram only: the https:// link the button opens.'),
      ai_writes_reply: z.boolean().optional().describe('TikTok only: the AI employee writes each public reply itself.'),
      ai_instruction: z.string().max(500).optional().describe('TikTok only, with ai_writes_reply: how the AI should reply.'),
      turn_on: z.boolean().default(false).describe('true starts it right away. Confirm with the user first.')
    }),
    annotations: OUTBOUND
  }, async ({ ai_employee_id, ...input }) => {
    const row = await resolveEmployee(userId, ai_employee_id);
    const made = await createAutomation(row.id, input);
    const builder = `${SITE}/automation-workflows.html?business=${row.id}`;
    return jsonText({
      ok: true,
      comment_automation: automationView(made.row),
      turned_on: made.turned_on,
      builder,
      next_step: made.not_connected
        ? `It is saved but switched off, because ${input.platform === 'tiktok' ? 'TikTok' : 'Instagram'} is not connected for this AI employee. The user connects it at ${links(row.id).connect_channels}, then you can turn it on with set_comment_automation.`
        : made.turned_on ? 'Tell the user it is live and now answers matching comments.' : 'It is saved but switched off. Ask the user if you should turn it on with set_comment_automation.'
    });
  });

  register('delete_comment_automation', {
    title: 'Delete a comment automation',
    description: 'Use this to remove one comment automation (automation_id from list_comment_automations). It stops running and disappears from the list. Confirm with the user first.',
    inputSchema: z.object({ automation_id: z.string() }),
    annotations: { ...WRITE, destructiveHint: true }
  }, async ({ automation_id }) => {
    const automation = await ownedAutomation(userId, automation_id);
    await archiveAutomation(automation);
    if (automation.safety_config?.trigger_type === 'ice_breaker') await runFunction(instagramSyncFunction, token, { business_id: automation.business_id, trigger_type: 'ice_breaker' }).catch(() => null);
    return jsonText({ ok: true, deleted: automation.name });
  });

  register('set_comment_automation', {
    title: 'Turn a comment automation on or off',
    description: 'Use this to turn one comment automation on or off (automation_id from list_comment_automations). Turning it on means it starts replying to matching comments right away, and each run uses credits.',
    inputSchema: z.object({ automation_id: z.string(), on: z.boolean() }),
    annotations: OUTBOUND
  }, async ({ automation_id, on }) => {
    const automation = await ownedAutomation(userId, automation_id);
    const saved = await setAutomationOn(automation, on);
    // Instagram conversation starters are shown by Instagram itself, so it is told about the change (as the site does).
    if (automation.safety_config?.trigger_type === 'ice_breaker') await runFunction(instagramSyncFunction, token, { business_id: automation.business_id, trigger_type: 'ice_breaker' }).catch(() => null);
    return jsonText({ ok: true, comment_automation: automationView(saved) });
  });

  // ---------- Phone numbers and automatic calls ----------

  register('get_phone_setup', {
    title: 'See phone numbers and automatic calls',
    description: 'Use this to see the phone side of an AI employee: its phone numbers (and whether each can call out), the countries where a new number is available now, and the automatic calls settings (confirming new orders, reminding before bookings, calling hours).',
    inputSchema: z.object({ ai_employee_id: employeeId }),
    annotations: READ
  }, async ({ ai_employee_id }) => {
    const row = await resolveEmployee(userId, ai_employee_id);
    const [lines, automatic] = await Promise.all([runFunction(phoneLineFunction, token, { business_id: row.id }, { method: 'GET' }), getAutomaticCalls(row.id)]);
    return jsonText({
      ok: true,
      phone_numbers: (lines.data.numbers || []).map(item => ({ number: item.e164, country: item.country, can_call_out: Boolean(item.can_call), ...(item.pending ? { waiting_for_first_call: true } : {}) })),
      countries_with_numbers_now: (lines.data.countries || []).map(item => item.country),
      automatic_calls: automatic,
      links: { phone: links(row.id).phone }
    });
  });

  register('get_phone_number', {
    title: 'Get a phone number for the AI employee',
    description: 'Use this to give an AI employee a new phone number in a country (two-letter code from get_phone_setup), so it can answer calls and call out. Needs credits on the account. Voice, greeting and call forwarding are set on the Phone page. Confirm the country with the user first.',
    inputSchema: z.object({ ai_employee_id: employeeId, country: z.string().regex(/^[A-Za-z]{2}$/).describe('Two-letter country code, for example US.') }),
    annotations: OUTBOUND
  }, async ({ ai_employee_id, country }) => {
    const row = await resolveEmployee(userId, ai_employee_id);
    const result = await withBudget(runFunction(phoneLineFunction, token, { business_id: row.id, action: 'activate', country: country.toUpperCase() }));
    if (!result.ok) return jsonText({ ok: false, error: result.data.error || 'number_failed', next_step: NUMBER_ERRORS[result.data.error] || 'The number could not be added right now. Try once more.', links: { phone: links(row.id).phone, account: ACCOUNT_URL } });
    return jsonText({ ok: true, phone_number: result.data.number?.e164 || '', can_call_out: Boolean(result.data.number?.can_call), next_step: 'Tell the user the number. They can choose the voice and greeting on the Phone page (links.phone).', links: { phone: links(row.id).phone } });
  });

  register('set_automatic_calls', {
    title: 'Set automatic phone calls',
    description: 'Use this to turn automatic AI calls on or off and say what they do: call a customer a few minutes after a new order to confirm it, and call before a booking to remind them. Calls are only made inside the calling hours (the business\'s local time) and use phone credits. Send only what changes.',
    inputSchema: z.object({
      ai_employee_id: employeeId,
      confirm_new_orders: z.boolean().optional(),
      minutes_after_the_order: z.number().int().min(1).max(1440).optional(),
      order_call_says: z.string().max(300).optional().describe('What the AI should say and ask on an order call.'),
      remind_before_bookings: z.boolean().optional(),
      hours_before_the_booking: z.number().int().min(1).max(72).optional(),
      reminder_call_says: z.string().max(300).optional().describe('What the AI should say and ask on a reminder call.'),
      calling_hours_from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().describe('24-hour time, for example 09:00.'),
      calling_hours_to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional()
    }),
    annotations: OUTBOUND
  }, async ({ ai_employee_id, ...input }) => {
    const row = await resolveEmployee(userId, ai_employee_id);
    const [automatic, numbers] = await Promise.all([setAutomaticCalls(row.id, input), phoneLines(row.id).catch(() => [])]);
    const canCall = numbers.some(item => item.can_call_out);
    return jsonText({ ok: true, automatic_calls: automatic, ...(canCall ? {} : { note: 'Saved, but this AI employee has no phone number that can call out yet, so no automatic calls are made until it has one.' }) });
  });

  return server;
}

const handler = createMcpHandler(createAutomationServer, { legacy: 'stateless', responseMode: 'auto', onerror: (error) => console.error('automation_mcp_error', error?.message || error) });

function bearerToken(request) {
  return (String(request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i) || [])[1] || '';
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate');
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default async function automationMcp(request, context) {
  const startedAt = Date.now();
  const requestId = String(request.headers.get('x-nf-request-id') || 'unknown');
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id' } });
  }
  const token = bearerToken(request);
  const waitUntil = typeof context?.waitUntil === 'function' ? context.waitUntil.bind(context) : undefined;
  let user = null;
  try {
    user = await authenticateToken(token);
  } catch (error) {
    // Sign-in could not be checked because Supabase is unreachable; the user's login is still valid.
    if (error instanceof AuthUnavailableError) {
      console.warn('automation_mcp_request', JSON.stringify({ requestId, method: request.method, authenticated: null, status: 503, durationMs: Date.now() - startedAt }));
      return withCors(new Response(JSON.stringify({ error: 'temporarily_unavailable', error_description: 'Hansora is temporarily unavailable. Please try again in a minute.' }), { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '30' } }));
    }
    user = null;
  }
  if (!user) {
    console.warn('automation_mcp_request', JSON.stringify({ requestId, method: request.method, tokenProvided: Boolean(token), authenticated: false, status: 401, durationMs: Date.now() - startedAt }));
    return withCors(new Response(JSON.stringify({ error: 'invalid_token', error_description: 'Connect your Hansora account to continue.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': `Bearer resource_metadata="${getOAuthProtectedResourceMetadataUrl(MCP_URL)}"` }
    }));
  }
  const authInfo = { token, clientId: user.clientId, scopes: user.scopes, extra: { userId: user.id, email: user.email, waitUntil } };
  const response = withCors(await handler.fetch(request, { authInfo }));
  console.info('automation_mcp_request', JSON.stringify({ requestId, method: request.method, authenticated: true, status: response.status, durationMs: Date.now() - startedAt }));
  return response;
}

export const config = { path: '/automation/mcp' };
