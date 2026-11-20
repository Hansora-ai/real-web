import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// The database helpers read these when they load, so they are set before the endpoints are imported.
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', HANSORA_AUTOMATION_INTERNAL_SECRET: 'x'.repeat(40), URL: 'https://hansora.test' });
const website = await import('../../lib/automation/website.mjs');
const { handler: chat } = await import('../../netlify/functions/automation-website-chat.mjs');
const { handler: setup } = await import('../../netlify/functions/automation-website-setup.mjs');

const BIZ = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const KEY = 'hw_0123456789abcdef01234567';
const VISITOR = 'v0123456789abcdef0123';

// ---------- a small stand-in for Supabase's REST API ----------
function fakeDb(seed = {}) {
  const tables = { automation_channel_connections: [], automation_businesses: [{ id: BIZ, name: 'Oak & Co', owner_user_id: OWNER }], automation_agents: [{ business_id: BIZ, primary_language: 'hy' }], automation_contacts: [], automation_conversations: [], automation_messages: [], automation_webhook_events: [], ...seed };
  const calls = []; let n = 0;
  const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const get = (row, key) => key.includes('->>') ? (row[key.split('->>')[0]] || {})[key.split('->>')[1]] : row[key];
  const match = (row, params) => [...params].every(([key, value]) => {
    if (['select', 'order', 'limit', 'on_conflict'].includes(key)) return true;
    const actual = get(row, key);
    if (value.startsWith('eq.')) return String(actual) === value.slice(3);
    if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(String(actual));
    if (value.startsWith('gt.')) return String(actual) > value.slice(3);
    return true;
  });
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  async function fetchImpl(url, init = {}) {
    const u = new URL(url); const method = init.method || 'GET'; const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ host: u.host, path: u.pathname, search: u.search, method, body, headers: init.headers || {} });
    if (u.host === 'hansora.test') return new Response('', { status: 202 });
    if (u.pathname === '/auth/v1/user') return init.headers.Authorization === 'Bearer good' ? reply(200, { id: OWNER }) : reply(401, {});
    const table = u.pathname.replace('/rest/v1/', ''); const rows = tables[table] ||= [];
    if (method === 'GET') { const limit = Number(u.searchParams.get('limit')) || 1000; const [col, dir] = String(u.searchParams.get('order') || '').split('.'); const found = rows.filter(row => match(row, u.searchParams)); if (col) found.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === 'desc' ? -1 : 1)); return reply(200, found.slice(0, limit)); }
    if (method === 'PATCH') { const hit = rows.filter(row => match(row, u.searchParams)); hit.forEach(row => Object.assign(row, body)); return reply(200, hit); }
    if (method === 'POST') {
      const items = Array.isArray(body) ? body : [body]; const out = [];
      const prefer = String(init.headers?.Prefer || '');
      const conflict = u.searchParams.get('on_conflict');
      for (const item of items) {
        const keys = conflict ? conflict.split(',') : ['idempotency_key', 'external_event_id'].filter(k => item[k]);
        const existing = keys.length ? rows.find(row => keys.every(k => row[k] === item[k])) : null;
        if (existing && prefer.includes('ignore-duplicates')) continue;
        if (existing) { Object.assign(existing, item); out.push(existing); continue; }
        const row = { id: id(), created_at: new Date().toISOString(), received_at: new Date().toISOString(), ai_enabled: true, ...item }; rows.push(row); out.push(row);
      }
      return reply(201, out);
    }
    return reply(404, {});
  }
  return { tables, calls, fetchImpl };
}
function withDb(db, fn) { return async () => { const real = globalThis.fetch; globalThis.fetch = db.fetchImpl; try { await fn(); } finally { globalThis.fetch = real; } }; }
const liveConnection = (settings = {}, status = 'connected') => ({ id: 'conn-1', business_id: BIZ, channel_type: 'website', status, settings: { widget_key: KEY, allowed_domains: ['myshop.am'], color: '#2563eb', title: 'Oak & Co', greeting: 'Hi!', ask_details: 'off', detail_fields: [], daily_limit: 500, ...settings } });
const ev = (method, { origin = 'https://www.myshop.am', body, query } = {}) => ({ httpMethod: method, headers: { origin, 'x-nf-client-connection-ip': '203.0.113.9' }, body: body ? JSON.stringify(body) : undefined, queryStringParameters: query || {}, rawUrl: 'https://hansora.test/.netlify/functions/automation-website-chat' });

// ---------- rules ----------
test('website addresses are cleaned and only listed websites (or their subdomains) may use the bubble', () => {
  assert.equal(website.normalizeDomain('https://www.MyShop.am/contact?x=1'), 'myshop.am');
  assert.equal(website.normalizeDomain('shop.example.co.uk:8080'), 'shop.example.co.uk');
  assert.equal(website.normalizeDomain('not a site'), '');
  assert.equal(website.normalizeDomain('javascript:alert(1)'), '');
  assert.equal(website.originAllowed('https://myshop.am', ['myshop.am']), true);
  assert.equal(website.originAllowed('https://blog.myshop.am', ['myshop.am']), true);
  assert.equal(website.originAllowed('https://myshop.am.evil.com', ['myshop.am']), false);
  assert.equal(website.originAllowed('https://evilmyshop.am', ['myshop.am']), false);
  assert.equal(website.originAllowed('', ['myshop.am']), false);
  assert.equal(website.originAllowed('https://hansora.co', [], { siteHost: 'hansora.co' }), true, 'owner preview on the Hansora site');
});

test('settings: the widget key is made once and never taken from the owner; values are checked', () => {
  const first = website.sanitizeSettings({ widget_key: 'hw_ffffffffffffffffffffffff', allowed_domains: 'myshop.am, https://www.other.com/ bad!site', color: 'red', ask_details: 'required', detail_fields: ['phone', 'hack'], daily_limit: 99999, reply_delay: 99, title: ' Oak\n&  Co ' });
  assert.match(first.widget_key, /^hw_[0-9a-f]{24}$/);
  assert.notEqual(first.widget_key, 'hw_ffffffffffffffffffffffff');
  assert.deepEqual(first.allowed_domains, ['myshop.am', 'other.com']);
  assert.equal(first.color, '#7c3aed');
  assert.deepEqual(first.detail_fields, ['phone']);
  assert.equal(first.daily_limit, 5000);
  assert.equal(first.reply_delay, 30);
  assert.equal(first.title, 'Oak & Co');
  assert.equal(website.sanitizeSettings({}, first).widget_key, first.widget_key, 'kept on later saves');
  assert.deepEqual(website.sanitizeSettings({ ask_details: 'off', detail_fields: ['name'] }).detail_fields, []);
  assert.deepEqual(website.sanitizeSettings({ ask_details: 'optional' }).detail_fields, ['name', 'phone'], 'sensible default fields');
});

test('the bubble gets nothing private', () => {
  const config = website.publicConfig({ widget_key: KEY, allowed_domains: ['myshop.am'], daily_limit: 500, color: '#2563eb' }, { businessName: 'Oak' });
  assert.equal(config.title, 'Oak');
  assert.equal('allowed_domains' in config || 'widget_key' in config || 'daily_limit' in config, false);
});

test('visitor details and limits', () => {
  assert.deepEqual(website.cleanDetails({ name: '  Ani ', phone: '+374 91 123456', email: 'ANI@Mail.am' }), { name: 'Ani', phone: '+374 91 123456', email: 'ani@mail.am' });
  assert.deepEqual(website.cleanDetails({ phone: 'call me', email: 'nope' }), { name: '', phone: '', email: '' });
  assert.equal(website.missingDetail({ ask_details: 'required', detail_fields: ['name', 'phone'] }, { name: 'Ani' }), 'phone');
  assert.equal(website.missingDetail({ ask_details: 'optional', detail_fields: ['phone'] }, {}), '');
  assert.equal(website.limitBreached({ visitorLastMinute: 8 }), 'too_fast');
  assert.equal(website.limitBreached({ businessToday: 50, dailyLimit: 50 }), 'business_daily_limit');
  assert.equal(website.limitBreached({ ipLastHour: 60 }), 'too_many_from_network');
  assert.equal(website.limitBreached({ visitorToday: 3 }), '');
  assert.equal(website.ipHash('203.0.113.9', 's').length, 32);
  assert.notEqual(website.ipHash('203.0.113.9', 's'), '203.0.113.9');
});

// ---------- public chat endpoint ----------
test('chat: unknown key, and a website that is not on the list, are refused', withDb(fakeDb({ automation_channel_connections: [liveConnection()] }), async () => {
  assert.equal((await chat(ev('GET', { query: { key: 'hw_ffffffffffffffffffffffff' } }))).statusCode, 404);
  const other = await chat(ev('GET', { origin: 'https://copycat.com', query: { key: KEY } }));
  assert.equal(other.statusCode, 403);
  assert.equal(other.headers['Access-Control-Allow-Origin'], undefined, 'the browser blocks it too');
}));

test('chat: the bubble gets its settings on an allowed website', withDb(fakeDb({ automation_channel_connections: [liveConnection()] }), async () => {
  const res = await chat(ev('GET', { query: { key: KEY, visitor: VISITOR } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://www.myshop.am');
  const body = JSON.parse(res.body);
  assert.equal(body.config.enabled, true);
  assert.equal(body.config.color, '#2563eb');
  assert.equal(body.config.language, 'hy');
  assert.equal(JSON.stringify(body).includes(KEY), false, 'the key is not sent back');
}));

test('chat: full message flow', async () => {
  const db = fakeDb({ automation_channel_connections: [liveConnection()] });
  await withDb(db, async () => {
    const res = await chat(ev('POST', { body: { key: KEY, visitor: VISITOR, message: 'Do you deliver to Gyumri?', client_id: 'c123456789', page: 'https://www.myshop.am/delivery' } }));
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).message.from, 'visitor');
    const message = db.tables.automation_messages[0];
    assert.equal(message.content, 'Do you deliver to Gyumri?');
    assert.equal(message.metadata.source, 'website');
    assert.equal(message.metadata.page, 'https://www.myshop.am/delivery');
    assert.match(message.metadata.ip_hash, /^[0-9a-f]{32}$/);
    assert.equal(JSON.stringify(db.tables).includes('203.0.113.9'), false, 'the network address itself is never stored');
    assert.equal(db.tables.automation_conversations[0].channel_type, 'website');
    assert.equal(db.tables.automation_contacts[0].display_name, 'Website visitor');
    const queued = db.tables.automation_webhook_events[0];
    assert.equal(queued.provider, 'website');
    assert.equal(queued.payload.message_id, message.id);
    const dispatch = db.calls.find(c => c.host === 'hansora.test');
    assert.equal(dispatch.path, '/.netlify/functions/automation-website-process-background');
    assert.equal(dispatch.headers['x-hansora-internal-secret'], 'x'.repeat(40));
    // The same message sent twice (a retry) is saved once.
    await chat(ev('POST', { body: { key: KEY, visitor: VISITOR, message: 'Do you deliver to Gyumri?', client_id: 'c123456789' } }));
    assert.equal(db.tables.automation_messages.length, 1);
    // The bubble sees its messages and the team's replies, and that a reply is coming.
    db.tables.automation_messages.push({ id: 'm-team', conversation_id: db.tables.automation_conversations[0].id, direction: 'outbound', sender_type: 'human', content_type: 'text', content: 'Yes, tomorrow!', status: 'sent', created_at: new Date(Date.now() + 1000).toISOString() });
    const poll = JSON.parse((await chat(ev('GET', { query: { key: KEY, visitor: VISITOR } }))).body);
    assert.deepEqual(poll.messages.map(m => [m.from, m.text]), [['visitor', 'Do you deliver to Gyumri?'], ['team', 'Yes, tomorrow!']]);
    assert.equal(poll.typing, true);
    const later = JSON.parse((await chat(ev('GET', { query: { key: KEY, visitor: VISITOR, after: poll.cursor } }))).body);
    assert.deepEqual(later.messages, [], 'only new messages after the cursor');
  })();
});

test('chat: an offline bubble takes no messages', withDb(fakeDb({ automation_channel_connections: [liveConnection({}, 'paused')] }), async () => {
  const res = await chat(ev('POST', { body: { key: KEY, visitor: VISITOR, message: 'hi' } }));
  assert.equal(res.statusCode, 409);
}));

test('chat: required details must be given first, then the chat works', async () => {
  const db = fakeDb({ automation_channel_connections: [liveConnection({ ask_details: 'required', detail_fields: ['name', 'phone'] })] });
  await withDb(db, async () => {
    const early = await chat(ev('POST', { body: { key: KEY, visitor: VISITOR, message: 'hi' } }));
    assert.equal(early.statusCode, 400);
    assert.equal(JSON.parse(early.body).field, 'name');
    const bad = await chat(ev('POST', { body: { key: KEY, visitor: VISITOR, action: 'details', details: { name: 'Ani', phone: 'nope' } } }));
    assert.equal(JSON.parse(bad.body).field, 'phone');
    const good = await chat(ev('POST', { body: { key: KEY, visitor: VISITOR, action: 'details', details: { name: 'Ani', phone: '+374 91 123456' } } }));
    assert.equal(good.statusCode, 200);
    assert.equal(db.tables.automation_contacts[0].display_name, 'Ani');
    assert.equal(db.tables.automation_contacts[0].primary_phone, '+374 91 123456');
    const now = await chat(ev('POST', { body: { key: KEY, visitor: VISITOR, message: 'hi', client_id: 'c999999999' } }));
    assert.equal(now.statusCode, 200, now.body);
  })();
});

test('chat: the business daily total stops spam', async () => {
  const conn = liveConnection({ daily_limit: 50 });
  const db = fakeDb({ automation_channel_connections: [conn], automation_messages: Array.from({ length: 50 }, (_, i) => ({ id: `old${i}`, business_id: BIZ, conversation_id: 'other', direction: 'inbound', metadata: { source: 'website' }, created_at: new Date().toISOString() })) });
  await withDb(db, async () => {
    const res = await chat(ev('POST', { body: { key: KEY, visitor: VISITOR, message: 'hi' } }));
    assert.equal(res.statusCode, 429);
    assert.equal(JSON.parse(res.body).error, 'business_daily_limit');
    assert.equal(db.calls.some(c => c.host === 'hansora.test'), false, 'no AI reply, no credits used');
  })();
});

// ---------- owner settings ----------
test('setup: only the owner, the key is made once, and going live needs a website', async () => {
  const db = fakeDb({ automation_channel_connections: [{ id: 'conn-1', business_id: BIZ, channel_type: 'website', setup_order: 8, status: 'not_connected', settings: {} }] });
  await withDb(db, async () => {
    const as = (token, body) => setup({ httpMethod: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ business_id: BIZ, ...body }) });
    assert.equal((await as('bad', { action: 'get' })).statusCode, 401);
    const got = JSON.parse((await as('good', { action: 'get' })).body);
    assert.match(got.settings.widget_key, /^hw_[0-9a-f]{24}$/);
    assert.equal(got.snippet, `<script src="https://hansora.test/chat.js" data-key="${got.settings.widget_key}" async></script>`);
    assert.equal(got.settings.title, 'Oak & Co');
    const noSite = await as('good', { action: 'live' });
    assert.equal(noSite.statusCode, 400);
    const saved = JSON.parse((await as('good', { action: 'save', settings: { allowed_domains: ['https://myshop.am'], widget_key: 'hw_ffffffffffffffffffffffff' } })).body);
    assert.equal(saved.settings.widget_key, got.settings.widget_key, 'key unchanged');
    assert.deepEqual(saved.settings.allowed_domains, ['myshop.am']);
    assert.equal(JSON.parse((await as('good', { action: 'live' })).body).status, 'connected');
    const emptied = JSON.parse((await as('good', { action: 'save', settings: { allowed_domains: [] } })).body);
    assert.equal(emptied.status, 'paused', 'no website left → paused');
  })();
});

// ---------- database migration ----------
test('migration adds the website channel everywhere and gives every AI employee the row', async () => {
  const pg = new PGlite();
  await pg.exec(`
    create schema automation;
    create table automation.automation_businesses (id uuid primary key);
    create table automation.automation_channel_connections (id uuid primary key default gen_random_uuid(), business_id uuid, channel_type text, setup_order smallint, status text default 'not_connected', settings jsonb default '{}', unique (business_id, channel_type),
      constraint automation_channel_connections_channel_type_check check (channel_type = any ('{instagram_comments,instagram_dm,messenger,phone,telegram,tiktok,whatsapp}'::text[])),
      constraint automation_channel_connections_setup_order_check check ((channel_type = 'tiktok' and setup_order = 7) or channel_type <> 'tiktok'));
    create table automation.automation_contacts (channel_type text constraint automation_contacts_channel_type_check check (channel_type = any ('{manual,telegram}'::text[])));
    create table automation.automation_conversations (channel_type text constraint automation_conversations_channel_type_check check (channel_type = any (array['telegram'::text, 'test'::text])));
    create table automation.automation_usage_events (channel_type text constraint automation_usage_events_channel_type_check check (channel_type = any ('{telegram,test}'::text[])));
    create table automation.automation_webhook_events (provider text constraint automation_webhook_events_provider_check check (provider = any ('{meta,telegram,tiktok}'::text[])));
    create table automation.automation_messages (id uuid, metadata jsonb, created_at timestamptz);
    insert into automation.automation_businesses values ('${BIZ}');`);
  const sql = await readFile(new URL('../../supabase/34_automation_website_chat.sql', import.meta.url), 'utf8');
  await pg.exec(sql);
  await pg.exec(sql); // safe to run twice
  const row = await pg.query(`select setup_order from automation.automation_channel_connections where business_id = '${BIZ}' and channel_type = 'website'`);
  assert.equal(row.rows[0].setup_order, 8);
  await pg.exec(`insert into automation.automation_contacts values ('website'); insert into automation.automation_conversations values ('website'); insert into automation.automation_usage_events values ('website'); insert into automation.automation_webhook_events values ('website');`);
  await pg.exec(`insert into automation.automation_contacts values ('manual'); insert into automation.automation_webhook_events values ('meta');`);
  await assert.rejects(pg.exec(`insert into automation.automation_contacts values ('fax')`));
  await pg.exec(`insert into automation.automation_businesses values ('33333333-3333-4333-8333-333333333333'); select automation.automation_add_new_channels() is null;`).catch(() => {}); // trigger function exists
  const fn = await pg.query(`select pg_get_functiondef('automation.automation_add_new_channels'::regproc) as def`);
  assert.match(fn.rows[0].def, /'website', 8/);
});
