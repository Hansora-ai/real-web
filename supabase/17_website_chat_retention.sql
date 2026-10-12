-- Website assistant content only. Applying this enables permanent hourly cleanup.
-- Preview counts first; merge/deploy the application change, then apply this SQL.
begin;

create extension if not exists pg_cron;

alter table public.chat_sessions
  add column if not exists memory_expires_at timestamptz;

-- Legacy memory has no source timestamps. Session creation is a conservative
-- lower bound: later activity must not renew indefinitely retained preferences.
update public.chat_sessions
set memory_expires_at = created_at + interval '14 days'
where memory_expires_at is null
  and (summary <> '' or sales_memory <> '{}'::jsonb);

create index if not exists chat_messages_retention_created_idx
  on public.chat_messages (created_at, id);
create index if not exists chat_sessions_memory_expiry_idx
  on public.chat_sessions (memory_expires_at)
  where memory_expires_at is not null;

create or replace function public.purge_website_chat_content()
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_messages bigint := 0;
  v_memories bigint := 0;
begin
  -- Bound each run and avoid overlapping manual and scheduled invocations.
  perform pg_catalog.set_config('lock_timeout', '2s', true);
  if not pg_catalog.pg_try_advisory_xact_lock(173014, 14) then
    return pg_catalog.jsonb_build_object('skipped', true);
  end if;

  with expired as (
    select id from public.chat_sessions
    where memory_expires_at <= now()
      and (summary <> '' or sales_memory <> '{}'::jsonb
        or summary_through_sequence <> 0)
    order by memory_expires_at, id
    limit 5000
    for update skip locked
  )
  update public.chat_sessions s
  set summary = '', sales_memory = '{}'::jsonb, summary_through_sequence = 0
  from expired e where s.id = e.id;
  get diagnostics v_memories = row_count;

  with expired as (
    select id from public.chat_messages
    where created_at < now() - interval '14 days'
    order by created_at, id
    limit 5000
    for update skip locked
  )
  delete from public.chat_messages m using expired e where m.id = e.id;
  get diagnostics v_messages = row_count;

  -- Verified production FKs use ON DELETE SET NULL for message references
  -- in usage, events and purchase attribution. Session rows are retained.
  return pg_catalog.jsonb_build_object(
    'deleted_messages', v_messages, 'cleared_memories', v_memories
  );
end;
$function$;

-- Only the database owner running Cron may call this destructive routine.
revoke all on function public.purge_website_chat_content() from public, anon, authenticated, service_role;

-- Re-running this migration replaces the same named job, without duplicates.
select cron.schedule(
  'website-chat-content-retention-14d',
  '17 * * * *',
  $$select public.purge_website_chat_content();$$
);

commit;
