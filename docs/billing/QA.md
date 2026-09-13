# 로컬 검증 기록

2026-09-13, Node v25.8.1, `feat/toss-billing`.

| 확인 | 결과 | 범위 |
| --- | --- | --- |
| `npm run test:billing` | 37 tests PASS | domain, 암호화, Test transport, Worker 오케스트레이션, PGlite DB |
| `npm run test:dashboard` | 10 tests PASS | 기존 상담 지표/CSV/시크릿 비교 회귀 |
| `npx tsc --noEmit` | PASS | 최종 소스와 Next 생성 타입 |
| `npm run build` | PASS | 실제 키/개발 DB 없이 production bundle 생성 |
| 마이페이지 브라우저 | PASS | 실제 컴포넌트에 합성 API fixture 주입 |
| 동의 | PASS | 미동의 시 카드 인증 버튼 disabled, 동의 후 enabled |
| 모바일 390px | PASS | document scrollWidth=390, page overflow 없음 |
| callback | PASS | 외부 script 0개, 자체 inline script만 로드, query 제거 |
| 공개 Worker 호출 | 401 | secret 없는 호출 차단 |

화면 검증 fixture는 월 구독 990,000원 / 기존 Invoice 590,000원 / 일부 취소 100,000원을 사용했습니다. 실제 고객 데이터나 실제 결제가 아닙니다. 테스트용 app route는 최종 소스에서 제거했습니다.

PGlite SQL 테스트는 다음을 포함합니다.

- 고객 A/B 분리, owner/admin/editor/viewer SELECT만 허용, anon 접근 거절
- 서버 전용 credential 및 RPC의 고객 접근 거절
- 다른 Workspace subscription을 참조하는 Invoice FK 거절
- owner/admin 등록 확인, 권한 회수 이후 카드 교체 거절
- 새 credential 저장 실패의 트랜잭션 rollback 및 이전 default 카드 보존
- Invoice 및 Attempt 요청 identity 변경 거절
- 동일 Invoice 연속/동시 제출 중 하나만 claim
- unknown → 원래 승인 복구 → 중복 복구의 1회 반영
- 승인 지연에도 계약 다음 청구일 유지
- 부분/전체 취소 거래키 dedupe 및 초과 취소 거절
- Workspace pause / DB 전체 kill switch의 dispatch 차단
- 미전송 lease 만료 뒤 원래 Worker의 stale token 차단
- 명확한 실패 뒤 새 Attempt/orderId/idempotencyKey 및 고정 금액 유지
- 과거 납부기간, 다른 가격, 동의 불일치 차단 및 Invoice 생성 cursor
- 복구 조회 cooldown 일치, 미확정 결제 우선 처리, succeeded 90일/24시간 조회 제한
- Invoice별 승인 전 오류 격리 및 승인 후 DB 오류의 원래 Attempt 보존
- 미전송/중지 Attempt 30분 backoff, retry count 증가, 10회 기술 상한
- 등록 세션 중복의 명시적 conflict, billing event 교차 Workspace FK
- JSON key 순서와 무관한 동의 비교, 신규 빌링키 고아 정리 DELETE

임베디드 DB의 동시 호출 테스트는 여러 외부 DB 연결 사이의 실 경합 검증을 대체하지 않습니다. 실제 Supabase/PG 연결은 [후속 체크리스트](README.md#후속-작업-toss-키-수령-후-진행)에 따라 Toss 키 수령 후 수행합니다.
