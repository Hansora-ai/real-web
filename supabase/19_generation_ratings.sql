-- 👍 / 👎 ratings from the ChatGPT result card, with optional reasons and a short comment after 👎.
-- Review them in the Table Editor.
-- Safe to run again. The card has no user session, so the rating is accepted only for an existing
-- ChatGPT run id (long and random), and account, email, model and prompt are copied from that row,
-- never from the request.
begin;
create table if not exists public.generation_ratings (
  run_id text primary key check (char_length(run_id) between 8 and 160),
  generation_id uuid,
  user_id uuid references auth.users(id) on delete set null,
  email text,
  provider text,
  model text,
  prompt text,
  rating smallint not null check (rating in (-1, 1)),
  reasons text[] not null default '{}',
  comment text check (comment is null or char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.generation_ratings add column if not exists reasons text[] not null default '{}';
alter table public.generation_ratings add column if not exists comment text;
create index if not exists generation_ratings_created_idx on public.generation_ratings (created_at desc);
create index if not exists generation_ratings_model_idx on public.generation_ratings (model, rating);
alter table public.generation_ratings enable row level security;
revoke all on public.generation_ratings from public, anon, authenticated;
grant all on public.generation_ratings to service_role;

drop function if exists public.rate_generation(text, integer);
create or replace function public.rate_generation(p_run_id text, p_rating integer, p_reasons text[] default '{}', p_comment text default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_row record;
  v_email text;
  v_reasons text[] := coalesce(p_reasons, '{}');
  v_comment text := nullif(btrim(coalesce(p_comment, ''), E' \t\n\r'), '');
begin
  if p_rating is null or p_rating not in (-1, 1) then raise exception 'RATING_INVALID' using errcode = '22023'; end if;
  if cardinality(v_reasons) > 6 or exists (select 1 from unnest(v_reasons) r where char_length(r) not between 1 and 40) then
    raise exception 'RATING_INVALID' using errcode = '22023';
  end if;
  if v_comment is not null and char_length(v_comment) > 500 then raise exception 'RATING_INVALID' using errcode = '22023'; end if;
  if p_run_id is null or char_length(p_run_id) not between 8 and 160 or p_run_id not like '%-mcp-%' then
    raise exception 'RATING_UNKNOWN_RUN' using errcode = '22023';
  end if;
  select g.id, g.user_id, g.provider, g.prompt, coalesce(g.meta->>'model_id', g.meta->>'engine', g.meta->>'model', g.provider) as model
    into v_row
    from public.user_generations g
    where g.meta->>'run_id' = p_run_id
    order by g.created_at desc
    limit 1;
  if not found then raise exception 'RATING_UNKNOWN_RUN' using errcode = '22023'; end if;
  select u.email into v_email from auth.users u where u.id = v_row.user_id;
  insert into public.generation_ratings (run_id, generation_id, user_id, email, provider, model, prompt, rating, reasons, comment)
  values (p_run_id, v_row.id, v_row.user_id, v_email, v_row.provider, v_row.model, left(v_row.prompt, 5000), p_rating,
    case when p_rating = -1 then v_reasons else '{}' end, case when p_rating = -1 then v_comment else null end)
  on conflict (run_id) do update set rating = excluded.rating, reasons = excluded.reasons, comment = excluded.comment, updated_at = now();
  return p_run_id;
end;
$$;
revoke all on function public.rate_generation(text, integer, text[], text) from public;
grant execute on function public.rate_generation(text, integer, text[], text) to anon, authenticated;
comment on table public.generation_ratings is 'Thumbs up/down from the ChatGPT result card. One row per run; changing the vote updates it.';
notify pgrst, 'reload schema';
commit;
