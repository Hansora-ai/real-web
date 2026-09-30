// Booking availability for the built-in Hansora calendar. Pure functions: callers pass busy intervals
// (existing bookings, Google Calendar busy blocks) and the current time, so results are deterministic.

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export const DEFAULT_CALENDAR_CONFIG = Object.freeze({
  timezone: 'UTC',
  weekly_hours: { mon: [{ start: '10:00', end: '19:00' }], tue: [{ start: '10:00', end: '19:00' }], wed: [{ start: '10:00', end: '19:00' }], thu: [{ start: '10:00', end: '19:00' }], fri: [{ start: '10:00', end: '19:00' }], sat: [{ start: '11:00', end: '17:00' }], sun: [] },
  duration_minutes: 60,
  step_minutes: 30, // when a config has no step of its own, start times follow the appointment length
  last_start_minutes: -1, // -1: a booking must end by closing time; N: the last booking may start N minutes before closing
  buffer_minutes: 0,
  min_notice_minutes: 0, // booking rules are optional: without them there is no minimum notice
  max_days_ahead: 365,
  services: [],
  closed_dates: [],
  auto_confirm: false,
  capacity: 1, // bookings (or people) allowed at the same time
  count_by: 'bookings', // 'people': capacity counts people/seats and each booking has a group size
  max_group: 0, // largest group for one booking in people mode (0 = up to the capacity)
  places: [] // optional named places [{ name, index }]: tables, staff members, doctors…
});

// Named places keep a stable index (the booking's slot_index), so renaming or removing one never moves others.
export function normalizePlaces(list) {
  const used = new Set();
  return (Array.isArray(list) ? list : []).map(item => ({ name: String(item?.name || '').trim().slice(0, 60), index: Math.round(Number(item?.index)) }))
    .filter(item => item.name && Number.isInteger(item.index) && item.index >= 0 && item.index <= 499 && !used.has(item.index) && used.add(item.index)).slice(0, 100);
}

// How long before closing the last booking may start: its full length (it must end by closing), or the owner's
// "last booking" rule (for example 30 minutes before closing, even if the booking runs past closing).
const lastStartGap = (config, duration) => config.last_start_minutes < 0 ? duration : Math.max(1, config.last_start_minutes) * MINUTE;
const clamp = (value, min, max, fallback) => { const number = Math.round(Number(value)); return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback; };
const timeToMinutes = value => { const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || '')); return match ? Number(match[1]) * 60 + Number(match[2]) : null; };

export function validTimezone(timezone) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: String(timezone) }); return true; } catch (_) { return false; }
}

export function normalizeCalendarConfig(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const weekly = {};
  for (const day of WEEKDAYS) {
    const ranges = Array.isArray(source.weekly_hours?.[day]) ? source.weekly_hours[day] : source.weekly_hours ? [] : DEFAULT_CALENDAR_CONFIG.weekly_hours[day];
    weekly[day] = ranges.map(range => ({ start: String(range?.start || ''), end: String(range?.end || '') }))
      .filter(range => { const start = timeToMinutes(range.start), end = timeToMinutes(range.end === '24:00' ? '23:59' : range.end); return start !== null && end !== null && end > start; })
      .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start)).slice(0, 6);
  }
  const services = (Array.isArray(source.services) ? source.services : [])
    .map(service => ({ name: String(service?.name || '').trim().slice(0, 120), duration_minutes: clamp(service?.duration_minutes, 5, 720, 60) }))
    .filter(service => service.name).slice(0, 50);
  return {
    timezone: validTimezone(source.timezone) ? String(source.timezone) : DEFAULT_CALENDAR_CONFIG.timezone,
    weekly_hours: weekly,
    duration_minutes: clamp(source.duration_minutes, 5, 720, DEFAULT_CALENDAR_CONFIG.duration_minutes),
    step_minutes: source.step_minutes == null || source.step_minutes === '' ? clamp(source.duration_minutes, 5, 240, DEFAULT_CALENDAR_CONFIG.duration_minutes) : clamp(source.step_minutes, 5, 240, DEFAULT_CALENDAR_CONFIG.step_minutes),
    last_start_minutes: clamp(source.last_start_minutes, -1, 240, -1),
    buffer_minutes: clamp(source.buffer_minutes, 0, 240, DEFAULT_CALENDAR_CONFIG.buffer_minutes),
    min_notice_minutes: clamp(source.min_notice_minutes, 0, 60 * 24 * 14, DEFAULT_CALENDAR_CONFIG.min_notice_minutes),
    max_days_ahead: clamp(source.max_days_ahead, 1, 365, DEFAULT_CALENDAR_CONFIG.max_days_ahead),
    services,
    closed_dates: (Array.isArray(source.closed_dates) ? source.closed_dates : []).map(String).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).slice(0, 366),
    auto_confirm: Boolean(source.auto_confirm),
    ...(() => {
      const countBy = source.count_by === 'people' ? 'people' : 'bookings';
      const places = countBy === 'bookings' ? normalizePlaces(source.places) : [];
      const capacity = places.length || clamp(source.capacity, 1, countBy === 'people' ? 5000 : 500, 1);
      return { count_by: countBy, capacity, max_group: countBy === 'people' ? clamp(source.max_group, 0, capacity, 0) : 0, places };
    })()
  };
}

// Offset (ms) of `timezone` from UTC at instant `timestamp`.
function timezoneOffset(timestamp, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(timestamp)).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(timestamp / 1000) * 1000;
}

export function zonedDateTimeToUtc(date, minutes, timezone) {
  const [year, month, day] = date.split('-').map(Number);
  const wall = Date.UTC(year, month - 1, day, 0, minutes);
  let utc = wall - timezoneOffset(wall, timezone);
  utc = wall - timezoneOffset(utc, timezone);
  return utc;
}

export function localDate(timestamp, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
}

function weekdayKey(date) {
  const [year, month, day] = date.split('-').map(Number);
  return WEEKDAYS[(new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7];
}

function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function formatSlot(timestamp, timezone, locale = 'en-GB') {
  return new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp));
}

export function serviceDuration(config, serviceName) {
  const wanted = String(serviceName || '').trim().toLowerCase();
  const service = wanted ? config.services.find(item => item.name.toLowerCase() === wanted) : null;
  return { service: service?.name || '', duration: service?.duration_minutes || config.duration_minutes };
}

// How one time looks for a new booking. The break between bookings ("buffer") belongs to each place: a table
// needs its break after its own guests, but it never blocks the other tables. Used by the AI and the day view,
// so both always show the same answer.
function placeState(config, items, start, end) {
  const buffer = config.buffer_minutes * MINUTE;
  const overlaps = (item, gap = 0) => start - gap < item.end && end + gap > item.start;
  const direct = items.filter(item => overlaps(item));
  const closed = direct.some(item => item.blocksAll);
  if (config.count_by === 'people') {
    const used = items.filter(item => !item.blocksAll && overlaps(item, buffer)).reduce((sum, item) => sum + item.people, 0);
    return { closed, booked: Math.min(config.capacity, direct.filter(item => !item.blocksAll).reduce((sum, item) => sum + item.people, 0)), used, free: closed ? 0 : Math.max(0, config.capacity - used), freePlaces: [], breakBlocked: 0 };
  }
  const places = config.places.length ? config.places.map(item => item.index) : Array.from({ length: config.capacity }, (_, index) => index);
  const known = new Set(places);
  const bookings = items.filter(item => !item.blocksAll);
  const takenDirect = place => bookings.some(item => item.place === place && overlaps(item));
  const takenWithBreak = place => bookings.some(item => item.place === place && overlaps(item, buffer));
  // Older bookings saved before place numbers existed all share place 0: every extra one still takes a place.
  const extra = places.reduce((sum, place) => sum + Math.max(0, bookings.filter(item => item.place === place && overlaps(item)).length - 1), 0)
    + bookings.filter(item => !known.has(item.place) && overlaps(item)).length;
  const freePlaces = closed ? [] : places.filter(place => !takenWithBreak(place));
  const free = Math.max(0, freePlaces.length - extra);
  return { closed, booked: Math.min(config.capacity, bookings.filter(item => overlaps(item)).length), free, freePlaces, breakBlocked: closed ? 0 : places.filter(place => !takenDirect(place) && takenWithBreak(place)).length };
}

const busyItems = busy => busy.map(item => ({ start: Number(item.start), end: Number(item.end), blocksAll: Boolean(item.blocksAll), people: Math.max(1, Number(item.people) || 1), place: Number.isInteger(item.place) ? item.place : 0 })).filter(item => item.end > item.start);

// Places (their numbers) that can take a new booking at exactly this time, break included; free ones first.
export function freePlaceIndexes({ config: rawConfig, busy = [], start, end }) {
  const config = normalizeCalendarConfig(rawConfig);
  return placeState(config, busyItems(busy), Number(start), Number(end)).freePlaces;
}

// Returns free slots between `from` and `to` (ms). `busy` is [{start, end, place?, people?, blocksAll?}] in ms and
// must already include every active booking and external busy block.
export function computeSlots({ config: rawConfig, busy = [], from, to, now = Date.now(), durationMinutes, limit = 200, people = 1, place = null, count = 1 }) {
  const config = normalizeCalendarConfig(rawConfig);
  const duration = (durationMinutes || config.duration_minutes) * MINUTE;
  const earliest = Math.max(Number(from) || now, now + config.min_notice_minutes * MINUTE);
  const latest = Math.min(Number(to) || now + config.max_days_ahead * DAY, now + config.max_days_ahead * DAY);
  if (!(latest > earliest)) return [];
  const items = busyItems(busy);
  const group = Math.max(1, Math.round(Number(people)) || 1);
  const full = state => {
    if (state.closed) return true;
    if (Number.isInteger(place) && config.count_by !== 'people') return !state.freePlaces.includes(place);
    return config.count_by === 'people' ? state.used + group > config.capacity : state.free < Math.max(1, Math.round(Number(count)) || 1);
  };
  const slots = [];
  const lastDate = localDate(latest, config.timezone);
  for (let date = localDate(earliest, config.timezone), guard = 0; date <= lastDate && guard < 400; date = addDays(date, 1), guard++) {
    if (config.closed_dates.includes(date)) continue;
    for (const range of config.weekly_hours[weekdayKey(date)]) {
      const rangeStart = zonedDateTimeToUtc(date, timeToMinutes(range.start), config.timezone);
      const rangeEnd = zonedDateTimeToUtc(date, range.end === '24:00' ? 1440 : timeToMinutes(range.end), config.timezone);
      for (let start = rangeStart; start + lastStartGap(config, duration) <= rangeEnd; start += config.step_minutes * MINUTE) {
        if (start < earliest || start + duration > latest) continue;
        const end = start + duration;
        const state = placeState(config, items, start, end);
        if (full(state)) continue;
        // free: places (or people) still free at this time; freePlaces: their numbers (names for named places).
        slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), label: formatSlot(start, config.timezone), free: state.free, freePlaces: state.freePlaces });
        if (slots.length >= limit) return slots;
      }
    }
  }
  return slots;
}

// Every start time of one business day with how many places are taken and how many can still be booked, for the
// owner's day view. "free" is exactly what the AI can offer (breaks between bookings included).
export function daySlots({ config: rawConfig, date, busy = [], durationMinutes }) {
  const config = normalizeCalendarConfig(rawConfig);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || config.closed_dates.includes(date)) return [];
  const duration = (durationMinutes || config.duration_minutes) * MINUTE;
  const items = busyItems(busy);
  const slots = [];
  for (const range of config.weekly_hours[weekdayKey(date)]) {
    const rangeStart = zonedDateTimeToUtc(date, timeToMinutes(range.start), config.timezone);
    const rangeEnd = zonedDateTimeToUtc(date, range.end === '24:00' ? 1440 : timeToMinutes(range.end), config.timezone);
    for (let start = rangeStart; start + lastStartGap(config, duration) <= rangeEnd; start += config.step_minutes * MINUTE) {
      const end = start + duration;
      const state = placeState(config, items, start, end);
      slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), time: new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(start)), booked: state.closed ? config.capacity : state.booked, free: state.free, break_blocked: state.breakBlocked, free_places: state.freePlaces, capacity: config.capacity, count_by: config.count_by, blocked: state.closed });
    }
  }
  return slots;
}

// A short, spread-out choice for the AI: a few slots per day across the first days that have openings.
export function summarizeSlots(slots, { perDay = 4, days = 4 } = {}, timezone = DEFAULT_CALENDAR_CONFIG.timezone) {
  const byDay = new Map();
  for (const slot of slots) {
    const day = localDate(Date.parse(slot.start), timezone);
    if (!byDay.has(day)) { if (byDay.size >= days) break; byDay.set(day, []); }
    byDay.get(day).push(slot);
  }
  const output = [];
  for (const daySlots of byDay.values()) {
    if (daySlots.length <= perDay) { output.push(...daySlots); continue; }
    const step = (daySlots.length - 1) / (perDay - 1);
    for (let index = 0; index < perDay; index++) output.push(daySlots[Math.round(index * step)]);
  }
  return output;
}
