-- One row per ChatGPT tool call (balance checks, price lookups, starts and refusals), so we can see
-- where people stop before generating. No prompts, images or videos are stored.
-- Safe to run again. Only the server (service role) can read or write it.
begin;
create table if not exists public.chatgpt_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete cascade,
  tool text not null check (char_length(tool) <= 60),
  model_id text check (model_id is null or char_length(model_id) <= 60),
  outcome text check (outcome is null or char_length(outcome) <= 60),
  credits numeric,
  balance numeric,
  run_id text check (run_id is null or char_length(run_id) <= 160),
  details jsonb not null default '{}'::jsonb
);
create index if not exists chatgpt_events_user_idx on public.chatgpt_events (user_id, created_at desc);
create index if not exists chatgpt_events_created_idx on public.chatgpt_events (created_at desc);
alter table public.chatgpt_events enable row level security;
revoke all on public.chatgpt_events from public, anon, authenticated;
grant all on public.chatgpt_events to service_role;
comment on table public.chatgpt_events is 'ChatGPT app tool calls: which step each user reached. Deleted with the user account.';
notify pgrst, 'reload schema';
commit;
