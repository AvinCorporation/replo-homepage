# Toss 자동결제 MVP 개발 현황

2026-09-13 · 원본 명세 v0.2 · `feat/toss-billing`

`origin/main` (`e7b897c`)에서 분리한 worktree의 구현입니다. 기존 `dev` 및 원래 작업 폴더의 미커밋 변경은 포함하지 않습니다. 운영 DB 마이그레이션, 배포, 실제 승인, 고객 알림 전송은 실행하지 않았습니다.

## 후속 작업: Toss 키 수령 후 진행

**사용자 확인(2026-09-13): 개발 Supabase 및 Toss Test 키가 설정된 Preview는 현재 없으며, Toss에서 키를 받은 뒤 실제 연동 테스트를 진행한다.**

이번 코드 검증과 실제 PG 연동 검증을 구분합니다. Toss Test 카드 등록·변경·승인·실패·취소, 실제 Supabase RLS/API, 별도 연결 간 동시 Worker 테스트는 후속 작업입니다. 이 검증 전 MVP 출시 완료로 판단하지 않습니다.

1. Toss 자동결제 사용 가능한 계약/MID와 **자동결제용 Test Client/Secret Key**를 확인합니다.
2. 운영과 다른 개발 Supabase 프로젝트를 준비합니다. 기존 마이그레이션을 적용한 개발 스키마에 `20260913062551_toss_billing_mvp.sql`, `20260913132850_harden_toss_billing_workers.sql`, `20260913154000_split_billing_failure_counters.sql`, `20260914010000_primary_backup_payment_methods.sql`, `20260914020000_scheduled_plan_changes.sql` 순서로 적용합니다. 운영 DB에 먼저 실행하지 않습니다.
3. 아래 환경변수를 Preview에 등록합니다. Secret을 Git/이슈/대화에 붙여넣지 않습니다.
4. 개발 Auth User, Workspace, owner/admin/editor/viewer, 두 번째 Workspace를 준비합니다.
5. 사업 정책과 기존 고객 전환 조건을 확인하고, 테스트 구독에 명시적으로 설정합니다.
6. 두 승인 스위치가 모두 꺼진 상태로 카드 등록·권한·callback 테스트를 수행합니다.
7. **개발 환경만** 두 스위치를 켜고 인증된 Worker를 호출해 승인·재시도·복구·취소를 검증합니다.
8. 아래 출시 Gate를 확인한 뒤 Production Live 키 및 운영 활성화를 별도로 진행합니다.

## 현재 구현

- 기존 Workspace membership 유지. 고객 API는 `getUser()`와 현재 membership/role을 검증합니다.
- owner/admin이 마이페이지에서 라이트·베이직·프로 요금제 변경을 다음 달 1일로 예약할 수 있습니다. 엔터프라이즈는 별도 견적 문의로 연결합니다.
- Invoice/Attempt/Consent/Credential/Registration/Cancellation/Profile 분리, 교차 Workspace 복합 FK, 청구기간·주문번호·멱등키 uniqueness.
- Invoice 금액/기간/정책 및 Attempt 요청 identity의 DB 불변성.
- AES-256-GCM, Workspace+카드 ID AAD, 키 버전 및 이전 키 복호화 지원. credential은 서비스 전용.
- 1회·만료 state 해시, 등록 사용자·Workspace 고정, callback 권한 재검증, 주 카드 전환 단일 DB 트랜잭션.
- 마이페이지 실제 구독·주 카드·백업 카드·예정금액·청구·실패·취소 조회 및 Toss SDK 카드 인증.
- 활성 Toss 카드는 Workspace당 최대 2장입니다. 첫 카드는 주 카드, 두 번째 카드는 백업 카드로 저장되며 owner/admin이 주 카드를 바꿀 수 있습니다. Worker는 주 카드만 사용하고 백업 카드를 자동 대체 승인하지 않습니다. 기존 주 카드의 승인이 아직 확정되지 않았으면 결과가 반영될 때까지 전환을 차단합니다.
- 요금제 카탈로그는 라이트 590,000원/200건, 베이직 990,000원/500건, 프로 1,790,000원/1,000건, 엔터프라이즈 2,000건 이상/별도 견적이며 모두 VAT 별도 기준입니다.
- 셀프서비스 요금제 신청에서 현재·변경 플랜, 기본 이용료, VAT, 실제 결제액, 포함 문의량, 적용일과 매월 자동결제 조건을 함께 확인받아 고정 저장합니다. 카드가 없으면 신청 후 바로 카드를 등록할 수 있으며, 실제 결제는 다음 달 1일부터 시작합니다. 예약을 다시 하면 이전 예약은 취소되고 최신 예약 한 건만 남습니다.
- 생성/승인/복구 Worker 분리. Invoice generation cursor와 결제 성공 시 다음 결제일 분리. Invoice별 오류를 격리해 한 건의 credential/DB 오류가 같은 배치의 다음 청구를 막지 않습니다.
- 승인 전 Workspace 중지 및 DB 전체 중지 재검증. 영수증 및 부분/전체 취소 반영.
- 별도 callback HTML 응답은 공통 analytics/Channel Talk 레이아웃을 사용하지 않습니다. query 즉시 제거, no-store, no-referrer, nonce CSP 적용.
- 복구는 원래 orderId 조회만 수행하며, NOT_FOUND/timeout 뒤 새 결제를 만들지 않습니다.
- PG 승인 성공 후 DB 장애는 원래 processing Attempt를 남깁니다. 이후 lookup으로 동일 승인 복구.

## 환경변수

`docs/billing/environment.example`을 참고합니다. 실제 값을 저장한 파일은 Git에 넣지 않습니다.

| 이름 | 역할 |
| --- | --- |
| `BILLING_ENVIRONMENT` | `test` / `production`; Vercel production 여부와 일치 필수 |
| `TOSS_CLIENT_KEY` | Test `test_ck_` 또는 Live `live_ck_`; 등록 API가 인증 후 브라우저에 제공 |
| `TOSS_SECRET_KEY` | 서버 전용 `test_sk_` / `live_sk_` |
| `BILLING_SITE_URL` | 고정 callback origin. Preview에도 해당 Preview URL 지정 |
| `BILLING_TEST_SUPABASE_URL` | 허용된 개발 DB URL; 실제 `NEXT_PUBLIC_SUPABASE_URL`과 일치 필수 |
| `BILLING_PRODUCTION_SUPABASE_URL` | 운영 DB URL; Preview에서 이 DB 사용 금지 |
| `BILLING_ENCRYPTION_KEY_VERSION` | 현재 쓰기용 키 버전 |
| `BILLING_ENCRYPTION_KEYS` | 버전별 32-byte base64 키 JSON. Preview/Production 별도 키 |
| `BILLING_CHARGES_ENABLED` | 기본 `false` |
| `BILLING_ALLOW_TEST_KEYS_IN_PRODUCTION` | 라이브 도메인에서 Test 빌링키 등록을 검증할 때만 `true`. 이때 자동 승인은 강제로 차단 |
| `BILLING_CRON_SECRET` | `/api/cron/billing`의 Bearer 인증 |
| 기존 Supabase 환경변수 | public URL/anon key, 서버 전용 service role |

키 rotation: 새 버전을 keyring에 추가 → active 버전 변경 → 별도 서버 작업에서 이전 자격정보 복호화/재암호화 → 이전 버전 사용 건이 0건인지 확인 후 이전 키 제거. 재암호화 실행기는 이번 범위에 포함하지 않습니다.

운영 Auth만 사용할 수 있는 초기 검증 기간에는 `BILLING_ENVIRONMENT=production`, 운영 Supabase URL, Toss Test 키와 `BILLING_ALLOW_TEST_KEYS_IN_PRODUCTION=true`를 함께 사용할 수 있습니다. 이 모드는 `BILLING_CHARGES_ENABLED=true`를 거부하므로 카드 등록 UI만 검증할 수 있습니다. Live 키 전환 전 Test로 등록한 결제수단과 credential을 운영자가 정리하고, 허용 플래그를 제거해야 합니다.

## 결제경로 (PG 가맹점 심사 확인용)

심사자가 홈페이지에서 결제까지 따라올 수 있는 경로입니다. 링크가 끊기면 결제경로 확인이 불가하므로, 아래 단계는 유지해야 합니다.

1. `https://replo.kr` → 상단 메뉴 **요금제**(`#pricing-sec`) → 플랜 카드의 **이 플랜으로 시작**
2. 로그인 전이면 Google 로그인 창으로 이동하고, 로그인 후 1번에서 고른 플랜 화면으로 되돌아옵니다(`next` 파라미터).
3. 워크스페이스가 없으면 `/onboarding`에서 회사·브랜드 정보를 입력한 뒤 같은 화면으로 이어집니다.
4. `/mypage?section=plan`에서 월 이용료·VAT·실제 결제금액·시작일(다음 달 1일)·매월 자동결제 조건을 확인하고 **다음 달 1일부터 신청**을 누릅니다.
5. 같은 화면의 **결제 · 청구 정보 → 카드 등록**에서 결제 금액·결제일·재시도·해지 안내에 동의하면 토스페이먼츠 카드 등록(빌링 인증) 창이 열립니다. 카드 정보는 토스 인증창에서만 입력하며 Replo 화면에 저장하지 않습니다.
6. 대시보드에서는 좌측 레일의 **요금제** 메뉴로 4번 화면에 바로 들어갈 수 있습니다.

요금·자동결제·해지 조건은 홈페이지 요금제 섹션 하단(`homeCopy.pricing.note`)에도 함께 표시합니다.
카드 등록 창이 열리지 않으면 `BILLING_*`·`TOSS_*` 환경변수부터 확인합니다. 설정이 맞지 않으면 API가 503과 함께 `BILLING_ENVIRONMENT_MISMATCH` 등의 코드를 서버 로그에 남깁니다.

## 구독 해지와 회원 탈퇴

owner/admin이 마이페이지 > 이용 플랜에서 직접 처리합니다. 운영자가 DB를 직접 수정하지 않아도 됩니다.

### 구독 해지 (`/api/mypage/subscription/cancel`)

- `POST`: `cancellation_requested_at`, `cancellation_effective_at`, `invoice_stop_date`를 설정하고 예약된 요금제 변경을 함께 취소합니다.
- 해지 효력일은 다음 청구일(없거나 지났으면 다음 달 1일)입니다. 그 날부터 새 청구서를 만들지 않습니다.
- 이미 발행된 청구서와 미납 처리는 건드리지 않습니다. `charge_stop_at`을 설정하지 않으므로 기존 청구 승인은 그대로 진행됩니다. 환불·정산·마지막 청구 확정은 여전히 운영 확인 사항입니다.
- `DELETE`: 효력일 전까지 해지 신청을 철회합니다. 효력일이 지나면 거부하고 담당자 문의로 안내합니다.
- 구독 행의 `status`는 이 흐름에서 바꾸지 않습니다. 실제 종료 확정은 운영자가 판단합니다.

### 회원 탈퇴 (`DELETE /api/mypage/account`)

- 계정 단위입니다. 참여 중인 모든 워크스페이스에서 나가고, 마지막 owner인 워크스페이스는 `status='disabled'`로 종료하며 채널 연동을 끊고 대기 중인 초대를 회수합니다.
- 차단 조건(마지막 owner인 워크스페이스가 하나라도 해당하면 차단):
  - `subscriptions.status='past_due'` — 미납이 있어 운영 확인 필요
  - 유료 요금제 이용 중이고 해지 신청 전
  - 예약된 요금제 변경이 남아 있음
- 개인정보(`users.name`, `email`, `avatar_url`)는 즉시 익명화하고 로그인 계정을 삭제합니다. 결제 동의·카드 등록 세션 등이 `auth.users`를 참조하고 있으면 계정 삭제가 거부되는데, 이 기록은 보존 대상이므로 오류로 처리하지 않고 익명화 상태로 둡니다(서버 로그에 경고만 남습니다).
- 결제·세금 관련 기록은 워크스페이스 단위로 남습니다.

## 셀프서비스 요금제 결제 정책

고객이 라이트·베이직·프로 요금제를 신청할 때 화면에서 다음 조건을 확인하고 동의합니다.

- 기본 이용료에 VAT 10%를 더한 금액을 결제합니다.
- 새 요금제와 첫 결제는 다음 달 1일부터 시작합니다.
- 이후 매월 1일 등록한 주 카드로 자동결제합니다.
- 결제 실패 시 임의의 추가 승인을 만들지 않고 고객 확인이 필요한 상태로 전환합니다.
- 카드 변경만으로 이전 미납금을 다시 결제하지 않습니다.
- 해지는 마이페이지 문의하기를 통해 요청합니다.

이 조건은 `self-service-plan-v1` 정책과 `plan-change-v2` 약관 버전으로 저장됩니다. 기존에 예약된 셀프서비스 변경도 같은 조건으로 전환되며, 카드 등록 화면에서 결제 금액과 시작일을 다시 확인합니다.

## 별도 계약 고객 정책

셀프서비스 요금제가 아닌 기존 계약 고객은 `subscriptions.billing_policy`가 누락되거나 지원 값과 다르면 카드 등록과 신규 결제를 차단합니다. 아래는 별도 계약을 등록할 때 사용하는 **스키마 예시이며 승인된 정책이 아닙니다.**

```json
{
  "version": "replace-with-approved-policy-version",
  "termsVersion": "replace-with-approved-terms-version",
  "vat": "included",
  "firstCharge": "contract_date",
  "retry": { "basis": "billing_date", "days": [1, 3, 5] },
  "cardChangeArrears": "manual_approval",
  "cancellationInstructions": "replace-with-approved-cancellation-contact"
}
```

- VAT: `included` 또는 `excluded`. 별도 금액의 10%가 원 단위 정수가 아니면 반올림하지 않고 차단합니다. 별도 반올림 정책 확정 필요.
- 최초 결제: `contract_date` 또는 `registration`. 등록 완료 자체는 결제 성공이 아닙니다. 실제 승인은 다음 Worker에서 수행됩니다.
- `billing_anchor_day`: 구독마다 명시, 코드 기본값 없음. 31일 → 2월 말일 → 3월 31일 유지.
- 재시도 기준: `billing_date`(최초 청구일 한국시간 자정 기준) / `previous_failure`(직전 실패 시각 기준). 오프셋 배열은 명시적으로 설정. 이미 지나간 최초청구일 기준 재시도 창은 몰아서 처리하지 않고 수동 확인 대상으로 종료합니다.
- 신규 Invoice 생성 시 마지막으로 완료된 카드 등록 동의 또는 실제 적용된 요금제 변경 동의가 현재 구독의 정책/금액과 일치해야 합니다. 이미 생성된 미납 Invoice는 이전 동의와 금액을 유지합니다.
- 카드 변경 후 미납: 현재 지원 값은 `manual_approval`뿐입니다. 다른 정책은 확정 후 별도 구현해야 합니다. 카드 변경만으로 미납을 재결제하지 않습니다.
- 서비스 운영: `past_due`로 Workspace/CS 운영을 자동 중단하지 않습니다.
- 해지/마지막 청구/과거 미납: 운영 확인 후 별도 중지/승인 필드를 사용합니다. 자동 정책을 추정하지 않습니다.

## 기존 고객 전환과 날짜

기존 데이터는 자동 전환하지 않습니다. 운영자가 다음을 확인한 후 테스트/운영 구독에 입력해야 합니다.

- `auto_charge_start_date`: 자동결제 시작 허용일
- `first_period_start`: 최초 자동결제 대상 기간 시작일
- `paid_through`: 이미 납부한 기간의 **exclusive end**(다음 미납기간 시작일)
- `next_billing_date`, `billing_anchor_day`: 최초 계약 청구일과 원래 기준일
- `enrollment_confirmed_at`, `enrollment_confirmed_by`: 전환 확인 일시·담당자
- 기존 수납 방식 종료 여부와 마지막 입금기간을 외부 계약/수납 원장으로 재확인
- `billing_policy`: 고객에게 안내할 확정 정책

Invoice 기간은 `[period_start, period_end)`입니다. 기존 과거 `next_billing_date`만으로 청구하지 않습니다. 금액은 VAT 처리 이후 Invoice에 integer KRW로 고정됩니다. 이후 Subscription 가격 수정이 기존 Invoice에 반영되지 않습니다.

`cancellation_requested_at`, `cancellation_effective_at`, `invoice_stop_date`, `charge_stop_at`은 서로 다른 필드입니다. 취소·해지 운영 정책 확정 후 각각 설정합니다.

## Worker / 운영 처리

`GET /api/cron/billing`, `Authorization: Bearer <BILLING_CRON_SECRET>`.

등록/청구 테스트 중에는 직접 인증 호출합니다. **Cron 스케줄은 아직 활성화하지 않았습니다.** Vercel Cron은 `CRON_SECRET`을 보내므로 이를 사용할 때는 `BILLING_CRON_SECRET`과 같은 값으로 맞춰야 합니다. 실제 플랜이 300초 Route duration을 지원하는지 확인합니다.

한 호출에서 복구와 외부 취소 확인을 합쳐 최대 2건, Invoice 생성 최대 50개 구독, 승인 최대 2건으로 제한합니다. Toss 요청은 각각 65초 타임아웃입니다. Provider 요청만 최악의 경우 약 260초이므로 `maxDuration=300`에서 DB 처리와 런타임 오버헤드 여유는 약 40초입니다. 대기 건이 많으면 인증된 scheduler 호출 빈도를 조정합니다.

Cron은 복구 후 KST 기준 적용일이 지난 요금제 예약을 먼저 반영하고, 그 다음 Invoice를 생성합니다. 변경은 다음 달 1일에 구독에 적용되며 그 이후 새로 생성되는 Invoice부터 새 기본 이용료와 VAT 10%를 사용합니다. 이미 생성된 Invoice는 수정하지 않고 일할 계산도 하지 않습니다. 구독이 적용 전에 중지 또는 취소되면 예약도 취소 상태로 정리합니다.

승인은 다음 세 조건이 모두 true일 때만 가능합니다.

1. 서버 `BILLING_CHARGES_ENABLED=true`
2. 서버 전용 `billing_runtime_settings.charges_enabled=true`
3. Workspace `billing_profiles.auto_charge_enabled=true`, `billing_status='active'`

즉시 전체 중지: DB singleton의 `charges_enabled=false` 설정. 환경변수도 false로 유지합니다. Workspace 중지: 서비스 전용 `billing_pause_workspace(workspace_id, reason)` 호출.

중지와 승인 검증은 DB에서 순서가 결정됩니다. **이미 최종 검증을 통과해 PG에 전달된 승인 요청은 중지로 취소되지 않습니다.** 이는 조회/복구 대상으로 남으며, 필요 시 별도 환불 운영을 진행합니다.

만료된 `created` Attempt 중 `requested_at IS NULL`은 원래 lease를 무효화하고 미전송 실패로 정리합니다. 승인 전 credential/중지 오류도 같은 경로로 처리하며 Invoice의 `technical_failure_count`만 올리고 30분 뒤로 미룹니다. 기술 오류가 10회 연속이면 자동 Attempt 생성을 중단하고 담당자 확인 대상으로 전환하되, 고객 재시도 횟수인 `retry_count`를 소진하거나 구독을 `past_due`로 바꾸지 않습니다. `processing`/unknown은 오래됐어도 새 주문으로 바꾸지 않습니다. PG 조회가 계속 NOT_FOUND이면 운영자 확인이 필요합니다. 현재 구현은 불확실한 요청을 자동 재전송하지 않습니다.

미납 재개: 서비스 전용 `billing_approve_arrears_retry(invoice_id, operator_user_id, reason)`로 **검토한 Invoice 1건씩** 승인합니다. 모든 과거 미납을 일괄 승인하지 않습니다. 정책 snapshot 금액을 유지하고 새 Attempt를 생성합니다.

복구 Worker는 최근 10분 안에 확인하지 않은 미확정 Attempt를 먼저 조회합니다. 남는 슬롯에서만 최근 90일 내 succeeded Attempt를 24시간 간격으로 확인해 `payment_cancellations`에 거래키로 upsert합니다. 부분/전체 취소는 승인된 Invoice의 paid와 별도로 표시합니다. 대규모 실시간 반영이 필요하면 이후 webhook+provider 재조회 경로를 추가합니다.

Toss가 새 빌링키를 발급한 뒤 DB 등록이 실패하면 해당 신규 키에 공식 Core API의 `DELETE /v1/billing/{billingKey}`를 최선 노력으로 호출합니다. 경로와 메서드는 공식 문서로 확인했으며 Test 키를 이용한 실제 응답 검증은 아직 남아 있습니다. 삭제도 실패하면 `billing.orphan_billing_key_cleanup_failed` 로그에 registration session과 Workspace ID만 남깁니다. 운영자는 Toss API 로그에서 idempotency key가 registration session ID인 발급 요청을 찾아 빌링키를 삭제하고, 원문 키를 내부 로그나 문서에 복사하지 않습니다.

`billing_events`에 고객용 이벤트, `billing_operator_actions`에 내부 승인 기록을 남깁니다. 고객 알림 전송은 미연결입니다. 운영 모니터링은 `billing.worker_failed`, `billing.reconciliation_pending` 로그와 failed Invoice/configuration failure 조회를 출발점으로 연결해야 합니다. raw Toss response, authKey, billingKey, callback query는 로깅하지 않습니다. 배포 플랫폼/CDN의 callback query 기록 제거도 출시 전 확인합니다.

## 검증 및 출시 Gate

```sh
npm ci
npm run test:billing
npm run test:dashboard
npm run build
npx tsc --noEmit
```

브랜치 전환 뒤 삭제된 Route의 `.next/types`가 남아 있으면 유령 타입 오류가 날 수 있습니다. 이 경우 `.next`를 삭제하고 `npm run build`로 생성 타입을 다시 만든 뒤 `npx tsc --noEmit`을 실행합니다.

DB 테스트는 PGlite(실제 PostgreSQL 엔진)와 기존 main의 최소 테이블 fixture를 사용합니다. SQL 문법·RLS·제약조건·트랜잭션 rollback은 검증하지만, **기존 migration 전체의 실 Supabase 적용 및 서로 다른 연결의 동시 실행 증명은 아닙니다.**

키 수령 후 추가 확인:

- [ ] 개발 Supabase에 migration 전체 적용, RLS advisor 확인
- [ ] A/B Workspace 및 owner/admin/editor/viewer API 접근 검증
- [ ] Toss Test 카드 등록·변경·인증 실패·권한 회수·Workspace 이동
- [ ] Toss Test 키로 `DELETE /v1/billing/{billingKey}` 성공·실패 응답 확인
- [ ] 실제 승인, 명확한 거절, 정책별 재시도, 모든 재시도 소진
- [ ] 서로 다른 Worker 연결의 동시 승인 요청 차단
- [ ] Toss 성공 → DB write 장애 → 원래 orderId 복구
- [ ] timeout / 응답 손실 / 오래된 lease / NOT_FOUND 운영 복구
- [ ] 외부 부분·전체 취소 반영 및 영수증 확인
- [ ] 기존 납부기간 중복 청구 없음
- [ ] 라이트·베이직·프로 변경 예약, 예약 교체, 다음 달 1일 적용 및 기존 Invoice 금액 보존
- [ ] 엔터프라이즈 선택 시 자동 변경 없이 별도 견적 문의로 연결
- [ ] Workspace pause / DB global kill switch / 환경변수 차단 테스트
- [ ] 실제 Supabase/PostgREST에서 복구 조회의 두 `.or()` 필터가 AND로 적용되는지 확인
- [ ] Preview가 개발 DB와 Test 키만 사용하는지 검증
- [ ] 고객 동의·청구·해지·환불·알림 운영 문구 확정
- [ ] 장애 알림 목적지 및 처리 담당자 연결
- [ ] 기존 `next@14.1.2`에 대해 npm 설치 시 표시된 보안 경고 해결/검증 후 출시 (이번 결제 변경에서는 framework upgrade 미실행)

## 참고 문서

- [자동결제 운영·사용성 로드맵](ROADMAP.md)
- [Toss 자동결제 연동](https://docs.tosspayments.com/guides/v2/billing/integration)
- [Toss API: 승인·주문번호 조회·빌링키](https://docs.tosspayments.com/reference)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
