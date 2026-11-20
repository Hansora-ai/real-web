// Data access and shaping for the Hansora Automation MCP server (ChatGPT app), served at /automation/mcp.
//
// Privacy rule for this server: customer message text from Instagram, WhatsApp, TikTok, Messenger and Telegram is
// never returned to the AI client. Those platforms' terms restrict passing their chat data to third parties, so
// these channels are reported as counts with a link to the Hansora inbox. Website chat and phone calls are
// Hansora's own channels and can be read in full.
import { first, rows, serviceInsert, serviceUpdate, supabaseRequest } from '../automation/db.mjs';
import { AUTOMATION_PLANS, planIsActive, pricesForPlan, toDisplay } from '../automation/billing.mjs';

const q = encodeURIComponent;
export const SITE = String(process.env.URL || 'https://hansora.co').replace(/\/+$/, '');
// OpenAI's app rules forbid selling credits or plans from inside ChatGPT, linking to a page that starts a
// purchase, and promoting upgrades. So the tools never link to the pricing page: when credits matter they state
// the fact and point to the account page, the way the Creative app does.
export const ACCOUNT_URL = `${SITE}/automation-usage.html?from=chatgpt`;
export const ACCOUNT_LINE = `Say this as a plain fact, with no sales wording and without suggesting a purchase, plan or upgrade: "Your Hansora balance and account are at ${ACCOUNT_URL}".`;
export const READABLE_CHAT_CHANNEL = 'website';
export const LANGUAGES = ['en', 'ru', 'hy'];
export const TONES = ['friendly', 'professional', 'casual', 'formal'];

const CHANNEL_NAMES = {
  instagram_dm: 'Instagram messages', instagram_comments: 'Instagram comments', whatsapp: 'WhatsApp', telegram: 'Telegram',
  tiktok: 'TikTok', messenger: 'Messenger', website: 'Website chat', phone: 'Phone'
};
export const channelName = type => CHANNEL_NAMES[type] || String(type || '');
const one = value => Array.isArray(value) ? value[0] || null : value || null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = value => UUID.test(String(value || ''));

export function fail(code, message, extra = {}) {
  return Object.assign(new Error(code), { code, publicMessage: message, extra });
}

export const links = id => ({
  overview: `${SITE}/automation-agent.html?id=${id}`,
  inbox: `${SITE}/automation-inbox.html?business=${id}`,
  connect_channels: `${SITE}/automation-agent.html?id=${id}`,
  phone: `${SITE}/automation-phone.html?business=${id}`,
  orders_and_bookings: `${SITE}/automation-operations.html?business=${id}`
});

// ---------- AI employees ----------

const EMPLOYEE_SELECT = 'id,name,category,description,contact_phone,contact_email,timezone,status,setup_mode,updated_at,'
  + 'automation_agents(id,display_name,primary_language,supported_languages,tone,custom_instructions,prohibited_instructions,status),'
  + 'automation_business_knowledge(services_and_prices,opening_hours,delivery_and_service_areas,frequently_asked_questions,policies),'
  + 'automation_channel_connections(channel_type,status,connected_account_label,setup_order)';

export function employeeSummary(row) {
  const agent = one(row.automation_agents) || {};
  const channels = (row.automation_channel_connections || []).slice().sort((a, b) => (a.setup_order || 0) - (b.setup_order || 0));
  return {
    ai_employee_id: row.id,
    business_name: row.name,
    assistant_name: agent.display_name || '',
    category: row.category || '',
    // The stored status stays 'draft' for every AI employee, so say what is true: it works once a channel is connected.
    status: agent.status === 'paused' || row.status === 'paused' ? 'paused' : channels.some(item => item.status === 'connected') ? 'live' : 'no channel connected yet',
    comments_only: row.setup_mode === 'comments',
    connected_channels: channels.filter(item => item.status === 'connected').map(item => ({ channel: channelName(item.channel_type), account: item.connected_account_label || '' })),
    not_connected_channels: channels.filter(item => item.status !== 'connected').map(item => channelName(item.channel_type)),
    links: links(row.id)
  };
}

export function employeeDetails(row) {
  const agent = one(row.automation_agents) || {};
  const knowledge = one(row.automation_business_knowledge) || {};
  return {
    ...employeeSummary(row),
    description: row.description || '',
    contact_phone: row.contact_phone || '',
    contact_email: row.contact_email || '',
    timezone: row.timezone || 'UTC',
    primary_language: agent.primary_language || 'en',
    supported_languages: agent.supported_languages || [],
    tone: agent.tone || 'friendly',
    services_and_prices: knowledge.services_and_prices || '',
    opening_hours: knowledge.opening_hours || '',
    delivery_and_service_areas: knowledge.delivery_and_service_areas || '',
    faq: knowledge.frequently_asked_questions || '',
    policies: knowledge.policies || '',
    custom_instructions: agent.custom_instructions || '',
    prohibited_instructions: agent.prohibited_instructions || ''
  };
}

export async function listEmployees(userId) {
  return rows(await supabaseRequest(`/rest/v1/automation_businesses?owner_user_id=eq.${q(userId)}&status=neq.archived&select=${q(EMPLOYEE_SELECT)}&order=updated_at.desc&limit=50`));
}

// The AI employee a tool call is about. Most accounts have one, so the id may be left out.
export async function resolveEmployee(userId, id) {
  const all = await listEmployees(userId);
  if (id) {
    const found = isUuid(id) ? all.find(row => row.id === id) : null;
    if (!found) throw fail('ai_employee_not_found', 'This AI employee was not found in the connected Hansora account. Call list_ai_employees to see the ids.');
    return found;
  }
  if (!all.length) throw fail('no_ai_employee', 'This account has no AI employee yet. Offer to create one with create_ai_employee.');
  if (all.length > 1) throw fail('ai_employee_id_required', 'This account has more than one AI employee. Ask the user which one, then pass ai_employee_id.', { ai_employees: all.map(row => ({ ai_employee_id: row.id, business_name: row.name })) });
  return all[0];
}

export function validTimezone(value) {
  const zone = String(value || '').trim();
  if (!zone) return '';
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return zone.slice(0, 80); } catch { return ''; }
}

const text = (value, max) => String(value ?? '').trim().slice(0, max);
const KNOWLEDGE_FIELDS = { services_and_prices: ['services_and_prices', 12000], opening_hours: ['opening_hours', 4000], delivery_and_service_areas: ['delivery_and_service_areas', 4000], faq: ['frequently_asked_questions', 8000], policies: ['policies', 8000] };
const BUSINESS_FIELDS = { business_name: ['name', 120], category: ['category', 120], description: ['description', 4000], contact_phone: ['contact_phone', 80], contact_email: ['contact_email', 320] };
const AGENT_TEXT_FIELDS = { assistant_name: ['display_name', 120], custom_instructions: ['custom_instructions', 12000], prohibited_instructions: ['prohibited_instructions', 8000] };

// Languages as the database stores them: 1 to 3 of en/ru/hy, and the main one is always among them.
export function languageSettings(primary, supported, current = {}) {
  const main = LANGUAGES.includes(primary) ? primary : LANGUAGES.includes(current.primary_language) ? current.primary_language : 'en';
  const list = Array.isArray(supported) && supported.length ? supported : Array.isArray(current.supported_languages) ? current.supported_languages : [];
  const all = [...new Set([main, ...list.filter(item => LANGUAGES.includes(item))])].slice(0, 3);
  return { primary_language: main, supported_languages: all };
}

// Splits tool input into the three table patches. Only fields the caller sent are included.
export function employeePatches(input = {}, current = {}) {
  const pick = (map) => Object.fromEntries(Object.entries(map).filter(([key]) => input[key] !== undefined).map(([key, [column, max]]) => [column, text(input[key], max)]));
  const business = pick(BUSINESS_FIELDS);
  const agent = pick(AGENT_TEXT_FIELDS);
  const knowledge = pick(KNOWLEDGE_FIELDS);
  if (input.timezone !== undefined) { const zone = validTimezone(input.timezone); if (zone) business.timezone = zone; }
  if (input.tone !== undefined && TONES.includes(input.tone)) agent.tone = input.tone;
  if (input.primary_language !== undefined || input.supported_languages !== undefined) Object.assign(agent, languageSettings(input.primary_language, input.supported_languages, current));
  if (business.name !== undefined && !business.name) delete business.name;
  if (agent.display_name !== undefined && !agent.display_name) delete agent.display_name;
  return { business, agent, knowledge };
}

// Same rows the website's "Create your AI employee" form makes (automation_save_agent), written with the service
// role for the signed-in owner. Telegram, Messenger, TikTok and website channels are added by a database trigger.
export async function createEmployee(userId, input) {
  const { business, agent, knowledge } = employeePatches(input);
  if (!business.name) throw fail('business_name_required', 'Ask the user for the business name first.');
  const created = await serviceInsert('automation_businesses', { owner_user_id: userId, timezone: 'UTC', ...business });
  if (!created?.id) throw new Error('data_request_failed_create');
  try {
    await serviceInsert('automation_agents', { business_id: created.id, display_name: `${business.name} assistant`.slice(0, 120), tone: 'friendly', ...languageSettings(input.primary_language, input.supported_languages), ...agent });
    await serviceInsert('automation_business_knowledge', { business_id: created.id, services_and_prices: '', opening_hours: '', delivery_and_service_areas: '', frequently_asked_questions: '', policies: '', ...knowledge });
    await supabaseRequest('/rest/v1/automation_channel_connections?on_conflict=business_id,channel_type', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
      body: [['instagram_dm', 1], ['instagram_comments', 2], ['whatsapp', 3], ['phone', 4]].map(([channel_type, setup_order]) => ({ business_id: created.id, channel_type, setup_order }))
    });
  } catch (error) {
    // Never leave a half-made AI employee behind.
    await supabaseRequest(`/rest/v1/automation_businesses?id=eq.${q(created.id)}&owner_user_id=eq.${q(userId)}`, { method: 'DELETE' }).catch(() => null);
    throw error;
  }
  return created.id;
}

export async function updateEmployee(userId, row, input) {
  const agentRow = one(row.automation_agents) || {};
  const { business, agent, knowledge } = employeePatches(input, agentRow);
  const changed = [];
  if (Object.keys(business).length) { await serviceUpdate('automation_businesses', `id=eq.${q(row.id)}&owner_user_id=eq.${q(userId)}`, business); changed.push(...Object.keys(business)); }
  if (Object.keys(agent).length) {
    const version = await first(`/rest/v1/automation_agents?business_id=eq.${q(row.id)}&select=configuration_version&limit=1`);
    await serviceUpdate('automation_agents', `business_id=eq.${q(row.id)}`, { ...agent, configuration_version: Number(version?.configuration_version || 1) + 1 });
    changed.push(...Object.keys(agent));
  }
  if (Object.keys(knowledge).length) {
    const revision = await first(`/rest/v1/automation_business_knowledge?business_id=eq.${q(row.id)}&select=revision&limit=1`);
    await serviceUpdate('automation_business_knowledge', `business_id=eq.${q(row.id)}`, { ...knowledge, revision: Number(revision?.revision || 1) + 1 });
    changed.push(...Object.keys(knowledge));
  }
  return changed;
}

export async function getEmployee(userId, id) {
  return first(`/rest/v1/automation_businesses?id=eq.${q(id)}&owner_user_id=eq.${q(userId)}&select=${q(EMPLOYEE_SELECT)}&limit=1`);
}

export async function ownsBusiness(userId, businessId) {
  return Boolean(await first(`/rest/v1/automation_businesses?id=eq.${q(businessId)}&owner_user_id=eq.${q(userId)}&select=id&limit=1`));
}

// ---------- Activity (counts only: no customer names, numbers or message text) ----------

const inList = ids => `in.(${ids.map(q).join(',')})`;

// A chat "waits for a person" exactly as the Hansora inbox shows it.
export const WAITING_FILTER = 'status=not.in.(resolved,archived)&or=(status.eq.needs_attention,and(ai_enabled.is.false,status.neq.human_handling))';

export function countBy(list, keyOf) {
  return list.reduce((all, item) => { const key = keyOf(item); if (key) all[key] = (all[key] || 0) + 1; return all; }, {});
}

export async function activity(businessIds, now = Date.now()) {
  if (!businessIds.length) return {};
  const since = new Date(now - 24 * 3600 * 1000).toISOString();
  const ids = inList(businessIds);
  const [waiting, outcomes, calls] = await Promise.all([
    supabaseRequest(`/rest/v1/automation_conversations?business_id=${ids}&channel_type=neq.test&${WAITING_FILTER}&select=business_id,channel_type&limit=1000`).then(rows),
    supabaseRequest(`/rest/v1/automation_outcomes?business_id=${ids}&created_at=gte.${q(since)}&select=business_id,outcome_type&limit=1000`).then(rows),
    supabaseRequest(`/rest/v1/automation_calls?business_id=${ids}&direction=neq.test&started_at=gte.${q(since)}&select=business_id,direction&limit=1000`).then(rows)
  ]);
  return Object.fromEntries(businessIds.map(id => {
    const mine = list => list.filter(item => item.business_id === id);
    const byChannel = countBy(mine(waiting), item => channelName(item.channel_type));
    const kinds = countBy(mine(outcomes), item => item.outcome_type);
    const callKinds = countBy(mine(calls), item => item.direction);
    return [id, {
      chats_waiting_for_a_person: { total: mine(waiting).length, by_channel: byChannel },
      last_24_hours: { new_orders: kinds.order || 0, new_bookings: kinds.booking || 0, new_leads: kinds.lead || 0, calls_answered: callKinds.inbound || 0, calls_made: callKinds.outbound || 0 }
    }];
  }));
}

// Chats of the last 7 days for the overview card: how many there were, how many the AI handled on its own, how many a
// person answered, and how many wait for a person now. Counts only, per channel; no names or messages.
export function chatStats(conversations = []) {
  const total = conversations.length;
  const waiting = conversations.filter(row => !['resolved', 'archived'].includes(row.status) && (row.status === 'needs_attention' || (row.ai_enabled === false && row.status !== 'human_handling'))).length;
  const byPerson = conversations.filter(row => row.status === 'human_handling' || (row.ai_enabled === false && ['resolved', 'archived'].includes(row.status))).length;
  const byChannel = Object.entries(countBy(conversations, row => channelName(row.channel_type))).sort((a, b) => b[1] - a[1]).map(([channel, chats]) => ({ channel, chats }));
  return { total, handled_by_ai: Math.max(0, total - waiting - byPerson), answered_by_a_person: byPerson, need_you: waiting, by_channel: byChannel };
}

export async function recentChats(businessIds, now = Date.now()) {
  if (!businessIds.length) return [];
  const since = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
  return rows(await supabaseRequest(`/rest/v1/automation_conversations?business_id=${inList(businessIds)}&channel_type=neq.test&last_message_at=gte.${q(since)}&select=business_id,channel_type,status,ai_enabled&limit=5000`));
}

// ---------- Account ----------

const rate = value => toDisplay(value);
export function planView(subscription) {
  const active = planIsActive(subscription);
  const prices = pricesForPlan(active ? subscription.plan_id : null);
  return {
    plan: active ? AUTOMATION_PLANS[subscription.plan_id].name : 'Pay as you go',
    renews_or_ends_at: active ? subscription.current_period_end || null : null,
    credits_per_action: { ai_reply: rate(prices.aiReply), reply_to_photo_or_video: rate(prices.mediaReply), comment_automation_run: rate(prices.commentRun), phone_minute: rate(prices.voiceMinute) }
  };
}

export async function account(userId, businessIds = [], now = new Date()) {
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const [profile, subscription, usage] = await Promise.all([
    first(`/rest/v1/profiles?user_id=eq.${q(userId)}&select=credits&limit=1`),
    first(`/rest/v1/automation_subscriptions?user_id=eq.${q(userId)}&select=plan_id,status,current_period_end&limit=1`).catch(() => null),
    businessIds.length ? supabaseRequest(`/rest/v1/automation_usage_monthly_v?business_id=${inList(businessIds)}&billing_month=eq.${q(month)}&select=business_id,billable_ai_messages,billable_voice_seconds,credits_used`).then(rows).catch(() => []) : []
  ]);
  return {
    credits: toDisplay(profile?.credits || 0),
    ...planView(subscription),
    this_month: usage.map(item => ({ ai_employee_id: item.business_id, ai_replies: Number(item.billable_ai_messages || 0), phone_minutes: Math.round(Number(item.billable_voice_seconds || 0) / 6) / 10, credits_used: toDisplay(item.credits_used || 0) })),
    links: { account: ACCOUNT_URL },
    note: 'Report these numbers as they are. This app cannot purchase credits or take payments. If the user asked to buy or top up credits, say only that, in one sentence: no purchase summary, no amount after purchase, no payment options, no link or button for buying. Do not suggest buying credits, a plan or an upgrade.'
  };
}

// ---------- Website chats (Hansora's own channel) ----------

const chatWaiting = row => !['resolved', 'archived'].includes(row.status) && (row.status === 'needs_attention' || (row.ai_enabled === false && row.status !== 'human_handling'));
export function chatView(row) {
  return {
    chat_id: row.id,
    visitor: one(row.automation_contacts)?.display_name || 'Website visitor',
    answered_by: row.ai_enabled === false ? 'person' : 'ai',
    waiting_for_a_person: chatWaiting(row),
    status: row.status,
    last_message: row.last_message_preview || '',
    last_message_at: row.last_message_at
  };
}

export async function listWebsiteChats(businessId, { onlyWaiting = false, limit = 20 } = {}) {
  const filter = onlyWaiting ? `&${WAITING_FILTER}` : '&status=neq.archived';
  return rows(await supabaseRequest(`/rest/v1/automation_conversations?business_id=eq.${q(businessId)}&channel_type=eq.${READABLE_CHAT_CHANNEL}${filter}&select=${q('id,status,ai_enabled,last_message_preview,last_message_at,automation_contacts(display_name)')}&order=last_message_at.desc.nullslast&limit=${limit}`)).map(chatView);
}

// A website chat of one of the user's AI employees. Any other channel is refused here, whatever id is passed.
export async function ownedWebsiteChat(userId, chatId) {
  if (!isUuid(chatId)) throw fail('chat_not_found', 'This website chat was not found. Call list_website_chats to see the ids.');
  const row = await first(`/rest/v1/automation_conversations?id=eq.${q(chatId)}&select=${q('id,business_id,channel_type,status,ai_enabled,last_message_preview,last_message_at,automation_contacts(display_name)')}&limit=1`);
  if (row && !(await ownsBusiness(userId, row.business_id))) throw fail('chat_not_found', 'This website chat was not found. Call list_website_chats to see the ids.');
  if (!row) throw fail('chat_not_found', 'This website chat was not found. Call list_website_chats to see the ids.');
  if (row.channel_type !== READABLE_CHAT_CHANNEL) throw fail('chat_not_available_here', 'Only website chats can be opened here. Chats from Instagram, WhatsApp, TikTok, Telegram and Messenger stay in the Hansora inbox because of those platforms\' rules.', { inbox: links(row.business_id).inbox });
  return row;
}

export async function websiteChatMessages(chatId, limit = 50) {
  const list = rows(await supabaseRequest(`/rest/v1/automation_messages?conversation_id=eq.${q(chatId)}&select=direction,sender_type,content_type,content,occurred_at&order=occurred_at.desc&limit=${limit}`));
  return list.reverse().map(item => ({
    from: item.direction === 'inbound' ? 'visitor' : item.sender_type === 'human' ? 'person' : 'ai',
    text: item.content_type === 'text' || item.content ? String(item.content || '').slice(0, 4000) : `[${item.content_type}]`,
    at: item.occurred_at
  }));
}

export async function setChatAnsweredBy(row, who) {
  const person = who === 'person';
  await serviceUpdate('automation_conversations', `id=eq.${q(row.id)}&business_id=eq.${q(row.business_id)}`, { ai_enabled: !person, status: person ? 'human_handling' : 'open' });
}

// ---------- Phone calls ----------

export function callView(row, { transcript = false } = {}) {
  const outcome = row.outcome && typeof row.outcome === 'object' ? row.outcome : {};
  const seconds = row.ended_at ? Math.max(0, Math.round((Date.parse(row.ended_at) - Date.parse(row.started_at)) / 1000)) : null;
  return {
    call_id: row.id,
    direction: row.direction === 'outbound' ? 'AI called out' : row.direction === 'test' ? 'test call' : 'incoming',
    status: row.ended_at ? row.status : row.status === 'ringing' ? 'ringing' : 'in progress',
    started_at: row.started_at,
    duration_seconds: seconds,
    ...(row.direction === 'outbound' ? { called_number: outcome.called_number || '', purpose: outcome.purpose || '' } : { caller_number: outcome.caller_number || '' }),
    summary: row.summary || '',
    ...(transcript ? { transcript: String(row.transcript || '') } : { has_transcript: Boolean(row.transcript) })
  };
}

const CALL_SELECT = 'id,business_id,direction,status,started_at,ended_at,transcript,summary,outcome';
export async function listCalls(businessId, { limit = 10, direction } = {}) {
  // "all" includes test calls made from the Phone page; they are marked as tests.
  const filter = direction === 'incoming' ? '&direction=eq.inbound' : direction === 'outgoing' ? '&direction=eq.outbound' : direction === 'tests' ? '&direction=eq.test' : '';
  return rows(await supabaseRequest(`/rest/v1/automation_calls?business_id=eq.${q(businessId)}${filter}&select=${q(CALL_SELECT)}&order=started_at.desc&limit=${limit}`)).map(row => callView(row));
}

export async function ownedCall(userId, callId) {
  if (!isUuid(callId)) throw fail('call_not_found', 'This call was not found. Call list_calls to see the ids.');
  const row = await first(`/rest/v1/automation_calls?id=eq.${q(callId)}&select=${q(CALL_SELECT)}&limit=1`);
  if (row && !(await ownsBusiness(userId, row.business_id))) throw fail('call_not_found', 'This call was not found. Call list_calls to see the ids.');
  if (!row) throw fail('call_not_found', 'This call was not found. Call list_calls to see the ids.');
  return row;
}

export async function phoneLines(businessId) {
  return rows(await supabaseRequest(`/rest/v1/automation_phone_numbers?business_id=eq.${q(businessId)}&status=eq.assigned&select=e164,country,livekit_outbound_trunk_id,provider,verified_at&order=assigned_at.asc&limit=50`))
    .filter(item => !(item.provider === 'sip' && !item.verified_at))
    .map(item => ({ number: item.e164, country: item.country, can_call_out: Boolean(item.livekit_outbound_trunk_id) }));
}
