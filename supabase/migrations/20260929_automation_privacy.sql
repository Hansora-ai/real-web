-- Hansora Automation: Meta data-deletion / deauthorization requests (status shown on automation-data-deletion.html).
-- Apply after 20260929_automation_credits.sql.
create table if not exists automation.automation_data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  confirmation_code text not null unique check (char_length(confirmation_code) between 8 and 64),
  source text not null check (source in ('meta_data_deletion', 'meta_deauthorize', 'owner_request')),
  platform_user_id text check (platform_user_id is null or char_length(platform_user_id) <= 200),
  business_ids uuid[] not null default '{}',
  status text not null default 'received' check (status in ('received', 'completed', 'no_data')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table automation.automation_data_deletion_requests enable row level security;
revoke all on automation.automation_data_deletion_requests from public, anon, authenticated;

-- Server functions use the service role, which needs explicit rights in the automation schema.
grant all on all tables in schema automation to service_role;
grant all on all sequences in schema automation to service_role;
grant execute on all functions in schema automation to service_role;
