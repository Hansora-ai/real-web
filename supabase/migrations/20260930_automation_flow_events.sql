-- Hansora Automation: per-step results for comment automations (button taps, link clicks, seen).
-- Apply after 20260929_automation_privacy.sql.
create table if not exists automation.automation_flow_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references automation.automation_businesses(id) on delete cascade,
  workflow_id uuid not null references automation.automation_comment_workflows(id) on delete cascade,
  session_id uuid references automation.automation_flow_sessions(id) on delete set null,
  node_id text not null default '' check (char_length(node_id) <= 200),
  action_id text not null default '' check (char_length(action_id) <= 200),
  event_type text not null check (event_type in ('click', 'seen')),
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists automation_flow_events_workflow_idx on automation.automation_flow_events (workflow_id, node_id, event_type);
create index if not exists automation_messages_workflow_idx on automation.automation_messages ((metadata->>'workflow_id')) where metadata ? 'workflow_id';

alter table automation.automation_flow_events enable row level security;
drop policy if exists automation_flow_events_owner_read on automation.automation_flow_events;
create policy automation_flow_events_owner_read on automation.automation_flow_events
  for select to authenticated using (automation.automation_owns_business(business_id));
grant select on automation.automation_flow_events to authenticated;
revoke all on automation.automation_flow_events from anon;
grant all on automation.automation_flow_events to service_role;
