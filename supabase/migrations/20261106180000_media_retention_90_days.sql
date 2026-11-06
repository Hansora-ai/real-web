-- Generations and the media people upload are kept for 90 days, then deleted.
--
-- Replaces the older 30/60-day cleanup jobs. Those built the Storage delete URL from the raw file name,
-- so one file with a space or a bracket in its name ("ChatGPT Image Jun 23, 2026, 11_30_53 PM.png")
-- made pg_net reject the URL and the whole run failed, every run, and old files piled up.
--
-- The service role key is read from Vault (secret name: storage_cleanup_service_key), never stored here.

begin;

-- Percent-encode each character of a Storage object name, keeping "/" between folders.
create or replace function public.storage_object_url_path(p_name text)
returns text
language sql
immutable
as $$
  select coalesce(string_agg(
    case when ch ~ '^[A-Za-z0-9._~/-]$' then ch
         else upper(regexp_replace(encode(convert_to(ch, 'UTF8'), 'hex'), '(..)', '%\1', 'g'))
    end, '' order by pos), '')
  from regexp_split_to_table(p_name, '') with ordinality as t(ch, pos);
$$;

-- Deletes up to p_limit files older than p_days from one bucket (optionally only under some folders)
-- through the Storage API, so the file itself is removed, not just its database row.
create or replace function public.cleanup_storage_objects(
  p_bucket text,
  p_prefixes text[] default null,
  p_days integer default 90,
  p_limit integer default 500
)
returns table(request_id bigint, object_name text)
language plpgsql
security definer
set search_path to 'public', 'storage', 'net', 'extensions'
as $$
declare
  v_key text;
  v_url text := 'https://qmaealblegvcwodlmeht.supabase.co';
  r record;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'storage_cleanup_service_key' limit 1;
  if v_key is null then
    raise exception 'Vault secret storage_cleanup_service_key is missing';
  end if;

  for r in
    select o.name
    from storage.objects o
    where o.bucket_id = p_bucket
      and o.created_at < now() - make_interval(days => greatest(p_days, 1))
      and o.name not like '%.emptyFolderPlaceholder'
      and (p_prefixes is null or exists (select 1 from unnest(p_prefixes) as pre where o.name like pre || '%'))
    order by o.created_at asc
    limit p_limit
  loop
    request_id := net.http_delete(
      url := v_url || '/storage/v1/object/' || public.storage_object_url_path(p_bucket) || '/' || public.storage_object_url_path(r.name),
      headers := jsonb_build_object('apikey', v_key, 'Authorization', 'Bearer ' || v_key),
      timeout_milliseconds := 10000
    );
    object_name := r.name;
    return next;
  end loop;
end;
$$;

create or replace function public.cleanup_user_generations(p_days integer default 90)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  deleted_count integer;
begin
  delete from public.user_generations where created_at < now() - make_interval(days => greatest(p_days, 1));
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_storage_objects(text, text[], integer, integer) from public, anon, authenticated;
revoke all on function public.cleanup_user_generations(integer) from public, anon, authenticated;

-- Swap the old jobs for 90-day ones.
do $$
declare j text;
begin
  foreach j in array array[
    'cleanup-video-long-term-media-older-than-30-days',
    'cleanup-video-user-uploads-older-than-60-days',
    'cleanup-user-generations-older-than-60-days',
    'cleanup-generation-history-older-than-60-days'
  ] loop
    if exists (select 1 from cron.job where jobname = j) then perform cron.unschedule(j); end if;
  end loop;
end $$;

select cron.schedule('retention-90d-generation-history', '0 */6 * * *',
  $$select * from public.cleanup_storage_objects('generation-history', null, 90, 500)$$);
select cron.schedule('retention-90d-video-media', '10 */6 * * *',
  $$select * from public.cleanup_storage_objects('video', array['images/user-uploads/', 'audio/', '2025/', '2026/'], 90, 500)$$);
select cron.schedule('retention-90d-user-generations', '20 */6 * * *',
  $$select public.cleanup_user_generations(90)$$);

drop function if exists public.cleanup_video_long_term_media_older_than_30d();
drop function if exists public.cleanup_video_user_uploads(text);
drop function if exists public.cleanup_user_generations_older_than_60d();
drop function if exists public.cleanup_generation_history_older_than_60d();

commit;
