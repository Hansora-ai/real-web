-- Core table definitions and functions read from production on 2026-10-12.
-- Related record tables below retain only columns needed to test their verified FKs.
create schema auth;
create table auth.users (id uuid primary key);
create role anon;
create role authenticated;
create role service_role;
create table public.chat_sessions (
  id uuid not null default gen_random_uuid (),
  user_id uuid null,
  anonymous_secret_hash text null,
  language text not null default 'en'::text,
  summary text not null default ''::text,
  sales_memory jsonb not null default '{}'::jsonb,
  summary_through_sequence bigint not null default 0,
  catalog_version text not null default '2026-09-15.1'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null default (now() + '90 days'::interval),
  constraint chat_sessions_pkey primary key (id),
  constraint chat_sessions_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint chat_sessions_anonymous_secret_hash_check check (
    (
      (anonymous_secret_hash is null)
      or (char_length(anonymous_secret_hash) = 64)
    )
  ),
  constraint chat_sessions_check check (
    (
      (user_id is null) <> (anonymous_secret_hash is null)
    )
  ),
  constraint chat_sessions_language_check check (
    (
      language = any (array['en'::text, 'hy'::text, 'ru'::text])
    )
  )
) TABLESPACE pg_default;

create unique INDEX IF not exists chat_sessions_anonymous_secret_hash_uidx on public.chat_sessions using btree (anonymous_secret_hash) TABLESPACE pg_default
where
  (anonymous_secret_hash is not null);

create index IF not exists chat_sessions_user_updated_idx on public.chat_sessions using btree (user_id, updated_at desc) TABLESPACE pg_default
where
  (user_id is not null);
CREATE OR REPLACE FUNCTION public.touch_chat_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 update public.chat_sessions
 set updated_at = greatest(now(), new.created_at),
 expires_at = greatest(expires_at, now() + interval '90 days')
 where id = new.session_id;
 return new;
end;
$function$;

create table public.chat_messages (
  id uuid not null default gen_random_uuid (),
  session_id uuid not null,
  sequence bigint not null,
  request_id uuid not null,
  role text not null,
  content text not null,
  response_json jsonb null,
  status text not null default 'completed'::text,
  model_used text null,
  input_tokens integer null,
  cached_input_tokens integer null,
  output_tokens integer null,
  reviewed_status text null,
  human_correction text null,
  training_eligible boolean not null default false,
  created_at timestamp with time zone not null default now(),
  constraint chat_messages_pkey primary key (id),
  constraint chat_messages_session_id_request_id_role_key unique (session_id, request_id, role),
  constraint chat_messages_session_id_sequence_key unique (session_id, sequence),
  constraint chat_messages_session_id_fkey foreign KEY (session_id) references chat_sessions (id) on delete CASCADE,
  constraint chat_messages_status_check check (
    (
      status = any (
        array[
          'pending'::text,
          'completed'::text,
          'failed'::text
        ]
      )
    )
  ),
  constraint chat_messages_reviewed_status_check check (
    (
      (reviewed_status is null)
      or (
        reviewed_status = any (
          array[
            'approved'::text,
            'rejected'::text,
            'corrected'::text
          ]
        )
      )
    )
  ),
  constraint chat_messages_role_check check (
    (
      role = any (array['user'::text, 'assistant'::text])
    )
  ),
  constraint chat_messages_content_check check (
    (
      (char_length(content) >= 1)
      and (char_length(content) <= 12000)
    )
  )
) TABLESPACE pg_default;

create index IF not exists chat_messages_session_created_idx on public.chat_messages using btree (session_id, created_at desc) TABLESPACE pg_default;

create trigger chat_messages_touch_session
after INSERT on chat_messages for EACH row
execute FUNCTION touch_chat_session ();
CREATE OR REPLACE FUNCTION public.append_chat_message(p_session_id uuid, p_request_id uuid, p_role text, p_content text, p_response_json jsonb DEFAULT NULL::jsonb, p_status text DEFAULT 'completed'::text, p_model_used text DEFAULT NULL::text, p_input_tokens integer DEFAULT NULL::integer, p_cached_input_tokens integer DEFAULT NULL::integer, p_output_tokens integer DEFAULT NULL::integer)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_row public.chat_messages;
 v_sequence bigint;
begin
 if p_role not in ('user', 'assistant')
 or p_status not in ('pending', 'completed', 'failed')
 or char_length(coalesce(p_content, '')) not between 1 and 12000 then
 raise exception 'Invalid chat message';
 end if;

 perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));
 select coalesce(max(sequence), 0) + 1 into v_sequence
 from public.chat_messages
 where session_id = p_session_id;

 insert into public.chat_messages (
 session_id, sequence, request_id, role, content, response_json, status,
 model_used, input_tokens, cached_input_tokens, output_tokens
 ) values (
 p_session_id, v_sequence, p_request_id, p_role, p_content, p_response_json,
 p_status, p_model_used, p_input_tokens, p_cached_input_tokens, p_output_tokens
 )
 on conflict (session_id, request_id, role) do update set
 content = excluded.content,
 response_json = excluded.response_json,
 status = excluded.status,
 model_used = excluded.model_used,
 input_tokens = excluded.input_tokens,
 cached_input_tokens = excluded.cached_input_tokens,
 output_tokens = excluded.output_tokens
 returning * into v_row;

 return v_row;
end;
$function$;


create table public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.chat_sessions(id) on delete set null,
  message_id uuid references public.chat_messages(id) on delete set null
);
create table public.chat_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.chat_sessions(id) on delete cascade,
  message_id uuid references public.chat_messages(id) on delete set null
);
create table public.chat_purchase_attributions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.chat_sessions(id) on delete restrict,
  message_id uuid references public.chat_messages(id) on delete set null
);
-- PGlite cannot load pg_cron; this stub checks named schedule replacement only.
create schema cron;
create table cron.job (
  jobid bigint generated always as identity primary key,
  jobname text unique, schedule text, command text
);
create function cron.schedule(p_name text, p_schedule text, p_command text)
returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command)
  values(p_name, p_schedule, p_command)
  on conflict(jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid;
$$;
