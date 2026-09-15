-- Keep provider/customer retry policy independent from worker preflight failures.
begin;

alter table public.billing_invoices
  add column technical_failure_count integer not null default 0,
  add constraint billing_invoices_nonnegative_technical_failure_count
    check(technical_failure_count >= 0);

comment on column public.billing_invoices.retry_count is
  'Customer/provider payment failure count used only to index billing_policy.retry.';
comment on column public.billing_invoices.technical_failure_count is
  'Pre-dispatch technical failure circuit breaker; never consumes customer retry policy.';

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
  next_technical_failure_count integer;
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

  next_technical_failure_count := i.technical_failure_count + 1;

  update public.payment_attempts
  set status = 'failed',
      failure_category = 'configuration',
      failure_code = p_code,
      failure_message = '결제 승인 전 사전 점검이 완료되지 않았습니다. 담당자 확인이 필요합니다.',
      lease_until = null,
      updated_at = now()
  where id = a.id;

  update public.billing_invoices
  set status = case
        when next_technical_failure_count >= 10 then 'failed'
        else 'payment_pending'
      end,
      technical_failure_count = next_technical_failure_count,
      next_attempt_at = case
        when next_technical_failure_count >= 10 then null
        else now() + interval '30 minutes'
      end,
      updated_at = now()
  where id = i.id;

  -- A technical circuit breaker requires operator review, but it does not prove
  -- customer delinquency. Only exhausted provider/card failures set past_due.
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
    case
      when next_technical_failure_count >= 10 then 'payment.technical_blocked'
      else 'payment.deferred'
    end,
    '결제 승인 전 사전 점검이 완료되지 않았습니다. 담당자 확인이 필요합니다.',
    a.id::text || ':technical-deferred'
  )
  on conflict(dedupe_key) do nothing;
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
    or i.technical_failure_count >= 10
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

create or replace function public.billing_approve_arrears_retry(
  p_invoice uuid,
  p_operator uuid,
  p_reason text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  i public.billing_invoices;
begin
  if p_operator is null or length(trim(p_reason)) < 3 then
    raise exception 'APPROVAL_REQUIRED';
  end if;

  select * into strict i
  from public.billing_invoices
  where id = p_invoice
  for update;
  if i.status <> 'failed'
    or exists(
      select 1
      from public.payment_attempts
      where invoice_id = i.id
        and status <> 'failed'
    )
  then
    raise exception 'INVOICE_NOT_RETRYABLE';
  end if;

  update public.billing_invoices
  set status = 'payment_pending',
      retry_count = 0,
      technical_failure_count = 0,
      next_attempt_at = now(),
      updated_at = now()
  where id = i.id;

  insert into public.billing_events(
    workspace_id,
    invoice_id,
    event_type,
    message
  ) values (
    i.workspace_id,
    i.id,
    'payment.retry_approved',
    '담당자 확인 후 재결제가 승인되었습니다.'
  );

  insert into public.billing_operator_actions(
    workspace_id,
    invoice_id,
    operator_id,
    action,
    reason
  ) values (
    i.workspace_id,
    i.id,
    p_operator,
    'arrears_retry_approved',
    p_reason
  );
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
    and i.technical_failure_count < 10
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

-- Stable SQLSTATE values let the API distinguish expected customer actions
-- without parsing arbitrary PostgreSQL error text.
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
    raise exception 'BILLING_FORBIDDEN' using errcode = 'RB403';
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
    raise exception 'BILLING_REGISTRATION_IN_PROGRESS'
      using errcode = 'RB409';
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
  had_card boolean;
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

  select exists(
    select 1
    from public.payment_methods
    where workspace_id = r.workspace_id
      and provider = 'toss'
      and status = 'active'
      and is_default
  ) into had_card;

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
    false,
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

  update public.payment_methods
  set is_default = false,
      status = 'inactive',
      updated_at = now()
  where workspace_id = r.workspace_id
    and provider = 'toss'
    and id <> p_method
    and is_default;

  update public.payment_methods
  set is_default = true
  where id = p_method;

  update public.billing_credentials
  set status = 'revoked',
      revoked_at = now()
  where workspace_id = r.workspace_id
    and payment_method_id <> p_method
    and status = 'active';

  update public.billing_registration_sessions
  set status = 'completed',
      completed_at = now()
  where id = p_session;

  insert into public.billing_events(workspace_id, event_type, dedupe_key)
  values(
    r.workspace_id,
    case
      when had_card then 'payment_method.changed'
      else 'payment_method.registered'
    end,
    p_session::text || ':completed'
  );
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
