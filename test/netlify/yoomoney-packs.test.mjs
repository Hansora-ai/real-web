import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

process.env.YOOMONEY_NOTIFICATION_SECRET = 'test-secret';
process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

const { handler } = await import('../../netlify/functions/yoomoney-webhook.mjs');
const uid = '11111111-2222-3333-4444-555555555555';

// A signed YooMoney notification for a payment of `amount` roubles with the label a pricing page built.
function notification(labelCredits, amount, operation = `op-${labelCredits}-${amount}`) {
  const payload = {
    notification_type: 'card-incoming', operation_id: operation, amount: String(amount), withdraw_amount: String(amount),
    currency: '643', datetime: '2026-10-25T12:00:00Z', sender: '', codepro: 'false', label: `hansora_web|${labelCredits}|${uid}|buyer@example.com`
  };
  payload.sha1_hash = createHash('sha1').update([payload.notification_type, payload.operation_id, payload.amount, payload.currency,
    payload.datetime, payload.sender, payload.codepro, 'test-secret', payload.label].join('&')).digest('hex');
  return { httpMethod: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(payload).toString() };
}

async function pay(labelCredits, amount) {
  const originalFetch = globalThis.fetch;
  let granted = null;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (href.includes('/rest/v1/payments?on_conflict')) return reply([{ transaction_id: 'x' }], 201);
    if (href.includes('/rest/v1/payments?transaction_id')) return reply([{ transaction_id: 'x' }]);
    if (href.includes('/rest/v1/profiles') && (options.method || 'GET') === 'GET') return reply([{ credits: 0, email: 'buyer@example.com' }]);
    if (href.includes('/rest/v1/profiles') && options.method === 'PATCH') { granted = JSON.parse(options.body).credits; return reply([{}]); }
    return reply({});
  };
  try {
    const response = await handler(notification(labelCredits, amount));
    return { status: response.statusCode, granted };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('Creative packs grant 90 / 200 / 510 / 1050 stored credits for the same rouble prices', async () => {
  assert.deepEqual(await pay(90, 750), { status: 200, granted: 90 });
  assert.deepEqual(await pay(200, 1500), { status: 200, granted: 200 });
  assert.deepEqual(await pay(510, 3700), { status: 200, granted: 510 });
  assert.deepEqual(await pay(1050, 7400), { status: 200, granted: 1050 });
  // Labels from the first version of the new packs (500 / 1000) also get the larger gift.
  assert.deepEqual(await pay(500, 3700), { status: 200, granted: 510 });
  assert.deepEqual(await pay(1000, 7400), { status: 200, granted: 1050 });
});

test('a page opened before the change still pays out, at the new amount, never the old one', async () => {
  assert.deepEqual(await pay(100, 750), { status: 200, granted: 90 });
  assert.deepEqual(await pay(210, 1500), { status: 200, granted: 200 });
  assert.deepEqual(await pay(1100, 7400), { status: 200, granted: 1050 });
});

test('a label whose price does not match its pack is refused before any credit', async () => {
  assert.equal((await pay(1050, 750)).status, 400);
  assert.equal((await pay(1050, 750)).granted, null);
});
