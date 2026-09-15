-- Customer-approved plan changes apply from the first day of the next
-- calendar month in Asia/Seoul. Existing invoice snapshots never change.
begin;

create table public.billing_plan_catalog (
  code text primary key
    check(code in ('Lite', 'Basic', 'Pro', 'Enterprise')),
  display_name text not null,
  monthly_fee integer,
  included_tickets integer not null check(included_tickets >= 0),
  vat text not null default 'excluded' check(vat = 'excluded'),
  self_service boolean not null default true,
  sort_order integer not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(
    (self_service and monthly_fee is not null and monthly_fee > 0)
    or
    (not self_service and monthly_fee is null)
  )
);

insert into public.billing_plan_catalog(
  code,
  display_name,
  monthly_fee,
  included_tickets,
  vat,
  self_service,
  sort_order
) values
  ('Lite', '라이트', 590000, 200, 'excluded', true, 1),
  ('Basic', '베이직', 990000, 500, 'excluded', true, 2),
  ('Pro', '프로', 1790000, 1000, 'excluded', true, 3),
  ('Enterprise', '엔터프라이즈', null, 2000, 'excluded', false, 4);

create table public.subscription_plan_changes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  subscription_id uuid not null,
  requested_by uuid not null references auth.users(id),
  from_plan_name text,
  from_monthly_fee integer,
  from_included_tickets integer,
  to_plan_code text not null references public.billing_plan_catalog(code),
  to_monthly_fee integer not null check(to_monthly_fee > 0),
  to_included_tickets integer not null check(to_included_tickets >= 0),
  billing_policy_snapshot jsonb not null,
  consent_conditions jsonb not null,
  effective_on date not null,
  status text not null default 'scheduled'
    check(status in ('scheduled', 'applied', 'canceled')),
  agreed_at timestamptz not null default now(),
  applied_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(subscription_id, workspace_id)
    references public.subscriptions(id, workspace_id),
  unique(id, workspace_id)
);

create unique index one_scheduled_plan_change
  on public.subscription_plan_changes(subscription_id)
  where status = 'scheduled';

alter table public.subscriptions
  add column active_plan_change_id uuid
    references public.subscription_plan_changes(id);

comment on table public.subscription_plan_changes is
  'Immutable customer consent snapshot for a plan change scheduled on the next KST month boundary.';
comment on column public.subscriptions.active_plan_change_id is
  'Last applied customer-approved plan change used to authorize new invoice amounts.';

create function private.preserve_plan_change_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(
    new.workspace_id,
    new.subscription_id,
    new.requested_by,
    new.from_plan_name,
    new.from_monthly_fee,
    new.from_included_tickets,
    new.to_plan_code,
    new.to_monthly_fee,
    new.to_included_tickets,
    new.billing_policy_snapshot,
    new.consent_conditions,
    new.effective_on,
    new.agreed_at
  ) is distinct from row(
    old.workspace_id,
    old.subscription_id,
    old.requested_by,
    old.from_plan_name,
    old.from_monthly_fee,
    old.from_included_tickets,
    old.to_plan_code,
    old.to_monthly_fee,
    old.to_included_tickets,
    old.billing_policy_snapshot,
    old.consent_conditions,
    old.effective_on,
    old.agreed_at
  ) then
    raise exception 'PLAN_CHANGE_CONSENT_IMMUTABLE';
  end if;
  return new;
end
$$;

revoke all on function private.preserve_plan_change_consent() from public;
create trigger preserve_plan_change_consent
before update on public.subscription_plan_changes
for each row execute function private.preserve_plan_change_consent();

alter table public.billing_plan_catalog enable row level security;
alter table public.subscription_plan_changes enable row level security;
revoke all on public.billing_plan_catalog from public, anon, authenticated;
revoke all on public.subscription_plan_changes from public, anon, authenticated;
grant all on public.billing_plan_catalog to service_role;
grant all on public.subscription_plan_changes to service_role;

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

  if p_policy->>'vat' <> 'excluded'
    or nullif(p_policy->>'version', '') is null
    or nullif(p_policy->>'termsVersion', '') is null
    or p_policy - 'vat' is distinct from s.billing_policy - 'vat'
  then
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
    and s.billing_policy->>'vat' = 'excluded'
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
    p_policy,
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

create or replace function public.billing_create_invoice(
  p_subscription uuid,
  p_updated_at timestamptz,
  p_invoice jsonb
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.subscriptions;
  created uuid;
  consent public.billing_consents;
  plan_change public.subscription_plan_changes;
  card_consent_valid boolean := false;
  plan_consent_valid boolean := false;
begin
  select * into strict s
  from public.subscriptions
  where id = p_subscription
  for update;

  if s.updated_at is distinct from p_updated_at
    or s.enrollment_confirmed_at is null
    or s.billing_policy is distinct from p_invoice->'policy_snapshot'
    or s.status not in ('active', 'past_due', 'pending_payment_method')
    or s.auto_charge_start_date is null
    or s.first_period_start is null
    or (p_invoice->>'billing_date')::date < s.auto_charge_start_date
    or (p_invoice->>'period_start')::date < s.first_period_start
    or (
      s.paid_through is not null
      and (p_invoice->>'period_start')::date < s.paid_through
    )
    or (
      s.invoice_stop_date is not null
      and (p_invoice->>'billing_date')::date >= s.invoice_stop_date
    )
  then
    return false;
  end if;

  if (p_invoice->>'amount')::numeric <> s.monthly_fee * (
    case when s.billing_policy->>'vat' = 'excluded' then 1.1 else 1 end
  ) then
    raise exception 'INVOICE_AMOUNT_MISMATCH';
  end if;

  select c.* into consent
  from public.billing_consents c
  join public.billing_registration_sessions r
    on r.id = c.registration_session_id
  where c.workspace_id = s.workspace_id
    and r.status = 'completed'
  order by r.completed_at desc
  limit 1;

  card_consent_valid := consent.id is not null
    and consent.conditions->'policy' is not distinct from s.billing_policy
    and (consent.conditions->>'amount')::integer
      is not distinct from (p_invoice->>'amount')::integer;

  if s.active_plan_change_id is not null then
    select * into plan_change
    from public.subscription_plan_changes
    where id = s.active_plan_change_id
      and subscription_id = s.id
      and workspace_id = s.workspace_id
      and status = 'applied';

    plan_consent_valid := plan_change.id is not null
      and plan_change.to_plan_code = s.plan_name
      and plan_change.to_monthly_fee = s.monthly_fee
      and plan_change.to_included_tickets = s.included_tickets
      and plan_change.billing_policy_snapshot is not distinct from s.billing_policy
      and (plan_change.consent_conditions->>'totalAmount')::integer
        is not distinct from (p_invoice->>'amount')::integer;
  end if;

  if not card_consent_valid and not plan_consent_valid then
    raise exception 'BILLING_CONSENT_REQUIRED';
  end if;

  insert into public.billing_invoices(
    workspace_id,
    subscription_id,
    billing_date,
    period_start,
    period_end,
    amount,
    policy_snapshot,
    next_billing_date,
    next_attempt_at
  ) values (
    s.workspace_id,
    s.id,
    (p_invoice->>'billing_date')::date,
    (p_invoice->>'period_start')::date,
    (p_invoice->>'period_end')::date,
    (p_invoice->>'amount')::integer,
    s.billing_policy,
    (p_invoice->>'next_billing_date')::date,
    (p_invoice->>'next_attempt_at')::timestamptz
  )
  on conflict(subscription_id, period_start, period_end) do nothing
  returning id into created;

  update public.subscriptions
  set invoice_generation_date = greatest(
    invoice_generation_date,
    (p_invoice->>'next_billing_date')::date
  )
  where id = s.id;

  if created is not null then
    insert into public.billing_events(
      workspace_id,
      subscription_id,
      invoice_id,
      event_type,
      dedupe_key
    ) values (
      s.workspace_id,
      s.id,
      created,
      'invoice.created',
      created::text || ':created'
    );
  end if;

  return created is not null;
end
$$;

do $$
declare
  r record;
begin
  for r in
    select oid::regprocedure as signature
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname like 'billing\_%' escape '\'
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      r.signature
    );
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
end
$$;

commit;
