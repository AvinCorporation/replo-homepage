-- Keep one primary Toss card and one customer-selected backup card.
-- The backup is never charged until an owner/admin explicitly promotes it.
begin;

do $$
begin
  if exists (
    select 1
    from public.payment_methods
    where provider = 'toss' and status = 'active'
    group by workspace_id
    having count(*) > 2
  ) then
    raise exception 'More than two active Toss cards exist; reconcile before migrating';
  end if;
end
$$;

create or replace function public.billing_enforce_toss_card_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.provider = 'toss' and new.status = 'active' then
    if tg_op = 'INSERT'
      or old.provider is distinct from new.provider
      or old.status is distinct from new.status
      or old.workspace_id is distinct from new.workspace_id
    then
      -- The profile row is the workspace billing mutex used by registration,
      -- switching and charging. It also serializes the cardinality check.
      perform 1
      from public.billing_profiles
      where workspace_id = new.workspace_id
      for update;

      if (
        select count(*)
        from public.payment_methods
        where workspace_id = new.workspace_id
          and provider = 'toss'
          and status = 'active'
          and id <> new.id
      ) >= 2 then
        raise exception 'BILLING_PAYMENT_METHOD_LIMIT' using errcode = 'RB429';
      end if;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists billing_toss_card_limit on public.payment_methods;
create trigger billing_toss_card_limit
before insert or update on public.payment_methods
for each row execute function public.billing_enforce_toss_card_limit();

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

  if (
    select count(*)
    from public.payment_methods
    where workspace_id = p_workspace
      and provider = 'toss'
      and status = 'active'
  ) >= 2 then
    raise exception 'BILLING_PAYMENT_METHOD_LIMIT' using errcode = 'RB429';
  end if;

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
  active_card_count integer;
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

create or replace function public.billing_set_default_payment_method(
  p_workspace uuid,
  p_method uuid,
  p_user uuid
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_method uuid;
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

  perform 1
  from public.payment_methods m
  join public.billing_credentials c
    on c.payment_method_id = m.id
   and c.workspace_id = m.workspace_id
  where m.id = p_method
    and m.workspace_id = p_workspace
    and m.provider = 'toss'
    and m.status = 'active'
    and c.status = 'active'
  for update of m, c;
  if not found then
    raise exception 'BILLING_PAYMENT_METHOD_NOT_AVAILABLE'
      using errcode = 'RB404';
  end if;

  select id into current_method
  from public.payment_methods
  where workspace_id = p_workspace
    and provider = 'toss'
    and status = 'active'
    and is_default
  for update;

  if current_method is not distinct from p_method then
    return;
  end if;

  if exists (
    select 1
    from public.payment_attempts
    where workspace_id = p_workspace
      and payment_method_id = current_method
      and status in ('created', 'processing', 'unknown', 'reconciling')
  ) then
    raise exception 'BILLING_PAYMENT_IN_PROGRESS' using errcode = 'RB423';
  end if;

  update public.payment_methods
  set is_default = false,
      updated_at = now()
  where workspace_id = p_workspace
    and provider = 'toss'
    and status = 'active'
    and is_default;

  update public.payment_methods
  set is_default = true,
      updated_at = now()
  where id = p_method;

  insert into public.billing_operator_actions(
    workspace_id,
    operator_id,
    action,
    reason
  ) values (
    p_workspace,
    p_user,
    'primary_payment_method_changed',
    '마이페이지에서 주 결제수단 변경'
  );

  insert into public.billing_events(workspace_id, event_type, dedupe_key)
  values(
    p_workspace,
    'payment_method.primary_changed',
    p_method::text || ':primary:' || extract(epoch from clock_timestamp())::text
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
