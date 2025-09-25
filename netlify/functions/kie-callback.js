-- 1) Needed for gen_random_uuid()
create extension if not exists "pgcrypto";

-- 2) Table
create table if not exists public.nb_results (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  run_id     text not null,
  task_id    text,
  image_url  text,
  created_at timestamptz not null default now()
);

-- 3) Enable RLS
alter table public.nb_results enable row level security;

-- 4) Allow the browser (anon/authenticated) to read ONLY their own rows
drop policy if exists "users_read_own_results" on public.nb_results;
create policy "users_read_own_results"
  on public.nb_results
  for select
  to anon, authenticated
  using (auth.uid() = user_id);

-- NOTE: do NOT add an insert policy for anon/authenticated.
-- Your Netlify callback uses the SERVICE KEY, which bypasses RLS and can insert.

-- 5) Realtime (so the page gets the row immediately)
alter publication supabase_realtime add table public.nb_results;

-- 6) Helpful indexes for your queries
create index if not exists nb_results_run_id_idx   on public.nb_results (run_id);
create index if not exists nb_results_user_run_idx on public.nb_results (user_id, run_id);
