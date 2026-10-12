-- Apply before deploying Caption Studio refunds.
-- Each auto-caption charge is recorded once; a failed job can be refunded once,
-- within 30 minutes, at most 3 times per user per day. Credits and the refund
-- record change together, so a retry can never pay twice.
begin;

create table if not exists public.caption_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  cost numeric not null check (cost > 0),
  seconds numeric not null,
  videos integer not null,
  created_at timestamptz not null default now(),
  refunded numeric not null default 0,
  refunded_at timestamptz
);
create index if not exists caption_jobs_user_created on public.caption_jobs (user_id, created_at desc);
alter table public.caption_jobs enable row level security;
-- No policies: only the server (service role) reads or writes this table.

create or replace function public.refund_caption_job(p_job uuid, p_user uuid, p_kept_cost numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  job public.caption_jobs%rowtype;
  amount numeric;
  recent integer;
begin
  select * into job from public.caption_jobs where id = p_job and user_id = p_user for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if job.refunded_at is not null then return jsonb_build_object('status', 'already_refunded'); end if;
  if job.created_at < now() - interval '30 minutes' then return jsonb_build_object('status', 'expired'); end if;
  select count(*) into recent from public.caption_jobs
    where user_id = p_user and refunded_at > now() - interval '1 day';
  if recent >= 3 then return jsonb_build_object('status', 'limit'); end if;
  amount := greatest(0, least(job.cost, job.cost - greatest(0, coalesce(p_kept_cost, 0))));
  if amount <= 0 then return jsonb_build_object('status', 'nothing_to_refund'); end if;
  update public.caption_jobs set refunded = amount, refunded_at = now() where id = p_job;
  update public.profiles set credits = round((coalesce(credits, 0) + amount)::numeric, 2) where user_id = p_user;
  return jsonb_build_object('status', 'refunded', 'amount', amount);
end;
$$;
revoke all on function public.refund_caption_job(uuid, uuid, numeric) from public, anon, authenticated;

commit;
