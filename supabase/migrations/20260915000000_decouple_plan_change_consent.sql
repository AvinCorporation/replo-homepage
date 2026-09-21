-- Plan changes use their own price/effective-date consent. They must not
-- invent or overwrite the separate automatic-charge policy.
begin;

alter table public.subscription_plan_changes
  alter column billing_policy_snapshot drop not null;

create or replace function public.billing_schedule_plan_change(
  p_workspace uuid,
  p_subscription uuid,
  p_user uuid,
  p_plan_code text,
  p_expected_effective_on date,
  p_policy jsonb,
  p_conditions jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.subscriptions;
  plan public.billing_plan_catalog;
  effective_date date;
  expected_conditions jsonb;
  result uuid;
begin
  perform 1
  from public.workspace_members
  where workspace_id = p_workspace
    and user_id = p_user
    and status = 'active'
    and role in ('owner', 'admin')
  for share;
  if not found then
    raise exception 'BILLING_FORBIDDEN' using errcode = 'RB403';
  end if;

  perform 1
  from public.billing_profiles
  where workspace_id = p_workspace
  for update;

  select * into s
  from public.subscriptions
  where id = p_subscription
    and workspace_id = p_workspace
  for update;
  if not found
    or s.status not in ('active', 'past_due', 'pending_payment_method')
  then
    raise exception 'BILLING_PLAN_CHANGE_UNAVAILABLE'
      using errcode = 'RB424';
  end if;

  select * into plan
  from public.billing_plan_catalog
  where code = p_plan_code
  for share;
  if not found or not plan.self_service or plan.monthly_fee is null then
    raise exception 'BILLING_PLAN_REQUIRES_QUOTE'
      using errcode = 'RB425';
  end if;

  effective_date := (
    date_trunc('month', now() at time zone 'Asia/Seoul')
    + interval '1 month'
  )::date;
  if p_expected_effective_on is distinct from effective_date then
    raise exception 'BILLING_PLAN_CONSENT_CHANGED'
      using errcode = 'RB426';
  end if;

  if p_policy is distinct from jsonb_build_object(
    'termsVersion', 'plan-change-v1',
    'vat', 'excluded'
  ) then
    raise exception 'BILLING_PLAN_CONSENT_CHANGED'
      using errcode = 'RB426';
  end if;

  expected_conditions := jsonb_build_object(
    'termsVersion', p_policy->>'termsVersion',
    'fromPlan', s.plan_name,
    'planCode', plan.code,
    'planName', plan.display_name,
    'monthlyFee', plan.monthly_fee,
    'includedTickets', plan.included_tickets,
    'vat', 'excluded',
    'vatAmount', plan.monthly_fee / 10,
    'totalAmount', plan.monthly_fee + plan.monthly_fee / 10,
    'effectiveOn', effective_date::text
  );
  if p_conditions is distinct from expected_conditions then
    raise exception 'BILLING_PLAN_CONSENT_CHANGED'
      using errcode = 'RB426';
  end if;

  if (
    case when s.plan_name = 'Starter' then 'Lite' else s.plan_name end
  ) = plan.code
    and s.monthly_fee = plan.monthly_fee
    and s.included_tickets = plan.included_tickets
  then
    raise exception 'BILLING_PLAN_ALREADY_ACTIVE'
      using errcode = 'RB427';
  end if;

  update public.subscription_plan_changes
  set status = 'canceled',
      canceled_at = now(),
      updated_at = now()
  where subscription_id = s.id
    and status = 'scheduled';

  insert into public.subscription_plan_changes(
    workspace_id,
    subscription_id,
    requested_by,
    from_plan_name,
    from_monthly_fee,
    from_included_tickets,
    to_plan_code,
    to_monthly_fee,
    to_included_tickets,
    billing_policy_snapshot,
    consent_conditions,
    effective_on
  ) values (
    p_workspace,
    s.id,
    p_user,
    s.plan_name,
    s.monthly_fee,
    s.included_tickets,
    plan.code,
    plan.monthly_fee,
    plan.included_tickets,
    s.billing_policy,
    expected_conditions,
    effective_date
  )
  returning id into result;

  insert into public.billing_operator_actions(
    workspace_id,
    operator_id,
    action,
    reason
  ) values (
    p_workspace,
    p_user,
    'plan_change_scheduled',
    plan.code || ' 플랜을 ' || effective_date::text || '부터 적용'
  );

  insert into public.billing_events(
    workspace_id,
    subscription_id,
    event_type,
    message,
    dedupe_key
  ) values (
    p_workspace,
    s.id,
    'plan.change_scheduled',
    plan.display_name || ' 요금제가 ' || effective_date::text || '부터 적용됩니다.',
    result::text || ':scheduled'
  );

  return result;
end
$$;

create or replace function public.billing_apply_due_plan_changes(
  p_limit integer default 50
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  change_row public.subscription_plan_changes;
  applied_count integer := 0;
  today_kst date := (now() at time zone 'Asia/Seoul')::date;
begin
  for change_row in
    select *
    from public.subscription_plan_changes
    where status = 'scheduled'
      and effective_on <= today_kst
    order by effective_on, created_at, id
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  loop
    perform 1
    from public.subscriptions
    where id = change_row.subscription_id
      and workspace_id = change_row.workspace_id
    for update;

    update public.subscriptions
    set plan_name = change_row.to_plan_code,
        monthly_fee = change_row.to_monthly_fee,
        included_tickets = change_row.to_included_tickets,
        active_plan_change_id = change_row.id,
        updated_at = now()
    where id = change_row.subscription_id
      and workspace_id = change_row.workspace_id
      and status not in ('paused', 'canceled');

    if found then
      update public.subscription_plan_changes
      set status = 'applied',
          applied_at = now(),
          updated_at = now()
      where id = change_row.id;

      insert into public.billing_events(
        workspace_id,
        subscription_id,
        event_type,
        message,
        dedupe_key
      ) values (
        change_row.workspace_id,
        change_row.subscription_id,
        'plan.changed',
        change_row.to_plan_code || ' 요금제가 적용되었습니다.',
        change_row.id::text || ':applied'
      )
      on conflict(dedupe_key) do nothing;

      applied_count := applied_count + 1;
    else
      update public.subscription_plan_changes
      set status = 'canceled',
          canceled_at = now(),
          updated_at = now()
      where id = change_row.id;
    end if;
  end loop;

  return applied_count;
end
$$;


commit;
