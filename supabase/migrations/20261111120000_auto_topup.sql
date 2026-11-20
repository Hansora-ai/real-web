begin;
-- Auto top-up: a customer saves a card once (a Dodo on-demand subscription, no charge at setup). When their balance
-- falls below their chosen level, netlify/functions/auto-topup-run.mjs charges that card for their chosen pack and the
-- Dodo webhook adds the credits. All amounts are stored credits (1 stored = 10 displayed).
-- Only the server (service role) reads or writes these tables.

create table if not exists public.auto_topups (
  user_id uuid primary key,
  enabled boolean not null default false,
  -- pending: checkout opened, card not saved yet; active: card saved; cancelled: card removed or mandate ended.
  status text not null default 'pending' check (status in ('pending', 'active', 'cancelled')),
  pack_credits integer not null check (pack_credits > 0),
  threshold_credits integer not null check (threshold_credits >= 0),
  subscription_id text unique,
  customer_id text,
  failures integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.auto_topup_charges (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  subscription_id text not null,
  payment_id text unique,
  credits integer not null check (credits > 0),
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'charging' check (status in ('charging', 'succeeded', 'failed', 'expired')),
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
-- At most one charge in flight per person: a second run that tries to start one fails on this index.
create unique index if not exists auto_topup_charges_one_in_flight
  on public.auto_topup_charges (user_id) where status = 'charging';
create index if not exists auto_topup_charges_user_created on public.auto_topup_charges (user_id, created_at desc);

-- Who needs a top-up now: switched on, card saved, balance under the level, nothing in flight, fewer than
-- p_max_per_day top-ups in the last 24 hours, and no failed charge in the last p_retry_hours hours.
create or replace function public.auto_topup_due(p_max_per_day integer default 3, p_retry_hours integer default 6)
returns table (user_id uuid, subscription_id text, pack_credits integer, threshold_credits integer, credits numeric)
language sql
stable
set search_path = public
as $$
  select a.user_id, a.subscription_id, a.pack_credits, a.threshold_credits, coalesce(p.credits, 0)::numeric
  from public.auto_topups a
  join public.profiles p on p.user_id = a.user_id
  where a.enabled
    and a.status = 'active'
    and a.subscription_id is not null
    and coalesce(p.credits, 0) < a.threshold_credits
    and not exists (
      select 1 from public.auto_topup_charges c where c.user_id = a.user_id and c.status = 'charging'
    )
    and (
      select count(*) from public.auto_topup_charges c
      where c.user_id = a.user_id and c.status in ('charging', 'succeeded') and c.created_at > now() - interval '24 hours'
    ) < p_max_per_day
    and not exists (
      select 1 from public.auto_topup_charges c
      where c.user_id = a.user_id and c.status = 'failed' and c.created_at > now() - make_interval(hours => p_retry_hours)
    )
  order by a.user_id
  limit 200
$$;

alter table public.auto_topups enable row level security;
alter table public.auto_topup_charges enable row level security;
revoke all on public.auto_topups, public.auto_topup_charges from public, anon, authenticated;
grant select, insert, update on public.auto_topups, public.auto_topup_charges to service_role;
revoke all on function public.auto_topup_due(integer, integer) from public, anon, authenticated;
grant execute on function public.auto_topup_due(integer, integer) to service_role;
commit;
