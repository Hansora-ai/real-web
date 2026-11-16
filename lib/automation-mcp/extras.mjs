// More of the Hansora Automation MCP server: pausing the AI per channel, the day's schedule and bookings added by the
// team, usage per day, the sales funnel and the website chat bubble. Same privacy rule as data.mjs: counts and the
// owner's own settings only; customer details only for records from Hansora's own channels.
import { first, rows, serviceInsert, serviceUpdate, supabaseRequest } from '../automation/db.mjs';
import { toDisplay } from '../automation/billing.mjs';
import { DAY_KEYS, recordView, toolDefaults } from './business.mjs';
import { channelName, fail } from './data.mjs';

const q = encodeURIComponent;

// ---------- Pause or resume the AI per channel ----------

export const REPLY_CHANNELS = ['instagram_dm', 'instagram_comments', 'whatsapp', 'telegram', 'tiktok', 'messenger', 'website'];

export async function channelReplies(businessId) {
  const list = rows(await supabaseRequest(`/rest/v1/automation_channel_connections?business_id=eq.${q(businessId)}&channel_type=in.(${REPLY_CHANNELS.join(',')})&select=channel_type,status,settings,setup_order&order=setup_order.asc`));
  return list.map(row => ({ channel: row.channel_type, name: channelName(row.channel_type), connected: row.status === 'connected', ai_answers: row.settings?.automatic_replies !== false }));
}

export async function setChannelReplies(businessId, channel, on) {
  if (!REPLY_CHANNELS.includes(channel)) throw fail('channel_unknown', `Choose one of: ${REPLY_CHANNELS.map(channelName).join(', ')}.`);
  const row = await first(`/rest/v1/automation_channel_connections?business_id=eq.${q(businessId)}&channel_type=eq.${q(channel)}&select=id,settings&limit=1`);
  if (!row) throw fail('channel_unknown', 'This channel is not set up for this AI employee.');
  const settings = row.settings && typeof row.settings === 'object' ? row.settings : {};
  await serviceUpdate('automation_channel_connections', `id=eq.${q(row.id)}`, { settings: { ...settings, automatic_replies: Boolean(on) } });
  return channelReplies(businessId);
}

// ---------- The day's schedule ----------

// The UTC instant of a wall-clock time in a time zone (good to the minute; handles summer time).
export function zonedInstant(date, time, timezone) {
  const guess = new Date(`${date}T${time}:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess).map(part => [part.type, part.value]));
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
  return new Date(guess.getTime() - (shown - guess.getTime()));
}
export function localDate(timezone, at = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
const localTime = (timezone, value) => new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));

async function calendarConfig(business) {
  const row = await first(`/rest/v1/automation_tool_configs?business_id=eq.${q(business.id)}&tool_type=eq.calendar&select=enabled,config&limit=1`);
  return { enabled: row?.enabled === true, config: { ...toolDefaults(business.timezone || 'UTC').calendar, ...(row?.config || {}) } };
}

const SCHEDULE_SELECT = 'id,business_id,outcome_type,title,status,reference_number,estimated_value_minor,currency,scheduled_start,scheduled_end,service_name,party_size,assignee,private_note,summary,customer_name,customer_phone,collected_fields,created_by,created_at,conversation_id,slot_index,automation_conversations(channel_type)';

export async function schedule(business, date) {
  const { enabled, config } = await calendarConfig(business);
  const timezone = config.timezone || business.timezone || 'UTC';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : localDate(timezone);
  const start = zonedInstant(day, '00:00', timezone), end = new Date(start.getTime() + 24 * 3600 * 1000);
  const list = rows(await supabaseRequest(`/rest/v1/automation_outcomes?business_id=eq.${q(business.id)}&outcome_type=eq.booking&scheduled_start=gte.${q(start.toISOString())}&scheduled_start=lt.${q(end.toISOString())}&status=neq.cancelled&select=${q(SCHEDULE_SELECT)}&order=scheduled_start.asc&limit=200`));
  const weekday = DAY_KEYS[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7];
  const places = (config.places || []).filter(place => place?.name);
  const placeName = index => places.find(place => Number(place.index) === Number(index))?.name || '';
  return {
    date: day, weekday, timezone, bookings_on: enabled,
    closed: (config.closed_dates || []).includes(day),
    opening_hours: config.weekly_hours?.[weekday] || [],
    at_the_same_time: places.length || Number(config.capacity) || 1,
    bookings: list.map(row => ({ ...recordView(row), from: localTime(timezone, row.scheduled_start), to: localTime(timezone, row.scheduled_end), ...(placeName(row.slot_index) ? { with: placeName(row.slot_index) } : {}), blocked: row.created_by === 'human' && row.customer_name === 'Reserved' }))
  };
}

// A booking added by the team, or a blocked time ("Reserved"), saved like the day view on the site. The first free
// place is used; the database refuses two bookings in one place at the same time.
export async function addTeamBooking(business, input = {}) {
  const { config } = await calendarConfig(business);
  const timezone = config.timezone || business.timezone || 'UTC';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.date || '')) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(input.time || ''))) throw fail('time_invalid', 'Give the date as YYYY-MM-DD and the time as HH:MM (24-hour).');
  const minutes = Math.min(1440, Math.max(5, Math.round(Number(input.length_minutes) || Number(config.duration_minutes) || 60)));
  const startAt = zonedInstant(input.date, input.time, timezone), endAt = new Date(startAt.getTime() + minutes * 60000);
  const blocked = input.block === true;
  const places = (config.places || []).filter(place => place?.name);
  let slots = places.length ? places.map(place => Number(place.index)) : Array.from({ length: Math.max(1, Number(config.capacity) || 1) }, (_, index) => index);
  if (input.with) { const wanted = places.find(place => place.name.toLowerCase() === String(input.with).trim().toLowerCase()); if (!wanted) throw fail('team_member_unknown', `Choose one of: ${places.map(place => place.name).join(', ') || 'no names are set'}.`); slots = [Number(wanted.index)]; }
  const name = blocked ? 'Reserved' : String(input.customer_name || '').trim().slice(0, 200);
  if (!name) throw fail('customer_name_required', 'Ask for the customer\'s name, or block the time instead.');
  const base = {
    business_id: business.id, outcome_type: 'booking', created_by: 'human', status: 'confirmed',
    title: blocked ? `Reserved by your team · ${input.time}` : String(input.title || input.service || `Booking for ${name}`).slice(0, 300),
    customer_name: name, customer_phone: blocked ? '' : String(input.customer_phone || '').trim().slice(0, 60),
    service_name: String(input.service || '').slice(0, 200), scheduled_start: startAt.toISOString(), scheduled_end: endAt.toISOString(),
    summary: blocked ? `Reserved from ChatGPT for ${input.time}.` : String(input.note || 'Added from ChatGPT.').slice(0, 8000),
    collected_fields: blocked ? { Reserved: 'By your team', Time: input.time } : { 'Customer name': name, ...(input.customer_phone ? { 'Phone number': String(input.customer_phone) } : {}), Time: input.time }
  };
  for (const slot of slots) {
    try { return await serviceInsert('automation_outcomes', { ...base, slot_index: slot }); }
    catch (error) { if (Number(error?.status) !== 409) throw error; }
  }
  throw fail('time_already_booked', 'That time is already fully booked. Pick another time.');
}

// ---------- Usage per day ----------

export async function usageByDay(businessIds, days = 30, now = Date.now()) {
  if (!businessIds.length) return { days: [], total: 0 };
  const since = new Date(now - (days - 1) * 86400000); since.setUTCHours(0, 0, 0, 0);
  const list = rows(await supabaseRequest(`/rest/v1/automation_usage_events?business_id=in.(${businessIds.map(q).join(',')})&occurred_at=gte.${q(since.toISOString())}&select=occurred_at,unit_type,credits,billable_quantity&limit=20000`));
  const byDay = new Map(Array.from({ length: days }, (_, index) => [new Date(since.getTime() + index * 86400000).toISOString().slice(0, 10), { credits: 0, replies: 0, phone_minutes: 0 }]));
  for (const event of list) {
    const day = byDay.get(String(event.occurred_at).slice(0, 10)); if (!day) continue;
    day.credits += Number(event.credits || 0);
    if (event.unit_type === 'ai_message') day.replies += Number(event.billable_quantity || 0);
    if (/voice|phone|call/.test(String(event.unit_type))) day.phone_minutes += Number(event.billable_quantity || 0) / 60;
  }
  const out = [...byDay.entries()].map(([date, value]) => ({ date, credits: toDisplay(value.credits), ai_replies: Math.round(value.replies), phone_minutes: Math.round(value.phone_minutes * 10) / 10 }));
  return { days: out, total: Math.round(out.reduce((sum, day) => sum + day.credits, 0) * 100) / 100 };
}

// ---------- Sales funnel (counts only) ----------

export const SALES_STAGES = ['new', 'interested', 'ready', 'done', 'lost'];
export async function salesFunnel(businessIds, days = 30, now = Date.now()) {
  if (!businessIds.length) return { stages: [] };
  const since = new Date(now - days * 86400000).toISOString();
  const list = rows(await supabaseRequest(`/rest/v1/automation_conversations?business_id=in.(${businessIds.map(q).join(',')})&channel_type=neq.test&last_message_at=gte.${q(since)}&select=sales_stage,sales_value,sales_currency&limit=5000`));
  const stages = SALES_STAGES.map(stage => {
    const inStage = list.filter(row => (row.sales_stage || 'new') === stage);
    const values = inStage.reduce((all, row) => { if (Number(row.sales_value) > 0 && row.sales_currency) all[row.sales_currency] = (all[row.sales_currency] || 0) + Number(row.sales_value); return all; }, {});
    return { stage, chats: inStage.length, value: Object.entries(values).map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })) };
  });
  return { days, total: list.length, stages };
}
