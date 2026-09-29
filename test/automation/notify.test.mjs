import assert from 'node:assert/strict';
import test from 'node:test';
import { alertLink, buildAlertEmail, normalizePhone, notifyOwner, sendAlertWhatsApp, templateText } from '../../lib/automation/notify.mjs';

process.env.HANSORA_NOTIFY_WA_PHONE_NUMBER_ID = 'hansora-phone';
process.env.HANSORA_NOTIFY_WA_ACCESS_TOKEN = 'hansora-token';

const data = { businessId: 'biz-1', outcomeId: 'out-1', business: 'Ararat Studio', reference: '1042', customer: 'Ani · 37499111222', details: 'White cabinet\n120 × 200', time: 'Fri 2 Oct, 11:30', channel: 'WhatsApp' };

test('WhatsApp alerts are template messages from the Hansora number with a deep link button', async () => {
  let request;
  await sendAlertWhatsApp({ to: '37499000000', event: 'order_created', data, language: 'hy', fetchImpl: async (url, options) => { request = { url: String(url), body: JSON.parse(options.body) }; return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.alert' }] }) }; } });
  assert.match(request.url, /\/hansora-phone\/messages$/);
  assert.equal(request.body.type, 'template');
  assert.equal(request.body.template.name, 'hansora_order_alert');
  assert.equal(request.body.template.language.code, 'hy');
  assert.deepEqual(request.body.template.components[0].parameters.map(item => item.text), ['1042', 'Ararat Studio', 'Ani · 37499111222', 'White cabinet 120 × 200']);
  assert.deepEqual(request.body.template.components[1], { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'automation-operations.html?business=biz-1&record=out-1' }] });
});

test('template text, phone numbers, links and email are safe', () => {
  assert.equal(templateText('a\n\tb      c'), 'a b   c');
  assert.equal(templateText(''), '—');
  assert.equal(normalizePhone('+374 (99) 11-12-22'), '37499111222');
  assert.equal(normalizePhone('0099'), '');
  assert.equal(alertLink('handoff_requested', { businessId: 'b', conversationId: 'c' }), 'automation-inbox.html?business=b&conversation=c');
  const email = buildAlertEmail('booking_created', { ...data, customer: '<script>x</script>' });
  assert.equal(email.subject, 'New booking #1042 · Fri 2 Oct, 11:30');
  assert.ok(!email.html.includes('<script>'));
});

function fakeDeps({ settings, email = 'owner@example.com' } = {}) {
  const deliveries = new Map(); const sent = [];
  return {
    sent,
    deps: {
      first: async path => path.includes('notification_settings') ? settings : path.includes('automation_businesses') ? { owner_user_id: 'user-1' } : null,
      supabaseRequest: async path => path.startsWith('/auth/v1/admin/users/user-1') ? { email } : null,
      serviceInsert: async (table, value) => { if (deliveries.has(value.idempotency_key)) return null; const row = { id: `d${deliveries.size + 1}`, ...value }; deliveries.set(value.idempotency_key, row); return row; },
      serviceUpdate: async (table, query, value) => { const row = [...deliveries.values()].find(item => query === `id=eq.${item.id}`); Object.assign(row, value); return [row]; },
      sendWhatsApp: async input => { sent.push(['whatsapp', input.to, input.language]); return { messageId: 'wamid' }; },
      sendEmail: async input => { if (input.to === 'broken@example.com') throw new Error('email_send_failed'); sent.push(['email', input.to]); return { messageId: 'mail' }; }
    },
    deliveries
  };
}

test('owners get each enabled channel once, and only for events they chose', async () => {
  const settings = { whatsapp_enabled: true, whatsapp_verified_at: '2026-09-28T10:00:00Z', whatsapp_phone: '37499000000', email_enabled: true, email: 'alerts@studio.am', events: ['order_created'], language: 'ru' };
  const fake = fakeDeps({ settings });
  const first = await notifyOwner({ businessId: 'biz-1', event: 'order_created', data, idempotencyKey: 'order_created:out-1', deps: fake.deps });
  assert.deepEqual(first.map(item => [item.channel, item.status]), [['whatsapp', 'sent'], ['email', 'sent']]);
  assert.deepEqual(fake.sent, [['whatsapp', '37499000000', 'ru'], ['email', 'alerts@studio.am']]);
  const retry = await notifyOwner({ businessId: 'biz-1', event: 'order_created', data, idempotencyKey: 'order_created:out-1', deps: fake.deps });
  assert.deepEqual(retry.map(item => item.status), ['duplicate', 'duplicate']);
  assert.deepEqual(await notifyOwner({ businessId: 'biz-1', event: 'lead_created', data, idempotencyKey: 'lead_created:x', deps: fake.deps }), []);
});

test('without settings, alerts go to the account email; unverified WhatsApp is never used; failures are recorded', async () => {
  const fallback = fakeDeps({ settings: null });
  await notifyOwner({ businessId: 'biz-1', event: 'booking_created', data, idempotencyKey: 'booking_created:1', deps: fallback.deps });
  assert.deepEqual(fallback.sent, [['email', 'owner@example.com']]);
  const unverified = fakeDeps({ settings: { whatsapp_enabled: true, whatsapp_verified_at: null, whatsapp_phone: '37499000000', email_enabled: true, email: 'broken@example.com', events: ['handoff_requested'] } });
  const result = await notifyOwner({ businessId: 'biz-1', event: 'handoff_requested', data, idempotencyKey: 'handoff:1', deps: unverified.deps });
  assert.deepEqual(result.map(item => [item.channel, item.status]), [['email', 'failed']]);
  assert.equal([...unverified.deliveries.values()][0].status, 'failed');
});
