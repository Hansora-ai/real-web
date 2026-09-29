// Owner notifications. WhatsApp alerts are sent from Hansora's own WhatsApp Business number using approved
// utility templates (so they work even when the owner never wrote to Hansora); email via Resend is the backup.
import * as db from './db.mjs';
import { sendWhatsAppTemplateRaw } from './whatsapp.mjs';

export const NOTIFICATION_EVENTS = ['order_created', 'booking_created', 'booking_cancelled', 'handoff_requested', 'lead_created'];
export const DEFAULT_EVENTS = ['order_created', 'booking_created', 'handoff_requested'];

// Template names and body variables. The exact wording to submit to Meta is in docs/hansora-automation-tools.md.
export const ALERT_TEMPLATES = {
  order_created: { name: 'hansora_order_alert', params: data => [data.reference, data.business, data.customer, data.details] },
  booking_created: { name: 'hansora_booking_alert', params: data => [data.reference, data.business, data.customer, data.time] },
  booking_cancelled: { name: 'hansora_booking_cancelled', params: data => [data.reference, data.business, data.customer, data.time] },
  handoff_requested: { name: 'hansora_handoff_alert', params: data => [data.business, data.customer, data.details] },
  lead_created: { name: 'hansora_lead_alert', params: data => [data.business, data.customer, data.details] },
  test: { name: 'hansora_lead_alert', params: data => [data.business, 'Hansora test', 'Notifications are working'] }
};
export const VERIFY_TEMPLATE = 'hansora_verify_code';

function hansoraSender() {
  const phoneNumberId = String(process.env.HANSORA_NOTIFY_WA_PHONE_NUMBER_ID || '').trim();
  const accessToken = String(process.env.HANSORA_NOTIFY_WA_ACCESS_TOKEN || '').trim();
  if (!phoneNumberId || !accessToken) throw Object.assign(new Error('hansora_whatsapp_sender_not_configured'), { status: 503 });
  return { phoneNumberId, accessToken };
}

// WhatsApp template variables may not contain new lines, tabs or more than four consecutive spaces.
export function templateText(value, max = 300) {
  const text = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim();
  return (text || '—').slice(0, max);
}

export function normalizePhone(value) {
  const digits = String(value || '').replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^00/, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : '';
}

export function alertLink(event, data) {
  const business = encodeURIComponent(data.businessId || '');
  if (event === 'handoff_requested') return `automation-inbox.html?business=${business}${data.conversationId ? `&conversation=${encodeURIComponent(data.conversationId)}` : ''}`;
  return `automation-operations.html?business=${business}${data.outcomeId ? `&record=${encodeURIComponent(data.outcomeId)}` : ''}`;
}

export async function sendAlertWhatsApp({ to, event, data, language = 'en', fetchImpl = fetch }) {
  const template = ALERT_TEMPLATES[event];
  if (!template) throw new Error('unknown_notification_event');
  const sender = hansoraSender();
  return sendWhatsAppTemplateRaw({
    phoneNumberId: sender.phoneNumberId, accessToken: sender.accessToken, to, fetchImpl,
    template: { name: template.name, language: { code: language }, components: [
      { type: 'body', parameters: template.params(data).map(value => ({ type: 'text', text: templateText(value) })) },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: alertLink(event, data) }] }
    ] }
  });
}

export async function sendVerificationCode({ to, code, language = 'en', fetchImpl = fetch }) {
  const sender = hansoraSender();
  return sendWhatsAppTemplateRaw({
    phoneNumberId: sender.phoneNumberId, accessToken: sender.accessToken, to, fetchImpl,
    template: { name: VERIFY_TEMPLATE, language: { code: language }, components: [
      { type: 'body', parameters: [{ type: 'text', text: String(code) }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(code) }] }
    ] }
  });
}

const EMAIL_SUBJECTS = {
  order_created: data => `New order #${data.reference} · ${data.business}`,
  booking_created: data => `New booking #${data.reference} · ${data.time}`,
  booking_cancelled: data => `Booking #${data.reference} cancelled · ${data.time}`,
  handoff_requested: data => `A customer needs a person · ${data.business}`,
  lead_created: data => `New lead · ${data.business}`,
  test: data => `Test notification · ${data.business}`
};

export function buildAlertEmail(event, data) {
  const site = String(process.env.URL || 'https://hansora.co').replace(/\/$/, '');
  const rows = [['Customer', data.customer], ['Channel', data.channel], ['Time', data.time], ['Details', data.details]].filter(([, value]) => value);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const subject = (EMAIL_SUBJECTS[event] || EMAIL_SUBJECTS.test)(data);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;padding:24px;color:#111"><p style="font-size:12px;letter-spacing:1.5px;color:#5b6b82;margin:0 0 8px">HANSORA AUTOMATION</p><h1 style="font-size:22px;margin:0 0 18px">${escape(subject)}</h1><table style="width:100%;border-collapse:collapse;font-size:14px">${rows.map(([label, value]) => `<tr><td style="padding:8px 0;color:#5b6b82;width:110px;vertical-align:top">${escape(label)}</td><td style="padding:8px 0">${escape(value)}</td></tr>`).join('')}</table><p style="margin:24px 0 0"><a href="${site}/${alertLink(event, data)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px">Open in Hansora</a></p></div>`;
  return { subject, html };
}

export async function sendAlertEmail({ to, event, data, fetchImpl = fetch }) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) throw Object.assign(new Error('email_not_configured'), { status: 503 });
  const from = String(process.env.AUTOMATION_NOTIFY_FROM_EMAIL || process.env.CONTACT_FROM_EMAIL || 'onboarding@resend.dev');
  const { subject, html } = buildAlertEmail(event, data);
  const response = await fetchImpl('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, html }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error('email_send_failed'), { status: 502, providerStatus: response.status });
  return { messageId: String(body.id || '') };
}

async function ownerEmail(businessId, deps) {
  const business = await deps.first(`/rest/v1/automation_businesses?id=eq.${businessId}&select=owner_user_id&limit=1`);
  if (!business?.owner_user_id) return '';
  const user = await deps.supabaseRequest(`/auth/v1/admin/users/${business.owner_user_id}`).catch(() => null);
  return String(user?.email || '');
}

// Sends one event to every channel the owner enabled. Each channel is recorded once per idempotency key,
// so webhook or tool retries never notify twice. Failures are recorded and never break the conversation.
export async function notifyOwner({ businessId, event, data, idempotencyKey, deps = {} }) {
  const d = { first: db.first, serviceInsert: db.serviceInsert, serviceUpdate: db.serviceUpdate, supabaseRequest: db.supabaseRequest, sendWhatsApp: sendAlertWhatsApp, sendEmail: sendAlertEmail, ...deps };
  const settings = await d.first(`/rest/v1/automation_notification_settings?business_id=eq.${businessId}&select=*&limit=1`);
  const events = settings ? settings.events || [] : DEFAULT_EVENTS;
  if (event !== 'test' && !events.includes(event)) return [];
  const targets = [];
  if (settings?.whatsapp_enabled && settings.whatsapp_verified_at && settings.whatsapp_phone) targets.push({ channel: 'whatsapp', to: settings.whatsapp_phone });
  if (!settings || settings.email_enabled) { const email = settings?.email || await ownerEmail(businessId, d); if (email) targets.push({ channel: 'email', to: email }); }
  const results = [];
  for (const target of targets) {
    const delivery = await d.serviceInsert('automation_notification_deliveries', { business_id: businessId, outcome_id: data.outcomeId || null, conversation_id: data.conversationId || null, event_type: event, channel: target.channel, status: 'pending', idempotency_key: `${idempotencyKey}:${target.channel}` }, { ignoreDuplicates: true });
    if (!delivery) { results.push({ channel: target.channel, status: 'duplicate' }); continue; }
    try {
      const sent = target.channel === 'whatsapp'
        ? await d.sendWhatsApp({ to: target.to, event, data, language: settings?.language || 'en' })
        : await d.sendEmail({ to: target.to, event, data });
      await d.serviceUpdate('automation_notification_deliveries', `id=eq.${delivery.id}`, { status: 'sent', provider_message_id: sent.messageId || null });
      results.push({ channel: target.channel, status: 'sent' });
    } catch (error) {
      console.error('automation notification failed', { channel: target.channel, event, message: error?.message, providerStatus: error?.providerStatus });
      await d.serviceUpdate('automation_notification_deliveries', `id=eq.${delivery.id}`, { status: 'failed', error: String(error?.message || 'send_failed').slice(0, 2000) }).catch(() => null);
      results.push({ channel: target.channel, status: 'failed', error: error?.message });
    }
  }
  return results;
}
