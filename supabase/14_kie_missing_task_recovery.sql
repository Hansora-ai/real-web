-- Apply before deploying the KIE checker/scheduled recovery function.
-- Credits and failure/refund metadata commit together; retries cannot pay twice.
begin;

create or replace function public.kie_missing_task_candidate(p_meta jsonb)
returns boolean language sql immutable set search_path = public as $$
  select
    lower(coalesce(p_meta->>'status', '')) in ('', 'pending', 'processing')
    and lower(trim(coalesce(p_meta->>'task_id', ''))) in ('', 'null', 'undefined')
    and lower(trim(coalesce(p_meta->>'taskId', ''))) in ('', 'null', 'undefined')
    and (
      p_meta->>'source' in (
        'kie', 'kling', 'nano-banana', 'nano-banana-pro', 'nano-banana-2',
        'nano-banana-2-lite', 'nano-banana-2-1', 'grok-image', 'gpt-image-1.5',
        'gpt-image-2', 'gpt-image-2-5', 'seedream-4.5', 'seedream-5-lite',
        'seedream-5-pro', 'seedream-5-flash', 'z-image', 'qwen-2', 'wan-2-7-image'
      )
      or p_meta->>'checker' = 'kie-check'
      or p_meta->>'provider_api' = 'market'
    );
$$;

create or replace function public.resolve_kie_missing_task(p_generation_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  generation public.user_generations%rowtype;
  billing jsonb;
  amount numeric := 0;
  new_credits public.profiles.credits%type;
  grace_seconds integer := 300;
  charged boolean;
begin
  select * into generation from public.user_generations
    where id = p_generation_id for update;
  if not found then return jsonb_build_object('status', 'ignored'); end if;
  billing := coalesce(generation.meta, '{}'::jsonb);
  if generation.result_url is not null or not coalesce(public.kie_missing_task_candidate(billing), false) then
    return jsonb_build_object('status', 'ignored');
  end if;
  -- At least five minutes for submission/callback races. Longer stored TTLs
  -- are honored up to thirty minutes; this never expires tasks that have IDs.
  if coalesce(billing->>'ttl_secs', '') ~ '^[0-9]{1,6}$' then
    grace_seconds := greatest(300, least(1800, (billing->>'ttl_secs')::integer));
  end if;
  if generation.created_at is null or generation.created_at > now() - make_interval(secs => grace_seconds) then
    return jsonb_build_object('status', 'pending', 'error', 'missing_task_id');
  end if;

  charged := lower(coalesce(billing->>'charged', '')) = 'true';
  if charged and lower(coalesce(billing->>'subscription_unlimited', 'false')) <> 'true'
      and coalesce(billing->>'refund_amount', '') ~ '^[0-9]+([.][0-9]+)?$' then
    amount := (billing->>'refund_amount')::numeric;
  end if;
  billing := billing || jsonb_build_object(
    'status', 'failed', 'failed', true, 'error', 'missing_task_id_timeout', 'failed_at', now()
  );
  if lower(coalesce(billing->>'refunded', '')) = 'true' then
    amount := 0;
  elsif coalesce(billing->>'refund_claim', '') <> '' then
    -- A legacy claim may already have paid. Keep it for manual reconciliation.
    billing := billing || jsonb_build_object('refund_error', 'legacy_refund_claim_requires_review');
    amount := 0;
  elsif amount > 0 then
    update public.profiles set credits = coalesce(credits, 0) + amount
      where user_id = generation.user_id returning credits into new_credits;
    if not found then
      -- Abort the whole transaction so the sweep can retry after profile repair.
      raise exception 'Refund profile missing for generation %', generation.id;
    end if;
    billing := billing || jsonb_build_object(
      'refunded', true, 'refunded_cost', amount, 'refunded_at', now(),
      'refund_reason', 'missing_task_id_timeout'
    );
  else
    billing := billing || jsonb_build_object('refund_skipped_reason',
      case when not charged then 'not_charged'
        when lower(coalesce(billing->>'subscription_unlimited', '')) = 'true' then 'subscription_unlimited'
        else 'missing_refund_amount' end);
  end if;
  update public.user_generations set meta = billing where id = generation.id;
  return jsonb_build_object('status', 'failed', 'failed', true,
    'error', 'missing_task_id_timeout', 'refunded', lower(coalesce(billing->>'refunded', '')) = 'true',
    'refund_amount', amount);
end;
$$;

create or replace function public.sweep_kie_missing_tasks(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  candidate record;
  outcome jsonb;
  checked integer := 0;
  failed integer := 0;
  refunded integer := 0;
  errors integer := 0;
begin
  for candidate in
    select id from public.user_generations
    where result_url is null and public.kie_missing_task_candidate(meta)
      and created_at <= now() - make_interval(secs =>
        case when coalesce(meta->>'ttl_secs', '') ~ '^[0-9]{1,6}$'
          then greatest(300, least(1800, (meta->>'ttl_secs')::integer)) else 300 end)
    order by created_at asc limit greatest(1, least(500, coalesce(p_limit, 100)))
    for update skip locked
  loop
    checked := checked + 1;
    begin
      outcome := public.resolve_kie_missing_task(candidate.id);
      if outcome->>'status' = 'failed' then failed := failed + 1; end if;
      if (outcome->>'refund_amount')::numeric > 0 then refunded := refunded + 1; end if;
    exception when others then
      -- Each row is a subtransaction; a bad profile cannot block everyone else.
      errors := errors + 1;
      raise warning 'KIE missing task recovery failed for %: %', candidate.id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('checked', checked, 'failed', failed, 'refunded', refunded, 'errors', errors);
end;
$$;

revoke all on function public.kie_missing_task_candidate(jsonb) from public, anon, authenticated;
revoke all on function public.resolve_kie_missing_task(uuid) from public, anon, authenticated;
revoke all on function public.sweep_kie_missing_tasks(integer) from public, anon, authenticated;
grant execute on function public.resolve_kie_missing_task(uuid) to service_role;
grant execute on function public.sweep_kie_missing_tasks(integer) to service_role;

commit;
notify pgrst, 'reload schema';
