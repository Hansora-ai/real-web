begin;
-- Account deletion requests from the Hansora phone app (Apple 5.1.1(v), Google Play account deletion).
-- The app records the request; the owner is told on Telegram and completes it within 30 days.
-- No grants or policies expose this table to anon/authenticated clients; only the server (service role) uses it.
create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text,
  scope text not null check (scope in ('automation', 'account')),
  status text not null default 'requested' check (status in ('requested', 'completed', 'cancelled')),
  source text not null default 'app' check (length(source) <= 40),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
-- One open request per person and scope.
create unique index if not exists account_deletion_requests_open
  on public.account_deletion_requests (user_id, scope) where status = 'requested';
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public, anon, authenticated;
grant select, insert, update on public.account_deletion_requests to service_role;
commit;
