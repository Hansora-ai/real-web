import test from 'node:test';
import assert from 'node:assert/strict';
import { config, db, offerView, creditsForPayment, offerCredits, isActive, OFFER_PACKS, OFFER_HOURS, GRACE_MINUTES, STARTER } from '../../lib/business/chatgpt-offer.mjs';
import { handle } from '../../netlify/functions/chatgpt-offer.mjs';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', DODO_CHATGPT_STARTER_PRODUCT: 'https://checkout.dodopayments.com/buy/pdt_starter?quantity=1' };
const U1 = '11111111-1111-1111-1111-111111111111';
const PACK_999 = 'pdt_Gi01FZTv21T44htKut7lG';
const PACK_1999 = 'pdt_YNeJAH4NMLe8gJF7ff0Fe';
const HOUR = 3600000;
const T0 = Date.parse('2026-11-12T10:00:00Z');

// A tiny stand-in for Supabase REST: tables in memory, PostgREST-style filters.
function backend({ offers = [], events = [], payments = [], user = { id: U1, email: 'a@b.co' } } = {}) {
  const tables = { chatgpt_offers: offers.map((r) => ({ ...r })), chatgpt_events: events.map((r) => ({ ...r })), payments: payments.map((r) => ({ ...r })) };
  const matches = (row, params) => [...params].every(([k, v]) => {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) return true;
    if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
    if (v === 'is.null') return row[k] == null;
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(row[k]));
    return true;
  });
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    if (u.pathname === '/auth/v1/user') return init.headers.Authorization === 'Bearer good' ? reply(200, user) : reply(401, {});
    const rows = tables[u.pathname.replace('/rest/v1/', '')];
    const body = init.body ? JSON.parse(init.body) : undefined;
    const method = init.method || 'GET';
    if (method === 'GET') return reply(200, rows.filter((r) => matches(r, u.searchParams)));
    if (method === 'PATCH') { const hit = rows.filter((r) => matches(r, u.searchParams)); hit.forEach((r) => Object.assign(r, body)); return reply(200, hit); }
    if (method === 'POST') {
      const out = [];
      for (const item of body) { if (rows.some((r) => r.user_id === item.user_id)) continue; rows.push({ ...item }); out.push(item); }
      return reply(201, out);
    }
    return reply(405, {});
  }
  return { tables, fetchImpl };
}
const cfg = config(ENV);
// `view` is the pricing page (it starts the timer); `peek` is any other page.
const view = (b, now) => offerView({ cfg, store: db(cfg, b.fetchImpl), userId: U1, start: true, now });
const peek = (b, now) => offerView({ cfg, store: db(cfg, b.fetchImpl), userId: U1, now });
const pay = (b, extra) => creditsForPayment({ cfg, store: db(cfg, b.fetchImpl), userId: U1, productId: PACK_999, credits: 90, transactionId: 'pay_1', paidAt: new Date(T0 + HOUR).toISOString(), now: T0 + HOUR, ...extra });
const chatgptUser = () => backend({ events: [{ id: 1, user_id: U1 }] });

test('offer credits: 25% of the base credits free, never less than the pack gives today', () => {
  assert.deepEqual(Object.values(OFFER_PACKS).map((p) => offerCredits(p)), [113, 225, 563, 1125]);
  for (const pack of Object.values(OFFER_PACKS)) assert.ok(offerCredits(pack) > pack.credits);
});

test('the starter product is read from a pasted Dodo link or a bare id', () => {
  assert.equal(cfg.starterProductId, 'pdt_starter');
  assert.equal(config({ DODO_CHATGPT_STARTER_PRODUCT: 'pdt_abc123' }).starterCheckout, 'https://checkout.dodopayments.com/buy/pdt_abc123');
  // Without the setting, the starter product created in Dodo is used.
  assert.equal(config({}).starterCheckout, 'https://checkout.dodopayments.com/buy/pdt_0NrmWsHzjAdxHAYd4QOSG');
});

test('other pages never start the timer: the offer waits until the pricing page is opened', async () => {
  const b = chatgptUser();
  assert.deepEqual(await peek(b, T0), { eligible: true, active: false, pending: true, bonus_percent: 25 });
  assert.deepEqual(await peek(b, T0 + 20 * HOUR), { eligible: true, active: false, pending: true, bonus_percent: 25 });
  assert.equal(b.tables.chatgpt_offers.length, 0);
  // The pricing page starts it, a day later, with the full 8 hours; other pages then show the same deadline.
  const started = await view(b, T0 + 24 * HOUR);
  assert.equal(started.seconds_left, OFFER_HOURS * 3600);
  assert.equal((await peek(b, T0 + 25 * HOUR)).expires_at, started.expires_at);
});

test('anyone who never bought gets an 8-hour offer on the first look at pricing', async () => {
  const b = chatgptUser();
  const first = await view(b, T0);
  assert.equal(first.active, true);
  assert.equal(first.expires_at, new Date(T0 + OFFER_HOURS * HOUR).toISOString());
  assert.equal(first.seconds_left, OFFER_HOURS * 3600);
  assert.equal(first.bonus_percent, 25);
  assert.deepEqual(first.starter, { credits: STARTER.credits, price_cents: 499, checkout_url: 'https://checkout.dodopayments.com/buy/pdt_starter' });
  assert.deepEqual(first.packs.map((p) => [p.credits, p.offer_credits]), [[90, 113], [200, 225], [510, 563], [1050, 1125]]);
});

test('refreshing the page never restarts the timer', async () => {
  const b = chatgptUser();
  const first = await view(b, T0);
  const later = await view(b, T0 + 3 * HOUR);
  assert.equal(later.expires_at, first.expires_at);
  assert.equal(later.seconds_left, 5 * 3600);
  assert.equal(b.tables.chatgpt_offers.length, 1);
});

test('after 8 hours the offer is over for good', async () => {
  const b = chatgptUser();
  await view(b, T0);
  const expired = await view(b, T0 + 8 * HOUR + 1000);
  assert.deepEqual(expired, { eligible: true, active: false, used: false });
  const nextDay = await view(b, T0 + 30 * HOUR);
  assert.equal(nextDay.active, false);
  assert.equal(b.tables.chatgpt_offers.length, 1);
});

test('someone who never used ChatGPT gets the offer too; someone who already bought gets no offer and no timer', async () => {
  const stranger = backend();
  assert.equal((await view(stranger, T0)).active, true);
  const buyer = backend({ events: [{ id: 1, user_id: U1 }], payments: [{ uid: U1, status: 'succeeded', transaction_id: 'old' }] });
  assert.deepEqual(await view(buyer, T0), { eligible: false, active: false });
  assert.equal(buyer.tables.chatgpt_offers.length, 0);
});

test('someone who paid another way while the timer runs no longer sees the offer', async () => {
  const b = chatgptUser();
  await view(b, T0);
  b.tables.payments.push({ uid: U1, status: 'succeeded', transaction_id: 'ru_1' });
  assert.equal((await view(b, T0 + HOUR)).active, false);
});

test('CHATGPT_OFFER=off switches everything off', async () => {
  const b = chatgptUser();
  const off = config({ ...ENV, CHATGPT_OFFER: 'off' });
  assert.deepEqual(await offerView({ cfg: off, store: db(off, b.fetchImpl), userId: U1, now: T0 }), { eligible: false, active: false });
  assert.deepEqual(await creditsForPayment({ cfg: off, store: db(off, b.fetchImpl), userId: U1, productId: PACK_999, credits: 90, transactionId: 'p', now: T0 }), { credits: 90, offer: null });
});

test('a first purchase inside the window gets the bonus, once', async () => {
  const b = chatgptUser();
  await view(b, T0);
  assert.deepEqual(await pay(b), { credits: 113, offer: 'bonus' });
  assert.equal(b.tables.chatgpt_offers[0].used_transaction_id, 'pay_1');
  // Dodo sending the same payment again grants the same amount (the webhook itself credits only once).
  assert.deepEqual(await pay(b), { credits: 113, offer: 'bonus' });
  // A second purchase is a normal one.
  assert.deepEqual(await pay(b, { transactionId: 'pay_2', productId: PACK_1999, credits: 200 }), { credits: 200, offer: null });
  assert.equal((await view(b, T0 + 2 * HOUR)).active, false);
});

test('the bonus applies to one pack: extra units of the same purchase are normal', async () => {
  const b = chatgptUser();
  await view(b, T0);
  assert.deepEqual(await pay(b, { productId: PACK_1999, quantity: 2, credits: 400 }), { credits: 425, offer: 'bonus' });
});

test('a payment after the deadline gets normal credits; a checkout finished within the grace time still counts', async () => {
  const late = chatgptUser();
  await view(late, T0);
  const afterGrace = T0 + 8 * HOUR + (GRACE_MINUTES + 1) * 60000;
  assert.deepEqual(await pay(late, { paidAt: new Date(afterGrace).toISOString(), now: afterGrace }), { credits: 90, offer: null });
  const justInTime = chatgptUser();
  await view(justInTime, T0);
  const inGrace = T0 + 8 * HOUR + 10 * 60000;
  assert.deepEqual(await pay(justInTime, { paidAt: new Date(inGrace).toISOString(), now: inGrace }), { credits: 113, offer: 'bonus' });
});

test('someone with no offer row pays the normal amount', async () => {
  const b = backend();
  assert.deepEqual(await pay(b), { credits: 90, offer: null });
});

test('the starter pack grants its own amount and uses up the offer', async () => {
  const b = chatgptUser();
  await view(b, T0);
  assert.deepEqual(await pay(b, { productId: 'pdt_starter', credits: 45 }), { credits: 45, offer: 'starter' });
  assert.deepEqual(await pay(b, { transactionId: 'pay_2' }), { credits: 90, offer: null });
});

test('a database failure never blocks a payment: normal credits', async () => {
  const broken = { offer: async () => { throw new Error('down'); } };
  assert.deepEqual(await creditsForPayment({ cfg, store: broken, userId: U1, productId: PACK_999, credits: 90, transactionId: 'p', now: T0 }), { credits: 90, offer: null });
});

test('isActive: used or expired offers are not active', () => {
  const row = { expires_at: new Date(T0).toISOString(), used_at: null };
  assert.equal(isActive(row, T0 - 1), true);
  assert.equal(isActive(row, T0 + 1), false);
  assert.equal(isActive(row, T0 + 60000, 5), true);
  assert.equal(isActive({ ...row, used_at: 'x' }, T0 - 1), false);
  assert.equal(isActive(null, T0), false);
});

test('the endpoint needs a signed-in user and answers with the offer', async () => {
  const b = chatgptUser();
  const call = (headers, query) => handle({ httpMethod: 'GET', headers, queryStringParameters: query }, { fetchImpl: b.fetchImpl, env: ENV, now: T0 });
  assert.equal((await call({})).statusCode, 401);
  assert.equal((await call({ authorization: 'Bearer bad' })).statusCode, 401);
  assert.equal(JSON.parse((await call({ Authorization: 'Bearer good' })).body).pending, true);
  const ok = await call({ Authorization: 'Bearer good' }, { start: '1' });
  assert.equal(ok.statusCode, 200);
  assert.equal(JSON.parse(ok.body).active, true);
  assert.equal((await handle({ httpMethod: 'POST', headers: {} }, { fetchImpl: b.fetchImpl, env: ENV })).statusCode, 405);
});
