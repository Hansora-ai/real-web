import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { dodoSignatureState, handler } from '../../netlify/functions/dodo-webhook.mjs';

const SECRET = 'whsec_' + Buffer.from('test-secret-key-123').toString('base64');
const sign = (body, { id = 'msg_1', ts = Math.floor(Date.now() / 1000), secret = SECRET } = {}) => ({
  'webhook-id': id, 'webhook-timestamp': String(ts),
  'webhook-signature': 'v1,' + crypto.createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${body}`).digest('base64')
});

test('Dodo signature: real Dodo messages pass, fakes and old replays are rejected, no secret = old behaviour', () => {
  const body = '{"type":"payment.succeeded"}';
  assert.equal(dodoSignatureState(body, sign(body), SECRET), 'valid');
  assert.equal(dodoSignatureState(body + ' ', sign(body), SECRET), 'invalid', 'changed body');
  assert.equal(dodoSignatureState(body, sign(body, { secret: 'whsec_' + Buffer.from('other').toString('base64') }), SECRET), 'invalid', 'wrong secret');
  assert.equal(dodoSignatureState(body, sign(body, { ts: Math.floor(Date.now() / 1000) - 3600 }), SECRET), 'invalid', 'an hour-old replay');
  assert.equal(dodoSignatureState(body, {}, SECRET), 'invalid', 'no signature headers');
  assert.equal(dodoSignatureState(body, {}, ''), 'not_configured');
  const headers = sign(body); headers['webhook-signature'] = 'v1,bad ' + headers['webhook-signature'];
  assert.equal(dodoSignatureState(body, headers, SECRET), 'valid', 'one of several signatures matches');
});

async function run(payload, { signed = true } = {}) {
  const old = { ...process.env }; const oldFetch = globalThis.fetch; const writes = [];
  Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k', DODO_WEBHOOK_SECRET: SECRET });
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url); writes.push({ u, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (u.includes('/profiles') && (options.method || 'GET') === 'GET') return ok([{ credits: 0, monthly_credits: 0, payg_credits: 0 }]);
    return ok([{}]);
  };
  try {
    const body = JSON.stringify(payload);
    return { response: await handler({ httpMethod: 'POST', headers: signed ? sign(body) : {}, body }), writes };
  } finally { process.env = old; globalThis.fetch = oldFetch; }
}

test('Creative packs give 90 / 200 / 510 / 1050 stored credits whatever the link metadata says', async () => {
  const packs = [['pdt_Gi01FZTv21T44htKut7lG', 999, 90], ['pdt_YNeJAH4NMLe8gJF7ff0Fe', 1999, 200], ['pdt_oVJI6GNjziGZKrXtVczUY', 4999, 510], ['pdt_e8UPGoRi6Sf36NoxV7fAF', 9999, 1050]];
  for (const [product, cents, credits] of packs) {
    const { writes } = await run({ type: 'payment.succeeded', data: { status: 'succeeded', payment_id: `p-${product}`, total_amount: cents, currency: 'USD', product_cart: [{ product_id: product, quantity: 1 }], metadata: { uid: 'u1', credits: '1100' } } });
    const payment = writes.find((item) => item.u.includes('/payments') && item.method === 'POST');
    assert.equal(payment.body[0].credits, credits, product);
  }
});

test('A fake (unsigned) "payment succeeded" gives no credits once the secret is set', async () => {
  const { response, writes } = await run({ type: 'payment.succeeded', data: { status: 'succeeded', payment_id: 'p1', metadata: { uid: 'u1', credits: '100000' } } }, { signed: false });
  assert.equal(response.statusCode, 401);
  assert.equal(writes.length, 0);
});

test('Credits come from the product that was paid for, not from an edited checkout link', async () => {
  const { response, writes } = await run({ type: 'payment.succeeded', data: { status: 'succeeded', payment_id: 'p2', total_amount: 1499, currency: 'USD', product_cart: [{ product_id: 'pdt_0NpePPSth80ohulWU0r3D', quantity: 1 }], metadata: { uid: 'u1', credits: '1100', source: 'automation' } } });
  assert.equal(response.statusCode, 200);
  const payment = writes.find(item => item.u.includes('/payments') && item.method === 'POST');
  assert.equal(payment.body[0].credits, 150, 'the $14.99 Starter pack gives 150 stored credits (1,500⚡), not 1,100');
});

test('A Creative plan product cannot be upgraded by editing metadata_plan_id', async () => {
  const { writes } = await run({ type: 'subscription.active', data: { status: 'active', subscription_id: 'sub_9', product_id: 'pdt_0NitZowYuuy1bWlRxdOmz', next_billing_date: '2026-11-13T00:00:00Z', previous_billing_date: '2026-10-13T00:00:00Z', metadata: { uid: 'u1', plan_id: 'pro_max_monthly', monthly_credits: '1000' } } });
  const subscription = writes.find(item => item.u.includes('/user_subscriptions'));
  assert.equal(subscription.body[0].plan_id, 'premium_monthly');
  const payment = writes.find(item => item.u.includes('/payments') && item.method === 'POST');
  assert.equal(payment.body[0].credits, 250);
});
