-- Hansora Automation: payment link per product, and Excel (OneDrive / SharePoint) as a synced catalog source.
-- Apply after 11_automation_channels_products.sql. Safe to run more than once.
begin;

-- 1) A payment link per product (sent by the AI when the customer pays online).
alter table automation.automation_products add column if not exists payment_link text;
alter table automation.automation_products drop constraint if exists automation_products_payment_link_check;
alter table automation.automation_products add constraint automation_products_payment_link_check
  check (payment_link is null or payment_link = '' or (payment_link ~ '^https://' and char_length(payment_link) <= 1000));

-- 2) Products and sync sources can also come from an Excel file in OneDrive / SharePoint.
do $$
declare r record;
begin
  for r in
    select t.relname as tbl, c.conname from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'automation' and c.contype = 'c'
      and ((t.relname = 'automation_products' and pg_get_constraintdef(c.oid) ~ '\msource = ')
        or (t.relname = 'automation_product_sources' and pg_get_constraintdef(c.oid) ~ '\mkind = '))
  loop
    execute format('alter table automation.%I drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;
alter table automation.automation_products add constraint automation_products_source_check
  check (source in ('manual', 'import', 'google_sheet', 'excel_online'));
alter table automation.automation_product_sources add constraint automation_product_sources_kind_check
  check (kind in ('google_sheet', 'excel_online'));

commit;

notify pgrst, 'reload schema';
