import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWhatsAppEchoes, extractWhatsAppMessages, phonePauseExpired } from '../../lib/automation/whatsapp.mjs';

const echoPayload = {
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA1', changes: [{ field: 'smb_message_echoes', value: {
    metadata: { phone_number_id: '111222333' },
    message_echoes: [{ from: '37400000000', to: '15550001111', id: 'wamid.ECHO1', timestamp: '1790000000', type: 'text', text: { body: 'Your order is ready, we deliver today!' } }]
  } }] }]
};

test('messages the owner sends from the WhatsApp Business app are read as the team\'s replies', () => {
  const [echo] = extractWhatsAppEchoes(echoPayload);
  assert.equal(echo.customerId, '15550001111');
  assert.equal(echo.phoneNumberId, '111222333');
  assert.equal(echo.text, 'Your order is ready, we deliver today!');
  assert.equal(echo.externalEventId, 'wamid.ECHO1');
  // An echo is never treated as a customer message (so the AI does not answer the owner).
  assert.deepEqual(extractWhatsAppMessages(echoPayload), []);
});

test('the AI comes back 12 hours after the owner last wrote from the phone, not after an inbox take-over', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const phone = hoursAgo => ({ metadata: { source: 'whatsapp_business_app', sent_at: new Date(now - hoursAgo * 3600e3).toISOString() } });
  assert.equal(phonePauseExpired(phone(2), now), false);
  assert.equal(phonePauseExpired(phone(13), now), true);
  assert.equal(phonePauseExpired({ metadata: { sent_by_user_id: 'u1' }, created_at: '2026-09-01T00:00:00Z' }, now), false);
  assert.equal(phonePauseExpired(null, now), false);
});
