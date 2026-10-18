import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const alice = randomUUID(), bob = randomUUID();
const migration = await readFile(new URL('../../supabase/18_user_feedback.sql', import.meta.url), 'utf8');
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    insert into auth.users values ('${alice}', 'alice@example.test'), ('${bob}', null);`);
  await db.exec(migration);
  await db.exec(migration);
});
after(() => db.close());
async function asUser(id, sql, values = []) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id || '']);
  await db.exec(`set role ${id ? 'authenticated' : 'anon'}`);
  try { return await db.query(sql, values); } finally { await db.exec('reset role'); }
}
const send = (user, id, message, path = '/index.html', lang = 'en') => asUser(user, 'select public.submit_user_feedback($1,$2,$3,$4) as id', [id, message, path, lang]);
test('identity/email come from Auth, retries save once, multilingual text stays intact', async () => {
  const id = randomUUID(), message = '  Спасибо։ Հայերեն feedback <script> is plain text\nSecond line  ';
  assert.equal((await send(alice, id, message, '/index_arm.html', 'hy')).rows[0].id, id);
  assert.equal((await send(alice, id, message)).rows[0].id, id);
  const rows = (await db.query('select * from user_feedback where id=$1', [id])).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].user_id, alice); assert.equal(rows[0].email, 'alice@example.test');
  assert.equal(rows[0].message, message.trim()); assert.equal(rows[0].language, 'hy');
  await assert.rejects(send(bob, id, message), /FEEDBACK_REQUEST_CONFLICT/);
});
test('anonymous callers and direct table access are rejected', async () => {
  await assert.rejects(send(null, randomUUID(), 'anonymous'), /permission denied/);
  for (const user of [alice, bob]) {
    for (const sql of ['select * from public.user_feedback', "insert into public.user_feedback (id,message) values (gen_random_uuid(),'forged')", "update public.user_feedback set message='changed'", 'delete from public.user_feedback']) {
      await assert.rejects(asUser(user, sql), /permission denied/);
    }
  }
});
test('blank, oversized and invalid context submissions do not save', async () => {
  for (const text of ['', ' \n\t ', 'a'.repeat(5001), null]) await assert.rejects(send(alice, randomUUID(), text), /FEEDBACK_INVALID_MESSAGE/);
  await assert.rejects(send(alice, null, 'valid'), /FEEDBACK_INVALID_MESSAGE/);
  await assert.rejects(send(alice, randomUUID(), 'valid', '/'.repeat(501)), /FEEDBACK_INVALID_CONTEXT/);
  await assert.rejects(send(alice, randomUUID(), 'valid', '/', 'fr'), /FEEDBACK_INVALID_CONTEXT/);
});
test('accounts without email still submit; email updates are reflected; ten per hour limit is enforced', async () => {
  const id = randomUUID(); await send(bob, id, 'No email account');
  assert.equal((await db.query('select email from user_feedback where id=$1',[id])).rows[0].email, null);
  await db.query('update auth.users set email=$1 where id=$2', ['new@example.test', bob]);
  for (let i=0;i<9;i++) await send(bob, randomUUID(), 'Another message '+i);
  await assert.rejects(send(bob, randomUUID(), 'one too many'), /FEEDBACK_RATE_LIMITED/);
  assert.equal((await send(bob,id,'No email account')).rows[0].id,id);
  assert.equal((await db.query('select count(*)::int as n from user_feedback where email=$1',['new@example.test'])).rows[0].n,9);
});
