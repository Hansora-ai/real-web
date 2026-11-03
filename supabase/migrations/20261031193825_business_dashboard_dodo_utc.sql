-- Match Dodo reporting day boundaries for all owner reports.
begin;
create or replace function public.business_dashboard_snapshot(p_start date, p_end date)
returns jsonb language plpgsql stable security invoker
set search_path = pg_catalog, public set statement_timeout = '20s'
as $$
declare lo timestamptz; hi timestamptz; answer jsonb;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then
    raise exception 'Choose a date range of up to 367 days';
  end if;
  lo := p_start::timestamp at time zone 'UTC';
  hi := (p_end+1)::timestamp at time zone 'UTC';
  if (select count(*) from public.user_generations where created_at>=lo and created_at<hi)>100000 then
    raise exception 'This range is too large; choose a shorter period';
  end if;
  with pay as materialized (
    select p.id,p.transaction_id,uid,credits,status,p.provider,p.created_at,coalesce(paid_at,p.created_at) paid_at,
      currency,amount_cents,
      jsonb_build_object(
        'report_gross_usd_cents',r.gross_usd_cents,
        'report_settlement_amount',r.settlement_amount,'report_settlement_tax',r.settlement_tax,
        'report_settlement_currency',r.settlement_currency,
        'settlement_amount',payload#>'{data,settlement_amount}',
        'settlement_currency',payload#>'{data,settlement_currency}',
        'settlement_tax',payload#>'{data,settlement_tax}',
        'total_amount',payload#>'{data,total_amount}', 'tax',payload#>'{data,tax}',
        'payment_method',payload#>'{data,payment_method}',
        'card_issuing_country',payload#>'{data,card_issuing_country}',
        'subscription_id',payload#>'{data,subscription_id}',
        'refunds',payload#>'{data,refunds}', 'refund_status',payload#>'{data,refund_status}'
      ) financial
    from public.payments p left join public.business_payment_reconciliation r on r.provider=p.provider and r.transaction_id=p.transaction_id
    where coalesce(paid_at,p.created_at)<hi and status in ('succeeded','paid','refunded','partially_refunded')
  ), gens as materialized (
    select distinct on(user_id,coalesce(nullif(meta->>'run_id',''),id::text))
      id,user_id,created_at,provider,kind,meta,result_url
    from public.user_generations
    where created_at>=lo and created_at<hi
      and coalesce(provider,'') not ilike '%template%'
    order by user_id,coalesce(nullif(meta->>'run_id',''),id::text),created_at desc,id
  )
  select jsonb_build_object(
    'generated_at',now(), 'range',jsonb_build_object('start',p_start,'end',p_end),
    'payments',coalesce((select jsonb_agg(to_jsonb(p)) from pay p),'[]'::jsonb),
    'registrations',coalesce((select jsonb_agg(x) from (
      select (a at time zone 'UTC')::date as "day",count(*) n
      from public.profiles where a>=lo and a<hi
        and user_id not in ('45c5cfc7-090e-491f-a304-05f863bbdf85','a1102230-2b84-49e4-8452-4a6b650de87a')
      group by 1 order by 1
    ) x),'[]'::jsonb),
    'credit_movements',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'user_id',a.user_id,'old_credits',a.old_credits,'new_credits',a.new_credits,'delta',a.delta,'changed_at',a.changed_at,
      'payment_id',(select p.id from pay p where p.uid=a.user_id and p.credits=a.delta and a.delta>0
        and a.changed_at between p.paid_at-interval '10 minutes' and p.paid_at+interval '10 minutes'
        order by abs(extract(epoch from a.changed_at-p.paid_at)),p.id limit 1)))
      from public.credit_audit a where exists(select 1 from pay where uid=a.user_id)),'[]'::jsonb),
    'buyers',coalesce((select jsonb_agg(x) from (
      select p.user_id,p.email,p.credits,p.payg_credits,p.monthly_credits,
        (select min(paid_at) from pay where uid=p.user_id) first_payment,
        (select sum(credits) from pay where uid=p.user_id) package_credits,
        (select count(*) from pay where uid=p.user_id) payments
      from public.profiles p where exists(select 1 from pay where uid=p.user_id)
    ) x),'[]'::jsonb),
    'generation_history_start',(select min(created_at) from public.user_generations where coalesce(provider,'') not ilike '%template%'),
    'purchase_journeys',coalesce((select jsonb_agg(jsonb_build_object(
      'user_id',b.uid,'first_purchase',b.first_purchase,
      'generations',coalesce((select jsonb_agg(jsonb_build_object(
        'id',g.id,'run_id',g.meta->>'run_id','created_at',g.created_at,'provider',g.provider,
        'model',coalesce(g.meta->>'model_id',g.meta->>'engine',g.meta->>'model',g.provider),
        'status',coalesce(g.meta->>'status',case when g.result_url is not null then 'done' else 'unknown' end)
      )) from (select distinct on(coalesce(nullif(meta->>'run_id',''),id::text)) id,meta,created_at,provider,result_url
        from public.user_generations where user_id=b.uid and created_at<b.first_purchase
        and coalesce(provider,'') not ilike '%template%'
        order by coalesce(nullif(meta->>'run_id',''),id::text),created_at desc,id) g),'[]'::jsonb)
    )) from (select uid,min(paid_at) first_purchase from pay where uid is not null group by uid
      having min(paid_at)>=lo and min(paid_at)<hi) b),'[]'::jsonb),
    'ratings',coalesce((select jsonb_agg(jsonb_build_object(
      'run_id',r.run_id,'user_id',r.user_id,'provider',coalesce(g.provider,r.provider),
      'model',coalesce(g.meta->>'model_id',g.meta->>'engine',g.meta->>'model',r.model,r.provider),
      'rating',r.rating,'reasons',r.reasons,'comment',r.comment,
      'created_at',r.created_at,'updated_at',r.updated_at
    )) from public.generation_ratings r left join public.user_generations g on g.id=r.generation_id and g.user_id=r.user_id
      where coalesce(r.updated_at,r.created_at)>=lo and coalesce(r.updated_at,r.created_at)<hi),'[]'::jsonb),
    'generations',coalesce((select jsonb_agg(jsonb_build_object(
      'id',g.id,'user_id',g.user_id,'created_at',g.created_at,'provider',g.provider,'kind',g.kind,
      'model',coalesce(g.meta->>'model',g.meta->>'model_id',g.provider),
      'status',coalesce(g.meta->>'status',case when g.result_url is not null then 'done' else 'unknown' end),
      'has_result',g.result_url is not null,'run_id',g.meta->>'run_id',
      'surface',case when g.meta->>'run_id' like '%-mcp-%' or exists(
        select 1 from public.chatgpt_events c where c.run_id=g.meta->>'run_id' and c.user_id=g.user_id
      ) then 'ChatGPT' else 'Website / other' end,
      'source',g.meta->>'source', 'resolution',coalesce(g.meta->>'resolution',g.meta->>'quality',g.meta#>>'{diagnostic,resolution}'),
      'characters',length(coalesce(g.meta#>>'{request,text}',g.meta#>>'{request_input,text}',g.meta#>>'{request_input,input_text}')),
      'duration',coalesce(g.meta->>'duration',g.meta#>>'{diagnostic,duration}',g.meta#>>'{request_input,duration}'),
      'input_seconds',coalesce(g.meta->>'source_video_duration',g.meta->>'source_duration'),
      'billed_seconds',g.meta->>'billed_seconds',
      'charged_cost',coalesce(g.meta->>'charged_cost',g.meta->>'charge_cost',g.meta->>'debited',g.meta->>'cost'),
      'refunded_at',g.meta->>'refunded_at','refunded',g.meta->>'refunded','refunded_cost',g.meta->>'refunded_cost',
      'unlimited',g.meta->>'subscription_unlimited',
      'error',coalesce(g.meta->>'error',g.meta->>'error_message',g.meta->>'failure_reason',g.meta->>'fail_msg'),
      'provider_cost_usd',g.meta->>'provider_cost_usd',
      'provider_refunded',g.meta->>'provider_refunded',
      'is_final',g.meta->>'draft_task_id' is not null,
      'is_free',coalesce(g.meta->>'is_free',g.meta->>'free_generation')
    )) from gens g),'[]'::jsonb),
    'refunds',coalesce((select jsonb_agg(jsonb_build_object('generation_id',generation_id,'run_id',run_id,'user_id',user_id,'amount',amount,'created_at',created_at))
      from public.refund_ledger where created_at>=lo and created_at<hi),'[]'::jsonb),
    'metadata_refunds',coalesce((select jsonb_agg(jsonb_build_object('generation_id',g.id,'run_id',g.meta->>'run_id','user_id',g.user_id,'amount',g.meta->>'refunded_cost','created_at',g.meta->>'refunded_at'))
      from public.user_generations g where g.meta->>'refunded'='true'
        and case when g.meta->>'refunded_at' ~ '^\d{4}-\d{2}-\d{2}T' then (g.meta->>'refunded_at')::timestamptz end >= lo
        and case when g.meta->>'refunded_at' ~ '^\d{4}-\d{2}-\d{2}T' then (g.meta->>'refunded_at')::timestamptz end < hi),'[]'::jsonb),
    'attribution',coalesce((select jsonb_agg(jsonb_build_object('user_id',r.user_id,'source',r.utm_source,'medium',r.utm_medium,'campaign',r.utm_campaign))
      from public.registration_attributions r where exists(select 1 from pay where uid=r.user_id) or exists(select 1 from gens where user_id=r.user_id)),'[]'::jsonb),
    'expenses',coalesce((select jsonb_agg(to_jsonb(e) order by starts_on desc) from public.business_expenses e
      where owner_user_id='45c5cfc7-090e-491f-a304-05f863bbdf85'),'[]'::jsonb),
    'settings',coalesce((select settings from public.business_settings where owner_user_id='45c5cfc7-090e-491f-a304-05f863bbdf85'),'{}'::jsonb),
    'extra_payment_sources',jsonb_build_object(
      'telegram_credit_grants',(select count(*) from public.telegram_payments where created_at>=lo and created_at<hi),
      'russian_checkout_logs',(select count(*) from public.russian_card_payment_logs where created_at>=lo and created_at<hi)
    )
  ) into answer;
  return answer;
end $$;
revoke all on function public.business_dashboard_snapshot(date,date) from public,anon,authenticated;
grant execute on function public.business_dashboard_snapshot(date,date) to service_role;



commit;
