# Agent Instructions

Before changing the public homepage, diagnosis form, or any UI component, read `docs/DESIGN_GUIDE.md` and follow it.

The original Claude-designed homepage at `public/replo-original/index.html` is the visual source of truth for the public homepage. Do not redesign, rebuild, or reinterpret it unless explicitly instructed.

The current diagnosis form direction is single-page dropdown-based, not multi-step. Do not use large radio option cards for the current version.

Public homepage CTAs should route users toward `/contact`.

한 가지 예외: 요금제 섹션(`#pricing-sec`)의 플랜 카드 CTA는 실제 결제 경로인 `/mypage?section=plan&plan=<planId>`로 연결합니다. PG(토스페이먼츠) 가맹점 심사에서 홈페이지 요금제 → 요금제 신청 → 카드 등록으로 이어지는 결제경로를 확인하기 때문에, 이 버튼을 `/contact`(무료 운영 진단)로 되돌리지 마세요. 엔터프라이즈 카드와 요금제 섹션 하단의 보조 CTA는 그대로 `/contact`로 둡니다.

Preserve these routes unless a task explicitly changes them:

- `/`
- `/replo-original/index.html`
- `/contact`
- `/diagnosis` (redirects to `/contact`)
- `/contatct/success`
- `/api/diagnosis`

Login, signup, onboarding, mypage, dashboard, billing, member, and integration features now live on `main` and ship to production together with the public homepage. Keep them separate from the public marketing pages in code: the public pages must stay static-friendly and must not depend on authenticated app state.

`main` is the production branch. Every merge into `main` deploys to `replo.kr` automatically, so run `next build` and verify the change before merging.

Never commit `.env`, `.env.local`, `.env.*.local`, Supabase service role keys, webhook secrets, or real customer data. Do not collect raw card data in public forms.
