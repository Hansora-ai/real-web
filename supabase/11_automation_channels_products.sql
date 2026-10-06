-- Hansora Automation: Telegram + Messenger channels, and the product catalog.
-- Apply after 10_automation_media_bucket.sql. Safe to run more than once.
begin;

-- 1) New allowed values are ADDED to the existing lists (nothing already allowed is removed).
do $$
declare
  item record; r record; v_existing text[]; v_all text[];
begin
  for item in select * from (values
    ('automation_channel_connections', 'channel_type', array['telegram', 'messenger']),
    ('automation_contacts', 'channel_type', array['telegram', 'messenger']),
    ('automation_conversations', 'channel_type', array['telegram', 'messenger']),
    ('automation_usage_events', 'channel_type', array['telegram', 'messenger']),
    ('automation_provider_resources', 'provider', array['telegram']),
    ('automation_provider_resources', 'resource_type', array['telegram_account', 'facebook_page']),
    ('automation_webhook_events', 'provider', array['telegram']),
    ('automation_tool_configs', 'tool_type', array['catalog'])
  ) as x(tbl, col, vals)
  loop
    v_existing := '{}';
    for r in
      select c.conname, pg_get_constraintdef(c.oid) as def
      from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'automation' and t.relname = item.tbl and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ~ ('\m' || item.col || ' = ANY')
    loop
      v_existing := v_existing || array(select m[1] from regexp_matches(r.def, '''([^'']+)''::text', 'g') as m);
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

-- Channel order on the AI employee page: Telegram 5, Messenger 6.
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
      (channel_type = 'messenger' and setup_order = 6)
    );

-- Every AI employee gets the two new channel rows (existing ones now, new ones automatically).
insert into automation.automation_channel_connections (business_id, channel_type, setup_order)
select b.id, x.channel_type, x.setup_order
from automation.automation_businesses b
cross join (values ('telegram', 5), ('messenger', 6)) as x(channel_type, setup_order)
on conflict (business_id, channel_type) do nothing;

create or replace function automation.automation_add_new_channels()
returns trigger language plpgsql security definer set search_path = automation, public as $$
begin
  insert into automation.automation_channel_connections (business_id, channel_type, setup_order)
  values (new.id, 'telegram', 5), (new.id, 'messenger', 6)
  on conflict (business_id, channel_type) do nothing;
  return new;
end $$;
drop trigger if exists automation_businesses_new_channels on automation.automation_businesses;
create trigger automation_businesses_new_channels after insert on automation.automation_businesses
  for each row execute function automation.automation_add_new_channels();

-- 2) Catalog settings live with the other tools (tool_type 'catalog', allowed above).

-- 3) Products.
create table if not exists automation.automation_products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references automation.automation_businesses(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 300),
  description text not null default '' check (char_length(description) <= 5000),
  category text not null default '' check (char_length(category) <= 200),
  sku text not null default '' check (char_length(sku) <= 120),
  price numeric(14,2) check (price is null or price >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  stock integer check (stock is null or stock >= 0),
  variants jsonb not null default '[]'::jsonb check (jsonb_typeof(variants) = 'array'),
  photos jsonb not null default '[]'::jsonb check (jsonb_typeof(photos) = 'array'),
  active boolean not null default true,
  source text not null default 'manual' check (source in ('manual', 'import', 'google_sheet')),
  external_key text check (external_key is null or char_length(external_key) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists automation_products_business_idx on automation.automation_products (business_id, active);
-- Imported / synced products are matched by external_key (manual products have none; NULLs never collide).
drop index if exists automation.automation_products_external_key_idx;
create unique index if not exists automation_products_business_external_key_idx on automation.automation_products (business_id, external_key);

-- Google Sheets (or any published CSV link) the catalog is synced from.
create table if not exists automation.automation_product_sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references automation.automation_businesses(id) on delete cascade,
  kind text not null default 'google_sheet' check (kind in ('google_sheet')),
  url text not null check (char_length(url) between 10 and 2000),
  column_map jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'paused', 'error')),
  last_synced_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  last_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, kind)
);

alter table automation.automation_products enable row level security;
alter table automation.automation_product_sources enable row level security;
drop policy if exists automation_products_owner on automation.automation_products;
create policy automation_products_owner on automation.automation_products for all to authenticated
  using (automation.automation_owns_business(business_id)) with check (automation.automation_owns_business(business_id));
drop policy if exists automation_product_sources_owner on automation.automation_product_sources;
create policy automation_product_sources_owner on automation.automation_product_sources for all to authenticated
  using (automation.automation_owns_business(business_id)) with check (automation.automation_owns_business(business_id));
grant select, insert, update, delete on automation.automation_products to authenticated;
grant select, insert, update, delete on automation.automation_product_sources to authenticated;
grant all on automation.automation_products to service_role;
grant all on automation.automation_product_sources to service_role;

commit;

notify pgrst, 'reload schema';
