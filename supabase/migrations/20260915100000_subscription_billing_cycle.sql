-- 매월 1일 정기 결제와 일할 청구를 위한 컬럼.
-- 신규 유료 전환은 '이번 달 잔여 + 다음 달'을 한 번에 청구하고, 그 다음 달 1일을
-- 다음 결제일로 잡습니다. 유료 플랜 간 변경은 다음 결제일부터 적용합니다.

alter table public.subscriptions
  add column if not exists current_period_start date,
  add column if not exists current_period_end date,
  add column if not exists scheduled_plan_name text,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists subscriptions_next_billing_idx
  on public.subscriptions(next_billing_date)
  where status = 'active';

alter table public.billing_events
  add column if not exists amount numeric(12,2),
  add column if not exists order_id text,
  add column if not exists plan_name text,
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists provider text,
  add column if not exists provider_payment_key text;

-- 같은 워크스페이스·플랜·기간이면 order_id가 같습니다. 재시도나 이중 클릭이
-- 두 번 청구되지 않도록 여기서 한 번 더 막습니다.
create unique index if not exists billing_events_order_id_key
  on public.billing_events(order_id)
  where order_id is not null;
