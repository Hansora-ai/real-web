-- A business can have several Hansora numbers, also in the same country: "Get a new phone number"
-- always assigns a free number (the older automation_assign_phone_number returned the existing one).
begin;

create or replace function automation.automation_assign_new_phone_number(p_business uuid, p_country text)
returns automation.automation_phone_numbers
language plpgsql
security definer
set search_path to 'automation', 'public'
as $function$
declare
  v_row automation.automation_phone_numbers;
begin
  select * into v_row from automation.automation_phone_numbers
    where status = 'available' and country = upper(p_country) and provider <> 'sip'
    order by created_at limit 1 for update skip locked;
  if not found then return null; end if;
  update automation.automation_phone_numbers
    set status = 'assigned', business_id = p_business, assigned_at = now(), updated_at = now()
    where id = v_row.id returning * into v_row;
  return v_row;
end $function$;

revoke all on function automation.automation_assign_new_phone_number(uuid, text) from public, anon, authenticated;
grant execute on function automation.automation_assign_new_phone_number(uuid, text) to service_role;

commit;
