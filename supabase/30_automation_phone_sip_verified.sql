-- An imported SIP number only counts as connected once a real call has arrived on it
-- (the phone worker sets verified_at on the first call). Before that it is "Not connected yet":
-- it does not make the phone channel live, and the owner sees what is left to do.
begin;

alter table automation.automation_phone_numbers add column if not exists verified_at timestamptz;

commit;
