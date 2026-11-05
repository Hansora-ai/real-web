// Phone → Call automations. Stored in the phone channel's settings as auto_calls.
// (Transfer to a person is stored as transfer_number / transfer_on / transfer_mode and used by the phone worker.)
const clamp = (value, min, max, fallback) => { const number = Math.round(Number(value)); return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback; };
const words = (value, fallback) => String(value || '').trim().slice(0, 300) || fallback;
const clock = (value, fallback) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '')) ? String(value) : fallback;

export const AUTO_CALL_DEFAULTS = {
  order: 'Confirm the customer’s order and answer their questions.',
  reminder: 'Remind the customer about their booking and ask them to confirm they are coming.'
};

export function autoCallSettings(value = {}) {
  return {
    from: clock(value?.from, '09:00'),
    to: clock(value?.to, '20:00'),
    order: { on: value?.order?.on === true, delay_minutes: clamp(value?.order?.delay_minutes, 1, 1440, 10), purpose: words(value?.order?.purpose, AUTO_CALL_DEFAULTS.order) },
    reminder: { on: value?.reminder?.on === true, hours_before: clamp(value?.reminder?.hours_before, 1, 72, 24), purpose: words(value?.reminder?.purpose, AUTO_CALL_DEFAULTS.reminder) }
  };
}

// Is the business's local time (HH:MM) inside from–to? (A window like 22:00–06:00 crosses midnight.)
export function insideHours(now, from, to) {
  return from <= to ? now >= from && now < to : now >= from || now < to;
}
