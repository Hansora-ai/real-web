-- A business can have several Hansora numbers (one per country), and owners can
-- leave a contact (WhatsApp, Telegram or email) for a local number, WhatsApp
-- calls, or help with forwarding, so Hansora can follow up by hand.
--
-- New requests with a contact:
--   select country, contact_method, contact_value, wants_local_number, wants_whatsapp_calls, wants_forwarding_help, updated_at
--   from automation.automation_phone_country_requests where contact_value is not null order by updated_at desc;
begin;

alter table automation.automation_phone_country_requests
  add column if not exists wants_email boolean not null default false,
  add column if not exists wants_local_number boolean not null default false,
  add column if not exists wants_whatsapp_calls boolean not null default false,
  add column if not exists wants_forwarding_help boolean not null default false,
  add column if not exists contact_method text check (contact_method in ('whatsapp', 'telegram', 'email')),
  add column if not exists contact_value text check (char_length(contact_value) <= 200),
  add column if not exists updated_at timestamptz not null default now();

-- One number per business and country, instead of one number per business.
drop index if exists automation.automation_phone_numbers_one_per_business;
create unique index if not exists automation_phone_numbers_one_per_business_country
  on automation.automation_phone_numbers (business_id, country) where status = 'assigned';

-- Gives the business its number in the country: the one it already has there,
-- else a free one. Row lock + skip locked = two owners never get the same number.
create or replace function automation.automation_assign_phone_number(p_business uuid, p_country text)
returns automation.automation_phone_numbers
language plpgsql
security definer
set search_path = automation, public
as $$
declare
  v_row automation.automation_phone_numbers;
begin
  select * into v_row from automation.automation_phone_numbers
    where business_id = p_business and status = 'assigned' and country = upper(p_country);
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

-- Turns off one number of the business (or all of them when p_e164 is null).
create or replace function automation.automation_release_phone_number(p_business uuid, p_e164 text)
returns void
language sql
security definer
set search_path = automation, public
as $$
  update automation.automation_phone_numbers
    set status = 'available', business_id = null, assigned_at = null, updated_at = now()
    where business_id = p_business and status = 'assigned' and (p_e164 is null or e164 = p_e164);
$$;

revoke all on function automation.automation_assign_phone_number(uuid, text) from public, anon, authenticated;
revoke all on function automation.automation_release_phone_number(uuid, text) from public, anon, authenticated;
grant execute on function automation.automation_assign_phone_number(uuid, text) to service_role;
grant execute on function automation.automation_release_phone_number(uuid, text) to service_role;

commit;
