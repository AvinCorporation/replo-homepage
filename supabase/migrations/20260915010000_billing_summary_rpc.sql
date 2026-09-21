-- Return the customer billing screen in one database round trip.
begin;

create or replace function public.billing_customer_summary(p_workspace uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'subscription', (
      select jsonb_build_object(
        'plan_name', s.plan_name,
        'monthly_fee', s.monthly_fee,
        'included_tickets', s.included_tickets,
        'status', s.status,
        'next_billing_date', s.next_billing_date,
        'billing_policy', s.billing_policy,
        'enrollment_confirmed_at', s.enrollment_confirmed_at
      )
      from public.subscriptions s
      where s.workspace_id = p_workspace
      order by s.created_at desc
      limit 1
    ),
    'paymentMethods', coalesce((
      select jsonb_agg(to_jsonb(method_row) order by method_row.is_default desc, method_row.registered_at)
      from (
        select id, masked_number, issuer_code, card_type, owner_type, status,
          is_default, registered_at
        from public.payment_methods
        where workspace_id = p_workspace
          and provider = 'toss'
          and status = 'active'
      ) method_row
    ), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(to_jsonb(invoice_row) order by invoice_row.billing_date desc)
      from (
        select id, billing_date, period_start, period_end, amount, status,
          next_attempt_at, paid_at
        from public.billing_invoices
        where workspace_id = p_workspace
        order by billing_date desc
        limit 50
      ) invoice_row
    ), '[]'::jsonb),
    'attempts', coalesce((
      select jsonb_agg(to_jsonb(attempt_row) order by attempt_row.created_at desc)
      from (
        select id, invoice_id, amount, status, failure_category,
          failure_message, receipt_url, approved_at, created_at
        from public.payment_attempts
        where workspace_id = p_workspace
        order by created_at desc
        limit 200
      ) attempt_row
    ), '[]'::jsonb),
    'cancellations', coalesce((
      select jsonb_agg(to_jsonb(cancellation_row) order by cancellation_row.canceled_at desc)
      from (
        select payment_attempt_id, cancel_amount, status, canceled_at
        from public.payment_cancellations
        where workspace_id = p_workspace
        order by canceled_at desc
        limit 200
      ) cancellation_row
    ), '[]'::jsonb),
    'nextInvoice', (
      select jsonb_build_object(
        'id', i.id,
        'amount', i.amount,
        'billing_date', i.billing_date,
        'next_attempt_at', i.next_attempt_at,
        'status', i.status
      )
      from public.billing_invoices i
      where i.workspace_id = p_workspace
        and i.status in ('scheduled', 'payment_pending', 'processing')
      order by i.billing_date
      limit 1
    )
  )
  where exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = p_workspace
      and member.user_id = (select auth.uid())
      and member.status = 'active'
  );
$$;

revoke all on function public.billing_customer_summary(uuid) from public, anon;
grant execute on function public.billing_customer_summary(uuid) to authenticated, service_role;

commit;
