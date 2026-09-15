-- 토스페이먼츠 빌링(자동결제) 카드 등록을 위한 payment_methods 확장.
-- 카드 번호/유효기간/CVC는 저장하지 않습니다. 토스 인증창이 발급한 빌링키만
-- 암호화해 보관하고, 화면에는 마스킹된 번호와 카드사만 노출합니다.

alter table public.payment_methods
  add column if not exists provider text not null default 'toss',
  add column if not exists customer_key text,
  add column if not exists billing_key_encrypted text,
  add column if not exists card_company text,
  add column if not exists card_type text,
  add column if not exists owner_type text,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists payment_methods_workspace_updated_idx
  on public.payment_methods(workspace_id, updated_at desc);

-- 빌링키와 고객키는 서버(service_role)만 읽습니다. 워크스페이스 멤버는
-- 마스킹된 카드 정보까지만 조회할 수 있어야 합니다.
revoke select (billing_key_encrypted, customer_key)
  on public.payment_methods from anon, authenticated;
