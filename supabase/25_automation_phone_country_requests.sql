-- Owners asking for local phone numbers in a country Hansora does not offer yet.
-- Written only by the server (automation-phone-line), with the signed-in
-- owner's email, so Hansora knows which countries to register next and whom
-- to tell when they open.
--
-- Most requested countries:
--   select country, count(*) from automation.automation_phone_country_requests
--   where notified_at is null group by country order by count(*) desc;
-- Who to email for one country (then set notified_at):
--   select email, created_at from automation.automation_phone_country_requests
--   where country = 'PL' and notified_at is null;
begin;

create table if not exists automation.automation_phone_country_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text,
  business_id uuid references automation.automation_businesses(id) on delete set null,
  country text not null check (country ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  unique (user_id, country)
);

alter table automation.automation_phone_country_requests enable row level security;
revoke all on automation.automation_phone_country_requests from anon, authenticated;
grant all on automation.automation_phone_country_requests to service_role;

commit;
