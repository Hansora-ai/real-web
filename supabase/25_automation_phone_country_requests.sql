-- Countries owners look at on the phone page, and whether they asked to be
-- emailed when local numbers open there. A row is saved as soon as an owner
-- picks a country (even if they then leave). Written only by the server
-- (automation-phone-line), with the signed-in owner's email.
--
-- Most looked-at countries:
--   select country, count(*) as owners, count(*) filter (where wants_email) as want_email
--   from automation.automation_phone_country_requests group by country order by owners desc;
-- Who to email for one country (then set notified_at):
--   select email, created_at from automation.automation_phone_country_requests
--   where country = 'PL' and wants_email and notified_at is null;
begin;

create table if not exists automation.automation_phone_country_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text,
  business_id uuid references automation.automation_businesses(id) on delete set null,
  country text not null check (country ~ '^[A-Z]{2}$'),
  wants_email boolean not null default false,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  unique (user_id, country)
);

alter table automation.automation_phone_country_requests enable row level security;
revoke all on automation.automation_phone_country_requests from anon, authenticated;
grant all on automation.automation_phone_country_requests to service_role;

commit;
