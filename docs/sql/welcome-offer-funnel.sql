-- Welcome offer funnel, per day (UTC), last 14 days. The offer: lib/business/chatgpt-offer.mjs.
--   started          people whose 8-hour timer started that day (they opened the pricing page)
--   popup_shown      of those, people who were shown the $4.99 starter popup
--   popup_closed     of those, people who closed it (X, "No thanks" or a click outside)
--   popup_reopened   of those, people who opened it again from the small "Starter pack" button
--   starter_clicked  of those, people who clicked Buy in the popup
--   bought_starter   of those, people who bought the $4.99 starter
--   bought_bonus     of those, people who bought a pack with the +25% credits
--   expired_unused   of those, people whose 8 hours ended without a purchase
-- Clicks come from click_events (element_label = the event name, saved by public/chatgpt-offer.js);
-- purchases come from chatgpt_offers, which the Dodo webhook fills in.
with offers as (
  select o.*, (o.started_at at time zone 'UTC')::date as day
  from public.chatgpt_offers o
  where o.started_at >= now() - interval '14 days'
), events as (
  select c.user_id, c.element_label
  from public.click_events c
  where c.created_at >= now() - interval '15 days' and c.element_label like 'welcome_%'
  group by 1, 2
)
select o.day,
  count(*) as started,
  count(*) filter (where exists (select 1 from events e where e.user_id = o.user_id and e.element_label = 'welcome_starter_shown')) as popup_shown,
  count(*) filter (where exists (select 1 from events e where e.user_id = o.user_id and e.element_label = 'welcome_starter_closed')) as popup_closed,
  count(*) filter (where exists (select 1 from events e where e.user_id = o.user_id and e.element_label = 'welcome_starter_reopened')) as popup_reopened,
  count(*) filter (where exists (select 1 from events e where e.user_id = o.user_id and e.element_label = 'welcome_starter_buy_clicked')) as starter_clicked,
  count(*) filter (where o.used_product = 'pdt_0NrmWsHzjAdxHAYd4QOSG') as bought_starter,
  count(*) filter (where o.used_at is not null and o.used_product <> 'pdt_0NrmWsHzjAdxHAYd4QOSG') as bought_bonus,
  count(*) filter (where o.used_at is null and o.expires_at < now()) as expired_unused
from offers o
group by o.day
order by o.day desc;

-- The same people one by one, newest first: who started, what they did, what they bought.
-- select o.started_at, u.email, o.expires_at, o.used_at, o.used_product, o.granted_credits * 10 as credits_shown,
--   (select string_agg(distinct c.element_label || coalesce(' (' || c.element_id || ')', ''), ', ')
--      from public.click_events c where c.user_id = o.user_id and c.element_label like 'welcome_%') as actions
-- from public.chatgpt_offers o join auth.users u on u.id = o.user_id
-- order by o.started_at desc limit 100;
