import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, authorized } from '../../netlify/functions/revenuecat-webhook.mjs';
import { describeEvent, APP_PACKS, APP_PLANS, CREATIVE_PLANS } from '../../lib/business/app-purchases.mjs';
import { AUTOMATION_PLANS } from '../../lib/automation/billing.mjs';

const UID = '11111111-2222-4333-8444-555555555555';
const AUTH = 'Bearer test-secret';

// A tiny in-memory Supabase REST: payments, profiles, user_subscriptions, automation_subscriptions.
function fakeDb(profile = { credits: 10, monthly_credits: 0, payg_credits: 10 }) {
  const db = { payments: [], profiles: [{ user_id: UID, ...profile }], user_subscriptions: [], automation_subscriptions: [] };
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url); const table = u.pathname.split('/').pop(); const rows = db[table];
    const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : null;
    const eq = (key) => { const v = u.searchParams.get(key); return v && v.startsWith('eq.') ? decodeURIComponent(v.slice(3)) : null; };
    const reply = (status, data) => ({ ok: status < 300, status, json: async () => data });
    if (method === 'POST') {
      const key = u.searchParams.get('on_conflict');
      for (const row of body) {
        const existing = rows.find(r => r[key] === row[key]);
        if (existing) { if (/merge-duplicates/.test(options.headers.Prefer)) Object.assign(existing, row); }
        else rows.push({ ...row });
      }
      return reply(201, body);
    }
    const match = r => Object.entries({ transaction_id: eq('transaction_id'), user_id: eq('user_id') }).every(([k, v]) => v == null || r[k] === v)
      && (u.searchParams.get('status') !== 'is.null' || r.status == null);
    const found = rows.filter(match);
    if (method === 'PATCH') { found.forEach(r => Object.assign(r, body)); return reply(200, found.map(r => ({ ...r }))); }
    return reply(200, found.map(r => ({ ...r })));
  };
  return { db, fetchImpl };
}
const sales = [];
const deps = extra => ({ webhookAuth: AUTH, supabaseUrl: 'https://db.test', serviceKey: 'svc', notifySale: async sale => { sales.push(sale); }, ...extra });
const post = (event, headers = { authorization: AUTH }) => ({ httpMethod: 'POST', headers, body: JSON.stringify({ event }) });

test('the products match the website packs and plans', () => {
  assert.deepEqual(Object.values(APP_PACKS), [90, 200, 510, 1050]);
  for (const plan of Object.values(APP_PLANS)) assert.ok(CREATIVE_PLANS[plan] || AUTOMATION_PLANS[plan], plan);
  assert.equal(Object.keys(APP_PLANS).length, 7);
});

test('a call without the RevenueCat password is refused', async () => {
  assert.equal(authorized({ authorization: 'Bearer wrong' }, AUTH), false);
  assert.equal(authorized({}, ''), false);
  const { fetchImpl } = fakeDb();
  const res = await handler(post({ type: 'NON_RENEWING_PURCHASE' }, { authorization: 'nope' }), deps({ fetchImpl }));
  assert.equal(res.statusCode, 401);
});

test('a credit pack adds pay-as-you-go credits once, even if the event repeats', async () => {
  const { db, fetchImpl } = fakeDb();
  const event = { type: 'NON_RENEWING_PURCHASE', app_user_id: UID, product_id: 'co.hansora.app.credits.2000', transaction_id: 't-1', store: 'APP_STORE', price: 19.99 };
  const first = await handler(post(event), deps({ fetchImpl }));
  const again = await handler(post(event), deps({ fetchImpl }));
  assert.equal(first.statusCode, 200); assert.equal(again.statusCode, 200);
  assert.equal(JSON.parse(again.body).credited, false);
  assert.deepEqual({ payg: db.profiles[0].payg_credits, total: db.profiles[0].credits }, { payg: 210, total: 210 });
  assert.equal(db.payments.length, 1);
  assert.equal(db.payments[0].provider, 'apple'); assert.equal(db.payments[0].amount_cents, 1999); assert.equal(db.payments[0].status, 'succeeded');
});

test('a purchase without a signed-in Hansora user changes nothing', async () => {
  const { db, fetchImpl } = fakeDb();
  const res = await handler(post({ type: 'NON_RENEWING_PURCHASE', app_user_id: '$RCAnonymousID:abc', product_id: 'co.hansora.app.credits.900', transaction_id: 't-2' }), deps({ fetchImpl }));
  assert.equal(res.statusCode, 200); assert.equal(db.payments.length, 0); assert.equal(db.profiles[0].credits, 10);
});

test('a Creative plan: subscription row, monthly credits each period, cancel keeps it until the end', async () => {
  const { db, fetchImpl } = fakeDb();
  const start = Date.parse('2026-11-05T10:00:00Z'), end = Date.parse('2026-12-05T10:00:00Z');
  const base = { app_user_id: UID, product_id: 'co.hansora.app.creative.pro.monthly', original_transaction_id: 'o-1', store: 'APP_STORE', price: 64, purchased_at_ms: start, expiration_at_ms: end };
  await handler(post({ ...base, type: 'INITIAL_PURCHASE', transaction_id: 'p-1' }), deps({ fetchImpl }));
  assert.equal(db.user_subscriptions[0].plan_id, 'pro_monthly'); assert.equal(db.user_subscriptions[0].status, 'active');
  assert.equal(db.user_subscriptions[0].provider_subscription_id, 'apple:o-1');
  assert.equal(db.profiles[0].monthly_credits, 450);
  await handler(post({ ...base, type: 'RENEWAL', transaction_id: 'p-2', purchased_at_ms: end, expiration_at_ms: end + 30 * 864e5 }), deps({ fetchImpl }));
  await handler(post({ ...base, type: 'RENEWAL', transaction_id: 'p-2', purchased_at_ms: end, expiration_at_ms: end + 30 * 864e5 }), deps({ fetchImpl }));
  assert.equal(db.profiles[0].monthly_credits, 900);
  await handler(post({ ...base, type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE' }), deps({ fetchImpl }));
  assert.equal(db.user_subscriptions[0].status, 'active'); assert.equal(db.user_subscriptions[0].cancel_at_period_end, true);
  await handler(post({ ...base, type: 'EXPIRATION' }), deps({ fetchImpl }));
  assert.equal(db.user_subscriptions[0].status, 'expired');
});

test('an Automation plan goes to automation_subscriptions and its credits to pay-as-you-go', async () => {
  const { db, fetchImpl } = fakeDb();
  const res = await handler(post({ type: 'INITIAL_PURCHASE', app_user_id: UID, product_id: 'co.hansora.app.automation.growth.monthly:monthly', transaction_id: 'g-1', original_transaction_id: 'g-0', store: 'PLAY_STORE', price: 99, purchased_at_ms: Date.now(), expiration_at_ms: Date.now() + 30 * 864e5 }), deps({ fetchImpl }));
  assert.equal(res.statusCode, 200);
  assert.equal(db.automation_subscriptions[0].plan_id, 'automation_growth_monthly');
  assert.equal(db.automation_subscriptions[0].provider, 'google');
  assert.equal(db.profiles[0].payg_credits, 10 + AUTOMATION_PLANS.automation_growth_monthly.credits);
  assert.equal(db.profiles[0].monthly_credits, 0);
});

test('a store cancel never ends a plan bought on the website', async () => {
  const { db, fetchImpl } = fakeDb();
  db.user_subscriptions.push({ user_id: UID, plan_id: 'premium_monthly', status: 'active', provider: 'dodopayments', provider_subscription_id: 'sub_web' });
  await handler(post({ type: 'EXPIRATION', app_user_id: UID, product_id: 'co.hansora.app.creative.premium.monthly', original_transaction_id: 'o-9', store: 'APP_STORE' }), deps({ fetchImpl }));
  assert.equal(db.user_subscriptions[0].status, 'active'); assert.equal(db.user_subscriptions[0].provider, 'dodopayments');
});

test('a refund of a plan ends it now', () => {
  const info = describeEvent({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', app_user_id: UID, product_id: 'co.hansora.app.creative.premium.monthly', original_transaction_id: 'o-1', store: 'APP_STORE' });
  assert.equal(info.status, 'cancelled'); assert.equal(info.cancelAtPeriodEnd, false);
});
