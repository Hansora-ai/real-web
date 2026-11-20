-- ChatGPT "not enough credits" funnel, per day (UTC):
--   stopped      users ChatGPT stopped for not enough credits (each was sent the hansora.co account line)
--   opened_link  of those, users who opened hansora.co from that link afterwards (signed in on the site)
--   bought       of those, users who paid afterwards (any time after the stop)
--   bought_after_link  paid after opening the link
-- anonymous_opens: link opens by visitors not signed in on the site (cannot be matched to a user).
-- The link is hansora.co/?from=chatgpt_credits; public/header.js saves each open once per visit as
-- element_label 'chatgpt_credits_link_opened' in click_events (signed in) or anonymous_click_events.
with stops as (
  select user_id, (created_at at time zone 'UTC')::date as day, min(created_at) as first_stop
  from public.chatgpt_events
  where tool = 'create_generation' and outcome = 'insufficient_credits'
    and created_at >= now() - interval '14 days'
    and user_id not in ('45c5cfc7-090e-491f-a304-05f863bbdf85', 'a1102230-2b84-49e4-8452-4a6b650de87a')
  group by 1, 2
), funnel as (
  select s.day, s.user_id,
    (select min(c.created_at) from public.click_events c
      where c.user_id = s.user_id and c.element_label = 'chatgpt_credits_link_opened' and c.created_at >= s.first_stop) as opened_at,
    (select min(coalesce(p.paid_at, p.created_at)) from public.payments p
      where p.uid = s.user_id and p.status in ('succeeded', 'paid', 'completed', 'success')
        and coalesce(p.paid_at, p.created_at) >= s.first_stop) as paid_at
  from stops s
)
select f.day,
  count(*) as stopped,
  count(f.opened_at) as opened_link,
  count(f.paid_at) as bought,
  count(f.paid_at) filter (where f.opened_at is not null and f.paid_at >= f.opened_at) as bought_after_link,
  (select count(*) from public.anonymous_click_events a
    where a.element_label = 'chatgpt_credits_link_opened' and (a.created_at at time zone 'UTC')::date = f.day) as anonymous_opens
from funnel f
group by f.day
order by f.day desc;
