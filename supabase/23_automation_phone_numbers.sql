-- Phone number pool. Hansora owns the numbers (Telnyx, a local operator, or the
-- LiveKit test number); a business is given one when it turns its phone line on.
-- Only the server assigns and releases numbers, and inbound calls are routed by
-- this table, so an owner can never claim another business's number.
begin;

create table if not exists automation.automation_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  e164 text not null unique check (e164 ~ '^\+[1-9][0-9]{7,14}$'),
  country text not null check (country ~ '^[A-Z]{2}$'),
  provider text not null check (provider in ('telnyx', 'livekit', 'operator')),
  provider_number_id text,
  label text,
  status text not null default 'available' check (status in ('available', 'assigned', 'disabled')),
  business_id uuid references automation.automation_businesses(id) on delete set null,
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_phone_numbers_assignment check ((status = 'assigned') = (business_id is not null))
);

create unique index if not exists automation_phone_numbers_one_per_business
  on automation.automation_phone_numbers (business_id) where status = 'assigned';
create index if not exists automation_phone_numbers_available
  on automation.automation_phone_numbers (country) where status = 'available';

alter table automation.automation_phone_numbers enable row level security;
drop policy if exists automation_phone_numbers_owner_read on automation.automation_phone_numbers;
create policy automation_phone_numbers_owner_read on automation.automation_phone_numbers
  for select to authenticated using (business_id is not null and automation.automation_owns_business(business_id));
revoke all on automation.automation_phone_numbers from anon, authenticated;
grant select on automation.automation_phone_numbers to authenticated;
grant all on automation.automation_phone_numbers to service_role;

-- Gives the business its number: the one it already has, else a free one in the
-- country. Row lock + skip locked = two owners can never get the same number.
create or replace function automation.automation_assign_phone_number(p_business uuid, p_country text)
returns automation.automation_phone_numbers
language plpgsql
security definer
set search_path = automation, public
as $$
declare
  v_row automation.automation_phone_numbers;
begin
  select * into v_row from automation.automation_phone_numbers where business_id = p_business and status = 'assigned';
  if found then return v_row; end if;
  select * into v_row from automation.automation_phone_numbers
    where status = 'available' and country = upper(p_country)
    order by created_at limit 1 for update skip locked;
  if not found then return null; end if;
  update automation.automation_phone_numbers
    set status = 'assigned', business_id = p_business, assigned_at = now(), updated_at = now()
    where id = v_row.id returning * into v_row;
  return v_row;
end $$;

create or replace function automation.automation_release_phone_number(p_business uuid)
returns void
language sql
security definer
set search_path = automation, public
as $$
  update automation.automation_phone_numbers
    set status = 'available', business_id = null, assigned_at = null, updated_at = now()
    where business_id = p_business and status = 'assigned';
$$;

revoke all on function automation.automation_assign_phone_number(uuid, text) from public, anon, authenticated;
revoke all on function automation.automation_release_phone_number(uuid) from public, anon, authenticated;
grant execute on function automation.automation_assign_phone_number(uuid, text) to service_role;
grant execute on function automation.automation_release_phone_number(uuid) to service_role;

commit;
