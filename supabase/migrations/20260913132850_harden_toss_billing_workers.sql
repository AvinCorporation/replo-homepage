-- Harden the Toss worker orchestration after review. This migration is additive
-- so environments that already applied the MVP migration keep a clear history.
begin;

alter table public.billing_events
  add constraint billing_events_invoice_workspace_fk
    foreign key(invoice_id, workspace_id)
    references public.billing_invoices(id, workspace_id)
    not valid,
  add constraint billing_events_attempt_workspace_fk
    foreign key(payment_attempt_id, workspace_id)
    references public.payment_attempts(id, workspace_id)
    not valid;

alter table public.billing_events
  validate constraint billing_events_invoice_workspace_fk;
alter table public.billing_events
  validate constraint billing_events_attempt_workspace_fk;

-- An attempt that never reached Toss is safe to replace only after an explicit
-- delay. retry_count is a technical circuit breaker, independent of the
-- customer retry policy. An operator can reset it with the audited approval RPC.
create or replace function public.billing_defer_attempt(
  p_attempt uuid,
  p_code text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  a public.payment_attempts;
  i public.billing_invoices;
  next_retry_count integer;
begin
  select * into strict a
  from public.payment_attempts
  where id = p_attempt
  for update;

  if a.status <> 'created' or a.requested_at is not null then
    return;
  end if;

  select * into strict i
  from public.billing_invoices
  where id = a.invoice_id
  for update;

  next_retry_count := i.retry_count + 1;

  update public.payment_attempts
  set status = 'failed',
      failure_category = 'configuration',
      failure_code = p_code,
      failure_message = '결제 승인 전 사전 점검이 완료되지 않았습니다. 담당자 확인이 필요합니다.',
      lease_until = null,
      updated_at = now()
  where id = a.id;

  update public.billing_invoices
  set status = case when next_retry_count >= 10 then 'failed' else 'payment_pending' end,
      retry_count = next_retry_count,
      next_attempt_at = case
        when next_retry_count >= 10 then null
        else now() + interval '30 minutes'
      end,
      updated_at = now()
  where id = i.id;

  if next_retry_count >= 10 then
    update public.subscriptions
    set status = 'past_due',
        updated_at = now()
    where id = i.subscription_id
      and status not in ('paused', 'canceled');
  end if;

  insert into public.billing_events(
    workspace_id,
    invoice_id,
    payment_attempt_id,
    event_type,
    message,
    dedupe_key
  ) values (
    a.workspace_id,
    i.id,
    a.id,
    case when next_retry_count >= 10 then 'payment.failed' else 'payment.deferred' end,
    '결제 승인 전 사전 점검이 완료되지 않았습니다. 담당자 확인이 필요합니다.',
    a.id::text || ':technical-deferred'
  )
  on conflict(dedupe_key) do nothing;
end
$$;

create or replace function public.billing_begin_registration(
  p_workspace uuid,
  p_user uuid,
  p_state_hash text,
  p_policy jsonb,
  p_conditions jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
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
    raise exception 'BILLING_FORBIDDEN';
  end if;

  insert into public.billing_profiles(workspace_id)
  values(p_workspace)
  on conflict(workspace_id) do nothing;

  perform 1
  from public.billing_profiles
  where workspace_id = p_workspace
  for update;

  update public.billing_registration_sessions
  set status = 'failed'
  where workspace_id = p_workspace
    and status in ('pending', 'processing')
    and expires_at < now();

  perform 1
  from public.billing_registration_sessions
  where workspace_id = p_workspace
    and status in ('pending', 'processing');
  if found then
    raise exception 'BILLING_REGISTRATION_IN_PROGRESS';
  end if;

  insert into public.billing_registration_sessions(
    workspace_id,
    initiated_by,
    state_hash,
    expires_at,
    policy_snapshot
  ) values (
    p_workspace,
    p_user,
    p_state_hash,
    now() + interval '10 minutes',
    p_policy
  )
  returning id into result;

  insert into public.billing_consents(
    workspace_id,
    user_id,
    registration_session_id,
    terms_version,
    billing_policy_version,
    conditions
  ) values (
    p_workspace,
    p_user,
    result,
    p_policy->>'termsVersion',
    p_policy->>'version',
    p_conditions
  );

  insert into public.billing_events(workspace_id, event_type, dedupe_key)
  values(
    p_workspace,
    'payment_method.registration_started',
    result::text || ':started'
  );

  return result;
end
$$;

create or replace function public.billing_claim_invoice(p_invoice uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  i public.billing_invoices;
  p public.billing_profiles;
  s public.subscriptions;
  m public.payment_methods;
  a public.payment_attempts;
begin
  select * into i from public.billing_invoices where id = p_invoice;
  select * into p
  from public.billing_profiles
  where workspace_id = i.workspace_id
  for update;

  if not coalesce(
    (select charges_enabled from public.billing_runtime_settings where singleton),
    false
  ) then
    return null;
  end if;
  if p.id is null
    or not p.auto_charge_enabled
    or p.billing_status <> 'active'
  then
    return null;
  end if;

  select * into i
  from public.billing_invoices
  where id = p_invoice
  for update;
  if i.status not in ('scheduled', 'payment_pending')
    or i.next_attempt_at is null
    or i.next_attempt_at > now()
    or i.retry_count >= 10
  then
    return null;
  end if;

  select * into s from public.subscriptions where id = i.subscription_id;
  if (s.charge_stop_at is not null and s.charge_stop_at <= now())
    or s.status in ('paused', 'canceled')
    or s.enrollment_confirmed_at is null
  then
    return null;
  end if;
  if exists(
    select 1
    from public.payment_attempts
    where invoice_id = i.id
      and status <> 'failed'
  ) then
    return null;
  end if;

  select * into m
  from public.payment_methods
  where workspace_id = i.workspace_id
    and provider = 'toss'
    and status = 'active'
    and is_default;
  if not found or not exists(
    select 1
    from public.billing_credentials
    where payment_method_id = m.id
      and status = 'active'
  ) then
    return null;
  end if;

  insert into public.payment_attempts(
    workspace_id,
    invoice_id,
    payment_method_id,
    attempt_no,
    order_id,
    idempotency_key,
    amount,
    order_name,
    status,
    lease_until,
    lease_token
  ) values (
    i.workspace_id,
    i.id,
    m.id,
    (select coalesce(max(attempt_no), 0) + 1
      from public.payment_attempts
      where invoice_id = i.id),
    'replo_' || replace(gen_random_uuid()::text, '-', ''),
    gen_random_uuid()::text,
    i.amount,
    'Replo ' || i.billing_date::text,
    'created',
    now() + interval '3 minutes',
    gen_random_uuid()
  )
  returning * into a;

  update public.billing_invoices
  set status = 'processing',
      updated_at = now()
  where id = i.id;

  return to_jsonb(a);
end
$$;

create or replace function public.billing_authorize_attempt(
  p_attempt uuid,
  p_lease uuid
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  a public.payment_attempts;
  p public.billing_profiles;
begin
  select * into a from public.payment_attempts where id = p_attempt;
  select * into p
  from public.billing_profiles
  where workspace_id = a.workspace_id
  for update;
  select * into a
  from public.payment_attempts
  where id = p_attempt
  for update;

  if a.status <> 'created'
    or a.lease_token is distinct from p_lease
    or a.lease_until < now()
  then
    return false;
  end if;

  if not coalesce(
      (select charges_enabled from public.billing_runtime_settings where singleton),
      false
    )
    or not coalesce(p.auto_charge_enabled, false)
    or p.billing_status is distinct from 'active'
    or not exists(
      select 1
      from public.payment_methods
      where id = a.payment_method_id
        and status = 'active'
        and is_default
    )
    or exists(
      select 1
      from public.billing_invoices i
      join public.subscriptions s on s.id = i.subscription_id
      where i.id = a.invoice_id
        and (
          s.status in ('paused', 'canceled')
          or (s.charge_stop_at is not null and s.charge_stop_at <= now())
        )
    )
  then
    perform public.billing_defer_attempt(a.id, 'CHARGE_PAUSED');
    return false;
  end if;

  update public.payment_attempts
  set status = 'processing',
      requested_at = now(),
      updated_at = now()
  where id = a.id;
  return true;
end
$$;

create or replace function public.billing_claim_reconciliation(p_attempt uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  a public.payment_attempts;
begin
  select * into a
  from public.payment_attempts
  where id = p_attempt
  for update skip locked;

  if not found
    or a.status = 'failed'
    or a.lease_until > now()
    or a.last_checked_at > now() - interval '10 minutes'
  then
    return null;
  end if;

  if a.status = 'created' and a.requested_at is null then
    -- Fence the old lease before creating a replacement request identity.
    perform public.billing_defer_attempt(a.id, 'NOT_DISPATCHED');
    return null;
  end if;

  update public.payment_attempts
  set lease_until = now() + interval '3 minutes',
      lease_token = gen_random_uuid(),
      status = case when status = 'succeeded' then status else 'reconciling' end,
      reconciliation_started_at = now(),
      last_checked_at = now()
  where id = a.id
  returning * into a;

  return to_jsonb(a);
end
$$;

create or replace function public.billing_due_invoice_ids(p_limit integer default 2)
returns table(id uuid)
language sql
security invoker
set search_path = ''
as $$
  select i.id
  from public.billing_invoices i
  join public.billing_profiles p on p.workspace_id = i.workspace_id
  join public.subscriptions s on s.id = i.subscription_id
  where i.status in ('scheduled', 'payment_pending')
    and i.next_attempt_at <= now()
    and i.retry_count < 10
    and p.auto_charge_enabled
    and p.billing_status = 'active'
    and (
      select charges_enabled
      from public.billing_runtime_settings
      where singleton
    )
    and s.status not in ('paused', 'canceled')
    and s.enrollment_confirmed_at is not null
    and (s.charge_stop_at is null or s.charge_stop_at > now())
    and exists(
      select 1
      from public.payment_methods m
      join public.billing_credentials c on c.payment_method_id = m.id
      where m.workspace_id = i.workspace_id
        and m.provider = 'toss'
        and m.is_default
        and m.status = 'active'
        and c.status = 'active'
    )
    and not exists(
      select 1
      from public.payment_attempts a
      where a.invoice_id = i.id
        and a.status <> 'failed'
    )
  order by i.next_attempt_at, i.id
  limit greatest(1, least(p_limit, 10));
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
