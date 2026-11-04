-- Outgoing calls: the AI calls a customer back, or calls the owner to hand a caller over (warm transfer).
-- A number can make calls when it has a LiveKit outbound trunk. Calls stay inside the number's country
-- unless Hansora turns on allow_international for that number (owners can only read this table).
begin;

alter table automation.automation_phone_numbers
  add column if not exists livekit_outbound_trunk_id text,
  add column if not exists allow_international boolean not null default false;

commit;
