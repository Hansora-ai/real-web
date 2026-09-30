// Owner's day view of bookings: every start time of one day with how many places are taken and by whom.
// Uses the same calendar settings and slot calculation as the AI, so the view matches what customers are offered.
import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { first, rows, supabaseRequest } from '../../lib/automation/db.mjs';
import { daySlots, normalizeCalendarConfig, zonedDateTimeToUtc } from '../../lib/automation/availability.mjs';
import { deliverySlotsConfig, deliveryWindowConfig } from '../../lib/automation/tools.mjs';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
const DAY = 24 * 60 * 60 * 1000;

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  try {
    const user = await authenticateRequest(event);
    if (!user) return json(401, { error: 'authentication_required' });
    let body; try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'invalid_json' }); }
    if (!isUuid(body.business_id) || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.date || ''))) return json(400, { error: 'invalid_request' });
    const business = await first(`/rest/v1/automation_businesses?id=eq.${body.business_id}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id,timezone&limit=1`);
    if (!business) return json(404, { error: 'business_not_found' });
    const configs = rows(await supabaseRequest(`/rest/v1/automation_tool_configs?business_id=eq.${business.id}&tool_type=in.(calendar,orders)&select=tool_type,enabled,config`));
    const calendar = configs.find(row => row.tool_type === 'calendar'), orders = configs.find(row => row.tool_type === 'orders');
    const bookingConfig = normalizeCalendarConfig({ timezone: business.timezone, ...(calendar?.config || {}) });
    const delivery = deliverySlotsConfig(orders?.config || {});
    // Two views: bookings (tables, staff…) or delivery windows (N deliveries per window, same working hours).
    const kinds = { booking: Boolean(calendar?.enabled), delivery: Boolean(orders?.enabled && delivery.enabled) };
    const kind = body.kind === 'delivery' || (body.kind !== 'booking' && !kinds.booking && kinds.delivery) ? 'delivery' : 'booking';
    const config = kind === 'delivery' ? normalizeCalendarConfig(deliveryWindowConfig(bookingConfig, delivery)) : bookingConfig;
    const from = zonedDateTimeToUtc(body.date, 0, config.timezone);
    const bookings = rows(await supabaseRequest(`/rest/v1/automation_outcomes?business_id=eq.${business.id}&outcome_type=eq.${kind === 'delivery' ? 'order' : 'booking'}&scheduled_start=not.is.null&status=in.(new,in_progress,waiting,confirmed)&scheduled_start=lt.${encodeURIComponent(new Date(from + DAY).toISOString())}&scheduled_end=gt.${encodeURIComponent(new Date(from).toISOString())}&select=*&order=scheduled_start.asc`)); // * also works before the place/people columns exist
    const busy = bookings.map(row => ({ start: Date.parse(row.scheduled_start), end: Date.parse(row.scheduled_end), people: Number(row.party_size) || Number(row.collected_fields?.People) || 1, row }));
    const placeName = row => config.places.find(item => item.index === (Number.isInteger(row.slot_index) ? row.slot_index : 0))?.name || '';
    const slots = daySlots({ config, date: body.date, busy }).map(slot => {
      const start = Date.parse(slot.start), end = Date.parse(slot.end);
      const inSlot = busy.filter(item => start < item.end && end > item.start).map(({ row, people }) => ({ id: row.id, reference: row.reference_number, customer: row.customer_name || 'Customer', service: row.service_name || '', status: row.status, start: row.scheduled_start, end: row.scheduled_end, people, place: kind === 'booking' ? placeName(row) : '', slot_index: Number.isInteger(row.slot_index) ? row.slot_index : 0, by_team: row.created_by === 'human' }));
      // Named places: each one shows who has it at this time, or that it is free.
      const places = config.places.map(item => ({ index: item.index, name: item.name, booking: inSlot.find(booking => booking.place === item.name) || null }));
      return { ...slot, bookings: inSlot, ...(places.length ? { places } : {}) };
    });
    return json(200, { kind, kinds, enabled: kinds[kind], date: body.date, timezone: config.timezone, capacity: config.capacity, count_by: config.count_by, place_label: kind === 'delivery' ? 'Delivery' : String(calendar?.config?.place_label || 'Place'), duration_minutes: config.duration_minutes, slots });
  } catch (error) {
    console.error('automation-day-view error', { message: error?.message });
    return json(500, { error: 'day_view_unavailable' });
  }
}
