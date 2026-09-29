begin;

create or replace function automation.automation_owns_business(p_business_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = automation, public
as $$
  select exists (
    select 1 from automation.automation_businesses b
    where b.id = p_business_id and b.owner_user_id = (select auth.uid())
  );
$$;

create table if not exists automation.automation_provider_resources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references automation.automation_businesses(id) on delete cascade,
  agent_id uuid references automation.automation_agents(id) on delete cascade,
  provider text not null check (provider in ('elevenlabs', 'meta', 'google_calendar', 'livekit', 'gemini', 'hansora')),
  resource_type text not null check (resource_type in ('agent', 'instagram_account', 'whatsapp_account', 'phone_number', 'calendar', 'webhook', 'knowledge_base')),
  provider_resource_id text not null check (char_length(provider_resource_id) between 1 and 500),
  status text not null default 'active' check (status in ('pending', 'active', 'paused', 'error', 'revoked')),
  safe_config jsonb not null default '{}'::jsonb,
  secret_reference text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, provider, resource_type, provider_resource_id),
  check (secret_reference is null or char_length(secret_reference) <= 500)
);

create table if not exists automation.automation_provider_credentials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references automation.automation_businesses(id) on delete cascade,
  provider_resource_id uuid not null references automation.automation_provider_resources(id) on delete cascade,
  credential_type text not null check (credential_type in ('access_token', 'refresh_token', 'registration_pin')),
  encrypted_secret text not null,
  secret_iv text not null,
  secret_tag text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_resource_id, credential_type)
);

create table if not exists automation.automation_oauth_states (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references automation.automation_businesses(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('meta_instagram', 'meta_whatsapp', 'google_calendar')),
  state_hash text not null unique check (char_length(state_hash) = 64),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

alter table automation.automation_channel_connections
  add column if not exists settings jsonb not null default '{}'::jsonb;

create table if not exists automation.automation_contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references automation.automation_businesses(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 200),
  primary_phone text not null default '' check (char_length(primary_phone) <= 80),
  primary_email text not null default '' check (char_length(primary_email) <= 320),
  language text check (language is null or language in ('hy', 'ru', 'en')),
  channel_type text not null check (channel_type in ('instagram_dm', 'instagram_comments', 'whatsapp', 'phone', 'manual')),
  external_contact_id text not null check (char_length(external_contact_id) between 1 and 500),
  profile jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, channel_type, external_contact_id)
);

create table if not exists automation.automation_conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references automation.automation_businesses(id) on delete cascade,
  contact_id uuid not null references automation.automation_contacts(id) on delete cascade,
  channel_connection_id uuid references automation.automation_channel_connections(id) on delete set null,
  channel_type text not null check (channel_type in ('instagram_dm', 'instagram_comments', 'whatsapp', 'phone', 'test')),
  external_thread_id text check (external_thread_id is null or char_length(external_thread_id) <= 500),
  status text not null default 'open' check (status in ('open', 'needs_attention', 'human_handling', 'resolved', 'archived')),
  ai_enabled boolean not null default true,
  human_owner_user_id uuid references auth.users(id) on delete set null,
  intent text not null default '' check (char_length(intent) <= 200),
  summary text not null default '' check (char_length(summary) <= 8000),
  last_message_preview text not null default '' check (char_length(last_message_preview) <= 1000),
  last_message_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (business_id, channel_type, external_thread_id)
);

create table if not exists automation.automation_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references automation.automation_businesses(id) on delete cascade,
  conversation_id uuid not null references automation.automation_conversations(id) on delete cascade,
  external_message_id text,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 500),
  direction text not null check (direction in ('inbound', 'outbound', 'internal')),
  sender_type text not null check (sender_type in ('customer', 'ai', 'human', 'system')),
  content_type text not null default 'text' check (content_type in ('text', 'image', 'audio', 'video', 'file', 'location', 'interactive', 'call_event')),
  content text not null default '' check (char_length(content) <= 24000),
  status text not null default 'received' check (status in ('received', 'queued', 'generated', 'sent', 'delivered', 'read', 'failed')),
  billable boolean not null default false,
  provider text,
  model text,
  provider_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (business_id, idempotency_key),
  check (external_message_id is null or char_length(external_message_id) <= 500),
  check (provider is null or char_length(provider) <= 80),
  check (model is null or char_length(model) <= 200),
  check (provider_message_id is null or char_length(provider_message_id) <= 500)
);

create table if not exists automation.automation_usage_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references automation.automation_businesses(id) on delete cascade,
  conversation_id uuid references automation.automation_conversations(id) on delete set null,
  message_id uuid references automation.automation_messages(id) on delete set null,
  channel_type text not null check (channel_type in ('instagram_dm', 'instagram_comments', 'whatsapp', 'phone', 'test')),
  unit_type text not null check (unit_type in ('ai_message', 'voice_second', 'provider_credit', 'tool_call')),
  quantity numeric(14,4) not null check (quantity >= 0),
  billable_quantity numeric(14,4) not null check (billable_quantity >= 0),
  estimated_cost_minor bigint not null default 0 check (estimated_cost_minor >= 0),
  currency text not null default 'AMD' check (currency ~ '^[A-Z]{3}$'),
  provider text not null check (char_length(provider) between 1 and 80),
  provider_usage_id text,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 500),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (business_id, idempotency_key),
  check (provider_usage_id is null or char_length(provider_usage_id) <= 500)
);

create table if not exists automation.automation_outcomes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references automation.automation_businesses(id) on delete cascade,
  conversation_id uuid references automation.automation_conversations(id) on delete set null,
  contact_id uuid references automation.automation_contacts(id) on delete set null,
  outcome_type text not null check (outcome_type in ('lead', 'order', 'booking')),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  status text not null default 'new' check (status in ('new', 'in_progress', 'waiting', 'confirmed', 'completed', 'cancelled')),
  owner_user_id uuid references auth.users(id) on delete set null,
  estimated_value_minor bigint not null default 0 check (estimated_value_minor >= 0),
  currency text not null default 'AMD' check (currency ~ '^[A-Z]{3}$'),
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  external_calendar_event_id text,
  collected_fields jsonb not null default '{}'::jsonb,
  summary text not null default '' check (char_length(summary) <= 8000),
  private_note text not null default '' check (char_length(private_note) <= 8000),
  created_by text not null default 'ai' check (created_by in ('ai', 'human', 'import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scheduled_end is null or scheduled_start is null or scheduled_end > scheduled_start),
  check (external_calendar_event_id is null or char_length(external_calendar_event_id) <= 500)
);

create table if not exists automation.automation_comment_workflows (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references automation.automation_businesses(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  post_scope text not null default 'all' check (post_scope in ('all', 'selected', 'next')),
  selected_post_ids text[] not null default '{}'::text[],
  match_type text not null default 'any' check (match_type in ('any', 'contains', 'exact')),
  keywords text[] not null default '{}'::text[],
  public_reply_variations text[] not null default '{}'::text[],
  dm_steps jsonb not null default '[]'::jsonb,
  safety_config jsonb not null default '{}'::jsonb,
  triggered_count bigint not null default 0 check (triggered_count >= 0),
  last_triggered_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'active' or post_scope <> 'selected' or cardinality(selected_post_ids) > 0),
  check (status <> 'active' or match_type = 'any' or cardinality(keywords) > 0)
);

create table if not exists automation.automation_comment_executions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references automation.automation_businesses(id) on delete cascade,
  workflow_id uuid not null references automation.automation_comment_workflows(id) on delete cascade,
  comment_id text not null check (char_length(comment_id) between 1 and 500),
  media_id text not null check (char_length(media_id) between 1 and 500),
  external_contact_id text not null check (char_length(external_contact_id) between 1 and 500),
  comment_text text not null default '' check (char_length(comment_text) <= 24000),
  status text not null default 'processing' check (status in ('processing', 'completed', 'partial', 'failed', 'ignored')),
  public_reply_id text,
  private_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workflow_id, comment_id)
);

create table if not exists automation.automation_flow_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references automation.automation_businesses(id) on delete cascade,
  workflow_id uuid not null references automation.automation_comment_workflows(id) on delete cascade,
  comment_execution_id uuid not null unique references automation.automation_comment_executions(id) on delete cascade,
  conversation_id uuid references automation.automation_conversations(id) on delete set null,
  external_contact_id text not null check (char_length(external_contact_id) between 1 and 500),
  current_node_index integer not null default 0 check (current_node_index >= 0),
  status text not null default 'awaiting_reply' check (status in ('awaiting_reply', 'running', 'waiting', 'ai_active', 'human_handling', 'completed', 'failed', 'expired')),
  context jsonb not null default '{}'::jsonb,
  last_error text,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists automation.automation_flow_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references automation.automation_businesses(id) on delete cascade,
  session_id uuid not null references automation.automation_flow_sessions(id) on delete cascade,
  node_index integer not null check (node_index >= 0),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  run_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 500),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists automation.automation_tool_configs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references automation.automation_businesses(id) on delete cascade,
  tool_type text not null check (tool_type in ('calendar', 'orders', 'leads', 'handoff')),
  enabled boolean not null default true,
  provider_resource_id uuid references automation.automation_provider_resources(id) on delete set null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, tool_type)
);

create table if not exists automation.automation_calls (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references automation.automation_businesses(id) on delete cascade,
  conversation_id uuid references automation.automation_conversations(id) on delete set null,
  provider_call_id text not null check (char_length(provider_call_id) between 1 and 500),
  direction text not null default 'inbound' check (direction in ('inbound', 'outbound', 'test')),
  status text not null default 'ringing' check (status in ('ringing', 'connected', 'transferred', 'completed', 'failed', 'missed')),
  started_at timestamptz not null default now(),
  connected_at timestamptz,
  ended_at timestamptz,
  billable_seconds integer not null default 0 check (billable_seconds >= 0),
  transcript text not null default '' check (char_length(transcript) <= 100000),
  summary text not null default '' check (char_length(summary) <= 8000),
  outcome jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (business_id, provider_call_id),
  check (ended_at is null or ended_at >= started_at)
);

create table if not exists automation.automation_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('meta', 'elevenlabs', 'google_calendar', 'livekit')),
  external_event_id text not null check (char_length(external_event_id) between 1 and 500),
  business_id uuid references automation.automation_businesses(id) on delete set null,
  event_type text not null check (char_length(event_type) between 1 and 200),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received' check (status in ('received', 'processing', 'processed', 'ignored', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, external_event_id)
);

create index if not exists automation_provider_resources_business_idx on automation.automation_provider_resources (business_id, provider, resource_type);
create index if not exists automation_provider_credentials_business_idx on automation.automation_provider_credentials (business_id, provider_resource_id);
create index if not exists automation_oauth_states_expiry_idx on automation.automation_oauth_states (provider, expires_at) where consumed_at is null;
create index if not exists automation_contacts_business_recent_idx on automation.automation_contacts (business_id, last_seen_at desc);
create index if not exists automation_conversations_business_recent_idx on automation.automation_conversations (business_id, last_message_at desc);
create index if not exists automation_conversations_attention_idx on automation.automation_conversations (business_id, status, last_message_at desc);
create index if not exists automation_messages_conversation_time_idx on automation.automation_messages (conversation_id, occurred_at, id);
create index if not exists automation_usage_business_time_idx on automation.automation_usage_events (business_id, occurred_at desc);
create index if not exists automation_usage_conversation_idx on automation.automation_usage_events (conversation_id, occurred_at);
create index if not exists automation_outcomes_business_status_idx on automation.automation_outcomes (business_id, outcome_type, status, updated_at desc);
create index if not exists automation_workflows_business_idx on automation.automation_comment_workflows (business_id, status, updated_at desc);
create index if not exists automation_comment_executions_contact_idx on automation.automation_comment_executions (workflow_id, external_contact_id, created_at);
create index if not exists automation_flow_sessions_contact_idx on automation.automation_flow_sessions (business_id, external_contact_id, status, updated_at desc);
create index if not exists automation_flow_jobs_due_idx on automation.automation_flow_jobs (status, run_at) where status = 'pending';
create index if not exists automation_calls_business_time_idx on automation.automation_calls (business_id, started_at desc);
create index if not exists automation_webhooks_status_idx on automation.automation_webhook_events (status, received_at);

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'automation_provider_resources','automation_contacts','automation_conversations',
    'automation_outcomes','automation_comment_workflows','automation_flow_sessions','automation_flow_jobs','automation_tool_configs'
  ] loop
    execute format('drop trigger if exists %I on automation.%I', v_table || '_touch_updated_at', v_table);
    execute format('create trigger %I before update on automation.%I for each row execute function automation.automation_touch_updated_at()', v_table || '_touch_updated_at', v_table);
  end loop;
end $$;

alter table automation.automation_provider_resources enable row level security;
alter table automation.automation_provider_credentials enable row level security;
alter table automation.automation_oauth_states enable row level security;
alter table automation.automation_contacts enable row level security;
alter table automation.automation_conversations enable row level security;
alter table automation.automation_messages enable row level security;
alter table automation.automation_usage_events enable row level security;
alter table automation.automation_outcomes enable row level security;
alter table automation.automation_comment_workflows enable row level security;
alter table automation.automation_comment_executions enable row level security;
alter table automation.automation_flow_sessions enable row level security;
alter table automation.automation_flow_jobs enable row level security;
alter table automation.automation_tool_configs enable row level security;
alter table automation.automation_calls enable row level security;
alter table automation.automation_webhook_events enable row level security;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'automation_provider_resources','automation_contacts','automation_conversations','automation_messages',
    'automation_usage_events','automation_outcomes','automation_comment_workflows','automation_comment_executions','automation_flow_sessions','automation_flow_jobs','automation_tool_configs','automation_calls'
  ] loop
    execute format('drop policy if exists %I on automation.%I', v_table || '_owner_all', v_table);
    execute format(
      'create policy %I on automation.%I for all to authenticated using (automation.automation_owns_business(business_id)) with check (automation.automation_owns_business(business_id))',
      v_table || '_owner_all', v_table
    );
    execute format('grant select, insert, update, delete on automation.%I to authenticated', v_table);
    execute format('revoke all on automation.%I from anon', v_table);
  end loop;
end $$;

revoke all on automation.automation_webhook_events from public, anon, authenticated;
revoke all on automation.automation_provider_credentials from public, anon, authenticated;
revoke all on automation.automation_oauth_states from public, anon, authenticated;
revoke all on automation.automation_provider_resources from anon;
revoke execute on function automation.automation_owns_business(uuid) from public, anon;
grant execute on function automation.automation_owns_business(uuid) to authenticated;

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
  min(currency) as currency
from automation.automation_usage_events
group by business_id, date_trunc('month', occurred_at);

grant select on automation.automation_usage_monthly_v to authenticated;
revoke all on automation.automation_usage_monthly_v from anon;

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
  min(currency) as currency
from automation.automation_usage_events
group by business_id, date_trunc('month', occurred_at), channel_type;

grant select on automation.automation_usage_monthly_channel_v to authenticated;
revoke all on automation.automation_usage_monthly_channel_v from anon;


-- Server functions use the service role, which needs explicit rights in the automation schema.
grant all on all tables in schema automation to service_role;
grant all on all sequences in schema automation to service_role;
grant execute on all functions in schema automation to service_role;

commit;
