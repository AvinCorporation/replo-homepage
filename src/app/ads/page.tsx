import type { Metadata } from "next";
import { PlanTiers } from "./PlanTiers";

// Mobile-only ad landing page for Meta/Instagram traffic.
// Designed around a 390px viewport, centered as a mobile column on wider
// screens. Every CTA routes to the existing /contact diagnosis form and
// forwards the current query string (utm_*, fbclid, ...) so paid-traffic
// attribution is preserved end-to-end.

export const metadata: Metadata = {
  title: "리플로 Replo | CS직원 뽑기 전, 월 59만원 CS 운영대행",
  description:
    "CS직원 뽑기 전, 월 59만원으로 CS 운영대행부터 시작하세요. 상담 응대 · 자동화 · 챗봇 구조설계 · 운영 기준 정리까지 Replo가 대신 설계하고 운영합니다. 무료 운영 진단.",
  openGraph: {
    title: "CS직원 뽑기 전, 월 59만원으로 CS 운영대행부터",
    description:
      "상담 응대 · 자동화 · 챗봇 구조설계 · 운영 기준 정리까지. 월 59만원. 무료 운영 진단 받기.",
  },
};

// Read per-request so ad-click params (utm_*, fbclid) reach the CTA hrefs
// instead of being frozen into a prerendered static page.
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

// Rebuild the incoming query string (utm_source, utm_campaign, fbclid, ...)
// and append it to the /contact CTA target so ad-click attribution survives.
function buildContactHref(searchParams: SearchParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else if (typeof value === "string") {
      params.set(key, value);
    }
  }
  const qs = params.toString();
  return qs ? `/contact?${qs}` : "/contact";
}

const styles = `
.ads {
  --brand: #6657F0;
  --brand-2: #7C6BFF;
  --brand-deep: #4F43D8;
  --brand-soft: #F3F1FF;
  --ink: #111827;
  --muted: #667085;
  --border: #E4E0F8;
  --lavender: #F7F5FF;
  --surface: rgba(255, 255, 255, 0.86);
  --dark: #19172A;
  /* Unified to one cohesive brand system — no unrelated accent hues.
     Two subtle purple tones give tonal variety without going rainbow. */
  --accent-teal: #6657F0;
  --accent-teal-soft: #EFECFE;
  --accent-amber: #8B7BF7;
  --accent-amber-soft: #F1EEFF;
  --accent-blue: #5648D6;
  --accent-blue-soft: #ECE9FD;
  position: relative;
  min-height: 100vh;
  margin: 0 auto;
  max-width: 480px;
  background:
    radial-gradient(circle at 50% 0%, rgba(124, 107, 255, 0.10), transparent 32%),
    linear-gradient(180deg, #FBFAFF 0%, #F8F7FC 100%);
  color: var(--ink);
  font-family: Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  letter-spacing: -0.02em;
  overflow-x: clip;
  padding-bottom: 112px; /* room for sticky CTA */
}
.ads * { box-sizing: border-box; }
@media (min-width: 481px) {
  body { background: #F1F0F8; }
  .ads { box-shadow: 0 0 0 1px rgba(17,24,39,.04), 0 24px 80px rgba(17,24,39,.10); }
}
.ads img { max-width: 100%; display: block; }
.ads a { -webkit-tap-highlight-color: transparent; }

.ads-wrap { padding: 0 20px; }

/* ============ Top bar ============ */
.ads-topbar {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 20px;
  background: rgba(251, 250, 255, 0.86);
  backdrop-filter: saturate(180%) blur(14px);
  -webkit-backdrop-filter: saturate(180%) blur(14px);
  border-bottom: 1px solid rgba(231, 227, 255, 0.6);
}
.ads-topbar img { height: 23px; width: auto; }
.ads-toplink {
  font-size: 13px;
  font-weight: 700;
  color: var(--brand-deep);
  text-decoration: none;
  padding: 8px 15px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: #fff;
  box-shadow: 0 8px 22px rgba(79, 67, 216, 0.08), inset 0 1px 0 rgba(255,255,255,.86);
}

/* ============ Shared bits ============ */
.ads-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 700;
  color: var(--brand-deep);
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid var(--border);
  padding: 8px 15px;
  border-radius: 999px;
  box-shadow: 0 10px 24px rgba(79, 67, 216, 0.10), inset 0 1px 0 rgba(255,255,255,.92);
}
.ads-badge svg { width: 15px; height: 15px; color: var(--brand); }

.ads-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0;
  color: var(--brand-deep);
  background: var(--brand-soft);
  border: 1px solid var(--border);
  padding: 6px 12px 6px 11px;
  border-radius: 999px;
  margin: 0 0 15px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.7);
}
.ads-eyebrow::before {
  content: "";
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--brand);
  box-shadow: 0 0 0 3px rgba(109,93,246,.14);
}
.ads-h2 {
  font-size: 25px;
  line-height: 1.42;
  font-weight: 850;
  margin: 0 0 24px;
  letter-spacing: -0.042em;
  word-break: keep-all;
}
.ads-h2 .hl { color: var(--brand); }
.ads-sub { font-size: 15px; line-height: 1.62; color: var(--muted); margin: 0; }

/* Primary button */
.ads-cta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: 100%;
  padding: 17px 20px;
  border-radius: 16px;
  font-size: 17px;
  font-weight: 800;
  color: #fff;
  text-decoration: none;
  background: linear-gradient(135deg, var(--brand-2) 0%, var(--brand) 48%, var(--brand-deep) 100%);
  box-shadow: 0 14px 30px rgba(79, 67, 216, 0.26), inset 0 1px 0 rgba(255, 255, 255, 0.34);
  border: none;
  letter-spacing: -0.02em;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.ads-cta svg { width: 18px; height: 18px; }
.ads-cta:hover { box-shadow: 0 14px 32px rgba(109, 93, 246, 0.44), inset 0 1px 0 rgba(255, 255, 255, 0.3); }
.ads-cta:active { transform: translateY(1px) scale(0.995); }
.ads-reassure { text-align: center; font-size: 13px; color: var(--muted); margin: 13px 0 0; }

/* Decorative primitives */
.ads-dots {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(rgba(109, 93, 246, 0.09) 1px, transparent 1px);
  background-size: 18px 18px;
  -webkit-mask-image: radial-gradient(120% 90% at 50% 0%, #000 30%, transparent 72%);
  mask-image: radial-gradient(120% 90% at 50% 0%, #000 30%, transparent 72%);
  pointer-events: none;
}
.ads-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(46px);
  pointer-events: none;
  z-index: 0;
}

/* Floating mini decoration card */
.ads-float {
  position: absolute;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.48);
  border: 1px solid rgba(228, 224, 248, 0.52);
  box-shadow: 0 10px 22px rgba(17, 24, 39, 0.035), inset 0 1px 0 rgba(255,255,255,.62);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  font-size: 11.5px;
  font-weight: 650;
  color: rgba(75, 85, 99, 0.52);
  opacity: 0.62;
  pointer-events: none;
}
.ads-float .ic {
  width: 22px; height: 22px; border-radius: 7px;
  display: grid; place-items: center;
  background: rgba(109, 93, 246, 0.055); color: rgba(109, 93, 246, 0.46);
}
.ads-float .ic svg { width: 13px; height: 13px; }

/* ============ 1. Hero ============ */
.ads-hero {
  position: relative;
  overflow: hidden;
  padding: 36px 20px 48px;
  text-align: center;
  background:
    radial-gradient(105% 66% at 50% -8%, rgba(124, 107, 255, 0.18), transparent 64%),
    radial-gradient(85% 46% at 94% 12%, rgba(109, 93, 246, 0.10), transparent 58%),
    linear-gradient(180deg, #F7F5FF 0%, #FBFAFF 100%);
}
.ads-hero .ads-glow.g1 { width: 200px; height: 200px; top: -40px; left: -50px; background: rgba(122, 107, 255, 0.28); }
.ads-hero .ads-glow.g2 { width: 160px; height: 160px; top: 120px; right: -60px; background: rgba(91, 71, 224, 0.18); }
.ads-hero .lines { position: absolute; inset: 0; z-index: 0; opacity: 0.5; pointer-events: none; }
.ads-hero .f1 { top: 96px; left: -14px; }
.ads-hero .f2 { top: 210px; right: -10px; }
.ads-hero-inner { position: relative; z-index: 2; }

.ads-hero h1 {
  font-size: 30px;
  line-height: 1.34;
  font-weight: 850;
  letter-spacing: -0.04em;
  margin: 18px 0 16px;
}
.ads-hero h1 .hl {
  color: var(--brand);
  background: linear-gradient(120deg, var(--brand-2), var(--brand-deep));
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.ads-hero h1 .price {
  display: inline-block;
  font-size: 1.38em;
  font-weight: 900;
  letter-spacing: -0.05em;
  line-height: 1;
  background: linear-gradient(150deg, #8577FF, var(--brand-deep));
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.ads-hero .ads-sub { padding: 0 6px; }
.ads-hero .ads-cta { margin-top: 28px; }

/* Hero price card — dimensional */
.ads-offer {
  position: relative;
  margin: 28px 0 22px;
  border-radius: 24px;
  padding: 24px 22px 23px;
  background:
    radial-gradient(circle at 76% 0%, rgba(124, 107, 255, 0.18), transparent 38%),
    linear-gradient(165deg, rgba(255,255,255,.96) 0%, #F6F3FF 100%);
  border: 1px solid rgba(109, 93, 246, 0.18);
  box-shadow:
    0 18px 42px rgba(79, 67, 216, 0.16),
    0 1px 0 rgba(255, 255, 255, 0.9) inset;
  overflow: hidden;
}
.ads-offer::before {
  content: "";
  position: absolute; left: 0; right: 0; top: 0; height: 44%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.85), transparent);
  pointer-events: none;
}
.ads-offer::after {
  content: "";
  position: absolute; width: 180px; height: 180px; right: -60px; top: -70px;
  background: radial-gradient(circle, rgba(122, 107, 255, 0.24), transparent 70%);
  pointer-events: none;
}
.ads-offer > * { position: relative; }
.ads-offer .limited {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 800; color: #fff;
  background: linear-gradient(135deg, rgba(255,255,255,.94), rgba(243,241,255,.9));
  border: 1px solid rgba(109, 93, 246, 0.20);
  color: var(--brand-deep);
  padding: 7px 14px; border-radius: 999px; margin-bottom: 15px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 8px 22px rgba(79, 67, 216, 0.10);
}
.ads-offer .limited svg { width: 13px; height: 13px; }
.ads-price { display: flex; align-items: baseline; justify-content: center; gap: 5px; line-height: 1; }
.ads-price .won, .ads-price .unit { font-size: 22px; font-weight: 800; color: var(--ink); }
.ads-price .num {
  font-size: 70px; font-weight: 900; letter-spacing: -0.05em;
  background: linear-gradient(165deg, #8577FF, var(--brand-deep));
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.ads-offer .tags {
  margin-top: 15px; padding-top: 16px;
  border-top: 1px solid rgba(228, 224, 248, 0.9);
  font-size: 13.5px; font-weight: 700; color: #4B5563;
}
.ads-offer .tags b { color: var(--brand-deep); font-weight: 800; }
.ads-hero .ads-cta { position: relative; z-index: 2; }

/* trust strip */
.ads-trust {
  display: flex; justify-content: center; gap: 14px; flex-wrap: wrap;
  margin: 22px 0 4px; position: relative; z-index: 2;
}
.ads-trust span { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; color: var(--muted); }
.ads-trust svg { width: 14px; height: 14px; color: var(--brand); }

/* ============ Section frame / rhythm ============ */
.ads-band { position: relative; padding: 54px 20px; }
.ads-band--lav {
  background:
    radial-gradient(circle at 50% 0%, rgba(124, 107, 255, 0.08), transparent 42%),
    linear-gradient(180deg, #F7F5FF 0%, #FAF9FF 100%);
  border-radius: 28px 28px 0 0;
  margin-top: -18px;
}
.ads-band--lav.tail { border-radius: 28px; margin-bottom: 8px; }
.ads-curve-top {
  position: absolute; top: -1px; left: 0; right: 0; height: 34px;
  background: inherit; border-radius: 34px 34px 0 0;
}

/* ============ 2. Problem ============ */
.ads-burden {
  position: relative;
  border-radius: 24px;
  padding: 22px 18px 18px;
  background: linear-gradient(180deg, #FFFFFF 0%, #FBFAFE 100%);
  border: 1px solid var(--border);
  box-shadow: 0 1px 2px rgba(17,24,39,.04), 0 16px 34px rgba(17, 24, 39, .05);
  overflow: hidden;
}
.ads-burden-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #475467;
  font-size: 12px;
  font-weight: 800;
  margin-bottom: 12px;
}
.ads-burden-label svg { width: 14px; height: 14px; color: rgba(109,93,246,.78); }
.ads-interruptions {
  display: grid;
  gap: 10px;
}
.ads-interrupt {
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 11px;
  align-items: start;
  padding: 13px 14px;
  border-radius: 17px;
  background: rgba(255,255,255,.72);
  border: 1px solid rgba(233,235,244,.92);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.86);
}
.ads-interrupt .ic {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: rgba(109,93,246,.06);
  color: rgba(91,75,232,.82);
  border: 1px solid rgba(109,93,246,.10);
}
.ads-interrupt .ic svg { width: 17px; height: 17px; }
.ads-interrupt p {
  color: #1F2937;
  font-size: 14.5px;
  font-weight: 780;
  letter-spacing: -0.025em;
  line-height: 1.45;
  margin: 0;
  word-break: keep-all;
}
.ads-interrupt p span {
  color: var(--muted);
  display: block;
  font-size: 12.5px;
  font-weight: 700;
  margin-bottom: 3px;
}
.ads-fragment-copy {
  margin: 0 2px 18px;
  color: var(--ink);
  font-size: 21px;
  font-weight: 900;
  letter-spacing: -0.04em;
  line-height: 1.44;
  word-break: keep-all;
}
.ads-fragment-copy strong { color: var(--ink); }
.ads-burden-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0 0;
  padding: 12px 13px;
  border-radius: 15px;
  background: rgba(248, 249, 252, .86);
  border: 1px solid rgba(233,235,244,.94);
  color: #475467;
  font-size: 12.5px;
  font-weight: 800;
  line-height: 1.42;
}
.ads-burden-foot svg { width: 15px; height: 15px; flex: 0 0 auto; color: rgba(109,93,246,.78); }

/* ============ 3. Comparison ============ */
.ads-compare { position: relative; display: grid; gap: 16px; }
.ads-col { position: relative; border-radius: 22px; padding: 22px 20px; overflow: hidden; }
.ads-col h3 { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 850; margin: 0 0 16px; }
.ads-col h3 .pill { margin-left: auto; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 999px; }
.ads-col ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.ads-col li { display: flex; align-items: flex-start; gap: 10px; font-size: 14.5px; font-weight: 600; line-height: 1.4; }
.ads-col li svg { width: 18px; height: 18px; flex: 0 0 auto; margin-top: 1px; }

/* gray paper-stack card */
.ads-col--plain {
  background: linear-gradient(180deg, #F7F7FA, #F1F2F6); border: 1px solid #E5E7EE; color: #737A8A;
  box-shadow: 0 10px 24px rgba(17, 24, 39, 0.06);
}
.ads-col--plain::before, .ads-col--plain::after {
  content: ""; position: absolute; inset: 0; border-radius: 22px;
  background: #EDEDF1; border: 1px solid #E4E4EA; z-index: -1;
}
.ads-col--plain::before { transform: rotate(-2.2deg) translateY(4px); }
.ads-col--plain::after { transform: rotate(1.6deg) translateY(3px); }
.ads-col--plain h3 { color: #55596A; }
.ads-col--plain h3 .pill { background: #E0E0E6; color: #6B7280; }
.ads-col--plain li svg { color: #AEB2C0; }

/* clean brand card */
.ads-col--brand {
  background:
    radial-gradient(circle at 88% 0%, rgba(124,107,255,.16), transparent 36%),
    linear-gradient(165deg, #ffffff 0%, #F5F2FF 100%);
  border: 1.5px solid rgba(109, 93, 246, 0.56);
  color: #1F2937;
  box-shadow: 0 18px 38px rgba(79, 67, 216, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.86);
}
.ads-col--brand h3 { color: var(--brand-deep); }
.ads-col--brand h3 img { height: 17px; width: auto; }
.ads-col--brand h3 .pill { background: rgba(109,93,246,.10); border: 1px solid rgba(109,93,246,.16); color: var(--brand-deep); }
.ads-col--brand li { font-weight: 700; }
.ads-col--brand li svg { color: var(--brand); }
.ads-col--brand li b { color: var(--brand-deep); }

.ads-vs {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  z-index: 3;
  font-size: 12px; font-weight: 800; color: var(--brand-deep);
  background: #fff; border: 1px solid var(--border);
  width: 42px; height: 42px; border-radius: 50%;
  display: grid; place-items: center;
  box-shadow: 0 12px 26px rgba(79, 67, 216, 0.18);
}

/* ============ 4. Service scope (operating system map) ============ */
.ads-ops {
  position: relative;
  border-radius: 24px;
  padding: 22px 18px 18px;
  background: linear-gradient(180deg, #FFFFFF 0%, #FAF9FF 100%);
  border: 1px solid var(--border);
  box-shadow: 0 1px 2px rgba(17,24,39,.04), 0 18px 40px rgba(79,67,216,.09);
  overflow: hidden;
}
.ads-ops-hub {
  position: relative;
  display: grid;
  place-items: center;
  width: 132px;
  height: 132px;
  margin: 0 auto 18px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 50% 42%, #fff 0 50%, transparent 51%),
    linear-gradient(160deg, #F1EDFF, #E7E2FC);
  box-shadow: 0 14px 30px rgba(79,67,216,.12), inset 0 1px 0 rgba(255,255,255,.8);
}
.ads-ops-hub::before,
.ads-ops-hub::after {
  content: "";
  position: absolute;
  border: 1px solid rgba(109,93,246,.12);
  border-radius: 50%;
}
.ads-ops-hub::before { inset: 13px; }
.ads-ops-hub::after { inset: 26px; }
.ads-ops-logo {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 3px;
  text-align: center;
}
.ads-ops-logo b {
  color: var(--brand-deep);
  font-size: 18px;
  font-weight: 900;
  letter-spacing: -0.035em;
}
.ads-ops-logo span {
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 800;
}
.ads-ops-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.ads-ops-card {
  min-height: 112px;
  border-radius: 17px;
  padding: 13px;
  background: rgba(255,255,255,.88);
  border: 1px solid rgba(238,235,251,.96);
  box-shadow: 0 8px 20px rgba(17,24,39,.045), inset 0 1px 0 rgba(255,255,255,.86);
}
.ads-ops-card.primary {
  grid-column: 1 / -1;
  min-height: auto;
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 12px;
  align-items: center;
  border-color: rgba(109,93,246,.34);
  background: linear-gradient(135deg, #fff, #F5F2FF);
}
.ads-ops-card .node {
  width: 36px;
  height: 36px;
  border-radius: 13px;
  display: grid;
  place-items: center;
  margin-bottom: 10px;
  background: var(--brand-soft);
  color: var(--brand);
}
.ads-ops-card:nth-child(2) .node { background: var(--accent-teal-soft); color: var(--accent-teal); }
.ads-ops-card:nth-child(3) .node { background: var(--accent-blue-soft); color: var(--accent-blue); }
.ads-ops-card:nth-child(4) .node { background: var(--accent-amber-soft); color: var(--accent-amber); }
.ads-ops-card:nth-child(5) .node { background: var(--brand-soft); color: var(--brand); }
.ads-ops-card.primary .node {
  width: 40px;
  height: 40px;
  margin: 0;
  color: #fff;
  background: linear-gradient(160deg, var(--brand-2), var(--brand-deep));
  box-shadow: 0 10px 22px rgba(79,67,216,.22);
}
.ads-ops-card .node svg { width: 19px; height: 19px; }
.ads-ops-card h4 {
  margin: 0;
  color: var(--ink);
  font-size: 14.5px;
  font-weight: 850;
  line-height: 1.3;
}
.ads-ops-card p {
  margin: 5px 0 0;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.42;
}

/* ============ 5. Price includes ============ */
.ads-inccard {
  position: relative;
  border-radius: 26px;
  padding: 22px 16px 18px;
  background: linear-gradient(180deg, #FFFFFF 0%, #FAF9FF 100%);
  border: 1px solid var(--border);
  box-shadow: 0 1px 2px rgba(17,24,39,.04), 0 20px 44px rgba(79, 67, 216, 0.10);
  overflow: hidden;
}
.ads-inccard::before {
  content: "";
  position: absolute;
  right: -58px;
  top: -54px;
  width: 178px;
  height: 178px;
  border: 1px solid rgba(109,93,246,.12);
  border-radius: 44% 56% 48% 52%;
  transform: rotate(-18deg);
}
.ads-inccard::after {
  content: "";
  position: absolute;
  width: 170px;
  height: 170px;
  left: -64px;
  bottom: -70px;
  background: radial-gradient(circle, rgba(122, 107, 255, 0.12), transparent 70%);
}
.ads-inccard > * { position: relative; z-index: 1; }
.ads-price-offer {
  margin-bottom: 14px;
  padding: 18px 16px;
  border-radius: 22px;
  background:
    radial-gradient(circle at 16% 18%, rgba(255,255,255,.9), transparent 26%),
    linear-gradient(135deg, rgba(255,255,255,.96), rgba(243,241,255,.90));
  border: 1px solid rgba(109,93,246,.20);
  box-shadow: 0 12px 26px rgba(79,67,216,.10), inset 0 1px 0 rgba(255,255,255,.92);
}
.ads-price-offer .label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--brand-deep);
  font-size: 12.5px;
  font-weight: 850;
  line-height: 1;
  margin-bottom: 10px;
}
.ads-price-offer .label svg { width: 14px; height: 14px; }
.ads-price-offer .price {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
  color: var(--ink);
  letter-spacing: -0.055em;
  line-height: 1;
  margin: 2px 0 12px;
}
.ads-price-offer .price .month {
  font-size: 25px;
  font-weight: 950;
}
.ads-price-offer .price .num {
  font-size: 55px;
  font-weight: 950;
  color: var(--brand-deep);
  text-shadow: 0 10px 26px rgba(91,75,232,.16);
}
.ads-price-offer .price .unit {
  font-size: 31px;
  font-weight: 950;
}
.ads-price-offer .meta {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}
.ads-price-offer .meta span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 8px 11px;
  font-size: 12px;
  font-weight: 820;
  line-height: 1;
  white-space: nowrap;
}
.ads-price-offer .meta span:first-child {
  color: var(--brand-deep);
  background: rgba(239,236,254,.92);
  border: 1px solid rgba(109,93,246,.16);
}
.ads-price-offer .meta span:last-child {
  color: #4B5563;
  background: rgba(255,255,255,.72);
  border: 1px solid rgba(222,229,242,.82);
}
.ads-price-offer .meta svg { width: 13px; height: 13px; }
.ads-inc {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.ads-inc li {
  position: relative;
  min-height: 150px;
  display: grid;
  grid-template-columns: 1fr auto;
  align-content: start;
  gap: 10px;
  padding: 15px 13px;
  border-radius: 18px;
  background: rgba(255,255,255,.76);
  border: 1px solid rgba(222,229,242,.92);
  color: #1F2937;
  box-shadow: 0 8px 18px rgba(17,24,39,.035), inset 0 1px 0 rgba(255,255,255,.82);
}
.ads-inc .ck {
  grid-column: 1 / -1;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 30% 25%, rgba(255,255,255,.95), transparent 32%),
    linear-gradient(145deg, #F4F1FF, #EAE6FD);
  color: rgba(109,93,246,.82);
  border: 1px solid rgba(109,93,246,.12);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.8);
}
.ads-inc .ck svg { width: 23px; height: 23px; }
.ads-inc-copy { min-width: 0; }
.ads-inc-copy b {
  display: block;
  color: var(--ink);
  font-size: 15px;
  font-weight: 900;
  letter-spacing: -0.035em;
  line-height: 1.26;
  word-break: keep-all;
}
.ads-inc-copy p {
  margin: 7px 0 0;
  color: #5F6676;
  font-size: 12.5px;
  font-weight: 650;
  line-height: 1.5;
  letter-spacing: -0.025em;
  word-break: keep-all;
}
.ads-inc-more {
  align-self: end;
  color: rgba(109,93,246,.62);
  width: 16px;
  height: 16px;
}
.ads-inc-more svg { width: 16px; height: 16px; stroke-width: 2.4; }
@media (max-width: 380px) {
  .ads-inccard { padding-left: 14px; padding-right: 14px; }
  .ads-price-offer .price .month { font-size: 22px; }
  .ads-price-offer .price .num { font-size: 48px; }
  .ads-price-offer .price .unit { font-size: 28px; }
  .ads-inc li { min-height: 146px; padding: 14px 12px; }
}

/* plan tiers (client toggle) */
.ads-tiers-wrap { margin-top: 14px; }
.ads-more {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%; padding: 15px; border-radius: 14px;
  background: rgba(255,255,255,.9); border: 1px solid var(--border); color: var(--brand-deep);
  font-size: 15px; font-weight: 800; cursor: pointer; letter-spacing: -0.02em;
  box-shadow: 0 8px 20px rgba(79, 67, 216, 0.08), inset 0 1px 0 rgba(255,255,255,.88);
  transition: background 0.15s ease;
}
.ads-more:hover { background: var(--brand-soft); }
.ads-more:active { transform: translateY(1px); }
.ads-more svg { width: 18px; height: 18px; transition: transform 0.2s ease; }
.ads-more[aria-expanded="true"] svg { transform: rotate(180deg); }
.ads-tiers { display: grid; gap: 12px; margin-top: 12px; }
.ads-tiers .hint { text-align: center; font-size: 12.5px; color: var(--muted); margin: 2px 0 4px; }
.ads-tier {
  border: 1px solid #EEEBFB; border-radius: 18px; padding: 18px;
  background: rgba(255,255,255,.92); box-shadow: 0 10px 24px rgba(17, 24, 39, 0.055), inset 0 1px 0 rgba(255,255,255,.86);
}
.ads-tier.pop {
  border: 1.5px solid rgba(109, 93, 246, 0.56);
  background:
    radial-gradient(circle at 86% 0%, rgba(124,107,255,.14), transparent 36%),
    linear-gradient(165deg, #fff, #F6F3FF);
  box-shadow: 0 14px 30px rgba(79, 67, 216, 0.12), inset 0 1px 0 rgba(255,255,255,.86);
}
.ads-tier .thead { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.ads-tier .tname { display: inline-flex; align-items: center; gap: 7px; font-size: 16px; font-weight: 800; flex: 0 0 auto; }
.ads-tier .tbadge { font-size: 10.5px; font-weight: 800; color: var(--brand-deep); background: rgba(255,255,255,.88); border: 1px solid rgba(109,93,246,.18); border-radius: 999px; padding: 3px 8px; }
.ads-tier .tprice { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.ads-tier .tprice b { font-size: 18px; font-weight: 800; color: var(--brand-deep); white-space: nowrap; }
.ads-tier .tprice em { font-size: 11px; font-weight: 700; color: var(--muted); font-style: normal; white-space: nowrap; }
.ads-tier .tprice em s { color: #B6B2C6; text-decoration-thickness: 1px; }
.ads-tier .tvol {
  display: inline-block; font-size: 12.5px; font-weight: 800; color: #4F46B8;
  background: rgba(243, 241, 255, .86); border: 1px solid rgba(109,93,246,.12); padding: 4px 11px; border-radius: 999px; margin-bottom: 14px;
}
.ads-tier ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 9px; }
.ads-tier li { display: flex; align-items: flex-start; gap: 9px; font-size: 13.5px; font-weight: 600; color: #374151; line-height: 1.42; }
.ads-tier li svg { width: 16px; height: 16px; color: var(--brand); flex: 0 0 auto; margin-top: 1px; }
.ads-tier .ads-cta { margin-top: 16px; padding: 13px; font-size: 15px; border-radius: 13px; }

/* ============ 6. Recommended ============ */
.ads-checkfit {
  display: grid;
  gap: 10px;
}
.ads-checkfit .item {
  display: grid;
  grid-template-columns: 30px 1fr;
  align-items: center;
  gap: 11px;
  min-height: 58px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255,255,255,.9);
  border: 1px solid #EEEBFB;
  box-shadow: 0 8px 20px rgba(17, 24, 39, 0.045), inset 0 1px 0 rgba(255,255,255,.85);
}
.ads-checkfit .item .chk {
  width: 30px; height: 30px; border-radius: 9px;
  display: grid; place-items: center;
  background: var(--brand-soft); color: var(--brand);
}
.ads-checkfit .item:nth-child(1) .chk { background: var(--accent-teal-soft); color: var(--accent-teal); }
.ads-checkfit .item:nth-child(2) .chk { background: var(--accent-blue-soft); color: var(--accent-blue); }
.ads-checkfit .item:nth-child(3) .chk { background: var(--accent-amber-soft); color: var(--accent-amber); }
.ads-checkfit .item:nth-child(4) .chk { background: var(--brand-soft); color: var(--brand); }
.ads-checkfit .item .chk svg { width: 16px; height: 16px; }
.ads-checkfit .item p { margin: 0; font-size: 14.5px; font-weight: 780; line-height: 1.38; color: #1F2937; }

/* ============ 7. Final CTA card ============ */
.ads-final { position: relative; padding: 50px 20px 44px; overflow: hidden; }
.ads-final .ads-glow { width: 220px; height: 220px; top: 10px; left: 50%; transform: translateX(-50%); background: rgba(122, 107, 255, 0.2); }
.ads-finalcard {
  position: relative; z-index: 2;
  border-radius: 26px; padding: 28px 22px;
  background:
    radial-gradient(circle at 80% 0%, rgba(255,255,255,.16), transparent 36%),
    linear-gradient(165deg, #6657F0 0%, #4F43D8 100%);
  color: #fff; text-align: center;
  box-shadow: 0 22px 46px rgba(79, 67, 216, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.25);
  overflow: hidden;
}
.ads-finalcard::after {
  content: ""; position: absolute; width: 200px; height: 200px; right: -60px; top: -70px;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.18), transparent 70%);
}
.ads-finalcard > * { position: relative; }
.ads-finalcard .fbadge {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12.5px; font-weight: 800;
  background: rgba(255, 255, 255, 0.18); border: 1px solid rgba(255, 255, 255, 0.28);
  padding: 6px 14px; border-radius: 999px; margin-bottom: 16px;
}
.ads-finalcard .fbadge svg { width: 13px; height: 13px; }
.ads-finalcard h2 { font-size: 22px; line-height: 1.45; font-weight: 800; letter-spacing: -0.03em; margin: 0 0 10px; }
.ads-finalcard p { font-size: 14px; line-height: 1.55; opacity: 0.92; margin: 0 0 18px; }
.ads-checklist {
  list-style: none; margin: 0 0 20px; padding: 16px; text-align: left;
  background: rgba(255, 255, 255, 0.12); border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 16px; display: grid; gap: 10px;
}
.ads-checklist li { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 700; }
.ads-checklist li svg { width: 18px; height: 18px; flex: 0 0 auto; opacity: 0.95; }
.ads-finalcard .ads-cta { background: #fff; color: var(--brand-deep); box-shadow: 0 12px 26px rgba(0, 0, 0, 0.22); }
.ads-finalcard .ads-cta:hover { box-shadow: 0 16px 32px rgba(0, 0, 0, 0.28); }
.ads-finalcard .ads-cta svg { color: var(--brand-deep); }
.ads-finalcard .fnote { font-size: 12.5px; opacity: 0.85; margin: 13px 0 0; }

/* ============ Footer ============ */
.ads-footer { text-align: center; padding: 30px 20px 40px; }
.ads-footer img { height: 21px; width: auto; margin: 0 auto 10px; opacity: 0.85; }
.ads-footer p { margin: 0; font-size: 12px; color: #9CA3AF; line-height: 1.7; }

/* ============ Sticky CTA + chat launcher ============ */
.ads-action-stack {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  margin: 0 auto;
  max-width: 480px;
  padding: 0 16px calc(12px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  pointer-events: none;
  transform: translateY(66px);
  will-change: transform;
}
.ads-chat-row {
  display: flex;
  justify-content: flex-end;
}
.ads-chat-button {
  width: 58px;
  height: 58px;
  border: 1px solid rgba(228, 224, 248, 0.86);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.96);
  color: var(--ink);
  box-shadow: 0 10px 24px rgba(17, 24, 39, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.9);
  font-size: 13px;
  font-weight: 850;
  letter-spacing: -0.04em;
  display: grid;
  place-items: center;
  cursor: pointer;
  pointer-events: auto;
  position: relative;
}
.ads-chat-button span {
  position: absolute;
  top: 14px;
  right: 10px;
  color: var(--brand);
  font-size: 12px;
  font-weight: 900;
}
.ads-chat-button::after {
  content: "";
  position: absolute;
  top: 4px;
  right: 5px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #EF4444;
  border: 2px solid #fff;
}
.ads-sticky {
  background: linear-gradient(180deg, rgba(251, 250, 255, 0), rgba(251, 250, 255, 0.92) 34%, #FBFAFF 100%);
  opacity: 0;
  pointer-events: none;
  will-change: opacity;
}
.ads-sticky .ads-cta {
  padding: 16px 20px;
  border-radius: 15px;
  box-shadow: 0 -2px 10px rgba(91, 71, 224, 0.08), 0 14px 30px rgba(79, 67, 216, 0.28);
}

@media (max-width: 400px) {
  .ads-hero h1 { font-size: 27px; }
  .ads-h2 { font-size: 22px; }
  .ads-price .num { font-size: 60px; }
}
@media (max-width: 360px) {
  .ads-wrap, .ads-band, .ads-hero, .ads-final { padding-left: 16px; padding-right: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .ads-cta { transition: none; }
}
`;

/* ---------- Inline line icons (stroke = currentColor) ---------- */
const IconSpark = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c.5 4.5 1.8 6.8 6.5 7.5-4.7.7-6 3-6.5 7.5-.5-4.5-1.8-6.8-6.5-7.5C10.2 8.8 11.5 6.5 12 2Z" /><path d="M19 13c.25 2 .8 3 3 3.4-2.2.4-2.75 1.4-3 3.4-.25-2-.8-3-3-3.4 2.2-.4 2.75-1.4 3-3.4Z" opacity="0.55" /></svg>
);
const IconChat = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 9 9 0 0 1-4-1L3 20l1-4.5A8.5 8.5 0 1 1 21 11.5Z" /></svg>
);
const IconTruck = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 16V6a1 1 0 0 0-1-1H2v11h12Z" /><path d="M14 9h4l3 3v4h-7" /><circle cx="6.5" cy="18.5" r="1.8" /><circle cx="17.5" cy="18.5" r="1.8" /></svg>
);
const IconRefund = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7h13a4 4 0 0 1 0 8h-6" /><path d="M7 3 3 7l4 4" /><path d="M13 15l-3 3 3 3" opacity="0.9" /></svg>
);
const IconRepeat = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
);
const IconBot = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 8V4M9 4h6" /><circle cx="9" cy="14" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="14" r="1.2" fill="currentColor" stroke="none" /><path d="M2 13v2M22 13v2" /></svg>
);
const IconFlow = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="5" rx="1.5" /><rect x="3" y="16" width="6" height="5" rx="1.5" /><rect x="15" y="16" width="6" height="5" rx="1.5" /><path d="M12 8v4M12 12H6v4M12 12h6v4" /></svg>
);
const IconDoc = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg>
);
const IconChart = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18" /><rect x="7" y="12" width="3" height="6" rx="1" /><rect x="12" y="8" width="3" height="10" rx="1" /><rect x="17" y="4" width="3" height="14" rx="1" /></svg>
);
const IconHeadset = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 13v-1a8 8 0 0 1 16 0v1" /><rect x="2.5" y="13" width="4" height="6" rx="1.5" /><rect x="17.5" y="13" width="4" height="6" rx="1.5" /><path d="M20 19a4 4 0 0 1-4 3h-2" /></svg>
);
const IconArrow = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
const IconCheck = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12.5l5 5 11-11" /></svg>
);
const IconCross = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
const IconBolt = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></svg>
);
const IconShield = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z" /><path d="M9 12l2 2 4-4" /></svg>
);

// Faint automation-line SVG behind the hero.
const HeroLines = (
  <svg className="lines" viewBox="0 0 390 320" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <path d="M-10 60 H120 a16 16 0 0 1 16 16 V150" stroke="#6D5DF6" strokeWidth="1.5" strokeDasharray="4 6" opacity="0.35" />
    <path d="M400 40 H280 a16 16 0 0 0-16 16 V130 a16 16 0 0 1-16 16 H150" stroke="#6D5DF6" strokeWidth="1.5" strokeDasharray="4 6" opacity="0.28" />
    <circle cx="136" cy="150" r="3" fill="#6D5DF6" opacity="0.5" />
    <circle cx="150" cy="146" r="3" fill="#6D5DF6" opacity="0.4" />
    <circle cx="264" cy="56" r="3" fill="#6D5DF6" opacity="0.45" />
  </svg>
);

const flowSteps = [
  { icon: IconHeadset, title: "상담 응대", desc: "전문 상담사가 채팅 · 게시판 · 이메일 문의를 직접 응대합니다.", primary: true },
  { icon: IconRepeat, title: "반복 문의 자동화", desc: "자주 묻는 문의를 자동으로 처리하도록 구조화합니다." },
  { icon: IconFlow, title: "챗봇 구조설계", desc: "고객 여정에 맞춘 챗봇 플로우를 설계합니다." },
  { icon: IconDoc, title: "FAQ · SOP 정리", desc: "응대 기준과 상담 스크립트를 문서로 정리합니다." },
  { icon: IconChart, title: "운영 대시보드", desc: "문의 현황과 반복 이슈를 대시보드로 확인합니다." },
];

const included = [
  { icon: IconHeadset, title: "상담 응대", desc: "채팅 · 게시판 · 이메일 문의를 응대합니다." },
  { icon: IconFlow, title: "자동화 구조 설계", desc: "반복 문의의 흐름과 운영 구조를 정리합니다." },
  { icon: IconBot, title: "챗봇 플로우 설계", desc: "문의 유형에 맞는 응대 시나리오를 설계합니다." },
  { icon: IconDoc, title: "FAQ / SOP 정리", desc: "자주 묻는 질문과 운영 기준을 문서화합니다." },
  { icon: IconChart, title: "운영 대시보드", desc: "상담 데이터와 개선 포인트를 대시보드로 제공합니다." },
];

const recommended = [
  "CS 채용은 아직 부담되는 브랜드",
  "대표가 직접 문의를 보는 쇼핑몰",
  "반복 문의가 늘어난 팀",
  "운영 기준이 정리되지 않은 브랜드",
];

export default function AdsLandingPage({ searchParams }: { searchParams: SearchParams }) {
  const contactHref = buildContactHref(searchParams);

  return (
    <main className="ads">
      <style dangerouslySetInnerHTML={{ __html: styles }} />

      {/* Top bar */}
      <header className="ads-topbar">
        <img src="/assets/replo-logo.svg" alt="Replo" width={132} height={34} />
        <a className="ads-toplink" href={contactHref}>무료 진단</a>
      </header>

      {/* 1. Hero */}
      <section className="ads-hero" aria-labelledby="ads-hero-title">
        <span className="ads-dots" aria-hidden="true" />
        <span className="ads-glow g1" aria-hidden="true" />
        <span className="ads-glow g2" aria-hidden="true" />
        {HeroLines}

        <div className="ads-hero-inner">
          <span className="ads-badge">{IconSpark}CS 운영대행 구독 서비스</span>
          <h1 id="ads-hero-title">
            <span className="price">월 59만원</span>으로 시작하는<br />
            CS 운영 대행 패키지
          </h1>
          <p className="ads-sub">상담 응대 · 자동화 설계 · 챗봇 구조 설계 · 운영 기준 정리까지</p>

          <a className="ads-cta" href={contactHref}>무료 운영 진단 받기{IconArrow}</a>
        </div>
      </section>

      {/* 2. Problem */}
      <section className="ads-band ads-band--lav" aria-labelledby="ads-problem-title">
        <div className="ads-burden" aria-label="대표님의 하루가 반복 CS로 쪼개지는 상황">
          <span className="ads-burden-label">{IconRepeat}혹시 이런 하루, 익숙하신가요?</span>
          <h3 className="ads-fragment-copy" id="ads-problem-title">작은 문의들이 반복되면<br /><strong>대표님의 하루는 계속 쪼개집니다.</strong></h3>

          <div className="ads-interruptions">
            <div className="ads-interrupt"><span className="ic">{IconBolt}</span><p><span>광고를 보려는데</span>배송 문의가 들어옵니다.</p></div>
            <div className="ads-interrupt"><span className="ic">{IconDoc}</span><p><span>상품을 개선하려는데</span>교환 문의를 확인합니다.</p></div>
            <div className="ads-interrupt"><span className="ic">{IconChart}</span><p><span>매출을 봐야 하는데</span>환불 가능 여부를 판단합니다.</p></div>
          </div>

          <p className="ads-burden-foot">{IconBot}<span>Replo는 반복 문의를 운영 기준으로 정리해, 대표님의 시간을 다시 확보합니다.</span></p>
        </div>
      </section>

      {/* 3. Hiring comparison */}
      <section className="ads-band" aria-labelledby="ads-compare-title">
        <p className="ads-eyebrow">채용보다 먼저</p>
        <h2 className="ads-h2" id="ads-compare-title">
          CS직원 채용보다 먼저,<br />
          <span className="hl">운영 구조</span>부터 잡아야 합니다.
        </h2>
        <div className="ads-compare">
          <div className="ads-col ads-col--plain">
            <h3>직접 채용<span className="pill">부담 ↑</span></h3>
            <ul>
              <li>{IconCross}채용 공고 · 면접</li>
              <li>{IconCross}교육 · 관리</li>
              <li>{IconCross}퇴사 · 공백 리스크</li>
              <li>{IconCross}월 고정비 부담</li>
            </ul>
          </div>
          <div className="ads-col ads-col--brand">
            <h3><img src="/assets/replo-logo.svg" alt="Replo" />CS 운영대행<span className="pill">추천</span></h3>
            <ul>
              <li>{IconCheck}바로 운영 시작</li>
              <li>{IconCheck}상담 응대 포함</li>
              <li>{IconCheck}운영 기준 함께 정리</li>
              <li>{IconCheck}월 단위 유연 운영</li>
              <li>{IconCheck}<b>월 59만원부터 시작</b></li>
            </ul>
          </div>
          <div className="ads-vs" aria-hidden="true">VS</div>
        </div>
      </section>

      {/* 4. Service scope — operations flow */}
      <section className="ads-band ads-band--lav" aria-labelledby="ads-scope-title">
        <p className="ads-eyebrow">툴이 아니라, 운영대행</p>
        <h2 className="ads-h2" id="ads-scope-title">
          툴만 제공하지 않습니다.<br />
          <span className="hl">CS 운영을 대신</span>합니다.
        </h2>
        <div className="ads-ops" aria-label="Replo CS 운영대행 구성">
          <div className="ads-ops-hub"><div className="ads-ops-logo"><b>Replo</b><span>CS 운영 시스템</span></div></div>
          <div className="ads-ops-grid">
            {flowSteps.map((s) => (
              <div className={`ads-ops-card${s.primary ? " primary" : ""}`} key={s.title}>
                <span className="node">{s.icon}</span>
                <div>
                  <h4>{s.title}</h4>
                  <p>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. Price includes */}
      <section className="ads-band" aria-labelledby="ads-price-title">
        <p className="ads-eyebrow">라이트 플랜</p>
        <h2 className="ads-h2" id="ads-price-title">
          <span className="hl">월 59만원</span>에<br />포함되는 것
        </h2>
        <div className="ads-inccard">
          <div className="ads-price-offer" aria-label="라이트 플랜 월 59만원">
            <span className="label">{IconSpark}라이트 플랜</span>
            <div className="price"><span className="month">월</span><strong className="num">59</strong><span className="unit">만원</span></div>
            <div className="meta">
              <span>{IconHeadset}월 상담 200건 기준</span>
              <span>상담 응대 포함</span>
            </div>
          </div>
          <ul className="ads-inc">
            {included.map((it) => (
              <li key={it.title}>
                <span className="ck">{it.icon}</span>
                <div className="ads-inc-copy">
                  <b>{it.title}</b>
                  <p>{it.desc}</p>
                </div>
                <span className="ads-inc-more" aria-hidden="true">{IconArrow}</span>
              </li>
            ))}
          </ul>
        </div>

        <PlanTiers contactHref={contactHref} />
      </section>

      {/* 6. Recommended */}
      <section className="ads-band ads-band--lav tail" aria-labelledby="ads-reco-title">
        <p className="ads-eyebrow">이런 브랜드에 딱 맞습니다</p>
        <h2 className="ads-h2" id="ads-reco-title">
          이런 브랜드라면<br /><span className="hl">Replo</span>가 맞습니다.
        </h2>
        <div className="ads-checkfit">
          {recommended.map((r) => (
            <div className="item" key={r}>
              <span className="chk">{IconCheck}</span>
              <p>{r}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 7. Final CTA card */}
      <section className="ads-final" aria-labelledby="ads-final-title">
        <span className="ads-glow" aria-hidden="true" />
        <div className="ads-finalcard">
          <span className="fbadge">{IconSpark}무료 운영 진단</span>
          <h2 id="ads-final-title">지금 CS 운영 상태를<br />무료로 점검해보세요.</h2>
          <p>문의량 · 반복 문의 · 자동화 가능 영역을<br />함께 확인해 드립니다.</p>
          <ul className="ads-checklist">
            <li>{IconCheck}현재 문의량과 응대 부담 진단</li>
            <li>{IconCheck}반복 문의 · 자동화 가능 영역 확인</li>
            <li>{IconCheck}운영 기준 정리 방향 제안</li>
          </ul>
          <a className="ads-cta" href={contactHref}>무료 운영 진단 받기{IconArrow}</a>
          <p className="fnote">상담 후 계약 여부를 결정하셔도 됩니다.</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="ads-footer">
        <img src="/assets/replo-logo.svg" alt="Replo" width={132} height={34} />
        <p>커머스 브랜드를 위한 CS 운영대행 서비스<br />© Replo. All rights reserved.</p>
      </footer>

      {/* Sticky mobile CTA + chat launcher */}
      <div className="ads-action-stack">
        <div className="ads-chat-row">
          <button className="ads-chat-button" type="button" data-ads-chat-button aria-label="채널톡 상담 열기">
            Replo<span>+</span>
          </button>
        </div>
        <div className="ads-sticky">
          <a className="ads-cta" href={contactHref}>무료 운영 진단 받기{IconArrow}</a>
        </div>
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `
(function () {
  var stack = document.querySelector('.ads-action-stack');
  var sticky = document.querySelector('.ads-sticky');
  var chatButton = document.querySelector('[data-ads-chat-button]');
  var ticking = false;

  function clamp(value) {
    return Math.max(0, Math.min(1, value));
  }

  function progress() {
    var start = Math.min(220, window.innerHeight * 0.22);
    var distance = Math.max(260, window.innerHeight * 0.42);
    return clamp((window.scrollY - start) / distance);
  }

  function hiddenOffset() {
    if (!sticky) return 66;
    return sticky.offsetHeight + 10;
  }

  function hideNativeChannelButton() {
    if (window.ChannelIO) {
      window.ChannelIO('hideChannelButton');
    }
  }

  function openMessenger() {
    if (window.ChannelIO) {
      window.ChannelIO('showMessenger');
    }
  }

  function apply(progressValue) {
    var offset = hiddenOffset() * (1 - progressValue);
    if (stack) {
      stack.style.transform = 'translateY(' + offset.toFixed(2) + 'px)';
    }
    if (sticky) {
      sticky.style.opacity = String(progressValue);
      sticky.style.pointerEvents = progressValue > 0.92 ? 'auto' : 'none';
    }
    hideNativeChannelButton();
  }

  function update() {
    ticking = false;
    apply(progress());
  }

  function requestUpdate() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }

  if (chatButton) {
    chatButton.addEventListener('click', openMessenger);
  }
  requestUpdate();
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  setInterval(hideNativeChannelButton, 1000);
  setTimeout(requestUpdate, 500);
  setTimeout(requestUpdate, 1200);
  setTimeout(requestUpdate, 2400);
})();
          `,
        }}
      />
    </main>
  );
}
