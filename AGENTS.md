# Agent Instructions

Before changing the public homepage, diagnosis form, or any UI component, read `docs/DESIGN_GUIDE.md` and follow it.

The original Claude-designed homepage at `public/replo-original/index.html` is the visual source of truth for the public homepage. Do not redesign, rebuild, or reinterpret it unless explicitly instructed.

The current diagnosis form direction is single-page dropdown-based, not multi-step. Do not use large radio option cards for the current version.

Public homepage CTAs should route users toward `/contact`.

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
