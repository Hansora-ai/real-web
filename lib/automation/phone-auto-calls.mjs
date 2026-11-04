// Phone → Outgoing calls → Automatic calls. Stored in the phone channel's settings as auto_calls.
const clamp = (value, min, max, fallback) => { const number = Math.round(Number(value)); return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback; };
const words = (value, fallback) => String(value || '').trim().slice(0, 300) || fallback;

export const AUTO_CALL_DEFAULTS = {
  callback: 'Call back the customer who asked to talk to a person, and help them with their request.',
  order: 'Confirm the customer’s order and answer their questions.',
  reminder: 'Remind the customer about their booking and ask them to confirm they are coming.'
};

export function autoCallSettings(value = {}) {
  return {
    hours_only: value?.hours_only !== false,
    callback: { on: value?.callback?.on === true, delay_minutes: clamp(value?.callback?.delay_minutes, 1, 1440, 5), purpose: words(value?.callback?.purpose, AUTO_CALL_DEFAULTS.callback) },
    order: { on: value?.order?.on === true, delay_minutes: clamp(value?.order?.delay_minutes, 1, 1440, 10), purpose: words(value?.order?.purpose, AUTO_CALL_DEFAULTS.order) },
    reminder: { on: value?.reminder?.on === true, hours_before: clamp(value?.reminder?.hours_before, 1, 72, 24), purpose: words(value?.reminder?.purpose, AUTO_CALL_DEFAULTS.reminder) }
  };
}
