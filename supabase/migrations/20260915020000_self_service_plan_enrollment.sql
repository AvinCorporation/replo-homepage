-- Self-service plan consent also defines the future monthly card payment.
-- Existing scheduled changes are upgraded before the consent immutability
-- trigger is restored; charges remain gated by card registration and switches.
begin;

drop trigger if exists preserve_plan_change_consent on public.subscription_plan_changes;

update public.subscription_plan_changes
set billing_policy_snapshot = jsonb_build_object(
  'version', 'self-service-plan-v1',
  'termsVersion', 'plan-change-v2',
  'vat', 'excluded',
  'firstCharge', 'contract_date',
  'retry', jsonb_build_object('basis', 'billing_date', 'days', '[]'::jsonb),
  'cardChangeArrears', 'manual_approval',
  'cancellationInstructions', '마이페이지 문의하기를 통해 요청'
),
    consent_conditions = consent_conditions || jsonb_build_object(
      'termsVersion', 'plan-change-v2',
      'billingCycle', 'monthly',
      'billingAnchorDay', 1,
      'firstChargeDate', effective_on::text,
      'automaticPayment', true
    ),
    updated_at = now()
where status = 'scheduled';

create trigger preserve_plan_change_consent
before update on public.subscription_plan_changes
for each row execute function private.preserve_plan_change_consent();

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
    'version', 'self-service-plan-v1',
    'termsVersion', 'plan-change-v2',
    'vat', 'excluded',
    'firstCharge', 'contract_date',
    'retry', jsonb_build_object('basis', 'billing_date', 'days', '[]'::jsonb),
    'cardChangeArrears', 'manual_approval',
    'cancellationInstructions', '마이페이지 문의하기를 통해 요청'
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
    'effectiveOn', effective_date::text,
    'billingCycle', 'monthly',
    'billingAnchorDay', 1,
    'firstChargeDate', effective_date::text,
    'automaticPayment', true
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
        billing_policy = change_row.billing_policy_snapshot,
        next_billing_date = change_row.effective_on,
        auto_charge_start_date = change_row.effective_on,
        first_period_start = change_row.effective_on,
        billing_anchor_day = 1,
        enrollment_confirmed_at = case
          when exists (
            select 1 from public.payment_methods method
            where method.workspace_id = change_row.workspace_id
              and method.provider = 'toss'
              and method.status = 'active'
              and method.is_default
          ) then coalesce(enrollment_confirmed_at, change_row.agreed_at)
          else enrollment_confirmed_at
        end,
        enrollment_confirmed_by = case
          when exists (
            select 1 from public.payment_methods method
            where method.workspace_id = change_row.workspace_id
              and method.provider = 'toss'
              and method.status = 'active'
              and method.is_default
          ) then coalesce(enrollment_confirmed_by, change_row.requested_by)
          else enrollment_confirmed_by
        end,
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
create or replace function public.billing_complete_registration(
  p_session uuid,
  p_user uuid,
  p_method uuid,
  p_encrypted text,
  p_version text,
  p_card jsonb
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.billing_registration_sessions;
  active_card_count integer;
  registration_conditions jsonb;
  pending_change public.subscription_plan_changes;
  subscription_row public.subscriptions;
begin
  select * into strict r
  from public.billing_registration_sessions
  where id = p_session
  for update;
  if r.status <> 'processing'
    or r.initiated_by <> p_user
    or r.expires_at < now()
  then
    raise exception 'INVALID_REGISTRATION' using errcode = 'RB410';
  end if;

  perform 1
  from public.workspace_members
  where workspace_id = r.workspace_id
    and user_id = p_user
    and status = 'active'
    and role in ('owner', 'admin')
  for share;
  if not found then
    raise exception 'BILLING_FORBIDDEN' using errcode = 'RB403';
  end if;

  perform 1
  from public.billing_profiles
  where workspace_id = r.workspace_id
  for update;

  select count(*) into active_card_count
  from public.payment_methods
  where workspace_id = r.workspace_id
    and provider = 'toss'
    and status = 'active';
  if active_card_count >= 2 then
    raise exception 'BILLING_PAYMENT_METHOD_LIMIT' using errcode = 'RB429';
  end if;

  insert into public.payment_methods(
    id,
    workspace_id,
    provider,
    masked_number,
    status,
    is_default,
    issuer_code,
    card_type,
    owner_type,
    registered_at
  ) values (
    p_method,
    r.workspace_id,
    'toss',
    p_card->>'maskedNumber',
    'active',
    active_card_count = 0,
    p_card->>'issuerCode',
    p_card->>'cardType',
    p_card->>'ownerType',
    now()
  );

  insert into public.billing_credentials(
    workspace_id,
    payment_method_id,
    encrypted_billing_key,
    encryption_key_version
  ) values (
    r.workspace_id,
    p_method,
    p_encrypted,
    p_version
  );

  select consent.conditions into strict registration_conditions
  from public.billing_consents consent
  where consent.registration_session_id = p_session;

  select * into subscription_row
  from public.subscriptions subscription
  where subscription.workspace_id = r.workspace_id
  order by subscription.created_at desc
  limit 1
  for update;

  select * into pending_change
  from public.subscription_plan_changes change_row
  where change_row.workspace_id = r.workspace_id
    and change_row.status = 'scheduled'
  order by change_row.created_at desc
  limit 1
  for update;

  if pending_change.id is not null
    and r.policy_snapshot is not distinct from pending_change.billing_policy_snapshot
    and registration_conditions->'policy' is not distinct from r.policy_snapshot
    and registration_conditions->>'cycle' = 'monthly'
    and (registration_conditions->>'billingAnchorDay')::integer = 1
    and registration_conditions->>'firstChargeDate' = pending_change.effective_on::text
    and (registration_conditions->>'amount')::integer
      = pending_change.to_monthly_fee + pending_change.to_monthly_fee / 10
  then
    update public.subscriptions
    set billing_policy = r.policy_snapshot,
        next_billing_date = pending_change.effective_on,
        auto_charge_start_date = pending_change.effective_on,
        first_period_start = pending_change.effective_on,
        billing_anchor_day = 1,
        enrollment_confirmed_at = now(),
        enrollment_confirmed_by = p_user,
        updated_at = now()
    where id = pending_change.subscription_id
      and workspace_id = r.workspace_id;
  elsif subscription_row.id is not null
    and registration_conditions->'policy' is not distinct from subscription_row.billing_policy
    and registration_conditions->>'cycle' = 'monthly'
    and (registration_conditions->>'billingAnchorDay')::integer
      = subscription_row.billing_anchor_day
    and registration_conditions->>'firstChargeDate'
      = subscription_row.next_billing_date::text
    and (registration_conditions->>'amount')::integer
      = subscription_row.monthly_fee * (
        case when subscription_row.billing_policy->>'vat' = 'excluded' then 1.1 else 1 end
      )
  then
    update public.subscriptions
    set enrollment_confirmed_at = now(),
        enrollment_confirmed_by = p_user,
        updated_at = now()
    where id = subscription_row.id;
  end if;

  update public.billing_registration_sessions
  set status = 'completed',
      completed_at = now()
  where id = p_session;

  insert into public.billing_events(workspace_id, event_type, dedupe_key)
  values(
    r.workspace_id,
    case
      when active_card_count = 0 then 'payment_method.registered'
      else 'payment_method.backup_registered'
    end,
    p_session::text || ':completed'
  );
end
$$;


commit;
