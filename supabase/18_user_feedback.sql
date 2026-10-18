-- Feedback is write-only for signed-in users; review it in the Supabase Table Editor.
-- Safe to run again. Identity comes from Supabase Auth, never from form fields.
begin;
create table if not exists public.user_feedback (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete set null,
  email text,
  message text not null check (char_length(message) between 1 and 5000),
  page_path text not null default '' check (char_length(page_path) <= 500),
  language text not null default 'en' check (language in ('en', 'ru', 'hy')),
  created_at timestamptz not null default now()
);
create index if not exists user_feedback_user_created_idx on public.user_feedback (user_id, created_at desc);
alter table public.user_feedback enable row level security;
revoke all on public.user_feedback from public, anon, authenticated;
grant all on public.user_feedback to service_role;

create or replace function public.submit_user_feedback(
  p_request_id uuid, p_message text, p_page_path text default '', p_language text default 'en'
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_message text := btrim(p_message, E' \t\n\r');
  v_existing public.user_feedback%rowtype;
begin
  if v_user is null then raise exception 'FEEDBACK_AUTH_REQUIRED' using errcode = '28000'; end if;
  if p_request_id is null or v_message is null or char_length(v_message) not between 1 and 5000 then
    raise exception 'FEEDBACK_INVALID_MESSAGE' using errcode = '22023';
  end if;
  if p_page_path is null or char_length(p_page_path) > 500 or p_language is null or p_language not in ('en', 'ru', 'hy') then
    raise exception 'FEEDBACK_INVALID_CONTEXT' using errcode = '22023';
  end if;
  select u.email into v_email from auth.users u where u.id = v_user;
  if not found then raise exception 'FEEDBACK_AUTH_REQUIRED' using errcode = '28000'; end if;
  -- Serialize submissions per user, so concurrent requests cannot bypass the limit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 18));
  select * into v_existing from public.user_feedback where id = p_request_id;
  if found then
    if v_existing.user_id = v_user and v_existing.message = v_message then return v_existing.id; end if;
    raise exception 'FEEDBACK_REQUEST_CONFLICT' using errcode = '22023';
  end if;
  if (select count(*) from public.user_feedback where user_id = v_user and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'FEEDBACK_RATE_LIMITED' using errcode = 'P0001';
  end if;
  insert into public.user_feedback (id, user_id, email, message, page_path, language)
  values (p_request_id, v_user, v_email, v_message, p_page_path, p_language);
  return p_request_id;
end;
$$;
revoke all on function public.submit_user_feedback(uuid, text, text, text) from public, anon;
grant execute on function public.submit_user_feedback(uuid, text, text, text) to authenticated;
comment on table public.user_feedback is 'User feedback. Read in Table Editor; website users can only submit through the authenticated RPC.';
notify pgrst, 'reload schema';
commit;
