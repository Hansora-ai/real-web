// Business actions the AI employee can take during a conversation. The business, conversation and contact
// always come from the trusted server context — never from the model's arguments.
import * as db from './db.mjs';
import { sha256, decryptSecret } from './crypto.mjs';
import { computeSlots, formatSlot, localDate, normalizeCalendarConfig, serviceDuration, summarizeSlots, zonedDateTimeToUtc } from './availability.mjs';
import { cancelGoogleEvent, createGoogleEvent, googleBusyIntervals, refreshGoogleAccessToken } from './google-calendar.mjs';
import { notifyOwner } from './notify.mjs';

export const DEFAULT_ORDER_FIELDS = ['Product or service', 'Quantity or dimensions', 'Customer name', 'Phone number', 'Delivery address'];
const CHANNEL_NAMES = { instagram_dm: 'Instagram DM', instagram_comments: 'Instagram comment', whatsapp: 'WhatsApp', phone: 'Phone', test: 'Test chat' };
const DAY = 24 * 60 * 60 * 1000;

export function fieldKey(label, index) {
  const key = String(label || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  return key || `field_${index + 1}`;
}

// The customer's own name and phone are shown as "who ordered"; every other field (including "product name")
// is part of what was ordered.
export function isContactField(label) {
  return /^(customer|client|your|full|contact)?\s*(full\s*)?name$|phone|mobile|telephone|whatsapp number/i.test(String(label || '').trim());
}

// Optional message the owner wants after every order; {number} becomes the order reference.
export function orderConfirmationText(config = {}, reference = '') {
  const template = String(config.confirmation_message || '').trim().slice(0, 1000);
  return template ? template.replace(/\{\s*(number|order_number|reference)\s*\}/gi, reference) : '';
}

// Optional delivery time slots for orders: "N deliveries per window" (1 per 20 minutes = one every 20 minutes).
export function deliverySlotsConfig(config = {}) {
  const slots = config?.delivery_slots || {};
  const clamp = (value, min, max, fallback) => { const number = Math.round(Number(value)); return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback; };
  return { enabled: Boolean(slots.enabled), perWindow: clamp(slots.per_window, 1, 500, 1), windowMinutes: clamp(slots.window_minutes, 5, 240, 30), leadMinutes: clamp(slots.lead_minutes, 0, 1440, 30) };
}

// Owner's own questions for leads (company, budget, area…): asked naturally, saved with the lead, never required.
export function leadQuestionMap(config = {}) {
  const labels = (Array.isArray(config.questions) ? config.questions : []).map(label => String(label || '').trim().slice(0, 80)).filter(Boolean).slice(0, 15);
  const used = new Set();
  return labels.map((label, index) => { let key = `q_${fieldKey(label, index)}`; while (used.has(key)) key = `${key}_${index + 1}`; used.add(key); return { key, label }; });
}

export function orderFieldMap(config = {}) {
  const labels = (Array.isArray(config.required_fields) && config.required_fields.length ? config.required_fields : DEFAULT_ORDER_FIELDS)
    .map(label => String(label || '').trim().slice(0, 80)).filter(Boolean).slice(0, 15);
  const used = new Set();
  return labels.map((label, index) => { let key = fieldKey(label, index); while (used.has(key)) key = `${key}_${index + 1}`; used.add(key); return { key, label }; });
}

// Tool definitions (JSON Schema parameters) for the provider. Built per business so the order tool asks for
// exactly the fields that owner requires.
export function buildToolDefinitions({ tools = {} } = {}) {
  const definitions = [];
  const confirmed = { type: 'boolean', description: 'true only after you repeated every detail back to the customer and they explicitly confirmed it.' };
  if (tools.calendar?.enabled) {
    const services = normalizeCalendarConfig(tools.calendar.config).services.map(item => item.name);
    const service = { type: 'string', description: services.length ? `Service name, one of: ${services.join(', ')}` : 'Service or reason for the visit.' };
    const calendarConfig = normalizeCalendarConfig(tools.calendar.config);
    const peopleMode = calendarConfig.count_by === 'people';
    const placeNames = calendarConfig.places.map(item => item.name);
    const people = { type: 'integer', description: `How many people the booking is for${calendarConfig.max_group ? ` (at most ${calendarConfig.max_group})` : ''}.` };
    const place = { type: 'string', description: `Only if the customer asks for a specific one: ${placeNames.join(', ')}.` };
    const extra = { ...(peopleMode ? { people } : {}), ...(placeNames.length ? { place } : {}) };
    definitions.push({
      name: 'check_availability',
      description: 'Find free appointment times. Call it before suggesting or promising any time. Offer only times it returns.',
      parameters: { type: 'object', properties: { date: { type: 'string', description: 'Preferred day in YYYY-MM-DD (business local date). Omit to get the next available days.' }, service, ...extra }, required: peopleMode ? ['people'] : [] }
    });
    definitions.push({
      name: 'create_booking',
      description: 'Book an appointment in a free time returned by check_availability, after the customer confirmed the time and details.',
      parameters: { type: 'object', properties: { start: { type: 'string', description: 'The exact "start" value of the chosen slot from check_availability.' }, service, customer_name: { type: 'string', description: 'Customer full name.' }, customer_phone: { type: 'string', description: 'Customer phone number, if given.' }, notes: { type: 'string', description: 'Anything else the business needs to know.' }, ...extra, customer_confirmed: confirmed }, required: ['start', 'customer_name', ...(peopleMode ? ['people'] : []), 'customer_confirmed'] }
    });
  }
  if (tools.calendar?.enabled) {
    definitions.push({
      name: 'cancel_booking',
      description: 'Cancel one of this customer\'s own upcoming bookings after they confirmed which one and that they want to cancel.',
      parameters: { type: 'object', properties: { reference: { type: 'string', description: 'Booking reference number the customer gave or you gave them.' }, customer_confirmed: confirmed }, required: ['reference', 'customer_confirmed'] }
    });
  }
  if (tools.orders?.enabled) {
    const fields = orderFieldMap(tools.orders.config);
    const delivery = deliverySlotsConfig(tools.orders.config);
    if (delivery.enabled) definitions.push({
      name: 'check_delivery_times',
      description: 'Find free delivery times. Call it before promising any delivery time. Offer only times it returns.',
      parameters: { type: 'object', properties: { date: { type: 'string', description: 'Preferred day in YYYY-MM-DD (business local date). Omit for the earliest times.' } }, required: [] }
    });
    definitions.push({
      name: 'create_order',
      description: 'Create an order after collecting every required detail and getting the customer\'s explicit confirmation. Never invent a price.',
      parameters: { type: 'object', properties: { ...Object.fromEntries(fields.map(field => [field.key, { type: 'string', description: field.label }])), notes: { type: 'string', description: 'Extra details or requests.' }, ...(delivery.enabled ? { delivery_time: { type: 'string', description: 'The exact "start" value of the chosen time from check_delivery_times.' } } : {}), customer_confirmed: confirmed }, required: [...fields.map(field => field.key), ...(delivery.enabled ? ['delivery_time'] : []), 'customer_confirmed'] }
    });
  }
  if (tools.leads?.enabled) {
    definitions.push({
      name: 'create_lead',
      description: 'Save a potential customer for the sales team when they show buying interest but are not ready to order or book.',
      parameters: { type: 'object', properties: { interest: { type: 'string', description: 'What the customer is interested in.' }, customer_name: { type: 'string' }, customer_phone: { type: 'string' }, details: { type: 'string', description: 'Budget, timing, size or other useful details.' }, quality: { type: 'string', enum: ['high', 'medium', 'low'], description: 'How likely they are to buy.' }, ...Object.fromEntries(leadQuestionMap(tools.leads.config).map(question => [question.key, { type: 'string', description: `Answer to: ${question.label}` }])) }, required: ['interest'] }
    });
  }
  definitions.push({
    name: 'handoff_to_human',
    description: 'Pause the AI and ask a team member to take over: the customer asks for a person, has a complaint or refund issue, or you cannot answer safely.',
    parameters: { type: 'object', properties: { reason: { type: 'string', description: 'Short reason for the team.' } }, required: ['reason'] }
  });
  return definitions;
}

const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

// The booking calendar's weekly hours are also the business's working hours, so the AI can answer
// "are you open on Saturday?" without a booking. Exact free times still come from check_availability.
export function workingHoursText(calendar, now = Date.now()) {
  if (!calendar?.enabled) return '';
  const config = normalizeCalendarConfig(calendar.config || {});
  const lines = ['## Working hours (from the booking calendar)', `Time zone: ${config.timezone}.`];
  for (const [day, name] of Object.entries(DAY_NAMES)) {
    const ranges = config.weekly_hours[day] || [];
    lines.push(`${name}: ${ranges.length ? ranges.map(range => `${range.start}–${range.end}`).join(', ') : 'closed'}`);
  }
  const today = localDate(now, config.timezone);
  const upcoming = config.closed_dates.filter(date => date >= today).sort().slice(0, 20);
  if (upcoming.length) lines.push(`Also closed on: ${upcoming.join(', ')}.`);
  const notice = config.min_notice_minutes, ahead = config.max_days_ahead;
  const span = minutes => minutes >= 1440 && minutes % 1440 === 0 ? `${minutes / 1440} day(s)` : minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} hour(s)` : `${minutes} minutes`;
  if (notice > 0 || ahead < 365) lines.push(`Bookings can be made${notice > 0 ? ` at least ${span(notice)} in advance` : ''}${notice > 0 && ahead < 365 ? ' and' : ''}${ahead < 365 ? ` up to ${ahead} day(s) ahead` : ''}.`);
  if (config.services.length) lines.push(`Services and how long they take: ${config.services.map(service => `${service.name} (${service.duration_minutes} min)`).join(', ')}.`);
  if (config.count_by === 'people') lines.push(`Bookings are counted by people: up to ${config.capacity} people at the same time${config.max_group ? `, at most ${config.max_group} in one booking` : ''}. Always ask how many people before checking times, and pass people to check_availability and create_booking.`);
  else if (config.places.length) lines.push(`${calendar.config?.place_label ? `${calendar.config.place_label}s` : 'Places'}: ${config.places.map(item => item.name).join(', ')}. Any free one is fine unless the customer asks for a specific one; then pass it as place to check_availability and create_booking.`);
  else if (config.capacity > 1) lines.push(`Up to ${config.capacity} bookings can take place at the same time (for example tables or staff); check_availability only returns times that still have a free place.`);
  lines.push(`Each appointment lasts ${config.duration_minutes} minutes unless a service below says otherwise, and it must end by closing time, so the latest start is closing time minus that length${config.buffer_minutes ? ` (plus a ${config.buffer_minutes}-minute break between appointments)` : ''}.`);
  lines.push('Use these hours to answer questions about opening days and times. For a specific appointment time, always call check_availability. If the customer asks for a time that is not offered, briefly say why (for example: we close at 20:10 and appointments are 1 hour, so the latest start is 19:00, or that time is already taken) and offer the nearest free times.');
  return lines.join('\n');
}

export function toolInstructions(definitions, tools = {}) {
  const names = new Set(definitions.map(item => item.name));
  const hours = workingHoursText(tools.calendar);
  const lines = [...(hours ? [hours, ''] : []), '## Actions', 'You can take real actions with tools. Never say something is booked, ordered or saved unless the tool returned ok: true, and always give the customer the reference number it returns.'];
  if (names.has('check_availability')) lines.push('For appointments: call check_availability first, offer two or three of the returned times, and never offer a time it did not return. Before create_booking, repeat the service, date, time and name and wait for the customer to confirm. To cancel, ask for the booking reference and confirmation, then call cancel_booking.');
  if (names.has('create_order')) {
    const required = orderFieldMap(tools.orders?.config).map(field => field.label);
    lines.push(`For orders you must ask the customer for every one of these details and get an answer for each: ${required.join('; ')}. Ask for one or two at a time, never guess or copy them from the profile (not even the name), then repeat the whole order back and call create_order only after the customer confirms. If a price is not in the business facts, say the team will confirm the price.`);
  }
  const bookingRules = String(tools.calendar?.config?.instructions || '').trim().slice(0, 3000);
  if (names.has('check_availability') && bookingRules) lines.push(`Owner's extra rules for bookings: ${bookingRules}`);
  if (names.has('check_delivery_times')) {
    const delivery = deliverySlotsConfig(tools.orders?.config);
    lines.push(`For delivery times: we deliver up to ${delivery.perWindow} order${delivery.perWindow === 1 ? '' : 's'} per ${delivery.windowMinutes} minutes. Call check_delivery_times, offer the earliest free times (for "as soon as possible" offer the earliest one), and pass the chosen time as delivery_time to create_order. Never promise a time it did not return.`);
  }
  const orderRules = String(tools.orders?.config?.instructions || '').trim().slice(0, 3000);
  if (names.has('create_order') && orderRules) lines.push(`Owner's extra rules for orders: ${orderRules}`);
  if (names.has('create_lead')) {
    const signals = String(tools.leads?.config?.signals || '').trim().slice(0, 800);
    const questions = leadQuestionMap(tools.leads?.config).map(question => question.label);
    lines.push(`When a customer is interested but not ready to buy, call create_lead once with what you learned.${signals ? ` Treat these as signs of a serious buyer: ${signals}` : ''}${questions.length ? ` Before saving the lead, try to learn: ${questions.join('; ')}. Ask naturally, one at a time; if the customer prefers not to answer, save the lead anyway.` : ''}`);
  }
  const rules = { asks_person: true, complaint: true, missing_info: false, uncertain: true, ...(tools.handoff?.config?.rules || {}) };
  const triggers = ['the customer asks for a person'];
  if (rules.complaint) triggers.push('there is a complaint, refund or other sensitive issue (acknowledge it politely first)');
  if (rules.missing_info) triggers.push('a price or availability detail is missing from the business facts');
  if (rules.uncertain) triggers.push('you still cannot answer after two attempts');
  lines.push(`If a tool returns ok: false, explain briefly and offer another option or a team member. Call handoff_to_human when ${triggers.join('; or when ')}. Then tell the customer a team member will reply here.`);
  return lines.join('\n');
}

function idempotencyKey(context, name, args) {
  const stable = JSON.stringify(Object.keys(args || {}).sort().map(key => [key, args[key]]));
  return `${context.conversationId || 'none'}:${name}:${sha256(stable).slice(0, 24)}`;
}

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);

export function createToolRunner(context, overrides = {}) {
  const d = { first: db.first, rows: db.rows, supabaseRequest: db.supabaseRequest, serviceInsert: db.serviceInsert, serviceUpdate: db.serviceUpdate, notifyOwner, googleBusyIntervals, createGoogleEvent, cancelGoogleEvent, refreshGoogleAccessToken, decryptSecret, now: () => Date.now(), ...overrides };
  let loaded;
  async function load() {
    if (loaded) return loaded;
    const business = await d.first(`/rest/v1/automation_businesses?id=eq.${context.businessId}&select=id,name,timezone&limit=1`);
    if (!business) throw Object.assign(new Error('business_not_found'), { status: 404 });
    const configs = d.rows(await d.supabaseRequest(`/rest/v1/automation_tool_configs?business_id=eq.${context.businessId}&select=*`));
    const tools = Object.fromEntries(configs.map(row => [row.tool_type, row]));
    const calendar = normalizeCalendarConfig({ timezone: business.timezone, ...(tools.calendar?.config || {}) });
    loaded = { business, tools, calendar };
    return loaded;
  }

  // Delivery windows use the business working hours (Bookings → Working hours) and time zone.
  function deliveryCalendar(state, delivery) {
    return { ...state.calendar, duration_minutes: delivery.windowMinutes, step_minutes: delivery.windowMinutes, buffer_minutes: 0, min_notice_minutes: delivery.leadMinutes, max_days_ahead: 7, capacity: delivery.perWindow, services: [] };
  }
  async function ordersBetween(from, to) {
    const orders = d.rows(await d.supabaseRequest(`/rest/v1/automation_outcomes?business_id=eq.${context.businessId}&outcome_type=eq.order&status=in.(new,in_progress,waiting,confirmed)&scheduled_start=lt.${encodeURIComponent(new Date(to).toISOString())}&scheduled_end=gt.${encodeURIComponent(new Date(from).toISOString())}&select=scheduled_start,scheduled_end`));
    return orders.map(row => ({ start: Date.parse(row.scheduled_start), end: Date.parse(row.scheduled_end) }));
  }

  // How many people (people mode) and which named place, if the customer asked for one.
  function bookingRequest(state, args) {
    const config = state.calendar;
    let place = null;
    if (config.places.length && text(args.place)) {
      const wanted = text(args.place).toLowerCase();
      place = config.places.find(item => item.name.toLowerCase() === wanted) || config.places.find(item => item.name.toLowerCase().includes(wanted) || wanted.includes(item.name.toLowerCase())) || null;
      if (!place) return { error: { ok: false, error: 'place_not_found', places: config.places.map(item => item.name), note: 'Offer one of these, or any free one.' } };
    }
    if (config.count_by !== 'people') return { people: 1, place };
    const people = Math.round(Number(args.people));
    if (!(people >= 1)) return { error: { ok: false, error: 'people_required', note: 'Ask how many people the booking is for first.' } };
    const max = config.max_group || config.capacity;
    if (people > max) return { error: { ok: false, error: 'group_too_large', max, note: `The largest group that can be booked is ${max}. Offer a team member for bigger groups.` } };
    return { people, place };
  }

  async function busyBetween(from, to, state) {
    // select=* also works before the place/people columns exist (SQL files 8 and 9).
    const bookings = d.rows(await d.supabaseRequest(`/rest/v1/automation_outcomes?business_id=eq.${context.businessId}&outcome_type=eq.booking&status=in.(new,in_progress,waiting,confirmed)&scheduled_start=lt.${encodeURIComponent(new Date(to).toISOString())}&scheduled_end=gt.${encodeURIComponent(new Date(from).toISOString())}&select=*`));
    const busy = bookings.map(row => ({ start: Date.parse(row.scheduled_start), end: Date.parse(row.scheduled_end), people: Number(row.party_size) || Number(row.collected_fields?.People) || 1, place: Number.isInteger(row.slot_index) ? row.slot_index : 0 }));
    const google = await googleAccess(state);
    // Busy time in the owner's own Google Calendar closes the time completely, whatever the number of places.
    if (google) busy.push(...(await d.googleBusyIntervals({ accessToken: google.accessToken, calendarId: google.calendarId, from, to })).map(item => ({ ...item, blocksAll: true })));
    return busy;
  }

  async function googleAccess(state) {
    const resourceId = state.tools.calendar?.provider_resource_id;
    if (!resourceId) return null;
    const resource = await d.first(`/rest/v1/automation_provider_resources?id=eq.${resourceId}&business_id=eq.${context.businessId}&provider=eq.google_calendar&status=eq.active&select=*&limit=1`);
    const calendarId = resource?.safe_config?.calendar_id;
    if (!calendarId) return null;
    const credential = await d.first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${resource.id}&credential_type=eq.refresh_token&select=*&limit=1`);
    if (!credential) throw Object.assign(new Error('calendar_unavailable'), { status: 503 });
    return { accessToken: await d.refreshGoogleAccessToken(d.decryptSecret(credential)), calendarId };
  }

  function customer(args) {
    const name = text(args.customer_name, 200) || text(context.contact?.name, 200);
    const phone = text(args.customer_phone, 60) || (context.channel === 'whatsapp' ? text(context.contact?.externalId, 60) : text(context.contact?.phone, 60));
    return { name, phone };
  }

  async function saveOutcome(row, key) {
    const saved = await d.serviceInsert('automation_outcomes', { business_id: context.businessId, conversation_id: context.conversationId || null, contact_id: context.contactId || null, created_by: 'ai', idempotency_key: key, ...row }, { ignoreDuplicates: true });
    return saved || await d.first(`/rest/v1/automation_outcomes?business_id=eq.${context.businessId}&idempotency_key=eq.${encodeURIComponent(key)}&select=*&limit=1`);
  }

  async function alert(event, outcome, data) {
    if (context.dryRun) return;
    // Handoffs have no record of their own; one alert per conversation per hour avoids repeats on retries.
    const subject = outcome?.id || `${context.conversationId}:${Math.floor(d.now() / 3600000)}`;
    await d.notifyOwner({ businessId: context.businessId, event, idempotencyKey: `${event}:${subject}`, data: { businessId: context.businessId, outcomeId: outcome?.id || null, conversationId: context.conversationId || null, business: loaded.business.name, channel: CHANNEL_NAMES[context.channel] || context.channel, reference: outcome?.reference_number ? String(outcome.reference_number) : '', ...data } }).catch(error => console.error('automation notify error', { event, message: error?.message }));
  }

  const handlers = {
    async check_availability(args) {
      const state = await load(); if (!state.tools.calendar?.enabled) return { ok: false, error: 'bookings_not_enabled' };
      const request = bookingRequest(state, args); if (request.error) return request.error;
      const { service, duration } = serviceDuration(state.calendar, args.service);
      const now = d.now();
      let from = now, to = now + Math.min(state.calendar.max_days_ahead, 14) * DAY;
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(args.date || ''))) { from = zonedDateTimeToUtc(args.date, 0, state.calendar.timezone); to = from + DAY; }
      const busy = await busyBetween(from, to, state);
      const all = computeSlots({ config: state.calendar, busy, from, to, now, durationMinutes: duration, people: request.people, place: request.place ? request.place.index : null });
      const slots = summarizeSlots(all, args.date ? { perDay: 8, days: 1 } : { perDay: 4, days: 4 }, state.calendar.timezone);
      return { ok: true, timezone: state.calendar.timezone, today: localDate(now, state.calendar.timezone), service: service || text(args.service, 120), duration_minutes: duration, ...(request.place ? { place: request.place.name } : {}), ...(state.calendar.count_by === 'people' ? { people: request.people } : {}), slots: slots.map(slot => ({ start: slot.start, label: slot.label })), note: slots.length ? 'Offer only these times.' : 'No free times in this range. Offer another day or a team member.' };
    },

    async create_booking(args) {
      const state = await load(); if (!state.tools.calendar?.enabled) return { ok: false, error: 'bookings_not_enabled' };
      if (args.customer_confirmed !== true) return { ok: false, error: 'customer_confirmation_required' };
      const start = Date.parse(String(args.start || '')); if (!Number.isFinite(start)) return { ok: false, error: 'invalid_start_time' };
      const who = customer(args); if (!who.name) return { ok: false, error: 'customer_name_required' };
      const request = bookingRequest(state, args); if (request.error) return request.error;
      const { service, duration } = serviceDuration(state.calendar, args.service);
      const dayStart = zonedDateTimeToUtc(localDate(start, state.calendar.timezone), 0, state.calendar.timezone);
      const free = computeSlots({ config: state.calendar, busy: await busyBetween(dayStart, dayStart + DAY, state), from: dayStart, to: dayStart + DAY, now: d.now(), durationMinutes: duration, people: request.people, place: request.place ? request.place.index : null });
      if (!free.some(slot => Date.parse(slot.start) === start)) return { ok: false, error: 'time_not_available', note: 'Call check_availability again and offer new times.' };
      const end = start + duration * 60 * 1000;
      const label = formatSlot(start, state.calendar.timezone);
      const serviceName = service || text(args.service, 200) || 'Appointment';
      if (context.dryRun) return { ok: true, test: true, reference: 'TEST', time: label, status: state.calendar.auto_confirm ? 'confirmed' : 'pending_confirmation', note: 'Test chat: nothing was saved.' };
      const key = idempotencyKey(context, 'create_booking', { start: args.start, service: serviceName, name: who.name });
      const peopleMode = state.calendar.count_by === 'people';
      const placeLabel = String(state.tools.calendar?.config?.place_label || 'Place').slice(0, 40);
      const bookingRow = { outcome_type: 'booking', title: `${serviceName} · ${label}`.slice(0, 300), status: state.calendar.auto_confirm ? 'confirmed' : 'new', scheduled_start: new Date(start).toISOString(), scheduled_end: new Date(end).toISOString(), customer_name: who.name, customer_phone: who.phone, service_name: serviceName.slice(0, 200), collected_fields: { Service: serviceName, Time: label, Customer: who.name, Phone: who.phone || '—', Notes: text(args.notes, 1000) || '—' }, summary: `${who.name} booked ${serviceName} for ${label} via ${CHANNEL_NAMES[context.channel] || context.channel}.${args.notes ? ` Notes: ${text(args.notes, 1000)}` : ''}` };
      if (peopleMode) { bookingRow.collected_fields = { ...bookingRow.collected_fields, People: String(request.people) }; bookingRow.title = `${bookingRow.title} · ${request.people} ${request.people === 1 ? 'person' : 'people'}`.slice(0, 300); }
      let outcome = null;
      if (peopleMode) {
        // People mode: the database adds up the people at that time under a lock and refuses the booking if the
        // limit would be passed (SQL file 9), so even bookings at the same second cannot overbook.
        try {
          const saved = await d.supabaseRequest('/rest/v1/rpc/automation_book_people', { method: 'POST', body: { p_business_id: context.businessId, p_start: bookingRow.scheduled_start, p_end: bookingRow.scheduled_end, p_people: request.people, p_capacity: state.calendar.capacity, p_row: { ...bookingRow, conversation_id: context.conversationId || null, contact_id: context.contactId || null, created_by: 'ai', idempotency_key: key } } });
          outcome = Array.isArray(saved) ? saved[0] || null : saved;
        } catch (error) {
          const detail = JSON.stringify(error?.details || error?.message || '');
          if (/people_capacity_reached/.test(detail)) return { ok: false, error: 'time_not_available', note: 'That time just filled up. Call check_availability again.' };
          if (!(error?.status === 404 || /PGRST202|automation_book_people/.test(detail))) throw error;
          // SQL file 9 not run yet: save directly (the people limit was checked just above).
          for (let index = 0; index < Math.min(500, state.calendar.capacity) && !outcome; index++) {
            try { outcome = await saveOutcome({ ...bookingRow, slot_index: index }, key); }
            catch (saveError) { if (saveError?.status === 409) continue; if (/slot_index/.test(JSON.stringify(saveError?.details || ''))) { outcome = await saveOutcome(bookingRow, key).catch(() => null); break; } throw saveError; }
          }
        }
      } else {
        // Each booking takes one numbered place (table, staff member…); the database refuses a place that is
        // already taken at that time, so the number of places can never be exceeded, even at the same second.
        const places = state.calendar.places;
        const indexes = request.place ? [request.place.index] : places.length ? places.map(item => item.index) : Array.from({ length: Math.max(1, Number(state.calendar.capacity) || 1) }, (_, index) => index);
        const numbered = places.length > 0 || indexes.length > 1;
        for (const index of indexes) {
          if (outcome) break;
          const named = places.find(item => item.index === index);
          const attempt = numbered ? { ...bookingRow, slot_index: index, ...(named ? { collected_fields: { ...bookingRow.collected_fields, [placeLabel]: named.name } } : {}) } : bookingRow;
          try { outcome = await saveOutcome(attempt, key); }
          catch (error) {
            if (error?.status === 409) continue;
            // Database not updated for places yet (SQL file 8): behave as a single place.
            if (numbered && /slot_index/.test(JSON.stringify(error?.details || error?.message || ''))) {
              try { outcome = await saveOutcome(bookingRow, key); } catch (retryError) { if (retryError?.status !== 409) throw retryError; }
              break;
            }
            throw error;
          }
        }
      }
      if (!outcome) return { ok: false, error: 'time_not_available', note: 'Someone just booked this time. Call check_availability again.' };
      const bookedPlace = state.calendar.places.find(item => item.index === outcome.slot_index);
      const google = await googleAccess(state).catch(() => null);
      if (google && !outcome.external_calendar_event_id) {
        const event = await d.createGoogleEvent({ accessToken: google.accessToken, calendarId: google.calendarId, idempotencyKey: key, summary: `${serviceName} — ${who.name}`, description: `Booked by Hansora AI (#${outcome.reference_number})\nCustomer: ${who.name}\nPhone: ${who.phone || '—'}\n${text(args.notes, 1000)}`, start, end, timezone: state.calendar.timezone }).catch(error => { console.error('google event create failed', { message: error?.message }); return null; });
        if (event) await d.serviceUpdate('automation_outcomes', `id=eq.${outcome.id}`, { external_calendar_event_id: event.id });
      }
      await alert('booking_created', outcome, { customer: [who.name, who.phone].filter(Boolean).join(' · '), time: label, details: serviceName });
      return { ok: true, reference: String(outcome.reference_number), time: label, service: serviceName, ...(bookedPlace ? { place: bookedPlace.name } : {}), ...(peopleMode ? { people: request.people } : {}), status: outcome.status === 'confirmed' ? 'confirmed' : 'pending_confirmation', note: outcome.status === 'confirmed' ? 'The booking is confirmed.' : 'Tell the customer the time is reserved and the team will confirm it shortly.' };
    },

    async cancel_booking(args) {
      const state = await load(); if (!state.tools.calendar?.enabled) return { ok: false, error: 'bookings_not_enabled' };
      if (args.customer_confirmed !== true) return { ok: false, error: 'customer_confirmation_required' };
      const reference = String(args.reference || '').replace(/\D/g, '');
      if (!reference) return { ok: false, error: 'reference_required' };
      if (context.dryRun) return { ok: true, test: true, note: 'Test chat: nothing was cancelled.' };
      // Only the same customer (same contact) can cancel, so a guessed number never cancels someone else's booking.
      const booking = context.contactId ? await d.first(`/rest/v1/automation_outcomes?business_id=eq.${context.businessId}&contact_id=eq.${context.contactId}&outcome_type=eq.booking&reference_number=eq.${reference}&select=*&limit=1`) : null;
      if (!booking) return { ok: false, error: 'booking_not_found', note: 'Ask the customer to check the number, or offer a team member.' };
      if (booking.status === 'cancelled') return { ok: true, note: 'This booking was already cancelled.' };
      if (['completed'].includes(booking.status) || Date.parse(booking.scheduled_start) < d.now()) return { ok: false, error: 'booking_already_started', note: 'Offer a team member.' };
      await d.serviceUpdate('automation_outcomes', `id=eq.${booking.id}&business_id=eq.${context.businessId}`, { status: 'cancelled', updated_at: new Date(d.now()).toISOString() });
      if (booking.external_calendar_event_id) {
        const google = await googleAccess(state).catch(() => null);
        if (google) await d.cancelGoogleEvent({ accessToken: google.accessToken, calendarId: google.calendarId, eventId: booking.external_calendar_event_id }).catch(error => console.error('google event cancel failed', { message: error?.message }));
      }
      const label = formatSlot(Date.parse(booking.scheduled_start), state.calendar.timezone);
      await alert('booking_cancelled', booking, { customer: [booking.customer_name, booking.customer_phone].filter(Boolean).join(' · ') || 'Customer', time: label, details: booking.service_name });
      return { ok: true, reference, time: label, note: 'Confirm the cancellation and offer to book another time.' };
    },

    async check_delivery_times(args) {
      const state = await load(); const delivery = deliverySlotsConfig(state.tools.orders?.config);
      if (!state.tools.orders?.enabled || !delivery.enabled) return { ok: false, error: 'delivery_times_not_enabled' };
      const now = d.now();
      let from = now, to = now + 7 * DAY;
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(args.date || ''))) { from = zonedDateTimeToUtc(args.date, 0, state.calendar.timezone); to = from + DAY; }
      const all = computeSlots({ config: deliveryCalendar(state, delivery), busy: await ordersBetween(from, to), from, to, now });
      const slots = summarizeSlots(all, args.date ? { perDay: 10, days: 1 } : { perDay: 5, days: 2 }, state.calendar.timezone);
      return { ok: true, timezone: state.calendar.timezone, today: localDate(now, state.calendar.timezone), slots: slots.map(slot => ({ start: slot.start, label: slot.label })), note: slots.length ? 'Offer only these delivery times.' : 'No free delivery times in this range. Offer another day or a team member.' };
    },

    async create_order(args) {
      const state = await load(); if (!state.tools.orders?.enabled) return { ok: false, error: 'orders_not_enabled' };
      if (args.customer_confirmed !== true) return { ok: false, error: 'customer_confirmation_required' };
      const fields = orderFieldMap(state.tools.orders.config);
      const missing = fields.filter(field => !text(args[field.key])).map(field => field.label);
      if (missing.length) return { ok: false, error: 'missing_details', missing, note: 'Ask the customer for these details first.' };
      // Delivery time slots: the chosen time must still have room (N deliveries per window).
      const delivery = deliverySlotsConfig(state.tools.orders.config);
      let deliveryStart = null, deliveryLabel = '';
      if (delivery.enabled) {
        deliveryStart = Date.parse(String(args.delivery_time || ''));
        if (!Number.isFinite(deliveryStart)) return { ok: false, error: 'delivery_time_required', note: 'Call check_delivery_times and let the customer choose a time first.' };
        const dayStart = zonedDateTimeToUtc(localDate(deliveryStart, state.calendar.timezone), 0, state.calendar.timezone);
        const free = computeSlots({ config: deliveryCalendar(state, delivery), busy: await ordersBetween(dayStart, dayStart + DAY), from: dayStart, to: dayStart + DAY, now: d.now() });
        if (!free.some(slot => Date.parse(slot.start) === deliveryStart)) return { ok: false, error: 'delivery_time_not_available', note: 'Call check_delivery_times again and offer new times.' };
        deliveryLabel = formatSlot(deliveryStart, state.calendar.timezone);
      }
      const collected = Object.fromEntries(fields.map(field => [field.label, text(args[field.key], 1000)]));
      if (deliveryLabel) collected['Delivery time'] = deliveryLabel;
      if (args.notes) collected.Notes = text(args.notes, 1000);
      const who = customer({ customer_name: collected['Customer name'] || args.customer_name, customer_phone: collected['Phone number'] || args.customer_phone });
      const details = fields.filter(field => !isContactField(field.label)).map(field => collected[field.label]).join(' · ');
      if (context.dryRun) return { ok: true, test: true, reference: 'TEST', note: 'Test chat: nothing was saved.' };
      const outcome = await saveOutcome({ outcome_type: 'order', title: (details || 'New order').slice(0, 300), ...(deliveryStart ? { scheduled_start: new Date(deliveryStart).toISOString(), scheduled_end: new Date(deliveryStart + delivery.windowMinutes * 60000).toISOString() } : {}), status: state.tools.orders.config?.auto_confirm ? 'confirmed' : 'new', customer_name: who.name, customer_phone: who.phone, collected_fields: collected, summary: `Order from ${who.name || 'customer'} via ${CHANNEL_NAMES[context.channel] || context.channel}: ${details}`.slice(0, 8000) }, idempotencyKey(context, 'create_order', collected));
      await alert('order_created', outcome, { customer: [who.name, who.phone].filter(Boolean).join(' · '), details });
      const reference = String(outcome.reference_number);
      const confirmation = orderConfirmationText(state.tools.orders.config, reference);
      return confirmation
        ? { ok: true, reference, status: outcome.status === 'confirmed' ? 'confirmed' : 'received', message_to_send: confirmation, note: 'Send message_to_send to the customer as your reply, translated into the conversation language if needed, keeping the order number.' }
        : { ok: true, reference, status: outcome.status === 'confirmed' ? 'confirmed' : 'received', note: 'Thank the customer, give the order number, briefly repeat what was ordered, and say what happens next (the team confirms the order and price).' };
    },

    async create_lead(args) {
      const state = await load(); if (!state.tools.leads?.enabled) return { ok: false, error: 'leads_not_enabled' };
      const interest = text(args.interest, 300); if (!interest) return { ok: false, error: 'interest_required' };
      const who = customer(args);
      if (context.dryRun) return { ok: true, test: true, note: 'Test chat: nothing was saved.' };
      const outcome = await saveOutcome({ outcome_type: 'lead', title: interest, status: 'new', customer_name: who.name, customer_phone: who.phone, collected_fields: { Interest: interest, ...Object.fromEntries(leadQuestionMap(state.tools.leads.config).map(question => [question.label, text(args[question.key], 1000) || '—'])), Details: text(args.details, 1000) || '—', Quality: ['high', 'medium', 'low'].includes(args.quality) ? args.quality : 'medium' }, summary: `${who.name || 'A customer'} is interested in ${interest}.${args.details ? ` ${text(args.details, 1000)}` : ''}` }, `${context.conversationId || 'none'}:create_lead`);
      await alert('lead_created', outcome, { customer: [who.name, who.phone].filter(Boolean).join(' · ') || 'Customer', details: interest });
      return { ok: true, note: 'Saved for the sales team. Do not mention internal lead tracking to the customer.' };
    },

    async handoff_to_human(args) {
      await load();
      const reason = text(args.reason, 300) || 'Customer needs a person';
      if (context.dryRun) return { ok: true, test: true, note: 'Test chat: the AI would pause and the team would be notified.' };
      if (context.conversationId) await d.serviceUpdate('automation_conversations', `id=eq.${context.conversationId}&business_id=eq.${context.businessId}`, { ai_enabled: false, status: 'needs_attention', intent: reason.slice(0, 200) });
      await alert('handoff_requested', null, { customer: text(context.contact?.name, 200) || 'Customer', details: reason });
      return { ok: true, note: 'Tell the customer a team member will reply here soon. Do not continue helping with this request yourself.' };
    }
  };

  return async function runTool(name, args = {}) {
    const handler = handlers[name];
    if (!handler) return { ok: false, error: 'unknown_tool' };
    try { return await handler(args && typeof args === 'object' ? args : {}); }
    catch (error) {
      console.error('automation tool error', { tool: name, message: error?.message, status: error?.status });
      return { ok: false, error: error?.message === 'calendar_unavailable' ? 'calendar_temporarily_unavailable' : 'action_failed', note: 'Apologise and offer a team member instead.' };
    }
  };
}

export function businessClock(timezone, now = Date.now()) {
  const zone = normalizeCalendarConfig({ timezone }).timezone;
  return `${new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(now))} (${zone}, today is ${localDate(now, zone)})`;
}

// Everything a message processor needs to let the AI act: the tool callback and a context line with the
// business's local date and time, so "tomorrow" and "Friday" resolve correctly.
export async function prepareConversationActions(context, overrides = {}) {
  const first = overrides.first || db.first;
  const business = await first(`/rest/v1/automation_businesses?id=eq.${context.businessId}&select=timezone&limit=1`);
  const runTool = createToolRunner(context, overrides);
  return { onToolCall: runTool, contextLine: `Current business date and time: ${businessClock(business?.timezone, (overrides.now || Date.now)())}.` };
}

export async function loadToolConfigs(businessId, overrides = {}) {
  const request = overrides.supabaseRequest || db.supabaseRequest;
  const configs = db.rows(await request(`/rest/v1/automation_tool_configs?business_id=eq.${businessId}&select=tool_type,enabled,config`));
  return Object.fromEntries(configs.map(row => [row.tool_type, row]));
}
