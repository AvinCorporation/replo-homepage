-- Toss-only, opt-in migration. Does not enroll or backfill existing customers.
begin;
-- Abort rather than silently rounding pre-existing prices.
do $$ begin
  if exists(select 1 from public.subscriptions where monthly_fee <> trunc(monthly_fee) or monthly_fee < 0 or monthly_fee > 2147483647) then
    raise exception 'Non-integer/out-of-range legacy fee: reconcile before migrating';
  end if;
end $$;
alter table public.subscriptions alter column monthly_fee type integer using monthly_fee::integer;
alter table public.subscriptions
  add column billing_anchor_day integer check (billing_anchor_day between 1 and 31),
  add column billing_policy jsonb,
  add column invoice_generation_date date,
  add column billing_generation_checked_at timestamptz,
  add column auto_charge_start_date date,
  add column first_period_start date,
  add column paid_through date,
  add column enrollment_confirmed_at timestamptz,
  add column enrollment_confirmed_by uuid references auth.users(id),
  add column cancellation_requested_at timestamptz,
  add column cancellation_effective_at date,
  add column invoice_stop_date date,
  add column charge_stop_at timestamptz,
  add constraint subscriptions_workspace_identity unique(id, workspace_id),
  add constraint subscriptions_nonnegative_fee check (monthly_fee >= 0) not valid;
comment on column public.subscriptions.steppay_subscription_id is 'Deprecated. Never used by Toss billing.';
create table public.billing_runtime_settings (
  singleton boolean primary key default true check(singleton),
  charges_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.billing_runtime_settings(singleton) values(true);
create table public.billing_profiles (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null unique references public.workspaces(id),
  provider text not null default 'toss' check(provider = 'toss'), customer_key text not null unique default gen_random_uuid()::text,
  auto_charge_enabled boolean not null default false, billing_status text not null default 'paused' check(billing_status in ('active','paused')),
  paused_at timestamptz, pause_reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.billing_registration_sessions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
  initiated_by uuid not null references auth.users(id), state_hash text not null unique,
  expires_at timestamptz not null, status text not null default 'pending' check(status in ('pending','processing','completed','failed')),
  policy_snapshot jsonb not null, created_at timestamptz not null default now(), completed_at timestamptz
);
create unique index one_pending_billing_registration on public.billing_registration_sessions(workspace_id) where status in ('pending','processing');
alter table public.payment_methods
  add column if not exists provider text,
  add column if not exists method_type text default 'card', add column if not exists issuer_code text, add column if not exists card_type text, add column if not exists owner_type text,
  add column if not exists is_default boolean not null default false,
  add column if not exists registered_at timestamptz, add column if not exists revoked_at timestamptz, add column if not exists updated_at timestamptz not null default now(),
  add constraint payment_methods_workspace_identity unique(id, workspace_id);
-- Older production schemas already have these generic payment columns without
-- the defaults used by Toss billing. Normalize them before billing writes begin.
update public.payment_methods set method_type='card' where method_type is null;
update public.payment_methods set updated_at=now() where updated_at is null;
alter table public.payment_methods
  alter column method_type set default 'card',
  alter column updated_at set default now(),
  alter column updated_at set not null;
create unique index one_default_toss_card on public.payment_methods(workspace_id) where provider = 'toss' and status = 'active' and is_default;
create table public.billing_credentials (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
  payment_method_id uuid not null unique, encrypted_billing_key text not null, encryption_key_version text not null,
  status text not null default 'active' check(status in ('active','revoked')), created_at timestamptz not null default now(), revoked_at timestamptz,
  foreign key(payment_method_id, workspace_id) references public.payment_methods(id, workspace_id)
);
create table public.billing_consents (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id), user_id uuid not null references auth.users(id),
  registration_session_id uuid not null unique references public.billing_registration_sessions(id),
  consent_type text not null default 'recurring_card_payment', terms_version text not null, billing_policy_version text not null,
  conditions jsonb not null, agreed_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table public.billing_invoices (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id), subscription_id uuid not null,
  billing_date date not null, period_start date not null, period_end date not null, amount integer not null check(amount > 0),
  policy_snapshot jsonb not null, next_billing_date date not null,
  status text not null default 'scheduled' check(status in ('scheduled','payment_pending','processing','paid','failed','canceled')),
  next_attempt_at timestamptz, retry_count integer not null default 0 check(retry_count >= 0), paid_at timestamptz, canceled_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(subscription_id, workspace_id) references public.subscriptions(id, workspace_id),
  unique(subscription_id, period_start, period_end), unique(id, workspace_id), check(period_end > period_start)
);
create index billing_invoices_due on public.billing_invoices(status, next_attempt_at);
create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id), invoice_id uuid not null, payment_method_id uuid not null,
  attempt_no integer not null check(attempt_no > 0), order_id text not null unique, idempotency_key text not null unique, toss_payment_key text unique,
  amount integer not null check(amount > 0), order_name text not null,
  status text not null default 'created' check(status in ('created','processing','succeeded','failed','unknown','reconciling')),
  failure_category text check(failure_category in ('retryable','action_required','configuration','unknown')),
  failure_code text, failure_message text, receipt_url text, requested_at timestamptz, approved_at timestamptz,
  reconciliation_started_at timestamptz, reconciliation_completed_at timestamptz, last_checked_at timestamptz,
  lease_until timestamptz, lease_token uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(invoice_id, workspace_id) references public.billing_invoices(id, workspace_id),
  foreign key(payment_method_id, workspace_id) references public.payment_methods(id, workspace_id), unique(invoice_id, attempt_no), unique(id, workspace_id)
);
create unique index one_unresolved_attempt on public.payment_attempts(invoice_id) where status in ('created','processing','unknown','reconciling','succeeded');
create index billing_attempt_recovery on public.payment_attempts(status, lease_until, last_checked_at);
create table public.payment_cancellations (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id), payment_attempt_id uuid not null,
  toss_transaction_key text not null unique, cancel_amount integer not null check(cancel_amount > 0), cancel_reason text,
  status text not null check(status in ('DONE','IN_PROGRESS','FAILED')), canceled_at timestamptz not null, created_at timestamptz not null default now(),
  foreign key(payment_attempt_id, workspace_id) references public.payment_attempts(id, workspace_id)
);
create table public.billing_operator_actions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
  invoice_id uuid references public.billing_invoices(id), operator_id uuid not null references auth.users(id),
  action text not null, reason text not null, created_at timestamptz not null default now()
);
alter table public.billing_events add column invoice_id uuid, add column payment_attempt_id uuid, add column dedupe_key text unique;
-- Some deployed legacy schemas made status mandatory. Toss billing records the
-- event state in event_type and may legitimately omit this legacy field.
alter table public.billing_events alter column status drop not null;
-- Remove all legacy policies AND client write grants, including permissive ALL policies.
do $$ declare t text; p record; begin
  foreach t in array array['subscriptions','payment_methods','billing_invoices','payment_attempts','billing_events','payment_cancellations','billing_profiles','billing_credentials','billing_registration_sessions','billing_consents','billing_runtime_settings','billing_operator_actions'] loop
    execute format('alter table public.%I enable row level security',t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I',p.policyname,t);
    end loop;
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    if t = any(array['subscriptions','payment_methods','billing_invoices','payment_attempts','billing_events','payment_cancellations']) then
      execute format('grant select on public.%I to authenticated',t);
      execute format('create policy billing_member_read on public.%I for select to authenticated using (private.can_read_workspace(workspace_id))',t);
    end if;
  end loop;
end $$;
-- Immutable invoice facts and immutable request identity.
create function public.billing_immutable_invoice() returns trigger language plpgsql set search_path = '' as $$ begin
  if (new.workspace_id,new.subscription_id,new.billing_date,new.period_start,new.period_end,new.amount,new.policy_snapshot,new.next_billing_date)
    is distinct from (old.workspace_id,old.subscription_id,old.billing_date,old.period_start,old.period_end,old.amount,old.policy_snapshot,old.next_billing_date) then
    raise exception 'Invoice snapshot is immutable';
  end if; return new;
end $$;
create trigger billing_invoice_snapshot before update on public.billing_invoices for each row execute function public.billing_immutable_invoice();
create function public.billing_immutable_attempt() returns trigger language plpgsql set search_path = '' as $$ begin
  if (new.workspace_id,new.invoice_id,new.payment_method_id,new.order_id,new.idempotency_key,new.amount,new.order_name,new.attempt_no)
    is distinct from (old.workspace_id,old.invoice_id,old.payment_method_id,old.order_id,old.idempotency_key,old.amount,old.order_name,old.attempt_no) then
    raise exception 'Attempt request is immutable';
  end if; return new;
end $$;
create trigger billing_attempt_snapshot before update on public.payment_attempts for each row execute function public.billing_immutable_attempt();
-- Begin registration and consent in one transaction. The caller already authenticated;
-- membership is rechecked here to handle revocation races.
create function public.billing_begin_registration(p_workspace uuid,p_user uuid,p_state_hash text,p_policy jsonb,p_conditions jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare result uuid; begin
  perform 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_user and status='active' and role in ('owner','admin') for share;
  if not found then raise exception 'BILLING_FORBIDDEN'; end if;
  insert into public.billing_profiles(workspace_id) values(p_workspace) on conflict(workspace_id) do nothing;
  perform 1 from public.billing_profiles where workspace_id=p_workspace for update;
  update public.billing_registration_sessions set status='failed' where workspace_id=p_workspace and status in ('pending','processing') and expires_at < now();
  insert into public.billing_registration_sessions(workspace_id,initiated_by,state_hash,expires_at,policy_snapshot)
    values(p_workspace,p_user,p_state_hash,now()+interval '10 minutes',p_policy) returning id into result;
  insert into public.billing_consents(workspace_id,user_id,registration_session_id,terms_version,billing_policy_version,conditions)
    values(p_workspace,p_user,result,p_policy->>'termsVersion',p_policy->>'version',p_conditions);
  insert into public.billing_events(workspace_id,event_type,dedupe_key) values(p_workspace,'payment_method.registration_started',result::text||':started');
  return result;
end $$;
create function public.billing_complete_registration(p_session uuid,p_user uuid,p_method uuid,p_encrypted text,p_version text,p_card jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare r public.billing_registration_sessions; had_card boolean; begin
  select * into strict r from public.billing_registration_sessions where id=p_session for update;
  if r.status <> 'processing' or r.initiated_by<>p_user or r.expires_at<now() then raise exception 'INVALID_REGISTRATION'; end if;
  perform 1 from public.workspace_members where workspace_id=r.workspace_id and user_id=p_user and status='active' and role in ('owner','admin') for share;
  if not found then raise exception 'BILLING_FORBIDDEN'; end if;
  perform 1 from public.billing_profiles where workspace_id=r.workspace_id for update;
  select exists(select 1 from public.payment_methods where workspace_id=r.workspace_id and provider='toss' and status='active' and is_default) into had_card;
  insert into public.payment_methods(id,workspace_id,provider,masked_number,status,is_default,issuer_code,card_type,owner_type,registered_at)
    values(p_method,r.workspace_id,'toss',p_card->>'maskedNumber','active',false,p_card->>'issuerCode',p_card->>'cardType',p_card->>'ownerType',now());
  insert into public.billing_credentials(workspace_id,payment_method_id,encrypted_billing_key,encryption_key_version)
    values(r.workspace_id,p_method,p_encrypted,p_version);
  -- Every change rolls back together if any later statement fails.
  update public.payment_methods set is_default=false,status='inactive',updated_at=now() where workspace_id=r.workspace_id and provider='toss' and id<>p_method and is_default;
  update public.payment_methods set is_default=true where id=p_method;
  update public.billing_credentials set status='revoked',revoked_at=now() where workspace_id=r.workspace_id and payment_method_id<>p_method and status='active';
  update public.billing_registration_sessions set status='completed',completed_at=now() where id=p_session;
  insert into public.billing_events(workspace_id,event_type,dedupe_key) values(r.workspace_id,case when had_card then 'payment_method.changed' else 'payment_method.registered' end,p_session::text||':completed');
end $$;
-- All claimers and pause operations serialize on the billing profile row.
create function public.billing_claim_invoice(p_invoice uuid) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare i public.billing_invoices; p public.billing_profiles; s public.subscriptions; m public.payment_methods; a public.payment_attempts; begin
  select * into i from public.billing_invoices where id=p_invoice;
  select * into p from public.billing_profiles where workspace_id=i.workspace_id for update;
  if not coalesce((select charges_enabled from public.billing_runtime_settings where singleton),false) then return null; end if;
  if p.id is null or not p.auto_charge_enabled or p.billing_status <> 'active' then return null; end if;
  select * into i from public.billing_invoices where id=p_invoice for update;
  if i.status not in ('scheduled','payment_pending') or i.next_attempt_at is null or i.next_attempt_at>now() then return null; end if;
  select * into s from public.subscriptions where id=i.subscription_id;
  if s.charge_stop_at <= now() or s.status in ('paused','canceled') or s.enrollment_confirmed_at is null then return null; end if;
  if exists(select 1 from public.payment_attempts where invoice_id=i.id and status<>'failed') then return null; end if;
  select * into m from public.payment_methods where workspace_id=i.workspace_id and provider='toss' and status='active' and is_default;
  if not found or not exists(select 1 from public.billing_credentials where payment_method_id=m.id and status='active') then return null; end if;
  insert into public.payment_attempts(workspace_id,invoice_id,payment_method_id,attempt_no,order_id,idempotency_key,amount,order_name,status,lease_until,lease_token)
    values(i.workspace_id,i.id,m.id,(select coalesce(max(attempt_no),0)+1 from public.payment_attempts where invoice_id=i.id),
      'replo_'||replace(gen_random_uuid()::text,'-',''),gen_random_uuid()::text,i.amount,'Replo '||i.billing_date::text,'created',now()+interval '3 minutes',gen_random_uuid()) returning * into a;
  update public.billing_invoices set status='processing',updated_at=now() where id=i.id;
  return to_jsonb(a);
end $$;
create function public.billing_authorize_attempt(p_attempt uuid,p_lease uuid) returns boolean language plpgsql security invoker set search_path = '' as $$
declare a public.payment_attempts; p public.billing_profiles; begin
  select * into a from public.payment_attempts where id=p_attempt;
  select * into p from public.billing_profiles where workspace_id=a.workspace_id for update;
  select * into a from public.payment_attempts where id=p_attempt for update;
  if a.status<>'created' or a.lease_token is distinct from p_lease or a.lease_until<now() then return false; end if;
  if not coalesce((select charges_enabled from public.billing_runtime_settings where singleton),false) or not p.auto_charge_enabled or p.billing_status<>'active'
    or not exists(select 1 from public.payment_methods where id=a.payment_method_id and status='active' and is_default)
    or exists(select 1 from public.billing_invoices i join public.subscriptions s on s.id=i.subscription_id where i.id=a.invoice_id and (s.status in ('paused','canceled') or s.charge_stop_at<=now())) then
    update public.payment_attempts set status='failed',failure_category='configuration',failure_code='CHARGE_PAUSED' where id=a.id;
    update public.billing_invoices set status='payment_pending' where id=a.invoice_id;
    return false;
  end if;
  update public.payment_attempts set status='processing',requested_at=now(),updated_at=now() where id=a.id;
  return true;
end $$;
create function public.billing_record_success(p_attempt uuid,p_payment_key text,p_amount integer,p_approved_at timestamptz,p_receipt text)
returns void language plpgsql security invoker set search_path = '' as $$
declare a public.payment_attempts; i public.billing_invoices; begin
  select * into strict a from public.payment_attempts where id=p_attempt for update;
  select * into strict i from public.billing_invoices where id=a.invoice_id for update;
  if a.amount<>p_amount or i.amount<>p_amount or (a.toss_payment_key is not null and a.toss_payment_key<>p_payment_key) then raise exception 'PAYMENT_MISMATCH'; end if;
  if a.status='succeeded' then return; end if;
  if a.status='failed' or i.status='canceled' then raise exception 'PAYMENT_STATE_CONFLICT'; end if;
  update public.payment_attempts set status='succeeded',toss_payment_key=p_payment_key,approved_at=p_approved_at,receipt_url=p_receipt,
    failure_category=null,failure_code=null,failure_message=null,reconciliation_completed_at=now(),last_checked_at=now(),lease_until=null,updated_at=now() where id=a.id;
  update public.billing_invoices set status='paid',paid_at=p_approved_at,next_attempt_at=null,updated_at=now() where id=i.id;
  update public.subscriptions set next_billing_date=greatest(next_billing_date,i.next_billing_date),
    status=case when status in ('paused','canceled') then status
      when exists(select 1 from public.billing_invoices where subscription_id=i.subscription_id and id<>i.id and status='failed') then 'past_due' else 'active' end,updated_at=now() where id=i.subscription_id;
  if a.status in ('unknown','reconciling') then
    insert into public.billing_events(workspace_id,invoice_id,payment_attempt_id,event_type,dedupe_key) values(a.workspace_id,i.id,a.id,'payment.recovered',a.id::text||':recovered') on conflict(dedupe_key) do nothing;
  end if;
  insert into public.billing_events(workspace_id,invoice_id,payment_attempt_id,event_type,dedupe_key) values(a.workspace_id,i.id,a.id,'payment.succeeded',a.id::text||':succeeded') on conflict(dedupe_key) do nothing;
end $$;
create function public.billing_record_failure(p_attempt uuid,p_category text,p_code text,p_message text,p_retry_at timestamptz)
returns void language plpgsql security invoker set search_path = '' as $$
declare a public.payment_attempts; i public.billing_invoices; begin
  select * into strict a from public.payment_attempts where id=p_attempt for update;
  if a.status in ('succeeded','failed') then return; end if;
  select * into strict i from public.billing_invoices where id=a.invoice_id for update;
  update public.payment_attempts set status=case when p_category='unknown' then 'unknown' else 'failed' end,
    failure_category=p_category,failure_code=p_code,failure_message=p_message,lease_until=null,updated_at=now() where id=a.id;
  if p_category<>'unknown' then
    update public.billing_invoices set status=case when p_retry_at is null then 'failed' else 'payment_pending' end,
      next_attempt_at=p_retry_at,retry_count=retry_count+1,updated_at=now() where id=i.id;
    if p_retry_at is null then update public.subscriptions set status='past_due',updated_at=now() where id=i.subscription_id and status not in ('paused','canceled'); end if;
  end if;
  insert into public.billing_events(workspace_id,invoice_id,payment_attempt_id,event_type,message,dedupe_key)
    values(a.workspace_id,i.id,a.id,case when p_category='unknown' then 'payment.reconciliation_started' else 'payment.failed' end,p_message,a.id::text||':'||p_category) on conflict(dedupe_key) do nothing;
end $$;
create function public.billing_claim_reconciliation(p_attempt uuid) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.payment_attempts; begin
  select * into a from public.payment_attempts where id=p_attempt for update skip locked;
  if not found or a.status='failed' or a.lease_until>now() or a.last_checked_at>now()-interval '10 minutes' then return null; end if;
  if a.status='created' and a.requested_at is null then
    -- The original lease is fenced: a resumed old worker cannot dispatch this attempt.
    update public.payment_attempts set status='failed',failure_category='configuration',failure_code='NOT_DISPATCHED',lease_until=null where id=a.id;
    update public.billing_invoices set status='payment_pending' where id=a.invoice_id;
    return null;
  end if;
  update public.payment_attempts set lease_until=now()+interval '3 minutes',lease_token=gen_random_uuid(),
    status=case when status='succeeded' then status else 'reconciling' end,reconciliation_started_at=now(),last_checked_at=now() where id=a.id returning * into a;
  return to_jsonb(a);
end $$;
create function public.billing_record_cancellation(p_attempt uuid,p_transaction text,p_amount integer,p_status text,p_canceled_at timestamptz)
returns void language plpgsql security invoker set search_path = '' as $$
declare a public.payment_attempts; begin
  select * into strict a from public.payment_attempts where id=p_attempt and status='succeeded' for update;
  if p_amount<=0 or p_amount>a.amount then raise exception 'INVALID_CANCEL_AMOUNT'; end if;
  if exists(select 1 from public.payment_cancellations where toss_transaction_key=p_transaction and (payment_attempt_id<>a.id or cancel_amount<>p_amount)) then raise exception 'CANCELLATION_MISMATCH'; end if;
  insert into public.payment_cancellations(workspace_id,payment_attempt_id,toss_transaction_key,cancel_amount,status,canceled_at)
    values(a.workspace_id,a.id,p_transaction,p_amount,p_status,p_canceled_at) on conflict(toss_transaction_key) do update set status=excluded.status;
  if (select coalesce(sum(cancel_amount),0) from public.payment_cancellations where payment_attempt_id=a.id and status='DONE')>a.amount then raise exception 'EXCESS_CANCEL_AMOUNT'; end if;
  insert into public.billing_events(workspace_id,invoice_id,payment_attempt_id,event_type,dedupe_key)
    values(a.workspace_id,a.invoice_id,a.id,'payment.cancellation_updated',p_transaction||':'||p_status) on conflict(dedupe_key) do nothing;
end $$;
create function public.billing_pause_workspace(p_workspace uuid,p_reason text) returns void language plpgsql security invoker set search_path = '' as $$ begin
  update public.billing_profiles set auto_charge_enabled=false,billing_status='paused',paused_at=now(),pause_reason=p_reason,updated_at=now() where workspace_id=p_workspace;
  insert into public.billing_events(workspace_id,event_type,message) values(p_workspace,'billing.paused','자동결제가 중지되었습니다.');
end $$;
-- Atomically verify the subscription snapshot, create the invoice and advance only
-- the generation cursor. Payment success advances the customer-facing billing date.
create function public.billing_create_invoice(p_subscription uuid,p_updated_at timestamptz,p_invoice jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare s public.subscriptions; created uuid; consent public.billing_consents; begin
  select * into strict s from public.subscriptions where id=p_subscription for update;
  if s.updated_at is distinct from p_updated_at or s.enrollment_confirmed_at is null
    or s.billing_policy is distinct from p_invoice->'policy_snapshot'
    or s.status not in ('active','past_due','pending_payment_method')
    or s.auto_charge_start_date is null or s.first_period_start is null
    or (p_invoice->>'billing_date')::date < s.auto_charge_start_date
    or (p_invoice->>'period_start')::date < s.first_period_start
    or (s.paid_through is not null and (p_invoice->>'period_start')::date < s.paid_through)
    or (s.invoice_stop_date is not null and (p_invoice->>'billing_date')::date >= s.invoice_stop_date)
    then return false; end if;
  if (p_invoice->>'amount')::numeric <> s.monthly_fee * (case when s.billing_policy->>'vat'='excluded' then 1.1 else 1 end) then raise exception 'INVOICE_AMOUNT_MISMATCH'; end if;
  select c.* into consent from public.billing_consents c join public.billing_registration_sessions r on r.id=c.registration_session_id
    where c.workspace_id=s.workspace_id and r.status='completed' order by r.completed_at desc limit 1;
  if consent.id is null or consent.conditions->'policy' is distinct from s.billing_policy
    or (consent.conditions->>'amount')::integer is distinct from (p_invoice->>'amount')::integer then
    raise exception 'BILLING_CONSENT_REQUIRED';
  end if;
  insert into public.billing_invoices(workspace_id,subscription_id,billing_date,period_start,period_end,amount,policy_snapshot,next_billing_date,next_attempt_at)
    values(s.workspace_id,s.id,(p_invoice->>'billing_date')::date,(p_invoice->>'period_start')::date,(p_invoice->>'period_end')::date,
    (p_invoice->>'amount')::integer,s.billing_policy,(p_invoice->>'next_billing_date')::date,(p_invoice->>'next_attempt_at')::timestamptz)
    on conflict(subscription_id,period_start,period_end) do nothing returning id into created;
  update public.subscriptions set invoice_generation_date=greatest(invoice_generation_date,(p_invoice->>'next_billing_date')::date) where id=s.id;
  if created is not null then
    insert into public.billing_events(workspace_id,subscription_id,invoice_id,event_type,dedupe_key) values(s.workspace_id,s.id,created,'invoice.created',created::text||':created');
  end if;
  return created is not null;
end $$;
-- No customer endpoint calls this. Operator approval is explicit and auditable.
create function public.billing_approve_arrears_retry(p_invoice uuid,p_operator uuid,p_reason text)
returns void language plpgsql security invoker set search_path = '' as $$
declare i public.billing_invoices; begin
  if p_operator is null or length(trim(p_reason))<3 then raise exception 'APPROVAL_REQUIRED'; end if;
  select * into strict i from public.billing_invoices where id=p_invoice for update;
  if i.status<>'failed' or exists(select 1 from public.payment_attempts where invoice_id=i.id and status<>'failed') then raise exception 'INVOICE_NOT_RETRYABLE'; end if;
  update public.billing_invoices set status='payment_pending',retry_count=0,next_attempt_at=now(),updated_at=now() where id=i.id;
  insert into public.billing_events(workspace_id,invoice_id,event_type,message) values(i.workspace_id,i.id,'payment.retry_approved','담당자 확인 후 재결제가 승인되었습니다.');
  insert into public.billing_operator_actions(workspace_id,invoice_id,operator_id,action,reason) values(i.workspace_id,i.id,p_operator,'arrears_retry_approved',p_reason);
end $$;
create function public.billing_due_invoice_ids(p_limit integer default 2) returns table(id uuid)
language sql security invoker set search_path = '' as $$
  select i.id from public.billing_invoices i
  join public.billing_profiles p on p.workspace_id=i.workspace_id
  join public.subscriptions s on s.id=i.subscription_id
  where i.status in ('scheduled','payment_pending') and i.next_attempt_at<=now()
    and p.auto_charge_enabled and p.billing_status='active'
    and (select charges_enabled from public.billing_runtime_settings where singleton)
    and s.status not in ('paused','canceled') and s.enrollment_confirmed_at is not null
    and (s.charge_stop_at is null or s.charge_stop_at>now())
    and exists(select 1 from public.payment_methods m join public.billing_credentials c on c.payment_method_id=m.id
      where m.workspace_id=i.workspace_id and m.provider='toss' and m.is_default and m.status='active' and c.status='active')
    and not exists(select 1 from public.payment_attempts a where a.invoice_id=i.id and a.status<>'failed')
  order by i.next_attempt_at,i.id limit greatest(1,least(p_limit,10));
$$;
-- Service-only RPCs. SECURITY INVOKER plus revoked PUBLIC execute, not exposed definer helpers.
do $$ declare r record; begin
  for r in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'billing\_%' escape '\' loop
    execute format('revoke all on function %s from public, anon, authenticated',r.signature);
    execute format('grant execute on function %s to service_role',r.signature);
  end loop;
end $$;
commit;
