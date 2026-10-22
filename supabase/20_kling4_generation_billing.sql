-- Apply AFTER 18_reapi_generation_billing.sql, BEFORE deploying Kling 4.0 / Henshin Lite.
-- Extend the existing atomic ledger and protection to KIE Kling 4.0; old jobs are unchanged.
-- Every balance mutation commits with the generation metadata under row locks.
begin;
-- History clients may update input diagnostics for older models. reAPI billing,
-- task ids and callback secrets must remain server-owned, including while pending.
create or replace function public.protect_reapi_generation()
returns trigger language plpgsql set search_path=public as $$
declare
  audio_fields text[] := array['status','completed_at','generated_video_url','audio_lease','audio_lease_until','audio_attempts','audio_error','audio_retry_at','audio_restored','audio_restored_at'];
begin
  if current_user in ('anon','authenticated','service_role') then
    if tg_op='INSERT' and new.meta->>'source' in ('reapi','kie-kling4') then raise exception 'Server-owned generation'; end if;
    if tg_op='UPDATE' and (old.meta->>'source' in ('reapi','kie-kling4') or new.meta->>'source' in ('reapi','kie-kling4')) then
      -- Billing transitions run as this migration's function owner. Direct
      -- service-role PATCHes from legacy checkers must not refund/complete these
      -- jobs. Only the existing Henshin soundtrack worker's narrow fields remain
      -- writable directly; its endpoint already requires an internal HMAC.
      if current_user='service_role' and old.meta->>'source_feature'='henshin'
          and new.id=old.id and new.user_id=old.user_id and new.provider=old.provider
          and new.kind=old.kind and new.prompt is not distinct from old.prompt then
        if new.result_url is not distinct from old.result_url and
            new.meta-'finisher_dispatched_at'=old.meta-'finisher_dispatched_at' then return new; end if;
        if old.meta->>'status' in ('restoring_audio','audio_retry','audio_failed')
            and new.meta->>'status' in ('restoring_audio','audio_retry','audio_failed','done')
            and new.meta-audio_fields=old.meta-audio_fields
            and (new.result_url is null or (new.meta->>'status'='done' and new.meta->>'audio_restored'='true')) then return new; end if;
      end if;
      raise exception 'Server-owned generation';
    end if;
    if tg_op='DELETE' and old.meta->>'source' in ('reapi','kie-kling4') and old.result_url is null and old.meta->>'status'<>'failed' then raise exception 'Wait for generation completion before deleting'; end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
drop trigger if exists protect_reapi_generation on public.user_generations;
create trigger protect_reapi_generation before insert or update or delete on public.user_generations for each row execute function public.protect_reapi_generation();
create or replace function public.reapi_generation_transition(
  p_action text, p_id uuid, p_user uuid, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g public.user_generations%rowtype;
  m jsonb;
  amount numeric;
  balance public.profiles.credits%type;
  inserted integer;
  task text;
begin
  if p_action = 'reserve' then
    m := p_payload->'meta';
    amount := (m->>'refund_amount')::numeric;
    if coalesce(m->>'source','') not in ('reapi','kie-kling4') or amount is null or amount <= 0 or amount <> round(amount, 1) then
      raise exception 'Invalid reAPI charge';
    end if;
    insert into public.user_generations(id,user_id,provider,kind,prompt,result_url,meta)
      values(p_id,p_user,p_payload->>'provider','video',p_payload->>'prompt',null,m)
      on conflict(id) do nothing;
    get diagnostics inserted = row_count;
    if inserted = 0 then
      select * into g from public.user_generations where id=p_id and user_id=p_user;
      if not found then raise exception 'Generation owner mismatch'; end if;
      return jsonb_build_object('created',false,'row',to_jsonb(g));
    end if;
    update public.profiles set credits=credits-amount where user_id=p_user and credits>=amount returning credits into balance;
    if not found then raise exception 'not_enough_credits'; end if;
    m := m || jsonb_build_object('charged',true,'charged_cost',amount,'debited',amount,'charged_at',now());
    update public.user_generations set meta=m where id=p_id returning * into g;
    return jsonb_build_object('created',true,'credits',balance,'row',to_jsonb(g));
  end if;

  select * into g from public.user_generations where id=p_id and user_id=p_user for update;
  if not found or coalesce(g.meta->>'source','') not in ('reapi','kie-kling4') then raise exception 'reAPI generation unavailable'; end if;
  m := g.meta;
  -- Terminal state is immutable. Repeated callbacks cannot pay or complete twice.
  if g.result_url is not null or m->>'status' in ('done','failed') or m->>'refunded'='true' then
    return jsonb_build_object('changed',false,'row',to_jsonb(g));
  end if;
  if p_action = 'attach' then
    task := p_payload->>'task_id';
    if task is null or task !~ '^[a-zA-Z0-9_.-]{1,200}$' then raise exception 'Invalid task id'; end if;
    if nullif(m->>'task_id','') is not null and m->>'task_id' <> task then raise exception 'Task id mismatch'; end if;
    m := m || jsonb_build_object('task_id',task,'submission_uncertain',false);
    if m->>'status'='pending' then m:=m||jsonb_build_object('status','processing'); end if;
  elsif p_action = 'uncertain' then
    if nullif(m->>'task_id','') is null then m:=m||jsonb_build_object('submission_uncertain',true); end if;
  elsif p_action = 'touch' then
    m := m || jsonb_build_object('reapi_checked_at',now());
  elsif p_action = 'fail' then
    -- Only a confirmed provider failure/rejection or an orphan with no task id.
    if p_payload->>'orphan'='true' and (nullif(m->>'task_id','') is not null or g.created_at > now()-interval '30 minutes') then
      return jsonb_build_object('changed',false,'row',to_jsonb(g));
    end if;
    if m->>'status' not in ('pending','processing') then return jsonb_build_object('changed',false,'row',to_jsonb(g)); end if;
    amount := case when m->>'charged'='true' then (m->>'refund_amount')::numeric else 0 end;
    if amount > 0 then
      update public.profiles set credits=coalesce(credits,0)+amount where user_id=p_user returning credits into balance;
      if not found then raise exception 'Refund profile missing'; end if;
    end if;
    m := m || jsonb_build_object('status','failed','failed',true,'error',coalesce(p_payload->>'error','Generation failed.'),'failed_at',now(),
      'refunded',amount>0,'refunded_cost',amount,'refunded_at',now());
  elsif p_action = 'complete' then
    if m->>'status' not in ('pending','processing') then return jsonb_build_object('changed',false,'row',to_jsonb(g)); end if;
    m := m || (p_payload->'meta');
    if m->>'status' not in ('done','restoring_audio') then raise exception 'Invalid completion status'; end if;
    update public.user_generations set result_url=p_payload->>'result_url',meta=m where id=p_id returning * into g;
    return jsonb_build_object('changed',true,'row',to_jsonb(g));
  else raise exception 'Invalid reAPI transition';
  end if;
  update public.user_generations set meta=m where id=p_id returning * into g;
  return jsonb_build_object('changed',true,'credits',balance,'row',to_jsonb(g));
end;
$$;
revoke all on function public.reapi_generation_transition(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.reapi_generation_transition(text,uuid,uuid,jsonb) to service_role;
commit;
notify pgrst, 'reload schema';
