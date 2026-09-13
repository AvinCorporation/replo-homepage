# Replo Homepage

Replo 공개 홈페이지와 무료 CS 운영 진단 접수 기능을 제공하는 Next.js 프로젝트입니다.

운영 브랜치인 `main`에는 공개 홈페이지와 도입문의 접수에 필요한 코드만 유지합니다. 로그인, 회원가입, 온보딩, 마이페이지, 대시보드, 결제 및 채널 연동 기능은 `dev` 브랜치에서 개발합니다.

## 주요 경로

- `/`: 공개 홈페이지
- `/contact`: 무료 운영 진단 신청
- `/diagnosis`: `/contact`로 이동하는 기존 URL 호환 경로
- `/contatct/success`: 접수 완료 화면
- `/api/diagnosis`: 진단 신청 저장 및 webhook 전달 API
- `/replo-original/index.html`: 보존된 Claude 디자인 원본

## 로컬 실행

```bash
npm install
cp .env.example .env.local
npm run dev
```

진단 신청 저장을 테스트하려면 `.env.local`에 Supabase URL과 service role key를 설정해야 합니다. 비밀 키가 포함된 환경 파일은 커밋하지 마세요.

## 진단 접수 처리

`POST /api/diagnosis`는 다음 순서로 동작합니다.

1. Redis 기반 IP rate limit을 확인합니다.
2. 입력값과 홈페이지 URL, 이메일 형식을 검증합니다.
3. Supabase `diagnosis_responses`에 접수 내용을 저장합니다.
4. `DIAGNOSIS_WEBHOOK_URL`이 있으면 접수 내용을 외부 시스템으로 전달합니다.
5. webhook 처리 상태를 `sent`, `failed`, `skipped`로 기록합니다.

운영 환경에서는 Upstash Redis 또는 Vercel KV 호환 변수가 반드시 필요합니다. Redis가 없거나 응답하지 않으면 API는 rate limit을 우회하지 않고 HTTP 503을 반환합니다.

## 검증

```bash
npx tsc --noEmit
npm run build
```

운영 배포 설정은 [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md), DB 스키마는 [`docs/supabase.sql`](./docs/supabase.sql)을 참고하세요.

## Toss 자동결제 MVP

구현 현황, 환경변수, 사업 정책 설정, 중복 승인 방지 및 운영 절차는 [Billing README](docs/billing/README.md)에 정리되어 있습니다.

**2026-09-13 사용자 확인:** 개발 Supabase와 Toss Test 키가 준비된 Preview는 아직 없습니다. Toss 키를 받은 뒤 실제 카드 등록·승인·실패·취소 테스트를 이어서 진행합니다. 그 전까지 자동결제는 기본 비활성화 상태이며 운영 DB 적용/배포/실제 결제를 실행하지 않습니다.

로컬 검증: `npm run test:billing`, `npm run test:dashboard`, `npx tsc --noEmit`, `npm run build`.
