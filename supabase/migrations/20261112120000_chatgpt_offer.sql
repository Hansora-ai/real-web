begin;
-- ChatGPT welcome offer (lib/business/chatgpt-offer.mjs): one row per person who was shown the offer.
-- The 8-hour timer starts at started_at and never restarts. used_* is set by the Dodo webhook when the first
-- purchase takes the offer. granted_credits is in stored credits (1 stored = 10 displayed).
-- Only the server (service role) reads or writes this table.
create table if not exists public.chatgpt_offers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_transaction_id text,
  used_product text,
  granted_credits integer check (granted_credits is null or granted_credits > 0),
  created_at timestamptz not null default now()
);
create index if not exists chatgpt_offers_started_idx on public.chatgpt_offers (started_at desc);
alter table public.chatgpt_offers enable row level security;
revoke all on public.chatgpt_offers from public, anon, authenticated;
grant all on public.chatgpt_offers to service_role;
comment on table public.chatgpt_offers is 'ChatGPT welcome offer: who saw it, when it ends, and the payment that used it. Deleted with the user account.';
notify pgrst, 'reload schema';
commit;
