-- Hansora Automation: TikTok direct messages channel.
-- Apply after 11_automation_channels_products.sql. Safe to run more than once. Only ADDS allowed values.
begin;

do $$
declare
  item record; r record; v_existing text[]; v_all text[];
begin
  for item in select * from (values
    ('automation_channel_connections', 'channel_type', array['tiktok']),
    ('automation_contacts', 'channel_type', array['tiktok']),
    ('automation_conversations', 'channel_type', array['tiktok']),
    ('automation_usage_events', 'channel_type', array['tiktok']),
    ('automation_provider_resources', 'provider', array['tiktok']),
    ('automation_provider_resources', 'resource_type', array['tiktok_account']),
    ('automation_webhook_events', 'provider', array['tiktok'])
  ) as x(tbl, col, vals)
  loop
    v_existing := '{}';
    for r in
      select c.conname, pg_get_constraintdef(c.oid) as def
      from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'automation' and t.relname = item.tbl and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ~ ('\m' || item.col || ' = ANY')
    loop
      -- Handles both saved forms: ARRAY['a'::text, 'b'::text] and '{a,b}'::text[].
      v_existing := v_existing || array(
        select trim(both '"' from v)
        from regexp_matches(r.def, '''([^'']+)''::text', 'g') as m,
             unnest(case when m[1] like '{%}' then string_to_array(trim(both '{}' from m[1]), ',') else array[m[1]] end) as v
      );
      execute format('alter table automation.%I drop constraint %I', item.tbl, r.conname);
    end loop;
    if cardinality(v_existing) = 0 then
      raise notice 'No allowed-values list found for %.% – left unchanged', item.tbl, item.col;
      continue;
    end if;
    select array_agg(distinct v order by v) into v_all from unnest(v_existing || item.vals) as v;
    execute format('alter table automation.%I add constraint %I check (%I = any (%L::text[]))', item.tbl, item.tbl || '_' || item.col || '_check', item.col, v_all);
  end loop;
end $$;

-- Channel order on the AI employee page: TikTok 7.
do $$
declare r record;
begin
  for r in
    select c.conname from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'automation' and t.relname = 'automation_channel_connections' and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%setup_order%'
  loop
    execute format('alter table automation.automation_channel_connections drop constraint %I', r.conname);
  end loop;
end $$;
alter table automation.automation_channel_connections
  add constraint automation_channel_connections_setup_order_check
    check (
      (channel_type = 'instagram_dm' and setup_order = 1) or
      (channel_type = 'instagram_comments' and setup_order = 2) or
      (channel_type = 'whatsapp' and setup_order = 3) or
      (channel_type = 'phone' and setup_order = 4) or
      (channel_type = 'telegram' and setup_order = 5) or
      (channel_type = 'messenger' and setup_order = 6) or
      (channel_type = 'tiktok' and setup_order = 7)
    );

-- Every AI employee gets the TikTok channel row (existing ones now, new ones automatically).
insert into automation.automation_channel_connections (business_id, channel_type, setup_order)
select b.id, 'tiktok', 7 from automation.automation_businesses b
on conflict (business_id, channel_type) do nothing;

create or replace function automation.automation_add_new_channels()
returns trigger language plpgsql security definer set search_path = automation, public as $$
begin
  insert into automation.automation_channel_connections (business_id, channel_type, setup_order)
  values (new.id, 'telegram', 5), (new.id, 'messenger', 6), (new.id, 'tiktok', 7)
  on conflict (business_id, channel_type) do nothing;
  return new;
end $$;

commit;
