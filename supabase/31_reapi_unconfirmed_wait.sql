-- Apply AFTER 20_kling4_generation_billing.sql (run once in the Supabase SQL editor). Changes one rule only, everything else is the same function.
-- When the provider never confirmed a job (no task id: its reply timed out), the generation was kept "generating"
-- for 30 minutes before it failed and was refunded, in case the provider's webhook confirmed it late. A job that
-- really started is confirmed within minutes, so the wait is now 10 minutes.
begin;
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
    if p_payload->>'orphan'='true' and (nullif(m->>'task_id','') is not null or g.created_at > now()-interval '10 minutes') then
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
