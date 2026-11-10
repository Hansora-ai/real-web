-- First-video test (Grok vs Wan 3.0), from the day it started. One row per first-video model.
--   users          new users whose first video (first_video_recipe) was made with that model
--   thumbs_up/down ratings of those first videos (from the result card; the rate_generation RPC was made in the
--                  Supabase dashboard, so if it stores ratings elsewhere than meta.rating, adjust these two lines)
--   bought         of those users, how many paid afterwards
--   result_link_opened  how many opened "check your generations" (hansora.co/usage.html?from=chatgpt_result)
-- Grok half: user ids ending in an odd hex digit; Wan half: even (lib/hansora-mcp/credits.mjs firstVideoGroup).
with firsts as (
  select distinct on (user_id) user_id, model_id, run_id, created_at
  from public.chatgpt_events
  where tool = 'first_video_recipe' and created_at >= '2026-11-11'
    and user_id not in ('45c5cfc7-090e-491f-a304-05f863bbdf85', 'a1102230-2b84-49e4-8452-4a6b650de87a')
  order by user_id, created_at
)
select f.model_id as first_video_model,
  count(*) as users,
  count(*) filter (where g.meta->>'rating' = '1' or g.meta->>'user_rating' = '1') as thumbs_up,
  count(*) filter (where g.meta->>'rating' = '-1' or g.meta->>'user_rating' = '-1') as thumbs_down,
  count(*) filter (where exists (select 1 from public.payments p where p.uid = f.user_id
      and p.status in ('succeeded', 'paid', 'completed', 'success') and coalesce(p.paid_at, p.created_at) >= f.created_at)) as bought,
  count(*) filter (where exists (select 1 from public.click_events c where c.user_id = f.user_id
      and c.element_label = 'chatgpt_result_link_opened')) as result_link_opened
from firsts f
left join public.user_generations g on g.user_id = f.user_id and g.meta->>'run_id' = f.run_id
group by f.model_id
order by users desc;
