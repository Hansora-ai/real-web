import { rows, supabaseRequest } from '../../lib/automation/db.mjs';
import { startOutgoingCall } from '../../lib/automation/phone-dial.mjs';
import { autoCallSettings } from '../../lib/automation/phone-auto-calls.mjs';
import { isInternalCall, isScheduledRun } from '../../lib/automation/schedule.mjs';

// Automatic AI calls, every 5 minutes: for each business that turned them on (Phone → Outgoing calls),
// call back callback requests, confirm new orders, and remind customers before bookings.
// Each trigger is called at most once (its key is saved on the call record).
// Scheduled every 5 minutes in netlify.toml.
const MAX_CALLS_PER_BUSINESS_PER_RUN = 2;

function localHour(timezone, at = new Date()) {
  try { return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: timezone || 'UTC' }).format(at)); } catch (_) { return at.getUTCHours(); }
}
function localTime(timezone, value) {
  try { return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: timezone || 'UTC' }).format(new Date(value)); } catch (_) { return String(value); }
}
const iso = ms => new Date(ms).toISOString();
const q = value => encodeURIComponent(value);

async function alreadyCalled(businessId, key) {
  return rows(await supabaseRequest(`/rest/v1/automation_calls?business_id=eq.${q(businessId)}&outcome->>trigger_key=eq.${q(key)}&select=id&limit=1`)).length > 0;
}

// The candidates for one rule: [{ key, phone, name, purpose }]
async function candidates(rule, settings, business) {
  const now = Date.now();
  const contactPhone = outcome => outcome.customer_phone || outcome.automation_contacts?.primary_phone || '';
  const select = 'id,title,summary,customer_name,customer_phone,service_name,scheduled_start,collected_fields,automation_contacts(display_name,primary_phone)';
  if (rule === 'callback' || rule === 'order') {
    const delay = settings[rule].delay_minutes * 60 * 1000;
    const kind = rule === 'callback' ? 'outcome_type=eq.lead&title=eq.Callback%20request' : 'outcome_type=in.(order,lead)&title=neq.Callback%20request';
    const found = rows(await supabaseRequest(`/rest/v1/automation_outcomes?business_id=eq.${q(business.id)}&${kind}&status=eq.new&created_at=lte.${q(iso(now - delay))}&created_at=gte.${q(iso(now - 24 * 3600 * 1000))}&select=${q(select)}&order=created_at.asc&limit=20`));
    return found.map(outcome => ({
      key: `auto:${rule}:${outcome.id}`,
      phone: contactPhone(outcome),
      name: outcome.customer_name || outcome.automation_contacts?.display_name || '',
      purpose: `${settings[rule].purpose} ${rule === 'callback' ? `Their request: ${outcome.collected_fields?.Reason || outcome.summary || 'they asked to talk to a person'}.` : `Their order: ${outcome.title}${outcome.summary ? ` — ${outcome.summary}` : ''}.`}`.slice(0, 500)
    }));
  }
  // Reminder: bookings starting in `hours_before` hours (a 15-minute window; each booking is called once).
  const ahead = settings.reminder.hours_before * 3600 * 1000;
  const found = rows(await supabaseRequest(`/rest/v1/automation_outcomes?business_id=eq.${q(business.id)}&outcome_type=eq.booking&status=in.(new,confirmed)&scheduled_start=gte.${q(iso(now + ahead - 5 * 60 * 1000))}&scheduled_start=lte.${q(iso(now + ahead + 10 * 60 * 1000))}&select=${q(select)}&limit=20`));
  return found.map(outcome => ({
    key: `auto:reminder:${outcome.id}`,
    phone: contactPhone(outcome),
    name: outcome.customer_name || outcome.automation_contacts?.display_name || '',
    purpose: `${settings.reminder.purpose} Booking: ${outcome.service_name || outcome.title} on ${localTime(business.timezone, outcome.scheduled_start)}.`.slice(0, 500)
  }));
}

export async function handler(event = {}) {
  // Only Netlify's scheduler (or an internal call) may run it.
  if (!isScheduledRun(event) && !isInternalCall(event)) return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized' }) };
  const connections = rows(await supabaseRequest('/rest/v1/automation_channel_connections?channel_type=eq.phone&settings->auto_calls=not.is.null&select=business_id,settings,automation_businesses(id,timezone)&limit=500'));
  let started = 0;
  for (const connection of connections) {
    const settings = autoCallSettings(connection.settings?.auto_calls);
    const business = connection.automation_businesses || { id: connection.business_id };
    const rules = ['callback', 'order', 'reminder'].filter(rule => settings[rule].on);
    if (!rules.length) continue;
    if (settings.hours_only) { const hour = localHour(business.timezone); if (hour < 9 || hour >= 20) continue; }
    let made = 0;
    for (const rule of rules) {
      if (made >= MAX_CALLS_PER_BUSINESS_PER_RUN) break;
      const list = await candidates(rule, settings, business).catch(error => { console.error('auto calls: candidates failed', { business: business.id, rule, message: error?.message }); return []; });
      for (const item of list) {
        if (made >= MAX_CALLS_PER_BUSINESS_PER_RUN) break;
        if (!item.phone || await alreadyCalled(business.id, item.key)) continue;
        try {
          await startOutgoingCall({ businessId: business.id, to: item.phone, purpose: item.purpose, contactName: item.name, triggerKey: item.key });
          made++; started++;
        } catch (error) {
          // A business without an outgoing line, credits or in-country number stops here; others go on.
          console.warn('auto call not started', { business: business.id, rule, code: error?.code || error?.message });
          if (['no_outgoing_line', 'credits_required', 'too_many_calls', 'phone_service_not_configured'].includes(error?.code)) break;
        }
      }
    }
  }
  return { statusCode: 200, body: JSON.stringify({ started }) };
}
