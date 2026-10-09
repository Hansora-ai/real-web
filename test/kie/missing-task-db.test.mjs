import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const uid = randomUUID();
before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.profiles (user_id uuid primary key, credits numeric);
    create table public.user_generations (
      id uuid primary key, user_id uuid, created_at timestamptz default now(),
      result_url text, meta jsonb
    );
    insert into profiles values ('${uid}', 10);
  `);
  await db.exec(await readFile(new URL('../../supabase/14_kie_missing_task_recovery.sql', import.meta.url), 'utf8'));
});
after(() => db.close());

async function seed(meta = {}, { age = 600, result = null, user = uid } = {}) {
  const id = randomUUID();
  await db.query(`insert into user_generations values ($1, $2, now() - make_interval(secs => $3), $4, $5)`,
    [id, user, age, result, { source: 'nano-banana-2', status: 'processing', task_id: null,
      charged: 'true', refund_amount: 0.5, ttl_secs: 200, ...meta }]);
  return id;
}
async function resolve(id) {
  return (await db.query('select resolve_kie_missing_task($1) as outcome', [id])).rows[0].outcome;
}
async function row(id) { return (await db.query('select * from user_generations where id=$1', [id])).rows[0]; }
async function credits() { return Number((await db.query('select credits from profiles where user_id=$1', [uid])).rows[0].credits); }

test('the reported charged/null-ID row fails and refunds exactly 0.5; retries pay once', async () => {
  const id = await seed({ run_id: 'reported-mcp-run', charged_cost: 0.5 });
  const initial = await credits();
  const responses = await Promise.all([resolve(id), resolve(id)]);
  assert.equal(responses.filter(r => r.refund_amount === 0.5).length, 1);
  assert.equal(await credits(), initial + 0.5);
  assert.equal((await row(id)).meta.status, 'failed');
  assert.equal((await row(id)).meta.refunded, true);
  assert.equal((await resolve(id)).status, 'ignored');
});

test('fresh submissions and longer TTLs wait; known tasks and non-KIE jobs are excluded', async () => {
  for (const [meta, options, expected] of [
    [{}, { age: 100 }, 'pending'], [{ ttl_secs: 900 }, { age: 600 }, 'pending'],
    [{ task_id: 'real-task' }, {}, 'ignored'], [{ taskId: 'camel-case-task' }, {}, 'ignored'],
    [{}, { result: 'https://result.test/image.png' }, 'ignored'],
    [{ source: 'byteplus' }, {}, 'ignored'], [{ source: 'replicate' }, {}, 'ignored'],
    [{ source: 'unlimited-queue', status: 'queued' }, {}, 'ignored'],
    [{ status: 'done' }, {}, 'ignored']
  ]) {
    const id = await seed(meta, options), initial = await credits();
    assert.equal((await resolve(id)).status, expected);
    assert.equal(await credits(), initial);
    await db.query('delete from user_generations where id=$1', [id]);
  }
});

test('uncharged, unlimited and already-refunded jobs fail without adding credits', async () => {
  for (const meta of [{ charged: false }, { subscription_unlimited: true, refund_amount: 0 },
    { refunded: true }, { refund_amount: 'bad' }, { refund_claim: 'legacy-claim' }]) {
    const id = await seed(meta), initial = await credits();
    assert.equal((await resolve(id)).status, 'failed');
    assert.equal(await credits(), initial);
  }
});

test('a refund write failure rolls back the failure marker, allowing a later retry', async () => {
  const id = await seed();
  await db.exec(`create function reject_refund() returns trigger language plpgsql as $$
    begin raise exception 'simulated database failure'; end; $$;
    create trigger reject_refund before update on profiles for each row execute function reject_refund();`);
  const initial = await credits();
  await assert.rejects(resolve(id), /simulated database failure/);
  assert.equal((await row(id)).meta.status, 'processing');
  assert.equal(await credits(), initial);
  await db.exec('drop trigger reject_refund on profiles; drop function reject_refund();');
  assert.equal((await resolve(id)).refunded, true);
  assert.equal(await credits(), initial + 0.5);
});

test('scheduled sweep repairs an offline backlog; bad profiles do not block other users', async () => {
  await db.exec('delete from user_generations');
  const missingUser = randomUUID();
  const broken = await seed({}, { user: missingUser });
  const first = await seed(), second = await seed({ source: 'nano-banana-2-lite', refund_amount: 0.2 });
  const initial = await credits();
  const outcome = (await db.query('select sweep_kie_missing_tasks(100) as outcome')).rows[0].outcome;
  assert.deepEqual(outcome, { checked: 3, failed: 2, refunded: 2, errors: 1 });
  assert.equal(await credits(), initial + 0.7);
  assert.equal((await row(broken)).meta.status, 'processing');
  assert.equal((await row(first)).meta.refunded, true);
  assert.equal((await row(second)).meta.refunded, true);
  await db.query('insert into profiles values ($1, 0)', [missingUser]);
  assert.equal((await resolve(broken)).refunded, true);
  assert.equal(await credits(), initial + 0.7);
});

test('RPCs cannot be called by browser roles', async () => {
  for (const role of ['anon', 'authenticated']) {
    const permissions = (await db.query(`select
      has_function_privilege($1, 'public.resolve_kie_missing_task(uuid)', 'execute') as single,
      has_function_privilege($1, 'public.sweep_kie_missing_tasks(integer)', 'execute') as batch`, [role])).rows[0];
    assert.deepEqual(permissions, { single: false, batch: false });
  }
});
