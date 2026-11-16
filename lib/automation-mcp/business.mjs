// Orders, bookings and leads, products, comment automations, business tools and phone settings for the Hansora
// Automation MCP server. Same privacy rule as data.mjs: a customer's name, phone number and answers are shown only
// when the record came from Hansora's own channels (website chat, phone) or was added by the team.
import { first, rows, serviceInsert, serviceUpdate, supabaseRequest } from '../automation/db.mjs';
import { autoCallSettings } from '../automation/phone-auto-calls.mjs';
import { PHONE_VOICE, PHONE_VOICES, phoneVoice } from '../automation/phone.mjs';
import { NOTIFICATION_EVENTS } from '../automation/notify.mjs';
import { channelName, fail, isUuid, links, ownsBusiness, SITE } from './data.mjs';

const q = encodeURIComponent;
const one = value => Array.isArray(value) ? value[0] || null : value || null;
const OWN_CHANNELS = new Set(['website', 'phone', 'test']);

// ---------- Orders, bookings, leads ----------

export const RECORD_KINDS = ['order', 'booking', 'lead'];
export const RECORD_STATUSES = ['new', 'in_progress', 'waiting', 'confirmed', 'completed', 'cancelled'];
const RECORD_SELECT = 'id,business_id,outcome_type,title,status,reference_number,estimated_value_minor,currency,scheduled_start,scheduled_end,service_name,party_size,assignee,private_note,summary,customer_name,customer_phone,collected_fields,created_by,created_at,conversation_id,automation_conversations(channel_type)';

export function recordView(row) {
  const channel = one(row.automation_conversations)?.channel_type || '';
  // No chat behind it (added by the team) or a Hansora channel: the customer details may be shown.
  const open = !row.conversation_id || OWN_CHANNELS.has(channel);
  const fields = row.collected_fields && typeof row.collected_fields === 'object' ? Object.fromEntries(Object.entries(row.collected_fields).filter(([key]) => !key.startsWith('_'))) : {};
  return {
    record_id: row.id,
    kind: row.outcome_type,
    number: row.reference_number ?? null,
    title: row.title,
    status: row.status,
    ...(row.scheduled_start ? { starts_at: row.scheduled_start, ends_at: row.scheduled_end || null } : {}),
    ...(row.service_name ? { service: row.service_name } : {}),
    ...(row.party_size ? { people: row.party_size } : {}),
    ...(Number(row.estimated_value_minor) > 0 ? { value: Number(row.estimated_value_minor) / 100, currency: row.currency || 'USD' } : {}),
    assigned_to: row.assignee || '',
    note: row.private_note || '',
    created_at: row.created_at,
    came_from: channel ? channelName(channel) : 'Added by the team',
    ...(open
      ? { customer_name: row.customer_name || '', customer_phone: row.customer_phone || '', details: fields, summary: row.summary || '' }
      : { customer_details: `Hidden here because this came from ${channelName(channel)}. Open it in Hansora to see the customer.` })
  };
}

export async function listRecords(businessId, { kind, status, from, to, limit = 20 } = {}) {
  const filters = [
    RECORD_KINDS.includes(kind) ? `outcome_type=eq.${kind}` : '',
    RECORD_STATUSES.includes(status) ? `status=eq.${status}` : '',
    from ? `created_at=gte.${q(from)}` : '',
    to ? `created_at=lte.${q(to)}` : ''
  ].filter(Boolean).map(item => `&${item}`).join('');
  return rows(await supabaseRequest(`/rest/v1/automation_outcomes?business_id=eq.${q(businessId)}${filters}&select=${q(RECORD_SELECT)}&order=created_at.desc&limit=${limit}`)).map(recordView);
}

export async function ownedRecord(userId, recordId) {
  const missing = () => fail('record_not_found', 'This order, booking or lead was not found. Call list_orders_bookings_leads to see the ids.');
  if (!isUuid(recordId)) throw missing();
  const row = await first(`/rest/v1/automation_outcomes?id=eq.${q(recordId)}&select=${q(RECORD_SELECT)}&limit=1`);
  if (!row || !(await ownsBusiness(userId, row.business_id))) throw missing();
  return row;
}

// ---------- Products ----------

const PRODUCT_SELECT = 'id,name,description,category,sku,price,currency,stock,variants,photos,active,source,payment_link,updated_at';
export function productView(row) {
  return {
    product_id: row.id, name: row.name, price: row.price === null ? null : Number(row.price), currency: row.currency, stock: row.stock, category: row.category || '', sku: row.sku || '',
    description: row.description || '', variants: Array.isArray(row.variants) ? row.variants : [], photos: Array.isArray(row.photos) ? row.photos.length : 0, shown_to_customers: row.active !== false, payment_link: row.payment_link || '',
    ...(row.source && row.source !== 'manual' ? { synced_from: row.source } : {})
  };
}

const cleanText = (value, max) => String(value ?? '').trim().slice(0, max);
export function productPatch(input = {}) {
  const patch = {};
  if (input.name !== undefined) { const name = cleanText(input.name, 300); if (name) patch.name = name; }
  if (input.description !== undefined) patch.description = cleanText(input.description, 5000);
  if (input.category !== undefined) patch.category = cleanText(input.category, 200);
  if (input.sku !== undefined) patch.sku = cleanText(input.sku, 120);
  if (input.price !== undefined) patch.price = input.price === null ? null : Math.max(0, Number(input.price) || 0);
  if (input.currency !== undefined && /^[A-Za-z]{3}$/.test(String(input.currency))) patch.currency = String(input.currency).toUpperCase();
  if (input.stock !== undefined) patch.stock = input.stock === null ? null : Math.max(0, Math.round(Number(input.stock) || 0));
  if (input.shown_to_customers !== undefined) patch.active = input.shown_to_customers !== false;
  if (input.payment_link !== undefined) { const link = cleanText(input.payment_link, 1000); if (!link || /^https:\/\//.test(link)) patch.payment_link = link; }
  if (input.variants !== undefined) {
    // The same shape the products page saves: name, own price and stock, optional colour.
    const list = (Array.isArray(input.variants) ? input.variants : []).map(variant => ({
      name: cleanText(variant?.name, 200),
      price: variant?.price === undefined || variant?.price === null ? null : Math.max(0, Number(variant.price) || 0),
      stock: variant?.stock === undefined || variant?.stock === null ? null : Math.max(0, Math.round(Number(variant.stock) || 0)),
      ...(/^#[0-9a-f]{6}$/i.test(String(variant?.color || '')) ? { color: String(variant.color) } : {})
    })).filter(variant => variant.name).slice(0, 50);
    if (new Set(list.map(variant => variant.name.toLowerCase())).size !== list.length) throw fail('variants_repeat', 'Each variant name must be different.');
    patch.variants = list;
    if (list.length && list.every(variant => Number.isInteger(variant.stock))) patch.stock = list.reduce((sum, variant) => sum + variant.stock, 0);
  }
  return patch;
}

export async function listProducts(businessId, { search = '', limit = 30 } = {}) {
  const term = String(search || '').replace(/[%*,()]/g, ' ').trim().slice(0, 80);
  const filter = term ? `&or=(name.ilike.*${q(term)}*,category.ilike.*${q(term)}*,sku.ilike.*${q(term)}*)` : '';
  const [list, catalog] = await Promise.all([
    supabaseRequest(`/rest/v1/automation_products?business_id=eq.${q(businessId)}${filter}&select=${q(PRODUCT_SELECT)}&order=name.asc&limit=${limit}`).then(rows),
    first(`/rest/v1/automation_tool_configs?business_id=eq.${q(businessId)}&tool_type=eq.catalog&select=enabled&limit=1`)
  ]);
  return { products: list.map(productView), ai_offers_products: catalog?.enabled === true };
}

export async function addProduct(businessId, input) {
  const patch = productPatch(input);
  if (!patch.name) throw fail('product_name_required', 'Ask the user for the product name.');
  return serviceInsert('automation_products', { business_id: businessId, ...patch });
}

export async function ownedProduct(userId, productId) {
  const missing = () => fail('product_not_found', 'This product was not found. Call list_products to see the ids.');
  if (!isUuid(productId)) throw missing();
  const row = await first(`/rest/v1/automation_products?id=eq.${q(productId)}&select=${q(`business_id,${PRODUCT_SELECT}`)}&limit=1`);
  if (!row || !(await ownsBusiness(userId, row.business_id))) throw missing();
  return row;
}

export async function updateProduct(row, input) {
  const patch = productPatch(input);
  if (!Object.keys(patch).length) return row;
  const saved = await serviceUpdate('automation_products', `id=eq.${q(row.id)}&business_id=eq.${q(row.business_id)}`, { ...patch, updated_at: new Date().toISOString() });
  return { ...row, ...patch, ...(saved[0] || {}), business_id: row.business_id };
}

export async function deleteProduct(row) {
  await supabaseRequest(`/rest/v1/automation_products?id=eq.${q(row.id)}&business_id=eq.${q(row.business_id)}`, { method: 'DELETE' });
}

// ---------- Business tools (what the AI employee may do) ----------

const TOOL_NAMES = { orders: 'orders', bookings: 'calendar', leads: 'leads', handoff_to_person: 'handoff', products: 'catalog' };
export const TOOL_KEYS = Object.keys(TOOL_NAMES);
export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DEFAULT_ORDER_FIELDS = ['Product or service', 'Quantity or dimensions', 'Customer name', 'Phone number', 'Delivery address'];
const weekday = [{ start: '10:00', end: '19:00' }];

// The same starting settings the Business tools page on hansora.co uses for a tool that was never saved.
export function toolDefaults(timezone = 'UTC') {
  return {
    calendar: { timezone, weekly_hours: { mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday, sat: [{ start: '11:00', end: '17:00' }], sun: [] }, duration_minutes: 60, step_minutes: 30, buffer_minutes: 0, min_notice_minutes: 0, max_days_ahead: 365, last_start_minutes: -1, services: [], closed_dates: [], auto_confirm: false, capacity: 1, count_by: 'bookings', max_group: 0, places: [] },
    orders: { required_fields: [...DEFAULT_ORDER_FIELDS], auto_confirm: false },
    leads: { signals: '', questions: [] },
    handoff: { rules: { asks_person: true, complaint: true, missing_info: false, uncertain: true } },
    catalog: {}
  };
}

async function toolRows(businessId) {
  const configs = rows(await supabaseRequest(`/rest/v1/automation_tool_configs?business_id=eq.${q(businessId)}&select=tool_type,enabled,config`));
  return Object.fromEntries(configs.map(row => [row.tool_type, row]));
}
const state = row => (row ? (row.enabled ? 'on' : 'off') : 'not set up');

export async function businessTools(businessId) {
  const byType = await toolRows(businessId);
  return Object.fromEntries(TOOL_KEYS.map(key => [key, state(byType[TOOL_NAMES[key]])]));
}

// Everything the Business tools page shows for orders, bookings, leads and handoff, in plain names.
const minutesText = value => (value >= 60 && value % 60 === 0 ? `${value / 60} h` : `${value} min`);
export async function businessToolSettings(business) {
  const byType = await toolRows(business.id);
  const defaults = toolDefaults(business.timezone || 'UTC');
  const config = type => ({ ...defaults[type], ...(byType[type]?.config && typeof byType[type].config === 'object' ? byType[type].config : {}) });
  const orders = config('orders'), calendar = config('calendar'), leads = config('leads'), handoff = config('handoff');
  const slots = orders.delivery_slots || {};
  const people = calendar.count_by === 'people';
  const places = Array.isArray(calendar.places) ? calendar.places.filter(place => place?.name) : [];
  return {
    orders: {
      status: state(byType.orders), questions_asked_before_every_order: orders.required_fields || [], new_orders_confirmed_automatically: Boolean(orders.auto_confirm),
      message_after_the_order: orders.confirmation_message || '', extra_rules_for_the_ai: orders.instructions || '',
      delivery_time_slots: slots.enabled ? { on: true, deliveries_at_the_same_time: Number(slots.per_window) || 1, per_minutes: Number(slots.window_minutes) || 30, earliest_minutes_after_ordering: Number(slots.lead_minutes ?? 30) } : { on: false }
    },
    bookings: {
      status: state(byType.calendar), timezone: calendar.timezone || business.timezone || 'UTC',
      opening_hours: Object.fromEntries(DAY_KEYS.map(day => [day, calendar.weekly_hours?.[day] || []])),
      booking_length_minutes: Number(calendar.duration_minutes) || 60, start_every_minutes: Number(calendar.step_minutes) || Number(calendar.duration_minutes) || 60,
      break_between_minutes: Number(calendar.buffer_minutes) || 0, minimum_notice_minutes: Number(calendar.min_notice_minutes) || 0, book_up_to_days_ahead: Number(calendar.max_days_ahead) || 365,
      last_booking: Number(calendar.last_start_minutes ?? -1) < 0 ? 'must end by closing time' : `can start ${minutesText(Number(calendar.last_start_minutes))} before closing`,
      counted_by: people ? 'people' : 'bookings', at_the_same_time: places.length || Number(calendar.capacity) || 1,
      ...(people ? { largest_group: Number(calendar.max_group) || 0 } : { team_member_names: places.map(place => place.name) }),
      services: (calendar.services || []).filter(service => service?.name).map(service => ({ name: service.name, length_minutes: Number(service.duration_minutes) || Number(calendar.duration_minutes) || 60 })),
      days_off: calendar.closed_dates || [],
      questions_asked_before_every_booking: Array.isArray(calendar.required_fields) ? calendar.required_fields : ['Customer name', 'Phone number'],
      new_bookings_confirmed_automatically: Boolean(calendar.auto_confirm), extra_rules_for_the_ai: calendar.instructions || ''
    },
    leads: { status: state(byType.leads), questions: leads.questions || [], signs_of_an_interested_customer: leads.signals || '' },
    handoff_to_person: {
      status: state(byType.handoff),
      hand_over_when: { customer_asks_for_a_person: handoff.rules?.asks_person !== false, customer_complains: handoff.rules?.complaint !== false, information_is_missing: Boolean(handoff.rules?.missing_info), ai_is_unsure: handoff.rules?.uncertain !== false },
      message_for_a_reel_from_another_account: handoff.unreadable_reel_message || ''
    },
    products: { status: state(byType.catalog) },
    only_on_the_website: ['Google Calendar'],
    settings_page: `${SITE}/automation-tools.html?business=${business.id}`
  };
}

// A list of questions as the page saves it: trimmed, at most 15, at most 80 characters each, no repeats.
export function questionList(values, what) {
  const list = (Array.isArray(values) ? values : []).map(value => String(value ?? '').trim().slice(0, 80)).filter(Boolean).slice(0, 15);
  if (new Set(list.map(item => item.toLowerCase())).size !== list.length) throw fail('questions_repeat', `Each ${what} must be different.`);
  return list;
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
export function weeklyHours(input, current = {}) {
  const week = Object.fromEntries(DAY_KEYS.map(day => [day, Array.isArray(current[day]) ? current[day] : []]));
  for (const day of DAY_KEYS) {
    if (input?.[day] === undefined) continue;
    const ranges = (Array.isArray(input[day]) ? input[day] : []).map(range => ({ start: String(range?.start || ''), end: String(range?.end || '') })).sort((a, b) => a.start.localeCompare(b.start));
    for (const [index, range] of ranges.entries()) {
      if (!CLOCK.test(range.start) || !CLOCK.test(range.end) || range.end <= range.start) throw fail('hours_invalid', `${day}: each time range needs a start and a later end in 24-hour time, for example 09:00 to 18:00.`);
      if (index && range.start < ranges[index - 1].end) throw fail('hours_overlap', `${day}: the time ranges overlap.`);
    }
    week[day] = ranges.slice(0, 4);
  }
  return week;
}

// Turns tools on or off and changes their settings. A tool that was never saved starts from the page's defaults.
export async function setBusinessTools(business, changes = {}) {
  const byType = await toolRows(business.id);
  const defaults = toolDefaults(business.timezone || 'UTC');
  const next = {};
  const edit = type => (next[type] ||= { enabled: byType[type] ? byType[type].enabled : type === 'handoff', config: { ...defaults[type], ...(byType[type]?.config && typeof byType[type].config === 'object' ? byType[type].config : {}) } });
  for (const key of TOOL_KEYS) if (typeof changes[key] === 'boolean') edit(TOOL_NAMES[key]).enabled = changes[key];
  if (changes.order_questions !== undefined) edit('orders').config.required_fields = questionList(changes.order_questions, 'order question');
  if (typeof changes.orders_confirmed_automatically === 'boolean') edit('orders').config.auto_confirm = changes.orders_confirmed_automatically;
  if (changes.message_after_the_order !== undefined) edit('orders').config.confirmation_message = String(changes.message_after_the_order || '').trim().slice(0, 500);
  if (changes.booking_questions !== undefined) edit('calendar').config.required_fields = questionList(changes.booking_questions, 'booking question');
  if (typeof changes.bookings_confirmed_automatically === 'boolean') edit('calendar').config.auto_confirm = changes.bookings_confirmed_automatically;
  if (changes.booking_length_minutes !== undefined) edit('calendar').config.duration_minutes = Math.min(1440, Math.max(5, Math.round(Number(changes.booking_length_minutes) || 60)));
  if (changes.opening_hours !== undefined) { const calendar = edit('calendar'); calendar.config.weekly_hours = weeklyHours(changes.opening_hours, calendar.config.weekly_hours); }
  if (changes.lead_questions !== undefined) edit('leads').config.questions = questionList(changes.lead_questions, 'lead question');
  if (changes.signs_of_an_interested_customer !== undefined) edit('leads').config.signals = String(changes.signs_of_an_interested_customer || '').trim().slice(0, 1000);
  if (changes.hand_over_when && typeof changes.hand_over_when === 'object') {
    const names = { customer_asks_for_a_person: 'asks_person', customer_complains: 'complaint', information_is_missing: 'missing_info', ai_is_unsure: 'uncertain' };
    const handoff = edit('handoff');
    handoff.config.rules = { ...handoff.config.rules, ...Object.fromEntries(Object.entries(names).filter(([name]) => typeof changes.hand_over_when[name] === 'boolean').map(([name, rule]) => [rule, changes.hand_over_when[name]])) };
  }
  const clampInt = (value, min, max) => Math.min(max, Math.max(min, Math.round(Number(value) || 0)));
  if (changes.order_extra_rules !== undefined) edit('orders').config.instructions = String(changes.order_extra_rules || '').trim().slice(0, 3000);
  if (changes.delivery_time_slots && typeof changes.delivery_time_slots === 'object') {
    const orders = edit('orders'), now = orders.config.delivery_slots || {}, slot = changes.delivery_time_slots;
    orders.config.delivery_slots = {
      enabled: typeof slot.on === 'boolean' ? slot.on : Boolean(now.enabled),
      per_window: slot.deliveries_at_the_same_time !== undefined ? clampInt(slot.deliveries_at_the_same_time, 1, 500) : Number(now.per_window) || 1,
      window_minutes: slot.per_minutes !== undefined ? clampInt(slot.per_minutes, 5, 240) : Number(now.window_minutes) || 30,
      lead_minutes: slot.earliest_minutes_after_ordering !== undefined ? clampInt(slot.earliest_minutes_after_ordering, 0, 1440) : Number(now.lead_minutes ?? 30)
    };
  }
  if (changes.booking_extra_rules !== undefined) edit('calendar').config.instructions = String(changes.booking_extra_rules || '').trim().slice(0, 3000);
  if (changes.booking_timezone !== undefined) {
    const zone = String(changes.booking_timezone || '').trim();
    try { new Intl.DateTimeFormat('en', { timeZone: zone }); } catch { throw fail('timezone_invalid', 'Use a time zone name such as America/New_York or Europe/London.'); }
    edit('calendar').config.timezone = zone;
  }
  const rule = (key, column, min, max) => { if (changes[key] !== undefined) { const calendar = edit('calendar'); calendar.config[column] = clampInt(changes[key], min, max); if (column === 'step_minutes') calendar.config.step_set = true; } };
  rule('start_every_minutes', 'step_minutes', 5, 1440);
  rule('break_between_minutes', 'buffer_minutes', 0, 240);
  rule('minimum_notice_minutes', 'min_notice_minutes', 0, 43200);
  rule('book_up_to_days_ahead', 'max_days_ahead', 1, 365);
  if (changes.last_booking_minutes_before_closing !== undefined) edit('calendar').config.last_start_minutes = changes.last_booking_minutes_before_closing === null ? -1 : clampInt(changes.last_booking_minutes_before_closing, 0, 240);
  if (changes.services !== undefined) {
    const list = (Array.isArray(changes.services) ? changes.services : []).map(service => ({ name: String(service?.name || '').trim().slice(0, 80), duration_minutes: clampInt(service?.length_minutes || 60, 5, 1440) })).filter(service => service.name).slice(0, 50);
    if (new Set(list.map(service => service.name.toLowerCase())).size !== list.length) throw fail('services_repeat', 'Each service name must be different.');
    edit('calendar').config.services = list;
  }
  if (changes.days_off !== undefined || changes.add_days_off !== undefined || changes.remove_days_off !== undefined) {
    const calendar = edit('calendar');
    const valid = list => (Array.isArray(list) ? list : []).map(String).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T12:00:00Z`)));
    let days = changes.days_off !== undefined ? valid(changes.days_off) : (calendar.config.closed_dates || []);
    days = [...new Set([...days, ...valid(changes.add_days_off)])].filter(day => !valid(changes.remove_days_off).includes(day)).sort().slice(-366);
    calendar.config.closed_dates = days;
  }
  if (changes.counted_by !== undefined || changes.at_the_same_time !== undefined || changes.team_member_names !== undefined || changes.largest_group !== undefined) {
    const calendar = edit('calendar'), config = calendar.config;
    if (changes.counted_by !== undefined) config.count_by = changes.counted_by === 'people' ? 'people' : 'bookings';
    const people = config.count_by === 'people';
    if (changes.team_member_names !== undefined) {
      const names = (Array.isArray(changes.team_member_names) ? changes.team_member_names : []).map(name => String(name || '').trim().slice(0, 60)).filter(Boolean).slice(0, 100);
      if (new Set(names.map(name => name.toLowerCase())).size !== names.length) throw fail('names_repeat', 'Each team member name must be different.');
      // Existing names keep their number, so bookings already made stay with the same person.
      const old = Array.isArray(config.places) ? config.places : [];
      let next = old.reduce((max, place) => Math.max(max, Number(place.index) || 0), -1) + 1;
      config.places = names.map(name => { const same = old.find(place => String(place.name).toLowerCase() === name.toLowerCase()); return { index: same ? same.index : next++, name }; });
      if (next > 500) throw fail('names_limit', 'Too many team members were changed. Remove some on the settings page first.');
    }
    const named = !people && (config.places || []).length;
    if (changes.at_the_same_time !== undefined && !named) config.capacity = clampInt(changes.at_the_same_time, 1, people ? 5000 : 500);
    if (named) config.capacity = config.places.length;
    config.max_group = people ? clampInt(changes.largest_group ?? config.max_group ?? 0, 0, config.capacity || 1) : 0;
  }
  if (changes.message_for_a_reel_from_another_account !== undefined) edit('handoff').config.unreadable_reel_message = String(changes.message_for_a_reel_from_another_account || '').trim().slice(0, 1000);
  // The same checks the page makes before saving.
  if (next.orders?.enabled && !next.orders.config.required_fields.length) throw fail('order_questions_required', 'Orders need at least one question to ask, for example the product and the customer name.');
  if (next.calendar?.enabled && !DAY_KEYS.some(day => (next.calendar.config.weekly_hours?.[day] || []).length)) throw fail('opening_hours_required', 'Bookings need opening hours on at least one day.');
  const list = Object.entries(next).map(([tool_type, value]) => ({ business_id: business.id, tool_type, enabled: value.enabled, config: value.config, updated_at: new Date().toISOString() }));
  if (list.length) await supabaseRequest('/rest/v1/automation_tool_configs?on_conflict=business_id,tool_type', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: list });
  return { changed: Object.keys(next).map(type => TOOL_KEYS.find(key => TOOL_NAMES[key] === type)) };
}

// ---------- Product photos ----------

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_PRODUCT_PHOTOS = 8;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

// Only public https addresses are fetched (ChatGPT hands over a temporary download link for an attached photo).
export function safePhotoUrl(value) {
  let url; try { url = new URL(String(value || '')); } catch { return ''; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /(^|\.)(localhost|internal|local)$/.test(host)) return '';
  return String(url);
}

// Downloads each photo and returns { content_type, content_base64 } or a plain reason it was skipped.
export async function downloadPhoto(file, fetchImpl = fetch) {
  const url = safePhotoUrl(file?.download_url || file?.url);
  if (!url) return { skipped: 'The photo link could not be used.' };
  let response;
  try { response = await fetchImpl(url, { signal: AbortSignal.timeout(10000), redirect: 'follow' }); } catch { return { skipped: 'The photo could not be downloaded.' }; }
  if (!response.ok) return { skipped: 'The photo could not be downloaded.' };
  const type = [String(file?.mime_type || '').toLowerCase(), String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()].find(item => PHOTO_TYPES.includes(item === 'image/jpg' ? 'image/jpeg' : item));
  if (!type) return { skipped: 'Only JPG, PNG and WebP photos can be added.' };
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) return { skipped: 'The photo was empty.' };
  if (bytes.length > MAX_PHOTO_BYTES) return { skipped: 'The photo is larger than 4 MB.' };
  return { content_type: type === 'image/jpg' ? 'image/jpeg' : type, content_base64: bytes.toString('base64') };
}

export async function saveProductPhotos(row, paths) {
  const existing = Array.isArray(row.photos) ? row.photos : [];
  const photos = [...existing, ...paths.map(path => ({ path }))].slice(0, MAX_PRODUCT_PHOTOS);
  await serviceUpdate('automation_products', `id=eq.${q(row.id)}&business_id=eq.${q(row.business_id)}`, { photos, updated_at: new Date().toISOString() });
  return photos.length;
}

// ---------- Comment automations ----------

export function automationView(row) {
  const config = row.safety_config && typeof row.safety_config === 'object' ? row.safety_config : {};
  const type = config.trigger_type || 'comment';
  return {
    automation_id: row.id,
    name: row.name,
    status: row.status === 'active' ? 'on' : row.status === 'paused' ? 'off' : row.status,
    platform: type === 'tiktok_comment' ? 'TikTok' : 'Instagram',
    trigger: type,
    reacts_to: row.match_type === 'any' ? 'any comment' : `comments ${row.match_type === 'exact' ? 'that are exactly' : 'that contain'}: ${(row.keywords || []).join(', ')}`,
    posts: row.post_scope === 'all' ? 'all posts' : row.post_scope === 'next' ? 'the next post' : `${(row.selected_post_ids || []).length} selected post${(row.selected_post_ids || []).length === 1 ? '' : 's'}`,
    ...(Array.isArray(row.public_reply_variations) && row.public_reply_variations.length ? { public_replies: row.public_reply_variations } : {}),
    ...(Array.isArray(row.dm_steps) && row.dm_steps.length ? { private_message: String(row.dm_steps.find(step => step?.type === 'message' && step.text)?.text || ''), steps: row.dm_steps.length } : {}),
    times_run: Number(row.triggered_count || 0),
    last_run_at: row.last_triggered_at || null
  };
}

const AUTOMATION_SELECT = 'id,business_id,name,status,post_scope,selected_post_ids,match_type,keywords,public_reply_variations,dm_steps,safety_config,triggered_count,last_triggered_at';
export async function listAutomations(businessId) {
  return rows(await supabaseRequest(`/rest/v1/automation_comment_workflows?business_id=eq.${q(businessId)}&status=neq.archived&select=${q(AUTOMATION_SELECT)}&order=updated_at.desc&limit=100`));
}

export async function ownedAutomation(userId, automationId) {
  const missing = () => fail('automation_not_found', 'This comment automation was not found. Call list_comment_automations to see the ids.');
  if (!isUuid(automationId)) throw missing();
  const row = await first(`/rest/v1/automation_comment_workflows?id=eq.${q(automationId)}&status=neq.archived&select=${q(AUTOMATION_SELECT)}&limit=1`);
  if (!row || !(await ownsBusiness(userId, row.business_id))) throw missing();
  return row;
}

// Changes the words and texts of an existing automation, keeping its steps, their order and the builder's layout.
// Only message texts, button labels and link addresses of existing steps can change here.
export async function updateAutomation(row, input = {}) {
  const config = row.safety_config && typeof row.safety_config === 'object' ? { ...row.safety_config } : {};
  const tiktok = config.trigger_type === 'tiktok_comment';
  const patch = {};
  if (input.name !== undefined) { const name = short(input.name, 200); if (name) patch.name = name; }
  if (input.reacts_to !== undefined || input.keywords !== undefined) {
    const any = (input.reacts_to ?? row.match_type) === 'any';
    const keywords = any ? [] : [...new Set((Array.isArray(input.keywords) ? input.keywords : row.keywords || []).map(word => short(word, 80)).filter(Boolean))].slice(0, 20);
    if (!any && !keywords.length) throw fail('keywords_required', 'Add at least one word, or make it react to any comment.');
    patch.match_type = any ? 'any' : tiktok ? 'contains' : (input.reacts_to ?? row.match_type) === 'exact' ? 'exact' : 'contains';
    patch.keywords = keywords;
  }
  if (input.public_replies !== undefined) {
    const replies = (Array.isArray(input.public_replies) ? input.public_replies : []).map(text => short(text, 300)).filter(Boolean).slice(0, 3);
    if (tiktok && !replies.length && config.reply_mode !== 'ai') throw fail('reply_required', 'A TikTok automation needs at least one public reply.');
    patch.public_reply_variations = replies;
    if (!tiktok) patch.safety_config = { ...config, public_reply_enabled: replies.length > 0 };
  }
  if (Array.isArray(input.steps) && input.steps.length) {
    const steps = (Array.isArray(row.dm_steps) ? row.dm_steps : []).map(step => ({ ...step, actions: Array.isArray(step.actions) ? step.actions.map(action => ({ ...action })) : step.actions }));
    for (const change of input.steps) {
      const step = steps.find(item => item.id === change?.step_id && item.type === 'message');
      if (!step) throw fail('step_not_found', 'That step is not a message of this automation. Read the automation again with list_comment_automations.');
      if (change.text !== undefined) { const text = short(change.text, 640); if (!text) throw fail('text_required', 'A message cannot be empty.'); step.text = text; }
      for (const buttonChange of Array.isArray(change.buttons) ? change.buttons : []) {
        const action = (step.actions || []).find(item => item.id === buttonChange?.button_id);
        if (!action) throw fail('button_not_found', 'That button is not on this step.');
        if (buttonChange.label !== undefined) { const label = short(buttonChange.label, 20); if (!label) throw fail('label_required', 'A button needs a label (20 characters at most).'); action.label = label; }
        if (buttonChange.url !== undefined) {
          const url = short(buttonChange.url, 1000);
          if (action.type !== 'website' || !/^https:\/\//i.test(url)) throw fail('button_needs_https_link', 'A link button needs an address that starts with https://.');
          action.url = url;
        }
      }
    }
    patch.dm_steps = steps;
  }
  if (!Object.keys(patch).length) return row;
  try {
    const saved = await serviceUpdate('automation_comment_workflows', `id=eq.${q(row.id)}&business_id=eq.${q(row.business_id)}`, { ...patch, updated_at: new Date().toISOString() });
    return { ...row, ...patch, ...(saved[0] || {}) };
  } catch (error) {
    if ([400, 409].includes(Number(error?.status))) throw fail('automation_not_valid', 'Hansora did not accept this change (a live automation needs its words). Check the words and try again.');
    throw error;
  }
}

export async function setAutomationOn(row, on) {
  const status = on ? 'active' : 'paused';
  try {
    await serviceUpdate('automation_comment_workflows', `id=eq.${q(row.id)}&business_id=eq.${q(row.business_id)}`, { status, ...(on ? { activated_at: new Date().toISOString() } : {}) });
  } catch (error) {
    // The database refuses to turn on an automation with no keywords or no selected posts.
    if (on && [400, 409].includes(Number(error?.status))) throw fail('automation_not_finished', 'This automation is not finished (it needs its keywords or posts). The user can finish it in the builder on hansora.co.', { builder: `${SITE}/automation-workflows.html?business=${row.business_id}` });
    throw error;
  }
  return { ...row, status };
}

// A simple automation as the builders on hansora.co save it: Instagram (optional public reply under the comment,
// then one private message, optionally with a link button) or TikTok (public reply only; TikTok has no private
// message after a comment). Multi-step flows are made in the builder.
const short = (value, max) => String(value ?? '').trim().slice(0, max);
export function automationPayload(businessId, input = {}) {
  const tiktok = input.platform === 'tiktok';
  const any = input.reacts_to === 'any';
  const keywords = any ? [] : [...new Set((Array.isArray(input.keywords) ? input.keywords : []).map(word => short(word, 80)).filter(Boolean))].slice(0, 20);
  if (!any && !keywords.length) throw fail('keywords_required', 'Ask the user which words in a comment should start this automation, or whether it should react to any comment.');
  const match = any ? 'any' : tiktok ? 'contains' : input.reacts_to === 'exact' ? 'exact' : 'contains';
  const replies = (Array.isArray(input.public_replies) ? input.public_replies : []).map(text => short(text, 300)).filter(Boolean).slice(0, 3);
  // A chosen post (the caller looked up the latest one) limits the automation to that post, like picking it in the builder.
  const post = input.post?.id ? { id: String(input.post.id), thumb: String(input.post.thumb || '').slice(0, 1500), caption: String(input.post.caption || '').slice(0, 120) } : null;
  const scope = post ? 'selected' : input.posts === 'next' ? 'next' : 'all';
  const previews = post ? { [post.id]: { thumb: post.thumb, caption: post.caption } } : {};
  const name = short(input.name, 200) || (any ? 'Reply to every comment' : `Comment: ${keywords.slice(0, 3).join(', ')}`).slice(0, 200);
  const base = { business_id: businessId, name, status: 'draft', post_scope: scope, selected_post_ids: post ? [post.id] : [], match_type: match, keywords };
  if (tiktok) {
    const ai = input.ai_writes_reply === true;
    if (!ai && !replies.length) throw fail('reply_required', 'Ask the user what to reply under the comment (TikTok allows a public reply only), or whether the AI should write each reply.');
    return { ...base, public_reply_variations: replies, dm_steps: [], safety_config: { platform: 'tiktok', trigger_type: 'tiktok_comment', reply_mode: ai ? 'ai' : 'fixed', ai_instruction: short(input.ai_instruction, 500), first_comment_only: true, ignore_own: true, exclude_keywords: [], public_reply_enabled: true, post_previews: previews } };
  }
  const message = short(input.private_message, 640);
  if (!message) throw fail('private_message_required', 'Ask the user what private message to send to the person who commented.');
  const label = short(input.button_label, 20), url = short(input.button_url, 1000);
  if ((label || url) && !(label && /^https:\/\//i.test(url))) throw fail('button_needs_https_link', 'A button needs a short label and a link that starts with https://.');
  const website = label ? [{ id: 'action-website', type: 'website', label, url }] : [];
  const config = { exclude_keywords: [], public_reply_enabled: replies.length > 0, first_comment_only: true, ignore_own: true, flow_version: 3, trigger_type: 'comment', trigger: { ref: '', question: '' }, folder: '', post_previews: previews, layout: {} };
  if (input.followers_only === true) {
    // The builder's "Follow to get the link" flow: a button, then a follower check; followers get the link, the
    // others are asked to follow and can tap again.
    if (!label) throw fail('link_required', 'A followers-only automation needs the link to send: ask for the link and a short button label.');
    const steps = [
      { id: 'message-opening', type: 'message', title: 'Opening DM', text: message, commentReply: true, entry: true, replyNextId: null, nextId: null, actions: [{ id: 'action-send', type: 'quick_reply', label: short(input.opening_button_label, 20) || 'Send me the link', nextId: 'check-follow' }] },
      { id: 'check-follow', type: 'condition', title: 'Follows you?', match: 'all', rules: [{ field: 'follows', op: 'is_true' }], passAfter: 3, yesId: 'message-link', noId: 'message-follow' },
      { id: 'message-follow', type: 'message', title: 'Ask to follow', text: short(input.not_following_message, 640) || 'This is for our followers only. Follow our account first, then tap the button below.', replyNextId: null, nextId: null, actions: [{ id: 'action-followed', type: 'quick_reply', label: short(input.following_button_label, 20) || 'I\'m following', nextId: 'check-follow' }] },
      { id: 'message-link', type: 'message', title: 'Send the link', text: short(input.link_message, 640) || 'Here is your link.', replyNextId: null, nextId: null, actions: website }
    ];
    return { ...base, public_reply_variations: replies, dm_steps: steps, safety_config: config };
  }
  const step = { id: 'message-opening', type: 'message', title: 'Opening DM', text: message, commentReply: true, entry: true, nextId: null, replyNextId: null, actions: website };
  return { ...base, public_reply_variations: replies, dm_steps: [step], safety_config: config };
}

export async function channelConnected(businessId, platform) {
  const type = platform === 'tiktok' ? 'tiktok' : 'instagram_comments';
  const fallback = platform === 'tiktok' ? '' : ',instagram_dm';
  const list = rows(await supabaseRequest(`/rest/v1/automation_channel_connections?business_id=eq.${q(businessId)}&channel_type=in.(${type}${fallback})&select=channel_type,status`));
  return list.some(item => item.status === 'connected');
}

export async function createAutomation(businessId, input) {
  const payload = automationPayload(businessId, input);
  const turnOn = input.turn_on === true && await channelConnected(businessId, input.platform);
  const row = await serviceInsert('automation_comment_workflows', turnOn ? { ...payload, status: 'active', activated_at: new Date().toISOString() } : payload);
  return { row, turned_on: turnOn, not_connected: input.turn_on === true && !turnOn };
}

export async function archiveAutomation(row) {
  await serviceUpdate('automation_comment_workflows', `id=eq.${q(row.id)}&business_id=eq.${q(row.business_id)}`, { status: 'archived' });
}

// ---------- Automatic phone calls ----------

// Voice, greeting, transfer to a person and transcripts, as the Phone page saves them in the phone channel's settings.
export function phoneSettingsView(settings = {}) {
  return {
    voice: phoneVoice(settings.voice) || PHONE_VOICE,
    greeting: String(settings.greeting || ''),
    transfer_to_a_person: { on: settings.transfer_on !== false && Boolean(settings.transfer_number), number: String(settings.transfer_number || ''), mode: settings.transfer_mode === 'direct' ? 'direct' : 'warm' },
    save_transcripts: settings.save_transcripts !== false
  };
}
export const VOICE_NAMES = PHONE_VOICES.map(voice => voice.name);
export const voiceList = () => PHONE_VOICES.map(voice => `${voice.name} (${voice.gender}, ${voice.style.toLowerCase()})`).join(', ');

export async function setPhoneSettings(businessId, input = {}) {
  const channel = await phoneChannel(businessId);
  if (!channel) throw fail('phone_not_set_up', 'This AI employee has no phone channel yet. The user can set it up on the Phone page.', { phone: links(businessId).phone });
  const settings = channel.settings && typeof channel.settings === 'object' ? { ...channel.settings } : {};
  if (input.voice !== undefined) { const voice = phoneVoice(input.voice); if (!voice) throw fail('voice_unknown', `Choose one of these voices: ${voiceList()}.`); settings.voice = voice; }
  if (input.greeting !== undefined) settings.greeting = String(input.greeting || '').trim().slice(0, 300);
  if (input.transfer_number !== undefined) {
    const number = String(input.transfer_number || '').replace(/[^\d+]/g, '');
    if (number && !/^\+[1-9]\d{7,14}$/.test(number)) throw fail('invalid_number', 'Give the transfer number in international format, for example +15550102030.');
    settings.transfer_number = number;
    if (!number) settings.transfer_on = false;
  }
  if (typeof input.transfer_on === 'boolean') {
    if (input.transfer_on && !settings.transfer_number) throw fail('transfer_number_required', 'Ask the user which phone number calls should be transferred to.');
    settings.transfer_on = input.transfer_on;
  }
  if (input.transfer_mode !== undefined) settings.transfer_mode = input.transfer_mode === 'direct' ? 'direct' : 'warm';
  if (typeof input.save_transcripts === 'boolean') settings.save_transcripts = input.save_transcripts;
  await serviceUpdate('automation_channel_connections', `id=eq.${q(channel.id)}`, { settings });
  return phoneSettingsView(settings);
}

// ---------- Alerts to the owner ----------

export const ALERT_EVENTS = { order_created: 'new order', booking_created: 'new booking', booking_cancelled: 'booking cancelled', handoff_requested: 'customer needs a person', lead_created: 'new lead' };
export function alertsView(row) {
  const events = Array.isArray(row?.events) ? row.events : ['order_created', 'booking_created', 'handoff_requested'];
  return {
    email: { on: row ? row.email_enabled !== false : true, address: row?.email || '' },
    whatsapp: { on: Boolean(row?.whatsapp_enabled), number: row?.whatsapp_phone || '', verified: Boolean(row?.whatsapp_verified_at) },
    alert_me_about: events.filter(event => NOTIFICATION_EVENTS.includes(event)),
    language: row?.language || 'en'
  };
}
export async function getAlerts(businessId) {
  return alertsView(await first(`/rest/v1/automation_notification_settings?business_id=eq.${q(businessId)}&select=*&limit=1`).catch(() => null));
}

async function phoneChannel(businessId) {
  return first(`/rest/v1/automation_channel_connections?business_id=eq.${q(businessId)}&channel_type=eq.phone&select=id,status,settings&limit=1`);
}

export function automaticCallsView(settings) {
  const value = autoCallSettings(settings?.auto_calls);
  return {
    calling_hours: { from: value.from, to: value.to },
    confirm_new_orders: { on: value.order.on, minutes_after_the_order: value.order.delay_minutes, what_to_say: value.order.purpose },
    remind_before_bookings: { on: value.reminder.on, hours_before: value.reminder.hours_before, what_to_say: value.reminder.purpose }
  };
}

export async function getAutomaticCalls(businessId) {
  const channel = await phoneChannel(businessId);
  return { ...automaticCallsView(channel?.settings), links: { phone: links(businessId).phone } };
}

export async function getPhoneSettings(businessId) {
  return phoneSettingsView((await phoneChannel(businessId))?.settings || {});
}

export async function setAutomaticCalls(businessId, input = {}) {
  const channel = await phoneChannel(businessId);
  if (!channel) throw fail('phone_not_set_up', 'This AI employee has no phone channel yet. The user can set it up on the Phone page.', { phone: links(businessId).phone });
  const settings = channel.settings && typeof channel.settings === 'object' ? channel.settings : {};
  const now = autoCallSettings(settings.auto_calls);
  const next = autoCallSettings({
    from: input.calling_hours_from ?? now.from,
    to: input.calling_hours_to ?? now.to,
    order: { on: input.confirm_new_orders ?? now.order.on, delay_minutes: input.minutes_after_the_order ?? now.order.delay_minutes, purpose: input.order_call_says ?? now.order.purpose },
    reminder: { on: input.remind_before_bookings ?? now.reminder.on, hours_before: input.hours_before_the_booking ?? now.reminder.hours_before, purpose: input.reminder_call_says ?? now.reminder.purpose }
  });
  await serviceUpdate('automation_channel_connections', `id=eq.${q(channel.id)}`, { settings: { ...settings, auto_calls: next } });
  return automaticCallsView({ auto_calls: next });
}
