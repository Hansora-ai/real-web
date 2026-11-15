import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

const { default: automationMcp, config } = await import('../../netlify/functions/automation-mcp.mjs');
const { default: oauthMetadata, config: metadataConfig } = await import('../../netlify/functions/automation-mcp-oauth-metadata.mjs');

const USER = '11111111-1111-4111-8111-111111111111';
const SHOP = '22222222-2222-4222-8222-222222222222';
const WEB_CHAT = '33333333-3333-4333-8333-333333333333';
const WHATSAPP_CHAT = '44444444-4444-4444-8444-444444444444';
const CALL = '55555555-5555-4555-8555-555555555555';
const token = `x.${Buffer.from(JSON.stringify({ client_id: 'chatgpt', sub: USER })).toString('base64url')}.y`;

const shop = () => ({
  id: SHOP, name: 'Luma Studio', category: 'Salon', description: '', contact_phone: '', contact_email: '', timezone: 'America/New_York', status: 'draft', setup_mode: 'full',
  automation_agents: [{ id: 'a1', display_name: 'Luma assistant', primary_language: 'en', supported_languages: ['en'], tone: 'friendly', custom_instructions: '', prohibited_instructions: '', status: 'active' }],
  automation_business_knowledge: [{ services_and_prices: 'Haircut $30', opening_hours: '9-18', delivery_and_service_areas: '', frequently_asked_questions: '', policies: '' }],
  automation_channel_connections: [{ channel_type: 'whatsapp', status: 'connected', connected_account_label: '+1 555 010 2030', setup_order: 3 }, { channel_type: 'website', status: 'not_connected', setup_order: 8 }]
});

// A fake Supabase: answers by table, and records every write.
function fakeDatabase(tables = {}) {
  const writes = [];
  const fetchFake = async (url, options = {}) => {
    const href = decodeURIComponent(String(url));
    const method = options.method || 'GET';
    if (href.endsWith('/auth/v1/user')) return Response.json({ id: USER, email: 'owner@example.com' });
    const table = (href.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
    if (!table) throw new Error(`unexpected fetch ${href}`);
    if (method !== 'GET') {
      const body = options.body ? JSON.parse(options.body) : null;
      writes.push({ method, table, href, body });
      const made = Array.isArray(body) ? body : [{ id: SHOP, ...body }];
      return Response.json(method === 'DELETE' ? [] : made, { status: 201 });
    }
    const value = tables[table];
    return Response.json(typeof value === 'function' ? value(href) : value || []);
  };
  return { fetchFake, writes };
}

async function rpc(method, params, tables) {
  const database = fakeDatabase(tables);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = database.fetchFake;
  try {
    const response = await automationMcp(new Request('https://hansora.co/automation/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    }));
    const raw = await response.text();
    const json = JSON.parse(raw.startsWith('{') ? raw : raw.split('\n').find(line => line.startsWith('data:')).slice(5));
    return { status: response.status, result: json.result, error: json.error, writes: database.writes };
  } finally { globalThis.fetch = originalFetch; }
}
const call = async (name, args, tables) => { const done = await rpc('tools/call', { name, arguments: args || {} }, tables); return { ...done, data: done.result?.structuredContent, text: JSON.stringify(done.result || {}) }; };

test('the server lives at /automation/mcp with its own OAuth discovery', async () => {
  assert.equal(config.path, '/automation/mcp');
  assert.equal(metadataConfig.path, '/.well-known/oauth-protected-resource/automation/mcp');
  const metadata = await (await oauthMetadata(new Request(`https://hansora.co${metadataConfig.path}`))).json();
  assert.equal(metadata.resource, 'https://hansora.co/automation/mcp');
  assert.deepEqual(metadata.authorization_servers, ['https://qmaealblegvcwodlmeht.supabase.co/auth/v1']);
  const response = await automationMcp(new Request('https://hansora.co/automation/mcp', { method: 'POST' }));
  assert.equal(response.status, 401);
  assert.match(response.headers.get('www-authenticate'), /resource_metadata="https:\/\/hansora.co\/\.well-known\/oauth-protected-resource\/automation\/mcp"/);
  assert.match(response.headers.get('access-control-expose-headers'), /WWW-Authenticate/);
});

test('every tool says what it does, and write tools are not marked read-only', async () => {
  const { result } = await rpc('tools/list', {}, {});
  const names = result.tools.map(tool => tool.name).sort();
  assert.deepEqual(names, ['add_knowledge', 'create_ai_employee', 'get_account', 'get_ai_employee', 'get_call', 'get_overview', 'get_website_chat', 'list_ai_employees', 'list_calls', 'list_website_chats', 'remove_knowledge', 'reply_to_website_chat', 'set_website_chat_answered_by', 'start_ai_call', 'test_ai_employee', 'update_ai_employee']);
  for (const tool of result.tools) {
    assert.match(tool.description, /^Use this/);
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean');
  }
  const byName = Object.fromEntries(result.tools.map(tool => [tool.name, tool.annotations]));
  for (const name of ['start_ai_call', 'reply_to_website_chat']) assert.deepEqual([byName[name].readOnlyHint, byName[name].openWorldHint], [false, true]);
  for (const name of ['get_overview', 'get_call', 'list_website_chats']) assert.equal(byName[name].readOnlyHint, true);
});

test('the overview counts waiting chats per channel and shows no customer names or messages', async () => {
  const { data, text } = await call('get_overview', {}, {
    automation_businesses: [shop()],
    automation_conversations: [{ business_id: SHOP, channel_type: 'whatsapp', last_message_preview: 'SECRET customer text', automation_contacts: { display_name: 'Jane Customer' } }, { business_id: SHOP, channel_type: 'whatsapp' }, { business_id: SHOP, channel_type: 'website' }],
    automation_outcomes: [{ business_id: SHOP, outcome_type: 'order', customer_name: 'Jane Customer' }, { business_id: SHOP, outcome_type: 'booking' }],
    automation_calls: [{ business_id: SHOP, direction: 'outbound' }],
    profiles: [{ credits: 12.3 }]
  });
  assert.equal(data.ok, true);
  const employee = data.ai_employees[0];
  assert.deepEqual(employee.chats_waiting_for_a_person, { total: 3, by_channel: { WhatsApp: 2, 'Website chat': 1 } });
  assert.deepEqual(employee.last_24_hours, { new_orders: 1, new_bookings: 1, new_leads: 0, calls_answered: 0, calls_made: 1 });
  assert.equal(data.credits, 123);
  assert.equal(data.plan, 'Pay as you go');
  assert.match(employee.links.inbox, /automation-inbox\.html\?business=/);
  assert.doesNotMatch(text, /SECRET|Jane/);
});

test('a WhatsApp chat cannot be read or answered here, whatever id is passed', async () => {
  const tables = { automation_conversations: [{ id: WHATSAPP_CHAT, business_id: SHOP, channel_type: 'whatsapp', status: 'open', ai_enabled: true, last_message_preview: 'SECRET' }], automation_businesses: [{ id: SHOP }], automation_messages: [{ direction: 'inbound', content: 'SECRET', content_type: 'text' }] };
  for (const [name, args] of [['get_website_chat', { chat_id: WHATSAPP_CHAT }], ['reply_to_website_chat', { chat_id: WHATSAPP_CHAT, message: 'hi' }], ['set_website_chat_answered_by', { chat_id: WHATSAPP_CHAT, answered_by: 'person' }]]) {
    const done = await call(name, args, tables);
    assert.equal(done.data.error, 'chat_not_available_here', name);
    assert.doesNotMatch(done.text, /SECRET/);
    assert.equal(done.writes.length, 0);
  }
});

test('someone else\'s website chat or call is not found', async () => {
  const tables = { automation_conversations: [{ id: WEB_CHAT, business_id: SHOP, channel_type: 'website', status: 'open', ai_enabled: true }], automation_calls: [{ id: CALL, business_id: SHOP, direction: 'inbound', transcript: 'SECRET' }], automation_businesses: [] };
  const chat = await call('get_website_chat', { chat_id: WEB_CHAT }, tables);
  assert.equal(chat.data.error, 'chat_not_found');
  const phone = await call('get_call', { call_id: CALL }, tables);
  assert.equal(phone.data.error, 'call_not_found');
  assert.doesNotMatch(phone.text, /SECRET/);
});

test('a website chat is read in order, with who said what', async () => {
  const { data } = await call('get_website_chat', { chat_id: WEB_CHAT }, {
    automation_conversations: [{ id: WEB_CHAT, business_id: SHOP, channel_type: 'website', status: 'needs_attention', ai_enabled: true, automation_contacts: { display_name: 'Visitor 12' } }],
    automation_businesses: [{ id: SHOP }],
    automation_messages: [{ direction: 'outbound', sender_type: 'ai', content_type: 'text', content: 'Hello!', occurred_at: '2026-11-14T10:01:00Z' }, { direction: 'inbound', sender_type: 'customer', content_type: 'text', content: 'Do you open on Sunday?', occurred_at: '2026-11-14T10:00:00Z' }]
  });
  assert.equal(data.chat.waiting_for_a_person, true);
  assert.deepEqual(data.messages.map(item => [item.from, item.text]), [['visitor', 'Do you open on Sunday?'], ['ai', 'Hello!']]);
});

test('replying to a website chat takes it over from the AI first, then saves the reply', async () => {
  let aiEnabled = true;
  const database = { automation_conversations: () => [{ id: WEB_CHAT, business_id: SHOP, contact_id: 'c1', channel_type: 'website', status: aiEnabled ? 'open' : 'human_handling', ai_enabled: aiEnabled }], automation_businesses: [{ id: SHOP }], automation_contacts: [{ id: 'c1' }] };
  const fake = fakeDatabase(database);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => { const response = await fake.fetchFake(url, options); if ((options.method || 'GET') === 'PATCH' && String(url).includes('automation_conversations') && JSON.parse(options.body).ai_enabled === false) aiEnabled = false; return response; };
  let data;
  try {
    const response = await automationMcp(new Request('https://hansora.co/automation/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'reply_to_website_chat', arguments: { chat_id: WEB_CHAT, message: 'Yes, 10 to 4.' } } }) }));
    const raw = await response.text();
    data = JSON.parse(raw.startsWith('{') ? raw : raw.split('\n').find(line => line.startsWith('data:')).slice(5)).result.structuredContent;
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(data.sent, true);
  const steps = fake.writes.map(write => `${write.method} ${write.table}`);
  assert.deepEqual(steps, ['PATCH automation_conversations', 'POST automation_messages', 'PATCH automation_conversations']);
  assert.deepEqual(fake.writes[0].body, { ai_enabled: false, status: 'human_handling' });
  assert.equal(fake.writes[1].body.content, 'Yes, 10 to 4.');
  assert.equal(fake.writes[1].body.sender_type, 'human');
});

test('creating an AI employee writes the same rows as the website form, with no Armenian defaults', async () => {
  const { data, writes } = await call('create_ai_employee', { business_name: ' Luma Studio ', services_and_prices: 'Haircut $30', timezone: 'America/New_York', tone: 'professional' }, { automation_businesses: [shop()], automation_provider_resources: [] });
  assert.equal(data.created, true);
  const posted = Object.fromEntries(writes.filter(write => write.method === 'POST').map(write => [write.table, write.body]));
  assert.deepEqual(posted.automation_businesses, { owner_user_id: USER, timezone: 'America/New_York', name: 'Luma Studio' });
  assert.deepEqual(posted.automation_agents, { business_id: SHOP, display_name: 'Luma Studio assistant', tone: 'professional', primary_language: 'en', supported_languages: ['en'] });
  assert.equal(posted.automation_business_knowledge.services_and_prices, 'Haircut $30');
  assert.deepEqual(posted.automation_channel_connections.map(row => row.channel_type), ['instagram_dm', 'instagram_comments', 'whatsapp', 'phone']);
  assert.match(data.ai_employee.links.connect_channels, /automation-agent\.html\?id=/);
});

test('updating sends only the changed fields and keeps the main language among the supported ones', async () => {
  const { data, writes } = await call('update_ai_employee', { opening_hours: 'Mon-Sat 9-18', primary_language: 'ru' }, { automation_businesses: [shop()], automation_agents: [{ configuration_version: 4 }], automation_business_knowledge: [{ revision: 2 }], automation_provider_resources: [] });
  assert.deepEqual(data.changed_fields.sort(), ['opening_hours', 'primary_language', 'supported_languages']);
  const patches = Object.fromEntries(writes.filter(write => write.method === 'PATCH').map(write => [write.table, write.body]));
  assert.deepEqual(patches.automation_agents, { primary_language: 'ru', supported_languages: ['ru', 'en'], configuration_version: 5 });
  assert.deepEqual(patches.automation_business_knowledge, { opening_hours: 'Mon-Sat 9-18', revision: 3 });
  assert.equal(patches.automation_businesses, undefined);
});

test('with several AI employees the tool asks which one instead of guessing', async () => {
  const second = { ...shop(), id: '66666666-6666-4666-8666-666666666666', name: 'Second Shop' };
  const { data } = await call('list_calls', {}, { automation_businesses: [shop(), second] });
  assert.equal(data.error, 'ai_employee_id_required');
  assert.equal(data.ai_employees.length, 2);
});

test('an AI call with no outgoing phone line explains what to do and starts nothing', async () => {
  const { data, writes } = await call('start_ai_call', { phone_number: '+15550102030', purpose: 'Confirm the appointment' }, { automation_businesses: [shop()], automation_phone_numbers: [] });
  assert.equal(data.error, 'no_outgoing_line');
  assert.match(data.links.phone, /automation-phone\.html/);
  assert.equal(writes.length, 0);
});

test('calls list the number and purpose; the transcript comes only from get_call', async () => {
  const row = { id: CALL, business_id: SHOP, direction: 'outbound', status: 'completed', started_at: '2026-11-14T10:00:00Z', ended_at: '2026-11-14T10:01:30Z', transcript: 'AI: Hello\nCaller: Hi', summary: 'Confirmed.', outcome: { called_number: '+15550102030', purpose: 'Confirm' } };
  const tables = { automation_businesses: [shop()], automation_calls: [row], automation_phone_numbers: [{ e164: '+15550100000', country: 'US', livekit_outbound_trunk_id: 't1', provider: 'twilio' }] };
  const list = await call('list_calls', {}, tables);
  assert.deepEqual(list.data.calls[0], { call_id: CALL, direction: 'AI called out', status: 'completed', started_at: row.started_at, duration_seconds: 90, called_number: '+15550102030', purpose: 'Confirm', summary: 'Confirmed.', has_transcript: true });
  assert.deepEqual(list.data.phone_numbers, [{ number: '+15550100000', country: 'US', can_call_out: true }]);
  const one = await call('get_call', { call_id: CALL }, tables);
  assert.equal(one.data.call.transcript, 'AI: Hello\nCaller: Hi');
});
