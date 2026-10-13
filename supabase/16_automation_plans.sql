-- Hansora Automation: monthly plans (Starter / Growth / Business / Scale).
-- Separate from Hansora Creative's public.user_subscriptions, so one person can have both plans at once.
-- Safe to run more than once.
begin;

create table if not exists automation.automation_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text not null check (plan_id in ('automation_starter_monthly','automation_growth_monthly','automation_business_monthly','automation_scale_monthly')),
  status text not null default 'inactive',
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table automation.automation_subscriptions enable row level security;

drop policy if exists "Owners read their Automation plan" on automation.automation_subscriptions;
create policy "Owners read their Automation plan" on automation.automation_subscriptions
  for select to authenticated using (user_id = auth.uid());

grant select on automation.automation_subscriptions to authenticated;
grant all on automation.automation_subscriptions to service_role;

commit;

-- Check: plan prices go down to 0.1⚡ steps (0.01 stored credit). This shows how many decimals profiles.credits keeps.
select column_name, data_type, numeric_scale
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name in ('credits', 'payg_credits', 'monthly_credits');
