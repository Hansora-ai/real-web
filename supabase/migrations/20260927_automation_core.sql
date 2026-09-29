begin;

-- Hansora Automation lives in its own schema, separate from Hansora Creative's public tables.
-- After running, add "automation" to Supabase → Project Settings → API → Exposed schemas.
create schema if not exists automation;
grant usage on schema automation to authenticated, service_role;
revoke all on schema automation from anon;


create table if not exists automation.automation_businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  category text not null default '' check (char_length(category) <= 120),
  description text not null default '' check (char_length(description) <= 4000),
  contact_phone text not null default '' check (char_length(contact_phone) <= 80),
  contact_email text not null default '' check (char_length(contact_email) <= 320),
  timezone text not null default 'Asia/Yerevan' check (char_length(timezone) between 1 and 80),
  status text not null default 'draft' check (status in ('draft', 'testing', 'active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists automation_businesses_owner_updated_idx
  on automation.automation_businesses (owner_user_id, updated_at desc);

create table if not exists automation.automation_business_knowledge (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references automation.automation_businesses(id) on delete cascade,
  services_and_prices text not null default '' check (char_length(services_and_prices) <= 12000),
  opening_hours text not null default '' check (char_length(opening_hours) <= 4000),
  delivery_and_service_areas text not null default '' check (char_length(delivery_and_service_areas) <= 4000),
  frequently_asked_questions text not null default '' check (char_length(frequently_asked_questions) <= 8000),
  policies text not null default '' check (char_length(policies) <= 8000),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists automation.automation_agents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references automation.automation_businesses(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  primary_language text not null default 'hy' check (primary_language in ('hy', 'ru', 'en')),
  supported_languages text[] not null default array['hy']::text[],
  tone text not null default 'friendly' check (tone in ('friendly', 'professional', 'casual', 'formal')),
  custom_instructions text not null default '' check (char_length(custom_instructions) <= 12000),
  prohibited_instructions text not null default '' check (char_length(prohibited_instructions) <= 8000),
  status text not null default 'draft' check (status in ('draft', 'testing', 'active', 'paused')),
  configuration_version integer not null default 1 check (configuration_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(supported_languages) between 1 and 3),
  check (supported_languages <@ array['hy', 'ru', 'en']::text[]),
  check (primary_language = any(supported_languages))
);

create table if not exists automation.automation_channel_connections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references automation.automation_businesses(id) on delete cascade,
  channel_type text not null check (channel_type in ('instagram_dm', 'instagram_comments', 'whatsapp', 'phone')),
  setup_order smallint not null check (setup_order between 1 and 4),
  status text not null default 'not_connected' check (status in ('not_connected', 'connecting', 'connected', 'paused', 'error')),
  provider text,
  connected_account_label text,
  last_error_code text,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, channel_type),
  unique (business_id, setup_order),
  check (
    (channel_type = 'instagram_dm' and setup_order = 1) or
    (channel_type = 'instagram_comments' and setup_order = 2) or
    (channel_type = 'whatsapp' and setup_order = 3) or
    (channel_type = 'phone' and setup_order = 4)
  ),
  check (provider is null or char_length(provider) <= 80),
  check (connected_account_label is null or char_length(connected_account_label) <= 200),
  check (last_error_code is null or char_length(last_error_code) <= 120)
);

create index if not exists automation_channels_business_order_idx
  on automation.automation_channel_connections (business_id, setup_order);

create or replace function automation.automation_touch_updated_at()
returns trigger
language plpgsql
set search_path = automation, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists automation_businesses_touch_updated_at on automation.automation_businesses;
create trigger automation_businesses_touch_updated_at
before update on automation.automation_businesses
for each row execute function automation.automation_touch_updated_at();

drop trigger if exists automation_knowledge_touch_updated_at on automation.automation_business_knowledge;
create trigger automation_knowledge_touch_updated_at
before update on automation.automation_business_knowledge
for each row execute function automation.automation_touch_updated_at();

drop trigger if exists automation_agents_touch_updated_at on automation.automation_agents;
create trigger automation_agents_touch_updated_at
before update on automation.automation_agents
for each row execute function automation.automation_touch_updated_at();

drop trigger if exists automation_channels_touch_updated_at on automation.automation_channel_connections;
create trigger automation_channels_touch_updated_at
before update on automation.automation_channel_connections
for each row execute function automation.automation_touch_updated_at();

alter table automation.automation_businesses enable row level security;
alter table automation.automation_business_knowledge enable row level security;
alter table automation.automation_agents enable row level security;
alter table automation.automation_channel_connections enable row level security;

drop policy if exists automation_businesses_owner_all on automation.automation_businesses;
create policy automation_businesses_owner_all
on automation.automation_businesses
for all
to authenticated
using ((select auth.uid()) = owner_user_id)
with check ((select auth.uid()) = owner_user_id);

drop policy if exists automation_knowledge_owner_all on automation.automation_business_knowledge;
create policy automation_knowledge_owner_all
on automation.automation_business_knowledge
for all
to authenticated
using (
  exists (
    select 1 from automation.automation_businesses b
    where b.id = automation_business_knowledge.business_id
      and b.owner_user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from automation.automation_businesses b
    where b.id = automation_business_knowledge.business_id
      and b.owner_user_id = (select auth.uid())
  )
);

drop policy if exists automation_agents_owner_all on automation.automation_agents;
create policy automation_agents_owner_all
on automation.automation_agents
for all
to authenticated
using (
  exists (
    select 1 from automation.automation_businesses b
    where b.id = automation_agents.business_id
      and b.owner_user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from automation.automation_businesses b
    where b.id = automation_agents.business_id
      and b.owner_user_id = (select auth.uid())
  )
);

drop policy if exists automation_channels_owner_all on automation.automation_channel_connections;
create policy automation_channels_owner_all
on automation.automation_channel_connections
for all
to authenticated
using (
  exists (
    select 1 from automation.automation_businesses b
    where b.id = automation_channel_connections.business_id
      and b.owner_user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from automation.automation_businesses b
    where b.id = automation_channel_connections.business_id
      and b.owner_user_id = (select auth.uid())
  )
);

grant select, insert, update, delete on automation.automation_businesses to authenticated;
grant select, insert, update, delete on automation.automation_business_knowledge to authenticated;
grant select, insert, update, delete on automation.automation_agents to authenticated;
grant select, insert, update, delete on automation.automation_channel_connections to authenticated;

revoke all on automation.automation_businesses from anon;
revoke all on automation.automation_business_knowledge from anon;
revoke all on automation.automation_agents from anon;
revoke all on automation.automation_channel_connections from anon;

create or replace function automation.automation_save_agent(
  p_business_id uuid,
  p_business_name text,
  p_category text,
  p_description text,
  p_contact_phone text,
  p_contact_email text,
  p_display_name text,
  p_primary_language text,
  p_supported_languages text[],
  p_tone text,
  p_business_profile jsonb,
  p_custom_instructions text,
  p_prohibited_instructions text
)
returns uuid
language plpgsql
security invoker
set search_path = automation, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_business_id uuid := p_business_id;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  if v_business_id is null then
    insert into automation.automation_businesses (
      owner_user_id, name, category, description, contact_phone, contact_email
    ) values (
      v_user_id, btrim(p_business_name), btrim(coalesce(p_category, '')),
      btrim(coalesce(p_description, '')), btrim(coalesce(p_contact_phone, '')),
      btrim(coalesce(p_contact_email, ''))
    ) returning id into v_business_id;

    insert into automation.automation_agents (
      business_id, display_name, primary_language, supported_languages, tone,
      custom_instructions, prohibited_instructions
    ) values (
      v_business_id, btrim(p_display_name), p_primary_language,
      p_supported_languages, p_tone,
      btrim(coalesce(p_custom_instructions, '')),
      btrim(coalesce(p_prohibited_instructions, ''))
    );

    insert into automation.automation_business_knowledge (
      business_id, services_and_prices, opening_hours, delivery_and_service_areas,
      frequently_asked_questions, policies
    ) values (
      v_business_id,
      coalesce(p_business_profile ->> 'services_and_prices', ''),
      coalesce(p_business_profile ->> 'opening_hours', ''),
      coalesce(p_business_profile ->> 'delivery_and_service_areas', ''),
      coalesce(p_business_profile ->> 'frequently_asked_questions', ''),
      coalesce(p_business_profile ->> 'policies', '')
    );

    insert into automation.automation_channel_connections (business_id, channel_type, setup_order)
    values
      (v_business_id, 'instagram_dm', 1),
      (v_business_id, 'instagram_comments', 2),
      (v_business_id, 'whatsapp', 3),
      (v_business_id, 'phone', 4);
  else
    update automation.automation_businesses
       set name = btrim(p_business_name),
           category = btrim(coalesce(p_category, '')),
           description = btrim(coalesce(p_description, '')),
           contact_phone = btrim(coalesce(p_contact_phone, '')),
           contact_email = btrim(coalesce(p_contact_email, ''))
     where id = v_business_id and owner_user_id = v_user_id;

    if not found then
      raise exception 'business_not_found' using errcode = 'P0002';
    end if;

    update automation.automation_agents
       set display_name = btrim(p_display_name),
           primary_language = p_primary_language,
           supported_languages = p_supported_languages,
           tone = p_tone,
           custom_instructions = btrim(coalesce(p_custom_instructions, '')),
           prohibited_instructions = btrim(coalesce(p_prohibited_instructions, '')),
           configuration_version = configuration_version + 1
     where business_id = v_business_id;

    if not found then
      raise exception 'agent_not_found' using errcode = 'P0002';
    end if;

    update automation.automation_business_knowledge
       set services_and_prices = coalesce(p_business_profile ->> 'services_and_prices', ''),
           opening_hours = coalesce(p_business_profile ->> 'opening_hours', ''),
           delivery_and_service_areas = coalesce(p_business_profile ->> 'delivery_and_service_areas', ''),
           frequently_asked_questions = coalesce(p_business_profile ->> 'frequently_asked_questions', ''),
           policies = coalesce(p_business_profile ->> 'policies', ''),
           revision = revision + 1
     where business_id = v_business_id;

    if not found then
      raise exception 'business_knowledge_not_found' using errcode = 'P0002';
    end if;
  end if;

  return v_business_id;
end;
$$;

revoke all on function automation.automation_save_agent(uuid, text, text, text, text, text, text, text, text[], text, jsonb, text, text) from public, anon;
grant execute on function automation.automation_save_agent(uuid, text, text, text, text, text, text, text, text[], text, jsonb, text, text) to authenticated;


-- Server functions use the service role, which needs explicit rights in the automation schema.
grant all on all tables in schema automation to service_role;
grant all on all sequences in schema automation to service_role;
grant execute on all functions in schema automation to service_role;

commit;
