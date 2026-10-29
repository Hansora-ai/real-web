-- Twilio numbers join the phone number pool.
begin;
alter table automation.automation_phone_numbers drop constraint if exists automation_phone_numbers_provider_check;
alter table automation.automation_phone_numbers add constraint automation_phone_numbers_provider_check
  check (provider in ('twilio', 'telnyx', 'livekit', 'operator'));
commit;
