import assert from 'node:assert/strict';
import test from 'node:test';
import { computeSlots, normalizeCalendarConfig, summarizeSlots, zonedDateTimeToUtc } from '../../lib/automation/availability.mjs';
import { buildToolDefinitions, createToolRunner, orderFieldMap, toolInstructions } from '../../lib/automation/tools.mjs';
import { askElevenLabsText, elevenLabsClientTools } from '../../lib/automation/providers/elevenlabs.mjs';

process.env.ELEVENLABS_API_KEY ||= 'test-key';
const YEREVAN = 'Asia/Yerevan'; // UTC+4, no daylight saving
// Monday 5 October 2026, 08:00 in Yerevan
const MONDAY_8AM = Date.parse('2026-10-05T04:00:00Z');
const calendar = { timezone: YEREVAN, weekly_hours: { mon: [{ start: '10:00', end: '13:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }, duration_minutes: 60, step_minutes: 60, buffer_minutes: 0, min_notice_minutes: 60, max_days_ahead: 14 };

test('local business time converts to UTC, including daylight-saving zones', () => {
  assert.equal(new Date(zonedDateTimeToUtc('2026-10-05', 10 * 60, YEREVAN)).toISOString(), '2026-10-05T06:00:00.000Z');
  assert.equal(new Date(zonedDateTimeToUtc('2026-07-01', 9 * 60, 'Europe/Berlin')).toISOString(), '2026-07-01T07:00:00.000Z');
  assert.equal(new Date(zonedDateTimeToUtc('2026-12-01', 9 * 60, 'Europe/Berlin')).toISOString(), '2026-12-01T08:00:00.000Z');
});

test('slots follow working hours, notice, existing bookings and buffers', () => {
  const free = computeSlots({ config: calendar, now: MONDAY_8AM, from: MONDAY_8AM, to: MONDAY_8AM + 86400000 });
  assert.deepEqual(free.map(slot => slot.start), ['2026-10-05T06:00:00.000Z', '2026-10-05T07:00:00.000Z', '2026-10-05T08:00:00.000Z']);
  const booked = computeSlots({ config: calendar, now: MONDAY_8AM, from: MONDAY_8AM, to: MONDAY_8AM + 86400000, busy: [{ start: Date.parse('2026-10-05T07:00:00Z'), end: Date.parse('2026-10-05T08:00:00Z') }] });
  assert.deepEqual(booked.map(slot => slot.start), ['2026-10-05T06:00:00.000Z', '2026-10-05T08:00:00.000Z']);
  const buffered = computeSlots({ config: { ...calendar, buffer_minutes: 15 }, now: MONDAY_8AM, from: MONDAY_8AM, to: MONDAY_8AM + 86400000, busy: [{ start: Date.parse('2026-10-05T07:00:00Z'), end: Date.parse('2026-10-05T08:00:00Z') }] });
  assert.deepEqual(buffered.map(slot => slot.start), []);
  const lateNow = Date.parse('2026-10-05T06:30:00Z'); // 10:30 local, 60 min notice → first slot 12:00
  assert.deepEqual(computeSlots({ config: calendar, now: lateNow, from: lateNow, to: lateNow + 86400000 }).map(slot => slot.start), ['2026-10-05T08:00:00.000Z']);
  assert.deepEqual(computeSlots({ config: { ...calendar, closed_dates: ['2026-10-05'] }, now: MONDAY_8AM, from: MONDAY_8AM, to: MONDAY_8AM + 86400000 }), []);
});

test('calendar config is sanitized and slot summaries stay short', () => {
  const config = normalizeCalendarConfig({ timezone: 'Mars/Base', weekly_hours: { mon: [{ start: '18:00', end: '09:00' }, { start: '09:00', end: '12:00' }] }, duration_minutes: 9999, services: [{ name: ' Haircut ', duration_minutes: 45 }, { name: '' }] });
  assert.equal(config.timezone, 'UTC');
  assert.deepEqual(config.weekly_hours.mon, [{ start: '09:00', end: '12:00' }]);
  assert.deepEqual(config.weekly_hours.tue, []);
  assert.equal(config.duration_minutes, 720);
  assert.deepEqual(config.services, [{ name: 'Haircut', duration_minutes: 45 }]);
  const slots = Array.from({ length: 10 }, (_, index) => ({ start: new Date(Date.parse('2026-10-05T06:00:00Z') + index * 1800000).toISOString() }));
  assert.equal(summarizeSlots(slots, { perDay: 4, days: 2 }, YEREVAN).length, 4);
});

test('tool definitions follow what the owner enabled and the order fields they require', () => {
  const none = buildToolDefinitions({ tools: {} });
  assert.deepEqual(none.map(tool => tool.name), ['handoff_to_human']);
  const all = buildToolDefinitions({ tools: { calendar: { enabled: true, config: {} }, orders: { enabled: true, config: { required_fields: ['Product', 'Size', 'Delivery address'] } }, leads: { enabled: true } } });
  assert.deepEqual(all.map(tool => tool.name), ['check_availability', 'create_booking', 'cancel_booking', 'create_order', 'create_lead', 'handoff_to_human']);
  const order = all.find(tool => tool.name === 'create_order');
  assert.deepEqual(order.parameters.required, ['product', 'size', 'delivery_address', 'customer_confirmed']);
  assert.match(toolInstructions(all), /reference number/);
  assert.deepEqual(orderFieldMap({ required_fields: ['Size', 'size'] }).map(field => field.key), ['size', 'size_2']);
  const client = elevenLabsClientTools(all);
  assert.equal(client[0].type, 'client');
  assert.ok(Object.values(client.find(tool => tool.name === 'create_lead').parameters.properties).every(property => property.description));
});

function fakeDb({ tools, outcomes = [] }) {
  const inserted = []; const updated = []; const alerts = [];
  const deps = {
    now: () => MONDAY_8AM,
    first: async path => {
      if (path.includes('automation_businesses')) return { id: 'biz', name: 'Ararat Studio', timezone: YEREVAN };
      if (path.includes('automation_outcomes') && path.includes('reference_number=eq.')) return outcomes.find(row => path.includes(`reference_number=eq.${row.reference_number}`) && path.includes(`contact_id=eq.${row.contact_id}`)) || null;
      if (path.includes('automation_outcomes')) return inserted.at(-1) || null;
      return null;
    },
    rows: value => Array.isArray(value) ? value : [],
    supabaseRequest: async path => path.includes('automation_tool_configs') ? tools : outcomes.filter(row => row.status !== 'cancelled').map(row => ({ scheduled_start: row.scheduled_start, scheduled_end: row.scheduled_end })),
    serviceInsert: async (table, value) => {
      if (value.outcome_type === 'booking' && outcomes.some(row => row.status !== 'cancelled' && row.scheduled_start === value.scheduled_start)) throw Object.assign(new Error('conflict'), { status: 409 });
      const row = { id: `row-${inserted.length + 1}`, reference_number: 1041 + inserted.length, ...value }; inserted.push(row); return row;
    },
    serviceUpdate: async (table, query, value) => { updated.push({ table, query, value }); return [value]; },
    notifyOwner: async input => { alerts.push(input); return []; }
  };
  return { deps, inserted, updated, alerts };
}

const context = { businessId: 'biz', conversationId: 'conv', contactId: 'contact-1', channel: 'whatsapp', contact: { name: 'Ani', externalId: '37499111222' } };
const tools = [{ tool_type: 'calendar', enabled: true, config: calendar }, { tool_type: 'orders', enabled: true, config: { required_fields: ['Product', 'Delivery address'] } }, { tool_type: 'leads', enabled: false, config: {} }];

test('booking needs confirmation, a real free slot, and notifies the owner once saved', async () => {
  const db = fakeDb({ tools });
  const run = createToolRunner(context, db.deps);
  const availability = await run('check_availability', {});
  assert.equal(availability.ok, true);
  assert.deepEqual(availability.slots.map(slot => slot.start), ['2026-10-05T06:00:00.000Z', '2026-10-05T07:00:00.000Z', '2026-10-05T08:00:00.000Z', '2026-10-12T06:00:00.000Z', '2026-10-12T07:00:00.000Z', '2026-10-12T08:00:00.000Z']);
  assert.equal(availability.today, '2026-10-05');
  assert.equal((await run('create_booking', { start: '2026-10-05T06:00:00.000Z', customer_name: 'Ani' })).error, 'customer_confirmation_required');
  assert.equal((await run('create_booking', { start: '2026-10-05T06:30:00.000Z', customer_name: 'Ani', customer_confirmed: true })).error, 'time_not_available');
  const booked = await run('create_booking', { start: '2026-10-05T06:00:00.000Z', customer_name: 'Ani', customer_confirmed: true });
  assert.equal(booked.ok, true);
  assert.equal(booked.reference, '1041');
  assert.equal(booked.status, 'pending_confirmation');
  assert.equal(db.inserted[0].customer_phone, '37499111222');
  assert.equal(db.inserted[0].scheduled_end, '2026-10-05T07:00:00.000Z');
  assert.equal(db.alerts[0].event, 'booking_created');
  assert.equal(db.alerts[0].data.reference, '1041');
});

test('a slot taken at the same moment returns time_not_available instead of double booking', async () => {
  const db = fakeDb({ tools });
  db.deps.serviceInsert = async () => { throw Object.assign(new Error('exclusion violation'), { status: 409 }); };
  const run = createToolRunner(context, db.deps);
  assert.equal((await run('create_booking', { start: '2026-10-05T06:00:00.000Z', customer_name: 'Ani', customer_confirmed: true })).error, 'time_not_available');
  assert.equal(db.alerts.length, 0);
});

test('orders require every owner field; disabled tools and test chats never save', async () => {
  const db = fakeDb({ tools });
  const run = createToolRunner(context, db.deps);
  const missing = await run('create_order', { product: 'White cabinet', customer_confirmed: true });
  assert.deepEqual(missing.missing, ['Delivery address']);
  const order = await run('create_order', { product: 'White cabinet', delivery_address: 'Arabkir 12', customer_confirmed: true });
  assert.equal(order.ok, true);
  assert.deepEqual(db.inserted[0].collected_fields, { Product: 'White cabinet', 'Delivery address': 'Arabkir 12' });
  assert.equal(db.alerts[0].event, 'order_created');
  assert.equal((await run('create_lead', { interest: 'Kitchen' })).error, 'leads_not_enabled');
  const dry = createToolRunner({ ...context, dryRun: true }, fakeDb({ tools }).deps);
  const testOrder = await dry('create_order', { product: 'Cabinet', delivery_address: 'Arabkir', customer_confirmed: true });
  assert.equal(testOrder.test, true);
  assert.equal(db.inserted.length, 1);
  assert.equal((await run('delete_everything', {})).error, 'unknown_tool');
});

test('customers can cancel only their own booking; handoff pauses the AI and alerts the team', async () => {
  const outcomes = [{ id: 'b1', reference_number: 2001, contact_id: 'contact-1', outcome_type: 'booking', status: 'new', scheduled_start: '2026-10-05T07:00:00.000Z', scheduled_end: '2026-10-05T08:00:00.000Z', customer_name: 'Ani', service_name: 'Visit' }];
  const db = fakeDb({ tools, outcomes });
  const run = createToolRunner(context, db.deps);
  assert.equal((await createToolRunner({ ...context, contactId: 'someone-else' }, db.deps)('cancel_booking', { reference: '2001', customer_confirmed: true })).error, 'booking_not_found');
  const cancelled = await run('cancel_booking', { reference: '#2001', customer_confirmed: true });
  assert.equal(cancelled.ok, true);
  assert.deepEqual(db.updated[0].value.status, 'cancelled');
  assert.equal(db.alerts[0].event, 'booking_cancelled');
  const handoff = await run('handoff_to_human', { reason: 'Refund request' });
  assert.equal(handoff.ok, true);
  assert.deepEqual(db.updated[1], { table: 'automation_conversations', query: 'id=eq.conv&business_id=eq.biz', value: { ai_enabled: false, status: 'needs_attention', intent: 'Refund request' } });
  assert.equal(db.alerts[1].event, 'handoff_requested');
});

class FakeSocket {
  static script = [];
  constructor() { this.sent = []; this.listeners = {}; FakeSocket.last = this; setTimeout(() => this.emit('open', {}), 0); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  emit(type, event) { for (const handler of this.listeners[type] || []) handler(event); }
  send(raw) {
    const message = JSON.parse(raw); this.sent.push(message);
    const reply = FakeSocket.script.shift();
    if (reply) setTimeout(() => reply(this, message), 0);
  }
  close() {}
}

test('ElevenLabs bridge runs client tools and returns the answer given after the tool result', async () => {
  const say = text => ({ data: JSON.stringify({ type: 'agent_response', agent_response_event: { agent_response: text } }) });
  FakeSocket.script = [
    socket => socket.emit('message', { data: JSON.stringify({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { conversation_id: 'conv-11' } }) }),
    null,
    socket => { socket.emit('message', say('One moment, let me check.')); socket.emit('message', { data: JSON.stringify({ type: 'client_tool_call', client_tool_call: { tool_name: 'check_availability', tool_call_id: 't1', parameters: { date: '2026-10-05' } } }) }); },
    socket => socket.emit('message', say('Monday has 10:00 and 11:00 free.'))
  ];
  const calls = [];
  const result = await askElevenLabsText({ agentId: 'agent', text: 'Any time Monday?', context: 'ctx', channel: 'whatsapp', settleMs: 10, onToolCall: async (name, args) => { calls.push([name, args]); return { ok: true, slots: [] }; }, fetchImpl: async () => ({ ok: true, json: async () => ({ signed_url: 'wss://example' }) }), WebSocketImpl: FakeSocket });
  assert.deepEqual(calls, [['check_availability', { date: '2026-10-05' }]]);
  assert.equal(result.text, 'Monday has 10:00 and 11:00 free.');
  assert.deepEqual(result.toolCalls, [{ name: 'check_availability', ok: true }]);
  assert.equal(result.conversationId, 'conv-11');
  const toolResult = FakeSocket.last.sent.find(message => message.type === 'client_tool_result');
  assert.deepEqual({ id: toolResult.tool_call_id, error: toolResult.is_error, result: JSON.parse(toolResult.result) }, { id: 't1', error: false, result: { ok: true, slots: [] } });
  assert.equal(FakeSocket.last.sent[0].dynamic_variables.hansora_channel, 'whatsapp');
});
