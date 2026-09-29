-- Hansora Automation: pay-as-you-go with the shared Hansora credit balance (profiles.credits).
-- Apply after 20260928_automation_tools.sql. Amounts are stored credits (the site shows them ×10 as ⚡).

-- One row per charge. The unique idempotency key guarantees a message or call is never charged twice.
create table if not exists automation.automation_credit_charges (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references automation.automation_businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 300),
  kind text not null check (kind in ('ai_reply', 'test_reply', 'voice', 'test_voice')),
  credits numeric(12,2) not null check (credits >= 0),
  status text not null default 'pending' check (status in ('pending', 'charged', 'insufficient', 'refunded', 'failed')),
  balance_after numeric(14,2),
  conversation_id uuid references automation.automation_conversations(id) on delete set null,
  reference jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists automation_credit_charges_business_idx on automation.automation_credit_charges (business_id, created_at desc);

alter table automation.automation_credit_charges enable row level security;
drop policy if exists automation_credit_charges_owner_read on automation.automation_credit_charges;
create policy automation_credit_charges_owner_read on automation.automation_credit_charges
  for select to authenticated using (automation.automation_owns_business(business_id));
grant select on automation.automation_credit_charges to authenticated;
revoke all on automation.automation_credit_charges from anon;

-- Credits actually charged for each usage event (0 for free messages and failed charges).
alter table automation.automation_usage_events
  add column if not exists credits numeric(12,2) not null default 0 check (credits >= 0);

create or replace view automation.automation_usage_monthly_v
with (security_invoker = true)
as
select
  business_id,
  date_trunc('month', occurred_at) as billing_month,
  count(*) filter (where unit_type = 'ai_message') as ai_message_events,
  coalesce(sum(billable_quantity) filter (where unit_type = 'ai_message'), 0) as billable_ai_messages,
  coalesce(sum(billable_quantity) filter (where unit_type = 'voice_second'), 0) as billable_voice_seconds,
  coalesce(sum(estimated_cost_minor), 0) as estimated_cost_minor,
  min(currency) as currency,
  coalesce(sum(credits), 0) as credits_used
from automation.automation_usage_events
group by business_id, date_trunc('month', occurred_at);

create or replace view automation.automation_usage_monthly_channel_v
with (security_invoker = true)
as
select
  business_id,
  date_trunc('month', occurred_at) as billing_month,
  channel_type,
  coalesce(sum(billable_quantity) filter (where unit_type = 'ai_message'), 0) as billable_ai_messages,
  coalesce(sum(billable_quantity) filter (where unit_type = 'voice_second'), 0) as billable_voice_seconds,
  coalesce(sum(estimated_cost_minor), 0) as estimated_cost_minor,
  min(currency) as currency,
  coalesce(sum(credits), 0) as credits_used
from automation.automation_usage_events
group by business_id, date_trunc('month', occurred_at), channel_type;

-- Server functions use the service role, which needs explicit rights in the automation schema.
grant all on all tables in schema automation to service_role;
grant all on all sequences in schema automation to service_role;
grant execute on all functions in schema automation to service_role;
