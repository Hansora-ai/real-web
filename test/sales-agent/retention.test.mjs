import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { CHAT_RETENTION_MS, chatCutoff, memoryExpiry, retainedSession } from '../../lib/sales-agent/retention.mjs';

const now = Date.parse('2026-10-12T20:00:00Z');

test('memory expires at the boundary, regardless of recent session activity', () => {
  const session = { summary: 'old request', sales_memory: { main_goal: 'old goal' },
    summary_through_sequence: 12, updated_at: new Date(now).toISOString(),
    memory_expires_at: new Date(now).toISOString() };
  assert.deepEqual(retainedSession(session, now).sales_memory, {});
  assert.equal(retainedSession(session, now).summary, '');
  assert.equal(retainedSession(session, now).summary_through_sequence, 0);
  assert.equal(session.summary, 'old request');
  assert.equal(retainedSession({ ...session, memory_expires_at: new Date(now + 1).toISOString() }, now).summary, 'old request');
  assert.equal(retainedSession({ ...session, memory_expires_at: undefined }, now).summary, '');
  assert.equal(retainedSession({ ...session, memory_expires_at: 'invalid' }, now).summary, '');
});

test('new activity cannot prolong memory or derived copies of older messages', () => {
  const prior = { memory_expires_at: new Date(now + 3600000).toISOString() };
  const history = [{ created_at: new Date(now - CHAT_RETENTION_MS + 1000).toISOString() }];
  assert.equal(memoryExpiry(prior, history, now), new Date(now + 1000).toISOString());
  assert.equal(memoryExpiry(prior, [], now), prior.memory_expires_at);
  assert.equal(memoryExpiry({ memory_expires_at: new Date(now - 1).toISOString() }, [], now), new Date(now + CHAT_RETENTION_MS).toISOString());
  assert.equal(chatCutoff(now), '2026-09-28T20:00:00.000Z');
});

test('production SQL removes expired content, preserves related records and allows subsequent messages', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('./fixtures/chat-schema.sql', import.meta.url), 'utf8'));
    // Only the extension declaration is skipped. Purge DDL and SQL run unchanged.
    const migration = (await readFile(new URL('../../supabase/17_website_chat_retention.sql', import.meta.url), 'utf8'))
      .replace('create extension if not exists pg_cron;', '');
    await db.exec(`insert into auth.users values ('11111111-1111-4111-8111-111111111111');
      insert into chat_sessions(id, user_id, summary, sales_memory, created_at, updated_at) values
      ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
       'old summary','{"main_goal":"old"}', now() - interval '30 days',now());`);
    await db.exec(migration);
    assert.equal((await db.query(`select memory_expires_at <= now() as expired from chat_sessions`)).rows[0].expired, true);
    await db.exec(`begin;
      insert into chat_sessions(id,user_id,summary,sales_memory,memory_expires_at) values
      ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',
       'recent summary','{"main_goal":"recent"}',now() + interval '1 day');
      insert into chat_messages(id,session_id,sequence,request_id,role,content,response_json,human_correction,created_at) values
      ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222',1,gen_random_uuid(),'user','old customer request',null,'old correction',now() - interval '14 days 1 millisecond'),
      ('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222',2,gen_random_uuid(),'assistant','old reply','{"message":"old reply"}',null,now() - interval '20 days'),
      ('66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222',3,gen_random_uuid(),'user','boundary',null,null,now() - interval '14 days'),
      ('77777777-7777-4777-8777-777777777777','22222222-2222-4222-8222-222222222222',4,gen_random_uuid(),'assistant','recent',null,null,now());
      insert into ai_usage_logs(session_id,message_id) values ('22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555');
      insert into chat_events(session_id,message_id) values ('22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555');
      insert into chat_purchase_attributions(session_id,message_id) values ('22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555');`);
    const result = (await db.query('select public.purge_website_chat_content() as result')).rows[0].result;
    assert.deepEqual(result, { deleted_messages: 2, cleared_memories: 1 });
    assert.deepEqual((await db.query('select content from chat_messages order by sequence')).rows.map(row => row.content), ['boundary', 'recent']);
    const sessions = (await db.query('select summary, sales_memory from chat_sessions order by id')).rows;
    assert.deepEqual(sessions, [{ summary: '', sales_memory: {} }, { summary: 'recent summary', sales_memory: { main_goal: 'recent' } }]);
    for (const table of ['ai_usage_logs', 'chat_events', 'chat_purchase_attributions']) {
      const row = (await db.query(`select session_id, message_id from ${table}`)).rows[0];
      assert.equal(row.session_id, '22222222-2222-4222-8222-222222222222');
      assert.equal(row.message_id, null);
    }
    assert.deepEqual((await db.query('select public.purge_website_chat_content() as result')).rows[0].result, { deleted_messages: 0, cleared_memories: 0 });
    assert.equal((await db.query(`select (public.append_chat_message('22222222-2222-4222-8222-222222222222',gen_random_uuid(),'user','next')).sequence as sequence`)).rows[0].sequence, 5);
    await db.exec(`insert into chat_messages(session_id,sequence,request_id,role,content,created_at)
      select '22222222-2222-4222-8222-222222222222', 10 + n, gen_random_uuid(), 'user', 'expired batch', now() - interval '30 days'
      from generate_series(1,5001) n;`);
    assert.equal((await db.query('select public.purge_website_chat_content() as result')).rows[0].result.deleted_messages, 5000);
    assert.equal((await db.query('select public.purge_website_chat_content() as result')).rows[0].result.deleted_messages, 1);
    await db.exec('commit;');
    await db.exec(migration);
    assert.equal((await db.query('select count(*)::int as count from cron.job')).rows[0].count, 1);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal((await db.query(`select has_function_privilege('${role}', 'public.purge_website_chat_content()', 'EXECUTE') as allowed`)).rows[0].allowed, false);
    }
  } finally { await db.close(); }
});

test('history query filters by message creation time and memory writes keep the earliest deadline', async () => {
  const priorUrl = process.env.SUPABASE_URL;
  const priorKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://database.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  const originalFetch = globalThis.fetch;
  const { getMessages, updateSessionMemory, ensureSession } = await import('../../lib/sales-agent/store.mjs');
  try {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url: new URL(url), options });
      return { ok: true, text: async () => JSON.stringify(options.method === 'PATCH' ? [{}] : [{ sequence: 2 }, { sequence: 1 }]) };
    };
    const before = Date.now();
    assert.deepEqual((await getMessages('s1', 200)).map(row => row.sequence), [1, 2]);
    const cutoff = Date.parse(calls[0].url.searchParams.get('created_at').slice(4));
    assert(cutoff >= before - CHAT_RETENTION_MS && cutoff <= Date.now() - CHAT_RETENTION_MS);
    assert.equal(calls[0].url.searchParams.get('limit'), '100');
    const earliest = new Date(Date.now() - CHAT_RETENTION_MS + 60000).toISOString();
    await updateSessionMemory({ id: 's1', sales_memory: { main_goal: 'expired goal' } }, 'new request', { message: 'new reply', memory: {}, language: 'en' }, 3, [{ created_at: earliest }]);
    const written = JSON.parse(calls[1].options.body);
    assert.equal(written.sales_memory.main_goal, null);
    assert.equal(Date.parse(written.memory_expires_at), Date.parse(earliest) + CHAT_RETENTION_MS);
    const id = '22222222-2222-4222-8222-222222222222';
    globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify([{
      id, user_id: 'owner', language: 'en', summary: 'expired private request',
      sales_memory: { main_goal: 'expired goal' }, memory_expires_at: new Date(Date.now() - 1).toISOString()
    }]) });
    const session = await ensureSession({ user: { id: 'owner' }, anonymous: {}, requestedSessionId: id, language: 'en' });
    assert.equal(session.summary, '');
    assert.deepEqual(session.sales_memory, {});
  } finally {
    globalThis.fetch = originalFetch;
    if (priorUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = priorUrl;
    if (priorKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = priorKey;
  }
});
