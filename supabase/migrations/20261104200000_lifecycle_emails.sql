begin;
-- Lifecycle emails (abandoned checkout, prices, credits-used, welcome), sent by the scheduled
-- Netlify function lifecycle-emails. Replaces the Grok Bot "Lifecycle" agent.
-- Only the server (service role) can read or write these tables.

-- One row per decision: every email sent, and every checkout/click that was looked at and skipped
-- (so it is never looked at again). Rows imported from the bot's dedup log have source = 'bot-import'.
create table if not exists public.lifecycle_emails (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  email text,
  user_id uuid,
  campaign text not null check (campaign in ('abandoned', 'prices', 'credits_used', 'welcome')),
  status text not null default 'sent' check (status in ('sent', 'skipped', 'failed')),
  event_key text unique,             -- buy:<buy_click_events.id>, click:<click_events.id>, credits_used:<user>, welcome:<user>
  idempotency_key text,
  sent_at timestamptz,
  lang text,
  subject text,
  resend_id text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  source text not null default 'auto' check (source in ('auto', 'bot-import'))
);
create index if not exists lifecycle_emails_email_idx on public.lifecycle_emails (lower(email), sent_at desc);
create index if not exists lifecycle_emails_user_idx on public.lifecycle_emails (user_id);
create index if not exists lifecycle_emails_sent_idx on public.lifecycle_emails (sent_at desc) where status = 'sent';

-- Addresses that asked to stop (the emails' Unsubscribe link goes to hansoraai.co@gmail.com). Add a row to stop all lifecycle emails.
create table if not exists public.lifecycle_unsubscribes (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now(),
  note text
);

-- One row of switches. max_emails_per_person: how many lifecycle emails one person can ever get (default 1; the
-- highest-priority one wins: abandoned checkout, then prices, then credits-used, then welcome). enabled=false: the job does nothing. dry_run=true: it works out who would get what,
-- saves that in last_run, and sends nothing. events_after: checkouts and clicks before this time are never emailed
-- (set it to the bot's last run when switching over, so nothing the bot already handled is sent again).
create table if not exists public.lifecycle_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  dry_run boolean not null default true,
  events_after timestamptz not null default now(),
  signups_after timestamptz not null default '2026-10-25T17:04:00Z',
  max_per_run int not null default 25,
  max_emails_per_person int not null default 1,   -- one email per person, picked by priority
  signup_wait_minutes int not null default 60,     -- signups wait this long, so people who generate get credits-used

  last_run_at timestamptz,
  last_run jsonb,
  last_summary_on date
);
insert into public.lifecycle_settings (id) values (1) on conflict (id) do nothing;

alter table public.lifecycle_settings add column if not exists max_emails_per_person int not null default 1;
alter table public.lifecycle_settings add column if not exists signup_wait_minutes int not null default 60;

alter table public.lifecycle_emails enable row level security;
alter table public.lifecycle_unsubscribes enable row level security;
alter table public.lifecycle_settings enable row level security;
revoke all on public.lifecycle_emails, public.lifecycle_unsubscribes, public.lifecycle_settings from public, anon, authenticated;
grant all on public.lifecycle_emails, public.lifecycle_unsubscribes, public.lifecycle_settings to service_role;

-- Everything one run needs, in one call. Checkouts and clicks are limited to the last 3 days, after events_after,
-- and not already decided. Clicks must be at least 20 minutes old. "paid" means a successful payment after the event.
create or replace function public.lifecycle_facts(p_now timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with s as (
  select * from lifecycle_settings where id = 1
), paid_users as (
  select uid, min(coalesce(paid_at, created_at)) first_paid, max(coalesce(paid_at, created_at)) last_paid
  from payments where status in ('succeeded', 'paid', 'completed', 'success') group by uid
), signups as (
  select au.id, lower(au.email) email, au.created_at, au.raw_app_meta_data->>'provider' provider,
    p.credits balance, p.language
  from auth.users au left join profiles p on p.user_id = au.id, s
  where au.created_at > greatest(s.signups_after, p_now - interval '48 hours')
    and not exists (select 1 from paid_users pu where pu.uid = au.id)
), gens as (
  select ug.user_id,
    count(*) filter (where ug.kind = 'video') videos,
    count(*) filter (where ug.kind is distinct from 'video') images,
    sum(coalesce((ug.meta->>'charged_cost')::numeric, (ug.meta->>'debited')::numeric, 0)) spent,
    mode() within group (order by coalesce(ug.meta->>'model', ug.provider)) top_model
  from user_generations ug join signups su on su.id = ug.user_id
  where ug.meta->>'charged' = 'true' and coalesce(ug.meta->>'status', '') not in ('failed', 'error')
  group by 1
), checkouts as (
  select b.id, lower(b.email) email, coalesce(b.user_id, pr.user_id) user_id, b.checkout_status, b.page_path,
    b.created_at, coalesce(b.status_updated_at, b.created_at) event_at
  from buy_click_events b left join profiles pr on b.user_id is null and lower(pr.email) = lower(b.email), s
  where b.checkout_status in ('failed', 'abandoned')
    and coalesce(b.status_updated_at, b.created_at) > greatest(s.events_after, p_now - interval '3 days')
    and not exists (select 1 from lifecycle_emails le where le.event_key = 'buy:' || b.id)
), clicks as (
  select c.id, lower(c.email) email, coalesce(c.user_id, pr.user_id) user_id, c.element_label, c.element_id, c.destination, c.page_path, c.created_at,
    case when c.element_label ilike '%practice_offer_buy_clicked%' then 'practice' else 'pricing' end kind
  from click_events c left join profiles pr on c.user_id is null and lower(pr.email) = lower(c.email), s
  where c.email is not null and c.email <> ''
    and c.created_at > greatest(s.events_after, p_now - interval '3 days')
    and c.created_at <= p_now - interval '20 minutes'
    and (
      c.element_label ilike '%practice_offer_buy_clicked%'
      or (c.element_label not ilike '%practice_offer%' and (
        c.destination ~* '(^|/)pricing' or c.destination ~* '^#(buy|premium)' or c.element_id = 'btnBuyCredits'
        or c.element_label ~* '(pricing|prices|\mbuy\M|купить|(^|[^а-яё])цен|գներ|preç|preis|precio|prix|tarif)'
      ))
    )
    and not exists (select 1 from lifecycle_emails le where le.event_key = 'click:' || c.id)
), emails as (
  select email from signups union select email from checkouts union select email from clicks
)
select jsonb_build_object(
  'now', p_now,
  'settings', (select to_jsonb(s) - 'last_run' from s),
  'signups', coalesce((select jsonb_agg(jsonb_build_object(
      'user_id', su.id, 'email', su.email, 'created_at', su.created_at, 'provider', su.provider, 'balance', su.balance,
      'language', su.language, 'videos', coalesce(g.videos, 0), 'images', coalesce(g.images, 0), 'spent', coalesce(g.spent, 0),
      'top_model', g.top_model) order by coalesce(g.spent, 0) desc)
    from signups su left join gens g on g.user_id = su.id), '[]'::jsonb),
  'checkouts', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'email', c.email, 'user_id', c.user_id, 'status', c.checkout_status, 'page_path', c.page_path,
      'created_at', c.created_at, 'event_at', c.event_at, 'language', pr.language,
      'paid', exists(select 1 from paid_users pu where pu.uid = c.user_id and pu.last_paid > c.created_at)
        or exists(select 1 from buy_click_events b2 where lower(b2.email) = c.email and b2.checkout_status = 'succeeded'
                  and coalesce(b2.status_updated_at, b2.created_at) > c.created_at)) order by c.event_at)
    from checkouts c left join profiles pr on pr.user_id = c.user_id), '[]'::jsonb),
  'clicks', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'email', c.email, 'user_id', c.user_id, 'kind', c.kind, 'label', left(c.element_label, 200),
      'destination', c.destination, 'page_path', c.page_path, 'created_at', c.created_at, 'language', pr.language,
      'paid', exists(select 1 from paid_users pu where pu.uid = c.user_id and pu.last_paid > c.created_at)
        or exists(select 1 from buy_click_events b2 where lower(b2.email) = c.email and b2.checkout_status = 'succeeded'
                  and coalesce(b2.status_updated_at, b2.created_at) > c.created_at)) order by c.created_at)
    from clicks c left join profiles pr on pr.user_id = c.user_id), '[]'::jsonb),
  'history', coalesce((select jsonb_agg(jsonb_build_object('email', lower(le.email), 'user_id', le.user_id, 'campaign', le.campaign, 'sent_at', le.sent_at))
    from lifecycle_emails le
    where le.status = 'sent' and (lower(le.email) in (select email from emails) or le.user_id in (select id from signups)
      or le.user_id in (select user_id from checkouts union select user_id from clicks))), '[]'::jsonb),
  'unsubscribed', coalesce((select jsonb_agg(u.email) from lifecycle_unsubscribes u where u.email in (select email from emails)), '[]'::jsonb)
);
$$;
revoke all on function public.lifecycle_facts(timestamptz) from public, anon, authenticated;
grant execute on function public.lifecycle_facts(timestamptz) to service_role;

-- Right before each send: has this person paid since the given time?
create or replace function public.lifecycle_paid_since(p_user_id uuid, p_email text, p_since timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from payments where p_user_id is not null and uid = p_user_id
                  and status in ('succeeded', 'paid', 'completed', 'success') and coalesce(paid_at, created_at) > p_since)
      or exists(select 1 from buy_click_events where p_email is not null and lower(email) = lower(p_email)
                  and checkout_status = 'succeeded' and coalesce(status_updated_at, created_at) > p_since);
$$;
revoke all on function public.lifecycle_paid_since(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.lifecycle_paid_since(uuid, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
commit;
