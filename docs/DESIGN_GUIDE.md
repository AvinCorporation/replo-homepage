# Replo Design Guide

## Product Design Intent
Replo is a CS operations and CX operations service for commerce brands. The product should feel like a clean B2B SaaS: trustworthy, operationally competent, calm, practical, professional, and simple.

## Visual Source Of Truth
The original Claude-designed homepage at `public/replo-original/index.html` is the visual source of truth for the public homepage.

Do not redesign, rebuild, or reinterpret the original homepage unless explicitly instructed. Public homepage work should preserve its structure, copy, spacing, and visual tone. Small behavioral changes such as CTA routing may be added with minimal scripts when safer than rebuilding the bundle.

## Brand Tone
Use concise Korean copy. Prefer operational clarity over marketing flourish. Replo should sound competent, direct, and helpful.

Avoid playful consumer app styling, excessive gradients, overly decorative UI, random new design systems, unnecessary animation, and dense layouts.

## Color System
Baseline colors:

- Primary Purple: `#5B47E0`
- Soft Background: `#F7F6FF`
- White: `#FFFFFF`
- Dark Text: `#1F2933` or similar
- Muted Text: `#6B7280` or similar
- Light Border: `#CBD2DA` or similar
- Page Gray: `#F1F3F5` or similar

Use `#5B47E0` for primary CTAs and selected/active states. Use soft backgrounds and white cards. Keep contrast high. Do not introduce unrelated accent colors.

## Typography Rules
Use a modern system sans stack or Pretendard when available. Headings should be bold and direct. Body copy should be readable at 15-18px with comfortable line height. Avoid novelty fonts and cramped letter spacing.

## Layout And Spacing
Use centered, constrained layouts for public forms and content-heavy sections. Prefer generous whitespace over dense dashboards on public pages. Keep page sections visually simple: white or soft background bands, restrained borders, and predictable spacing.

## Button Rules
Primary CTAs use purple fill with white text. Secondary buttons use white background with a light border. Buttons should have clear labels and be large enough to tap on mobile. Public homepage CTAs should direct users toward `/contact`, not login.

## Card Rules
Cards should be white, lightly bordered, and modestly rounded. Use cards for grouped content, forms, pricing tiers, or dashboard modules. Avoid nested decorative cards and heavy shadows.

## Form Rules
Forms should be compact, clear, and mobile-first. Labels must be visible. Required fields should be validated before submission. Error messages should be user-facing Korean text. Do not collect payment credentials in public forms.

## Diagnosis Form Rules
The current diagnosis form direction is single-page dropdown-based, not multi-step.

Do not use a stepper. Do not use large radio option cards for the current version. Use dropdown/select fields for the first three questions and text inputs for contact fields.

The diagnosis form should be:

- One-page
- Dropdown-based
- Compact
- Mobile-first
- Centered on desktop
- White card on light gray or soft purple background
- Simple B2B SaaS style
- Easy to complete quickly

## Public Homepage Rules
The public homepage visual design must remain the Claude-designed bundle. Hide or de-emphasize public-facing login buttons unless explicitly instructed. Main public CTAs should lead to `/contact`.

Pricing plan cards are the one exception: their CTA is the paid signup path and must link to `/mypage?section=plan&plan=<planId>`, which is the payment route a PG merchant review follows (요금제 → 요금제 신청 → 카드 등록). The Enterprise card and the secondary CTA under the pricing grid still lead to `/contact`. This is a routing exception only — do not change the pricing section's visual design.

Do not change the original hero copy or nav labels without explicit instruction.

## Accessibility Basics
Use semantic labels for form fields. Preserve keyboard access for buttons and links. Maintain high contrast and visible focus states. Tap targets should be comfortable on mobile.

## Responsive Behavior
Public forms should use one column on mobile. Desktop forms should stay centered and not stretch too wide. Minimal scroll is acceptable on mobile if it improves usability.

## Do And Don't
Do:

- Preserve the Claude-designed public homepage.
- Use `#5B47E0` for primary action states.
- Keep forms compact and easy to complete.
- Keep Korean copy clear and practical.
- Verify mobile layouts for horizontal overflow.

Don't:

- Redesign the public homepage without explicit instruction.
- Replace the diagnosis form with a multi-step flow.
- Use large radio-card selections for the current diagnosis form.
- Make login the main public CTA.
- Introduce unrelated colors, decorative animations, or a new visual system.
- Ask for card number, CVC, expiration date, billing password, or payment credentials.
