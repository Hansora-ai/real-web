-- Hansora Automation: Website chat channel (a chat bubble businesses add to their own website).
-- Apply after 15_automation_tiktok.sql. Safe to run more than once. Only ADDS allowed values.
-- Visitors' messages are written by the server (netlify/functions/automation-website-chat.mjs) and answered by
-- automation-website-process-background.mjs, the same way as Telegram. Widget settings (key, allowed websites,
-- colour, greeting, visitor details form) live in automation_channel_connections.settings for channel 'website'.
begin;

do $$
declare
  item record; r record; v_existing text[]; v_all text[];
begin
  for item in select * from (values
    ('automation_channel_connections', 'channel_type', array['website']),
    ('automation_contacts', 'channel_type', array['website']),
    ('automation_conversations', 'channel_type', array['website']),
    ('automation_usage_events', 'channel_type', array['website']),
    ('automation_webhook_events', 'provider', array['website'])
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

-- Channel order on the AI employee page: Website 8.
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
      (channel_type = 'tiktok' and setup_order = 7) or
      (channel_type = 'website' and setup_order = 8)
    );

-- Every AI employee gets the Website channel row (existing ones now, new ones automatically).
insert into automation.automation_channel_connections (business_id, channel_type, setup_order)
select b.id, 'website', 8 from automation.automation_businesses b
on conflict (business_id, channel_type) do nothing;

create or replace function automation.automation_add_new_channels()
returns trigger language plpgsql security definer set search_path = automation, public as $$
begin
  insert into automation.automation_channel_connections (business_id, channel_type, setup_order)
  values (new.id, 'telegram', 5), (new.id, 'messenger', 6), (new.id, 'tiktok', 7), (new.id, 'website', 8)
  on conflict (business_id, channel_type) do nothing;
  return new;
end $$;

-- Looking up a widget by its public key, and the visitor's limits, stay fast as chats grow.
create index if not exists automation_channel_connections_widget_key
  on automation.automation_channel_connections ((settings->>'widget_key')) where channel_type = 'website';
create index if not exists automation_messages_website_ip
  on automation.automation_messages ((metadata->>'ip_hash'), created_at) where metadata->>'source' = 'website';

commit;
