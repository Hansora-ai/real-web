-- Hansora Automation: exact prices below 1⚡ steps (1.2⚡, 0.8⚡, 0.3⚡ …).
-- profiles.credits keeps one decimal (1⚡ steps), so Automation remembers the leftover part of each charge per
-- account and takes whole ⚡ from the balance as soon as the leftovers add up. Hansora Creative is not changed.
-- Safe to run more than once.
begin;

create table if not exists automation.automation_credit_carry (
  user_id uuid primary key references auth.users(id) on delete cascade,
  carry numeric(12,4) not null default 0,
  updated_at timestamptz not null default now()
);
alter table automation.automation_credit_carry enable row level security;
grant all on automation.automation_credit_carry to service_role;

-- Adds p_amount (stored credits, may be negative for a refund) to the account's leftover and returns how much to
-- take from (or give back to) the balance now, always in whole 0.1 steps. Row lock = safe with parallel replies.
create or replace function automation.automation_take_fraction(p_user uuid, p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path = automation, public
as $$
declare
  v_total numeric;
  v_due numeric;
begin
  insert into automation.automation_credit_carry (user_id) values (p_user) on conflict (user_id) do nothing;
  select carry + p_amount into v_total from automation.automation_credit_carry where user_id = p_user for update;
  v_due := floor(v_total * 10) / 10;
  update automation.automation_credit_carry set carry = v_total - v_due, updated_at = now() where user_id = p_user;
  return v_due;
end $$;

revoke all on function automation.automation_take_fraction(uuid, numeric) from public, anon, authenticated;
grant execute on function automation.automation_take_fraction(uuid, numeric) to service_role;

commit;
