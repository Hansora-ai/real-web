import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { runAutoTopups, handleAutoTopupWebhook, isAutoTopupEvent, chargeBody, checkoutBody, config, packFor } from '../../lib/business/auto-topup.mjs';
import { handle } from '../../netlify/functions/auto-topup.mjs';

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  DODO_PAYMENTS_API_KEY: 'dodo',
  DODO_PAYMENTS_BASE_URL: 'https://dodo.test',
  DODO_AUTO_TOPUP_PRODUCT_ID: 'pdt_auto',
  URL: 'https://site.test'
};
const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';

// A tiny stand-in for Supabase REST + Dodo: tables in memory, PostgREST-style eq filters, every request recorded.
function fakeBackend({ settings = [], charges = [], payments = [], due = [], dodo = () => ({ status: 200, body: { payment_id: 'pay_1' } }), user = { id: U1, email: 'a@b.co' } } = {}) {
  const tables = { auto_topups: settings.map((r) => ({ ...r })), auto_topup_charges: charges.map((r) => ({ ...r })), payments: payments.map((r) => ({ ...r })) };
  let nextId = 100;
  const calls = [];
  const matches = (row, params) => [...params].every(([k, v]) => {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) return true;
    if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
    if (v.startsWith('lt.')) return String(row[k]) < v.slice(3);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(row[k]));
    return true;
  });
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const method = init.method || 'GET';
    calls.push({ host: u.host, path: u.pathname, search: u.search, method, body });
    if (u.host === 'dodo.test') { const r = dodo(u.pathname, body, method); return reply(r.status, r.body); }
    if (u.pathname === '/auth/v1/user') return init.headers.Authorization === 'Bearer good' ? reply(200, user) : reply(401, {});
    if (u.pathname === '/rest/v1/rpc/auto_topup_due') return reply(200, due);
    const table = u.pathname.replace('/rest/v1/', '');
    const rows = tables[table];
    if (method === 'GET') return reply(200, rows.filter((r) => matches(r, u.searchParams)));
    if (method === 'PATCH') { const hit = rows.filter((r) => matches(r, u.searchParams)); hit.forEach((r) => Object.assign(r, body)); return reply(200, hit); }
    if (method === 'POST') {
      const out = [];
      for (const item of body) {
        if (table === 'auto_topup_charges') {
          if (item.status === 'charging' && rows.some((r) => r.user_id === item.user_id && r.status === 'charging')) return reply(409, { code: '23505' });
          const row = { id: nextId++, ...item }; rows.push(row); out.push(row);
        } else {
          const existing = rows.find((r) => r.user_id === item.user_id);
          if (existing) { Object.assign(existing, item); out.push(existing); } else { rows.push({ ...item }); out.push(item); }
        }
      }
      return reply(201, out);
    }
    return reply(404, {});
  }
  return { fetchImpl, tables, calls };
}

const activeRow = (extra = {}) => ({ user_id: U1, enabled: true, status: 'active', pack_credits: 90, threshold_credits: 30, subscription_id: 'sub_1', failures: 0, last_error: null, ...extra });
const dueRow = { user_id: U1, subscription_id: 'sub_1', pack_credits: 90, threshold_credits: 30, credits: 5 };

// ---------- SQL ----------

test('migration: who is due, one charge in flight, daily cap and retry wait', async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table public.profiles (user_id uuid primary key, credits numeric(12,1) default 0);`);
  await pg.exec(await readFile(new URL('../../supabase/migrations/20261111120000_auto_topup.sql', import.meta.url), 'utf8'));
  const due = async () => (await pg.query('select user_id::text from public.auto_topup_due(3, 6)')).rows.map((r) => r.user_id);
  await pg.exec(`insert into profiles values ('${U1}', 2.5), ('${U2}', 500);
    insert into auto_topups (user_id, enabled, status, pack_credits, threshold_credits, subscription_id) values
      ('${U1}', true, 'active', 90, 30, 'sub_1'), ('${U2}', true, 'active', 90, 30, 'sub_2');`);
  assert.deepEqual(await due(), [U1], 'only the person under their level');

  await pg.exec(`insert into auto_topup_charges (user_id, subscription_id, credits, amount_cents) values ('${U1}', 'sub_1', 90, 999)`);
  assert.deepEqual(await due(), [], 'nothing while a charge is in flight');
  await assert.rejects(pg.exec(`insert into auto_topup_charges (user_id, subscription_id, credits, amount_cents) values ('${U1}', 'sub_1', 90, 999)`), /duplicate key/);

  await pg.exec(`update auto_topup_charges set status = 'succeeded';
    insert into auto_topup_charges (user_id, subscription_id, credits, amount_cents, status) values ('${U1}', 'sub_1', 90, 999, 'succeeded'), ('${U1}', 'sub_1', 90, 999, 'succeeded');`);
  assert.deepEqual(await due(), [], 'three top-ups in 24 hours is the cap');
  await pg.exec(`update auto_topup_charges set created_at = now() - interval '25 hours'`);
  assert.deepEqual(await due(), [U1]);

  await pg.exec(`insert into auto_topup_charges (user_id, subscription_id, credits, amount_cents, status) values ('${U1}', 'sub_1', 90, 999, 'failed')`);
  assert.deepEqual(await due(), [], 'wait after a failed charge');
  await pg.exec(`update auto_topup_charges set created_at = now() - interval '7 hours' where status = 'failed'`);
  assert.deepEqual(await due(), [U1]);

  await pg.exec(`update auto_topups set enabled = false where user_id = '${U1}'`);
  assert.deepEqual(await due(), [], 'switched off');
});

// ---------- scheduled run ----------

test('run: charges the saved card for the pack, with the charge id in the metadata', async () => {
  const b = fakeBackend({ settings: [activeRow()], due: [dueRow] });
  const result = await runAutoTopups({ env: ENV, fetchImpl: b.fetchImpl });
  assert.equal(result.due, 1);
  const charge = b.calls.find((c) => c.host === 'dodo.test');
  assert.equal(charge.path, '/subscriptions/sub_1/charge');
  assert.equal(charge.body.product_price, 999);
  assert.deepEqual(charge.body.metadata, { uid: U1, auto_topup: '1', charge_id: '100' });
  assert.equal(b.tables.auto_topup_charges[0].payment_id, 'pay_1');
  assert.equal(b.tables.auto_topup_charges[0].status, 'charging', 'the webhook finishes it');
});

test('run: does nothing without the auto top-up product configured', async () => {
  const b = fakeBackend({ due: [dueRow] });
  assert.deepEqual(await runAutoTopups({ env: { ...ENV, DODO_AUTO_TOPUP_PRODUCT_ID: '' }, fetchImpl: b.fetchImpl }), { ok: false, skipped: 'not_configured' });
  assert.equal(b.calls.length, 0);
});

test('run: a declined card counts a failure; the third switches auto top-up off', async () => {
  const declined = () => ({ status: 422, body: { code: 'CARD_DECLINED' } });
  const b = fakeBackend({ settings: [activeRow({ failures: 1 })], due: [dueRow], dodo: declined });
  const notes = [];
  await runAutoTopups({ env: ENV, fetchImpl: b.fetchImpl, notify: async (t) => notes.push(t) });
  assert.equal(b.tables.auto_topup_charges[0].status, 'failed');
  assert.equal(b.tables.auto_topups[0].failures, 2);
  assert.equal(b.tables.auto_topups[0].enabled, true);
  b.tables.auto_topup_charges.length = 0;
  await runAutoTopups({ env: ENV, fetchImpl: b.fetchImpl, notify: async (t) => notes.push(t) });
  assert.equal(b.tables.auto_topups[0].failures, 3);
  assert.equal(b.tables.auto_topups[0].enabled, false);
  assert.equal(notes.length, 1);
});

test('run: a mandate that is gone switches off at once', async () => {
  const b = fakeBackend({ settings: [activeRow()], due: [dueRow], dodo: () => ({ status: 400, body: { code: 'SUBSCRIPTION_NOT_ON_DEMAND' } }) });
  await runAutoTopups({ env: ENV, fetchImpl: b.fetchImpl });
  assert.equal(b.tables.auto_topups[0].enabled, false);
});

test('run: Dodo still busy with an earlier payment is not a failure', async () => {
  const b = fakeBackend({ settings: [activeRow()], due: [dueRow], dodo: () => ({ status: 409, body: {} }) });
  await runAutoTopups({ env: ENV, fetchImpl: b.fetchImpl });
  assert.equal(b.tables.auto_topup_charges[0].status, 'expired');
  assert.equal(b.tables.auto_topups[0].failures, 0);
});

test('run: a Dodo outage leaves the charge in flight for the webhook or the 2-hour expiry', async () => {
  const b = fakeBackend({ settings: [activeRow()], due: [dueRow], dodo: () => ({ status: 503, body: {} }) });
  await runAutoTopups({ env: ENV, fetchImpl: b.fetchImpl });
  assert.equal(b.tables.auto_topup_charges[0].status, 'charging');
  assert.equal(b.tables.auto_topups[0].failures, 0);
});

test('run: skips when another run already started a charge for this person', async () => {
  const b = fakeBackend({ settings: [activeRow()], due: [dueRow], charges: [{ id: 1, user_id: U1, subscription_id: 'sub_1', credits: 90, amount_cents: 999, status: 'charging', created_at: new Date().toISOString() }] });
  const result = await runAutoTopups({ env: ENV, fetchImpl: b.fetchImpl });
  assert.equal(result.results[0].skipped, 'in_flight');
  assert.equal(b.calls.filter((c) => c.host === 'dodo.test').length, 0);
});

// ---------- webhook ----------

const pendingCharge = { id: 7, user_id: U1, subscription_id: 'sub_1', payment_id: null, credits: 90, amount_cents: 999, status: 'charging' };

test('webhook: payment.succeeded grants the credits on the charge row, never the payload', async () => {
  const b = fakeBackend({ settings: [activeRow({ failures: 2, last_error: 'x' })], charges: [pendingCharge] });
  const granted = [];
  const sales = [];
  const r = await handleAutoTopupWebhook({
    type: 'payment.succeeded', root: {}, data: { payment_id: 'pay_9', subscription_id: 'sub_1', total_amount: 999, currency: 'USD' },
    meta: { uid: U1, auto_topup: '1', charge_id: '7', credits: '99999' }, env: ENV, fetchImpl: b.fetchImpl,
    addCredits: async (a) => { granted.push(a); return { credited: true }; }, notifySale: async (s) => sales.push(s)
  });
  assert.equal(r.status, 200);
  assert.equal(granted.length, 1);
  assert.equal(granted[0].credits, 90);
  assert.equal(granted[0].transaction_id, 'pay_9');
  assert.equal(granted[0].creditBucket, 'payg');
  assert.equal(b.tables.auto_topup_charges[0].status, 'succeeded');
  assert.equal(b.tables.auto_topups[0].failures, 0);
  assert.equal(sales.length, 1);
});

test('webhook: a retried payment.succeeded does not fail or notify twice', async () => {
  const b = fakeBackend({ settings: [activeRow()], charges: [{ ...pendingCharge, status: 'succeeded', payment_id: 'pay_9' }] });
  const sales = [];
  const r = await handleAutoTopupWebhook({
    type: 'payment.succeeded', root: {}, data: { payment_id: 'pay_9' }, meta: { uid: U1, auto_topup: '1' }, env: ENV, fetchImpl: b.fetchImpl,
    addCredits: async () => ({ credited: false, reason: 'already credited' }), notifySale: async (s) => sales.push(s)
  });
  assert.equal(r.status, 200);
  assert.equal(sales.length, 0);
});

test('webhook: the card-saving checkout and unknown payments grant nothing', async () => {
  const b = fakeBackend();
  let called = false;
  const r = await handleAutoTopupWebhook({ type: 'payment.succeeded', root: {}, data: { payment_id: 'pay_x' }, meta: { uid: U1, auto_topup: '1' }, env: ENV, fetchImpl: b.fetchImpl, addCredits: async () => { called = true; } });
  assert.equal(r.status, 200);
  assert.equal(r.body.auto_topup, 'no_charge');
  assert.equal(called, false);
});

test('webhook: a charge id that belongs to someone else is refused', async () => {
  const b = fakeBackend({ charges: [pendingCharge] });
  const r = await handleAutoTopupWebhook({ type: 'payment.succeeded', root: {}, data: { payment_id: 'pay_9' }, meta: { uid: U2, auto_topup: '1', charge_id: '7' }, env: ENV, fetchImpl: b.fetchImpl, addCredits: async () => assert.fail('no credits') });
  assert.equal(r.status, 400);
});

test('webhook: a failed credit write asks Dodo to retry', async () => {
  const b = fakeBackend({ settings: [activeRow()], charges: [pendingCharge] });
  const r = await handleAutoTopupWebhook({ type: 'payment.succeeded', root: {}, data: { payment_id: 'pay_9' }, meta: { uid: U1, auto_topup: '1', charge_id: '7' }, env: ENV, fetchImpl: b.fetchImpl, addCredits: async () => ({ credited: false, reason: 'profiles update failed' }) });
  assert.equal(r.status, 500);
  assert.equal(b.tables.auto_topup_charges[0].status, 'charging');
});

test('webhook: payment.failed records the decline', async () => {
  const b = fakeBackend({ settings: [activeRow()], charges: [pendingCharge] });
  const r = await handleAutoTopupWebhook({ type: 'payment.failed', root: {}, data: { payment_id: 'pay_9', error_code: 'INSUFFICIENT_FUNDS' }, meta: { uid: U1, auto_topup: '1', charge_id: '7' }, env: ENV, fetchImpl: b.fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(b.tables.auto_topup_charges[0].status, 'failed');
  assert.equal(b.tables.auto_topups[0].failures, 1);
  assert.equal(b.tables.auto_topups[0].last_error, 'INSUFFICIENT_FUNDS');
});

test('webhook: subscription.active saves the card and keeps the chosen pack and level', async () => {
  const b = fakeBackend({ settings: [{ user_id: U1, enabled: false, status: 'pending', pack_credits: 510, threshold_credits: 100 }] });
  const r = await handleAutoTopupWebhook({ type: 'subscription.active', root: {}, data: { subscription_id: 'sub_5', customer: { customer_id: 'cus_1' } }, meta: { uid: U1, auto_topup: '1' }, env: ENV, fetchImpl: b.fetchImpl });
  assert.equal(r.status, 200);
  assert.deepEqual(
    (({ enabled, status, pack_credits, threshold_credits, subscription_id, customer_id }) => ({ enabled, status, pack_credits, threshold_credits, subscription_id, customer_id }))(b.tables.auto_topups[0]),
    { enabled: true, status: 'active', pack_credits: 510, threshold_credits: 100, subscription_id: 'sub_5', customer_id: 'cus_1' }
  );
});

test('webhook: subscription.cancelled switches off', async () => {
  const b = fakeBackend({ settings: [activeRow()] });
  await handleAutoTopupWebhook({ type: 'subscription.cancelled', root: {}, data: { subscription_id: 'sub_1' }, meta: { auto_topup: '1' }, env: ENV, fetchImpl: b.fetchImpl });
  assert.equal(b.tables.auto_topups[0].enabled, false);
  assert.equal(b.tables.auto_topups[0].status, 'cancelled');
});

test('events are recognised by metadata or by the auto top-up product', () => {
  assert.equal(isAutoTopupEvent({ meta: { auto_topup: '1' }, env: ENV }), true);
  assert.equal(isAutoTopupEvent({ productId: 'pdt_auto', env: ENV }), true);
  assert.equal(isAutoTopupEvent({ meta: { credits: '90' }, productId: 'pdt_other', env: ENV }), false);
  assert.equal(isAutoTopupEvent({ productId: null, env: {} }), false);
});

test('the Dodo webhook routes auto top-up events to their own handler', async () => {
  const b = fakeBackend({ settings: [{ user_id: U1, enabled: false, status: 'pending', pack_credits: 90, threshold_credits: 30 }] });
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  Object.assign(process.env, ENV, { DODO_WEBHOOK_SECRET: '' });
  globalThis.fetch = b.fetchImpl;
  try {
    const { handler } = await import('../../netlify/functions/dodo-webhook.mjs');
    const res = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ type: 'subscription.active', data: { subscription_id: 'sub_8', product_id: 'pdt_auto', metadata: { uid: U1, auto_topup: '1' } } }) });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).auto_topup, 'card_saved');
    assert.equal(b.tables.auto_topups[0].subscription_id, 'sub_8');
  } finally {
    globalThis.fetch = realFetch;
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

// ---------- customer endpoint ----------

test('endpoint: signed out is refused', async () => {
  const b = fakeBackend();
  assert.equal((await handle({ httpMethod: 'GET', headers: {} }, { env: ENV, fetchImpl: b.fetchImpl })).statusCode, 401);
  assert.equal((await handle({ httpMethod: 'GET', headers: { authorization: 'Bearer bad' } }, { env: ENV, fetchImpl: b.fetchImpl })).statusCode, 401);
});

test('endpoint: first setup opens a card-saving checkout with nothing charged', async () => {
  const b = fakeBackend({ dodo: () => ({ status: 200, body: { session_id: 'cks_1', checkout_url: 'https://checkout.test/x' } }) });
  const res = await handle({ httpMethod: 'POST', headers: { Authorization: 'Bearer good' }, body: JSON.stringify({ action: 'setup', pack_credits: 200, threshold_credits: 50, return_path: '/profile_ru.html' }) }, { env: ENV, fetchImpl: b.fetchImpl });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(JSON.parse(res.body).checkout_url, 'https://checkout.test/x');
  const checkout = b.calls.find((c) => c.host === 'dodo.test');
  assert.equal(checkout.path, '/checkouts');
  assert.deepEqual(checkout.body.subscription_data, { on_demand: { mandate_only: true } });
  assert.deepEqual(checkout.body.metadata, { uid: U1, auto_topup: '1' });
  assert.equal(checkout.body.return_url, 'https://site.test/profile_ru.html?auto_topup=saved');
  assert.deepEqual(checkout.body.product_cart, [{ product_id: 'pdt_auto', quantity: 1 }]);
  assert.equal(checkout.body.minimal_address, true, 'short form: no street address');
  assert.deepEqual(checkout.body.feature_flags, { allow_phone_number_collection: false, allow_discount_code: false });
  assert.equal(b.tables.auto_topups[0].status, 'pending');
  assert.equal(b.tables.auto_topups[0].pack_credits, 200);
});

test('endpoint: with a saved card, setup switches on without a checkout', async () => {
  const b = fakeBackend({ settings: [activeRow({ enabled: false, failures: 3, last_error: 'CARD_DECLINED' })] });
  const res = await handle({ httpMethod: 'POST', headers: { Authorization: 'Bearer good' }, body: JSON.stringify({ action: 'setup', pack_credits: 1050, threshold_credits: 100 }) }, { env: ENV, fetchImpl: b.fetchImpl });
  const out = JSON.parse(res.body);
  assert.equal(out.checkout_url, undefined);
  assert.equal(out.settings.enabled, true);
  assert.equal(out.settings.pack_credits, 1050);
  assert.equal(out.settings.failures, 0);
  assert.equal(b.calls.filter((c) => c.path === '/checkouts').length, 0, 'no checkout');
});

test('endpoint: only the listed packs and levels are accepted', async () => {
  const b = fakeBackend();
  const post = (body) => handle({ httpMethod: 'POST', headers: { Authorization: 'Bearer good' }, body: JSON.stringify(body) }, { env: ENV, fetchImpl: b.fetchImpl });
  assert.equal((await post({ action: 'setup', pack_credits: 5, threshold_credits: 30 })).statusCode, 400);
  assert.equal((await post({ action: 'setup', pack_credits: 90, threshold_credits: 7 })).statusCode, 400);
  assert.equal((await post({ action: 'nope' })).statusCode, 400);
});

test('endpoint: off keeps the card; remove_card cancels the Dodo mandate', async () => {
  const b = fakeBackend({ settings: [activeRow()], dodo: () => ({ status: 200, body: {} }) });
  const post = (body) => handle({ httpMethod: 'POST', headers: { Authorization: 'Bearer good' }, body: JSON.stringify(body) }, { env: ENV, fetchImpl: b.fetchImpl });
  let out = JSON.parse((await post({ action: 'off' })).body);
  assert.equal(out.settings.enabled, false);
  assert.equal(out.settings.card_saved, true);
  out = JSON.parse((await post({ action: 'remove_card' })).body);
  assert.equal(out.settings.card_saved, false);
  const cancel = b.calls.find((c) => c.host === 'dodo.test' && c.method === 'PATCH');
  assert.equal(cancel.method, 'PATCH');
  assert.equal(cancel.path, '/subscriptions/sub_1');
});

test('packs match the Creative packs sold today', () => {
  assert.deepEqual([packFor(90), packFor(200), packFor(510), packFor(1050)].map((p) => p.amount_cents), [999, 1999, 4999, 9999]);
  assert.equal(packFor(91), null);
  assert.match(chargeBody({ userId: U1, chargeId: 1, pack: packFor(200) }).product_description, /2,000 credits/);
  assert.equal(checkoutBody({ cfg: config(ENV), userId: U1, email: null }).customer, undefined);
});

// ---------- pricing button, owner view ----------

test('endpoint: tells the pricing page whether the person has ever paid', async () => {
  const get = async (payments) => JSON.parse((await handle({ httpMethod: 'GET', headers: { Authorization: 'Bearer good' } }, { env: ENV, fetchImpl: fakeBackend({ payments }).fetchImpl })).body).has_purchase;
  assert.equal(await get([]), false);
  assert.equal(await get([{ transaction_id: 't1', uid: U2, status: 'succeeded' }]), false, 'someone else\'s payment');
  assert.equal(await get([{ transaction_id: 't1', uid: U1, status: null }]), false, 'unfinished payment');
  assert.equal(await get([{ transaction_id: 't1', uid: U1, status: 'succeeded' }]), true);
});

test('endpoint: a checkout from the pricing page comes back to the pricing page', async () => {
  const b = fakeBackend({ dodo: () => ({ status: 200, body: { checkout_url: 'https://checkout.test/x' } }) });
  await handle({ httpMethod: 'POST', headers: { Authorization: 'Bearer good' }, body: JSON.stringify({ action: 'setup', pack_credits: 90, threshold_credits: 30, return_path: '/pricing_arm.html' }) }, { env: ENV, fetchImpl: b.fetchImpl });
  assert.equal(b.calls.find((c) => c.host === 'dodo.test').body.return_url, 'https://site.test/pricing_arm.html?auto_topup=saved');
  const b2 = fakeBackend({ dodo: () => ({ status: 200, body: { checkout_url: 'https://checkout.test/x' } }) });
  await handle({ httpMethod: 'POST', headers: { Authorization: 'Bearer good' }, body: JSON.stringify({ action: 'setup', return_path: 'https://evil.test/' }) }, { env: ENV, fetchImpl: b2.fetchImpl });
  assert.equal(b2.calls.find((c) => c.host === 'dodo.test').body.return_url, 'https://site.test/profile.html?auto_topup=saved');
});

test('owner report: who set it up and which payments were auto top-ups', async () => {
  const { autoTopupReport } = await import('../../lib/business/auto-topup.mjs');
  const r = autoTopupReport({
    settings: [activeRow({ created_at: '2026-11-01T00:00:00Z' }), { user_id: U2, enabled: false, status: 'pending', pack_credits: 200, threshold_credits: 50 }],
    charges: [
      { user_id: U1, credits: 90, amount_cents: 999, status: 'succeeded', payment_id: 'pay_1', created_at: '2026-11-10T00:00:00Z' },
      { user_id: U1, credits: 90, amount_cents: 999, status: 'failed', error: 'CARD_DECLINED', created_at: '2026-11-09T00:00:00Z' }
    ],
    emails: { [U1]: 'a@b.co' }
  });
  assert.deepEqual(r.totals, { switched_on: 1, set_up: 1, checkout_not_finished: 1, topups: 1, topup_usd: 9.99, failed: 1 });
  assert.equal(r.people[0].email, 'a@b.co');
  assert.equal(r.people[0].pack_credits, 900);
  assert.equal(r.people[1].state, 'card not saved');
  assert.deepEqual([...r.payment_ids], ['pay_1']);
});

test('owner Telegram sale message says when it was an auto top-up', async () => {
  const { saleMessage } = await import('../../lib/business/sale-alert.mjs');
  assert.match(saleMessage({ provider: 'dodo', amountCents: 999, currency: 'USD', credits: 90, autoTopup: true }), /Dodo · 🔁 auto top-up/);
  assert.doesNotMatch(saleMessage({ provider: 'dodo', amountCents: 999, currency: 'USD', credits: 90 }), /auto top-up/);
});

test('the product setting accepts the bare id or a pasted checkout link', async () => {
  const { productIdFrom } = await import('../../lib/business/auto-topup.mjs');
  assert.equal(productIdFrom('pdt_0Nrj7SN523dHTfHDFo3tE'), 'pdt_0Nrj7SN523dHTfHDFo3tE');
  assert.equal(productIdFrom(' https://checkout.dodopayments.com/buy/pdt_0Nrj7SN523dHTfHDFo3tE?quantity=1 '), 'pdt_0Nrj7SN523dHTfHDFo3tE');
  assert.equal(productIdFrom(''), '');
  assert.equal(config({ ...ENV, DODO_AUTO_TOPUP_PRODUCT_ID: 'https://checkout.dodopayments.com/buy/pdt_X1?quantity=1' }).productId, 'pdt_X1');
  assert.equal(isAutoTopupEvent({ productId: 'pdt_X1', env: { DODO_AUTO_TOPUP_PRODUCT_ID: 'https://checkout.dodopayments.com/buy/pdt_X1?quantity=1' } }), true);
});

// ---------- card saved but the webhook never arrived ----------

const pendingRow = { user_id: U1, enabled: false, status: 'pending', pack_credits: 200, threshold_credits: 50, subscription_id: null, failures: 0 };
const subsReply = (items) => (path, body, method) => path === '/subscriptions' ? { status: 200, body: { items } } : { status: 200, body: { checkout_url: 'https://checkout.test/again' } };

test('endpoint: a card saved at Dodo is found even without the webhook, by uid in metadata', async () => {
  const b = fakeBackend({ settings: [pendingRow], dodo: subsReply([{ subscription_id: 'sub_other', metadata: { uid: U2 }, customer: { email: 'x@y.co' } }, { subscription_id: 'sub_mine', metadata: { uid: U1 }, customer: { customer_id: 'cus_9', email: 'a@b.co' } }]) });
  const out = JSON.parse((await handle({ httpMethod: 'GET', headers: { Authorization: 'Bearer good' } }, { env: ENV, fetchImpl: b.fetchImpl })).body);
  assert.equal(out.settings.enabled, true);
  assert.equal(out.settings.card_saved, true);
  assert.equal(out.settings.pack_credits, 200, 'keeps the chosen pack');
  assert.equal(b.tables.auto_topups[0].subscription_id, 'sub_mine');
  const lookup = b.calls.find((c) => c.host === 'dodo.test');
  assert.match(lookup.search, /product_id=pdt_auto/);
});

test('endpoint: falls back to the account email when the subscription has no uid', async () => {
  const b = fakeBackend({ settings: [pendingRow], dodo: subsReply([{ subscription_id: 'sub_mail', metadata: {}, customer: { email: 'A@B.co' } }]) });
  const out = JSON.parse((await handle({ httpMethod: 'GET', headers: { Authorization: 'Bearer good' } }, { env: ENV, fetchImpl: b.fetchImpl })).body);
  assert.equal(out.settings.card_saved, true);
  assert.equal(b.tables.auto_topups[0].subscription_id, 'sub_mail');
});

test('endpoint: a cancelled subscription at Dodo is not treated as a saved card', async () => {
  const b = fakeBackend({ settings: [pendingRow], dodo: subsReply([{ subscription_id: 'sub_old', status: 'cancelled', metadata: { uid: U1 } }]) });
  const out = JSON.parse((await handle({ httpMethod: 'GET', headers: { Authorization: 'Bearer good' } }, { env: ENV, fetchImpl: b.fetchImpl })).body);
  assert.equal(out.settings.card_saved, false);
});

test('endpoint: turning on again with a card saved at Dodo does not open a second checkout', async () => {
  const b = fakeBackend({ settings: [pendingRow], dodo: subsReply([{ subscription_id: 'sub_mine', metadata: { uid: U1 } }]) });
  const out = JSON.parse((await handle({ httpMethod: 'POST', headers: { Authorization: 'Bearer good' }, body: JSON.stringify({ action: 'setup', pack_credits: 90, threshold_credits: 30 }) }, { env: ENV, fetchImpl: b.fetchImpl })).body);
  assert.equal(out.checkout_url, undefined);
  assert.equal(out.settings.enabled, true);
  assert.equal(out.settings.pack_credits, 90);
  assert.equal(b.calls.filter((c) => c.path === '/checkouts').length, 0);
});

test('endpoint: no saved card at Dodo still opens the checkout', async () => {
  const b = fakeBackend({ settings: [pendingRow], dodo: subsReply([]) });
  const out = JSON.parse((await handle({ httpMethod: 'POST', headers: { Authorization: 'Bearer good' }, body: JSON.stringify({ action: 'setup', pack_credits: 90, threshold_credits: 30 }) }, { env: ENV, fetchImpl: b.fetchImpl })).body);
  assert.equal(out.checkout_url, 'https://checkout.test/again');
});

test('webhook: the $0 card-saving payment also switches auto top-up on', async () => {
  const b = fakeBackend({ settings: [pendingRow] });
  const r = await handleAutoTopupWebhook({ type: 'payment.succeeded', root: {}, data: { payment_id: 'pay_0', subscription_id: 'sub_7', total_amount: 0, customer: { customer_id: 'cus_7' } }, meta: { uid: U1, auto_topup: '1' }, env: ENV, fetchImpl: b.fetchImpl, addCredits: async () => assert.fail('no credits for the $0 payment') });
  assert.equal(r.body.auto_topup, 'card_saved');
  assert.equal(b.tables.auto_topups[0].enabled, true);
  assert.equal(b.tables.auto_topups[0].subscription_id, 'sub_7');
});

test('endpoint: shows the saved card as network and last 4 digits only', async () => {
  const dodo = (path) => {
    if (path === '/subscriptions/sub_1') return { status: 200, body: { subscription_id: 'sub_1', payment_method_id: 'pm_2', customer: { customer_id: 'cus_1' } } };
    if (path === '/customers/cus_1/payment-methods') return { status: 200, body: { items: [
      { payment_method_id: 'pm_1', payment_method: 'card', card: { last4_digits: '1111', card_network: 'MASTERCARD' } },
      { payment_method_id: 'pm_2', payment_method: 'card', card: { last4_digits: '4242', card_network: 'VISA', expiry_month: '4', expiry_year: '2029' } }
    ] } };
    return { status: 404, body: {} };
  };
  const b = fakeBackend({ settings: [activeRow({ customer_id: 'cus_1' })], dodo });
  const out = JSON.parse((await handle({ httpMethod: 'GET', headers: { Authorization: 'Bearer good' } }, { env: ENV, fetchImpl: b.fetchImpl })).body);
  assert.deepEqual(out.settings.card, { brand: 'VISA', last4: '4242', exp_month: '04', exp_year: '29' });
});

test('endpoint: works without card details when Dodo does not give them', async () => {
  const b = fakeBackend({ settings: [activeRow()], dodo: () => ({ status: 502, body: {} }) });
  const res = await handle({ httpMethod: 'GET', headers: { Authorization: 'Bearer good' } }, { env: ENV, fetchImpl: b.fetchImpl });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).settings.card, null);
});
