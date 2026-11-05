-- Owners who already have a SIP trunk number (any provider, any country) can bring it to Hansora.
-- Their provider sends calls to Hansora's LiveKit SIP address, signing in with a username and password
-- Hansora creates for that business. Imported numbers are rows with provider 'sip'; they are never
-- put in the shared pool: turning one off deletes the row.
-- The same row later holds the owner's outgoing (termination) settings for AI outgoing calls.
begin;

alter table automation.automation_phone_numbers drop constraint if exists automation_phone_numbers_provider_check;
alter table automation.automation_phone_numbers add constraint automation_phone_numbers_provider_check
  check (provider = any (array['twilio', 'telnyx', 'livekit', 'operator', 'sip']));

-- One Hansora number per business and country; imported numbers do not count.
drop index if exists automation.automation_phone_numbers_one_per_business_country;
create unique index automation_phone_numbers_one_per_business_country
  on automation.automation_phone_numbers (business_id, country) where status = 'assigned' and provider <> 'sip';

-- One LiveKit trunk per business for its imported numbers. Service role only (no policies).
create table if not exists automation.automation_phone_sip_trunks (
  business_id uuid primary key references automation.automation_businesses(id) on delete cascade,
  livekit_trunk_id text not null,
  livekit_dispatch_rule_id text,
  auth_username text not null,
  encrypted_secret text not null,
  secret_iv text not null,
  secret_tag text not null,
  outbound_address text,
  outbound_username text,
  outbound_encrypted_secret text,
  outbound_secret_iv text,
  outbound_secret_tag text,
  livekit_outbound_trunk_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table automation.automation_phone_sip_trunks enable row level security;
revoke all on automation.automation_phone_sip_trunks from public, anon, authenticated;
grant all on automation.automation_phone_sip_trunks to service_role;

-- Hansora's own number in the country: an imported number there is not one.
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
    where business_id = p_business and status = 'assigned' and country = upper(p_country) and provider <> 'sip';
  if found then return v_row; end if;
  select * into v_row from automation.automation_phone_numbers
    where status = 'available' and country = upper(p_country) and provider <> 'sip'
    order by created_at limit 1 for update skip locked;
  if not found then return null; end if;
  update automation.automation_phone_numbers
    set status = 'assigned', business_id = p_business, assigned_at = now(), updated_at = now()
    where id = v_row.id returning * into v_row;
  return v_row;
end $$;

-- Turning a number off: Hansora's numbers go back to the pool, imported ones are deleted.
create or replace function automation.automation_release_phone_number(p_business uuid, p_e164 text)
returns void
language plpgsql
security definer
set search_path = automation, public
as $$
begin
  delete from automation.automation_phone_numbers
    where business_id = p_business and status = 'assigned' and provider = 'sip' and (p_e164 is null or e164 = p_e164);
  update automation.automation_phone_numbers
    set status = 'available', business_id = null, assigned_at = null, updated_at = now()
    where business_id = p_business and status = 'assigned' and provider <> 'sip' and (p_e164 is null or e164 = p_e164);
end $$;

revoke all on function automation.automation_assign_phone_number(uuid, text) from public, anon, authenticated;
revoke all on function automation.automation_release_phone_number(uuid, text) from public, anon, authenticated;
grant execute on function automation.automation_assign_phone_number(uuid, text) to service_role;
grant execute on function automation.automation_release_phone_number(uuid, text) to service_role;

commit;
