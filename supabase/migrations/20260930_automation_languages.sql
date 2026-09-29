-- Hansora Automation is international: more reply languages and no Armenia-specific defaults.
-- Apply after 20260930_automation_flow_events.sql.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'automation.automation_agents'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%supported_languages%' or pg_get_constraintdef(oid) ilike '%primary_language%')
  loop
    execute format('alter table automation.automation_agents drop constraint %I', c.conname);
  end loop;
end $$;

alter table automation.automation_agents
  alter column primary_language set default 'en',
  alter column supported_languages set default array['en']::text[];

alter table automation.automation_agents
  add constraint automation_agents_languages_known check (
    supported_languages <@ array['en','es','fr','de','it','pt','ru','uk','pl','nl','tr','ar','hy','ka','zh','ja','ko','hi']::text[]
  ),
  add constraint automation_agents_languages_count check (cardinality(supported_languages) between 1 and 10),
  add constraint automation_agents_primary_supported check (primary_language = any(supported_languages));

alter table automation.automation_businesses alter column timezone set default 'UTC';
alter table automation.automation_outcomes alter column currency set default 'USD';
