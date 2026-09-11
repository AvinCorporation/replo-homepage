"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GoogleAuthButton } from "../auth/GoogleAuthButton";
import { homeCopy } from "../../content/homeCopy";
import { createClient } from "../../lib/supabase/client";
import { shouldShowPortalLogin } from "../../lib/deployment/host";

const PATHS: Record<string, string> = {
  arrowRight: "M5 12h14M13 5l7 7-7 7",
  card: "M3 7h18v10H3zM3 10h18M7 14h4",
  chart: "M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-7",
  check: "M5 12.5l4.5 4.5L19 7",
  chevDown: "M5 9l7 7 7-7",
  chevRight: "M9 5l7 7-7 7",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2",
  cpu: "M7 7h10v10H7zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3",
  doc: "M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 16h6",
  gauge: "M12 21a9 9 0 1 0-9-9M12 12l4-3M3 12h2M20 8l-1.5 1",
  headset: "M4 13v-1a8 8 0 0 1 16 0v1M4 13a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2ZM20 13a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2 2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2ZM18 19a4 4 0 0 1-4 3h-2",
  inbox: "M3 13l3-9h12l3 9v6H3v-6ZM3 13h5l1 3h6l1-3h5",
  layers: "M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5M3 16.5l9 5 9-5",
  link: "M9 15l6-6M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1",
  menu: "M4 7h16M4 12h16M4 17h16",
  message: "M4 5h16v11H8l-4 4V5Z",
  refresh: "M20 11a8 8 0 0 0-14-4M4 5v4h4M4 13a8 8 0 0 0 14 4M20 19v-4h-4",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3ZM8.5 12l2.5 2.5L16 9.5",
  sparkles: "M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3ZM19 14l.8 2.2 2.2.8-2.2.8L19 20l-.8-2.2-2.2-.8 2.2-.8L19 14Z",
  star: "M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 17l-5.3 2.6 1.1-6L3.4 9.4l6-.8L12 3Z",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  trending: "M3 17l6-6 4 4 8-8M21 7v5M21 7h-5",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0",
  x: "M6 6l12 12M18 6L6 18",
  zap: "M13 3 4 14h7l-1 7 9-11h-7l1-7Z",
};

function Icon({ name, size = 20, stroke = 1.7 }: { name: string; size?: number; stroke?: number }) {
  const d = PATHS[name] ?? PATHS.check;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split("M").filter(Boolean).map((seg, index) => (
        <path key={index} d={`M${seg}`} />
      ))}
    </svg>
  );
}

function Logo({ onDark = false }: { onDark?: boolean }) {
  return (
    <span className={`logo${onDark ? " on-dark" : ""}`}>
      Replo<sup>+</sup>
    </span>
  );
}

function ButtonLink({
  children,
  href = "/contact",
  variant = "primary",
  size,
  className = "",
  iconRight,
}: {
  children: React.ReactNode;
  href?: string;
  variant?: "primary" | "ghost";
  size?: "lg" | "sm";
  className?: string;
  iconRight?: string;
}) {
  return (
    <a className={["btn", `btn-${variant}`, size === "lg" ? "btn-lg" : size === "sm" ? "btn-sm" : "", className].filter(Boolean).join(" ")} href={href}>
      {children}
      {iconRight ? <Icon name={iconRight} size={size === "sm" ? 16 : 18} /> : null}
    </a>
  );
}

function LoginModal({
  authError,
  open,
  onClose,
}: {
  authError: boolean;
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="home-auth-modal" role="presentation" onMouseDown={onClose}>
      <div
        aria-labelledby="home-auth-title"
        aria-modal="true"
        className="home-auth-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="home-auth-close" type="button" onClick={onClose} aria-label="로그인 창 닫기">
          <Icon name="x" size={21} />
        </button>
        <div className="home-auth-brand">
          <Logo />
        </div>
        <h2 id="home-auth-title">Replo에 로그인</h2>
        <p className="home-auth-description">Google 계정으로 간편하게 시작하세요.</p>
        {authError ? (
          <p className="home-auth-error" role="alert">
            Google 인증을 완료하지 못했습니다. 다시 시도해 주세요.
          </p>
        ) : null}
        <div className="home-auth-action">
          <GoogleAuthButton label="Google로 계속하기" />
        </div>
        <small>처음 로그인하면 회사와 브랜드 정보를 등록합니다.</small>
      </div>
    </div>
  );
}

function MarketingNav({
  authenticated,
  authReady,
  onLogin,
  onLogout,
  showPortalLogin,
}: {
  authenticated: boolean;
  authReady: boolean;
  onLogin: () => void;
  onLogout: () => void;
  showPortalLogin: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const showAuthControls = showPortalLogin || authenticated;

  useEffect(() => {
    if (!menu) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [menu]);

  return (
    <>
      <header className="mnav">
        <div className="wrap mnav-in">
          <a href="#top" aria-label="Replo source home">
            <Logo />
          </a>
          <nav className="mnav-links" aria-label="주요 메뉴">
            {homeCopy.navigation.links.map(({ id, label }) => (
              <a key={id} href={`#${id}`}>{label}</a>
            ))}
          </nav>
          <div className="mnav-cta">
            {!authReady ? (
              <span className="mnav-auth-skeleton" aria-label="로그인 상태 확인 중" role="status" />
            ) : showAuthControls ? (
              <button className="btn btn-ghost btn-sm" type="button" onClick={authenticated ? onLogout : onLogin}>
                {authenticated ? "로그아웃" : "로그인"}
              </button>
            ) : null}
            <ButtonLink href={authenticated ? "/dashboard" : "/contact"} size="sm">
              {authenticated ? "대시보드 바로가기" : homeCopy.navigation.cta}
            </ButtonLink>
            <button className="mnav-burger" type="button" onClick={() => setMenu(true)} aria-label="메뉴 열기">
              <Icon name="menu" size={26} />
            </button>
          </div>
        </div>
      </header>
      <div className={`msheet${menu ? " show" : ""}`} onClick={() => setMenu(false)}>
        <div className="msheet-panel" onClick={(event) => event.stopPropagation()}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <Logo />
            <button type="button" onClick={() => setMenu(false)} style={{ background: "none", border: 0 }} aria-label="메뉴 닫기">
              <Icon name="x" size={24} />
            </button>
          </div>
          {homeCopy.navigation.links.map(({ id, label }) => (
            <a key={id} href={`#${id}`} onClick={() => setMenu(false)}>{label}</a>
          ))}
          <div className="col gap-10" style={{ marginTop: 18 }}>
            {authReady && showAuthControls ? (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setMenu(false);
                  authenticated ? onLogout() : onLogin();
                }}
              >
                {authenticated ? "로그아웃" : "로그인"}
              </button>
            ) : null}
            <ButtonLink href={authenticated ? "/dashboard" : "/contact"}>
              {authenticated ? "대시보드 바로가기" : homeCopy.navigation.cta}
            </ButtonLink>
          </div>
        </div>
      </div>
    </>
  );
}

function Hero() {
  return (
    <section className="hero" id="top">
      <div className="hero-bg">
        <div className="hero-grid" />
        <div className="hero-glow" style={{ top: -220, left: "50%", transform: "translateX(-50%)" }} />
      </div>
      <div className="wrap">
        <div className="hero-pitch no-art">
          <span className="chip"><Icon name="sparkles" size={15} /> {homeCopy.hero.eyebrow}</span>
          <h1 className="t-display">
            {homeCopy.hero.title[0]}<br />
            <span className="hero-grad">{homeCopy.hero.title[1]}</span>
          </h1>
          <p className="t-lead lead">{homeCopy.hero.description[0]}<br />{homeCopy.hero.description[1]}</p>
          <div className="cta-row">
            <ButtonLink size="lg">{homeCopy.hero.primaryCta}</ButtonLink>
            <ButtonLink href="#solution-sec" size="lg" variant="ghost">{homeCopy.hero.secondaryCta}</ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChecklistSection() {
  const [on, setOn] = useState<Record<number, boolean>>({});
  const count = Object.values(on).filter(Boolean).length;
  const result = count > 0 ? homeCopy.checklist.results[count - 1] : homeCopy.checklist.defaultResult;

  return (
    <section className="sec" id="check-sec">
      <div className="deco"><div className="deco-dots" /></div>
      <div className="wrap">
        <div className="sec-head sec-center">
          <span className="eyebrow-pill">{homeCopy.checklist.eyebrow}</span>
          <h2 className="t-h1">{homeCopy.checklist.title[0]}</h2>
          <p className="t-lead" style={{ marginTop: 16 }}>{homeCopy.checklist.description}</p>
        </div>
        <div className="check-list">
          {homeCopy.checklist.items.map(({ icon, title, question }, index) => (
            <button type="button" className={`check-item${on[index] ? " on" : ""}`} key={title} onClick={() => setOn((current) => ({ ...current, [index]: !current[index] }))}>
              <span className="check-box"><Icon name="check" size={15} stroke={2.6} /></span>
              <span className="check-ic"><Icon name={icon} size={20} /></span>
              <span className="check-body">
                <span className="check-t">{title}</span>
                <span className="check-q">{question}</span>
              </span>
            </button>
          ))}
        </div>
        <div className={`check-result${count > 0 ? " active" : ""}`}>{result}</div>
      </div>
    </section>
  );
}

function CauseSection() {
  return (
    <section className="sec-tight" style={{ background: "var(--bg)" }} id="cause-sec">
      <div className="deco"><div className="orb orb-violet-soft" style={{ width: 420, height: 420, top: -120, right: -140 }} /></div>
      <div className="wrap">
        <div className="sec-head sec-center">
          <span className="eyebrow-pill">{homeCopy.problem.eyebrow}</span>
          <h2 className="t-h1">{homeCopy.problem.title[0]}<br />{homeCopy.problem.title[1]}</h2>
          <p className="t-lead" style={{ marginTop: 16 }}>{homeCopy.problem.introduction[0]}<br />{homeCopy.problem.introduction[1]}</p>
        </div>
        <div className="shift-row">
          <div className="shift-card wrong">
            <div className="shift-label">{homeCopy.problem.commonDiagnosis.label}</div>
            <div className="shift-headline">{homeCopy.problem.commonDiagnosis.title}</div>
            <p className="shift-desc">{homeCopy.problem.commonDiagnosis.description[0]}<br />{homeCopy.problem.commonDiagnosis.description[1]}</p>
          </div>
          <div className="shift-card right">
            <div className="shift-label">{homeCopy.problem.realCause.label}</div>
            <div className="shift-headline">{homeCopy.problem.realCause.title}</div>
            <p className="shift-desc">{homeCopy.problem.realCause.description[0]}<br />{homeCopy.problem.realCause.description[1]}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function WhyNowSection() {
  return (
    <section className="sec" id="whynow-sec">
      <div className="deco"><div className="deco-grid mask-center" /><div className="orb orb-rose" style={{ width: 360, height: 360, bottom: -120, left: -100 }} /></div>
      <div className="wrap">
        <div className="sec-head sec-center">
          <span className="eyebrow-pill">{homeCopy.whyNow.eyebrow}</span>
          <h2 className="t-h1">{homeCopy.whyNow.title[0]}<br />{homeCopy.whyNow.title[1]}</h2>
        </div>
        <div className="urg-grid">
          {homeCopy.whyNow.cards.map(({ icon, stat, title, description }) => (
            <div className="urg-card" key={title}>
              <div className="urg-ic"><Icon name={icon} size={22} /></div>
              <div className="urg-stat">{stat}</div>
              <h4>{title}</h4>
              <p>{description}</p>
            </div>
          ))}
        </div>
        <p className="urg-foot">{homeCopy.whyNow.footer}<br /><b>{homeCopy.whyNow.footerStrong}</b></p>
      </div>
    </section>
  );
}

function SolCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="sol-card">
      <div className="si"><Icon name={icon} size={20} /></div>
      <div><h4>{title}</h4><p>{description}</p></div>
    </div>
  );
}

function SolutionSection() {
  return (
    <section className="sec-tight" style={{ background: "var(--bg)" }} id="solution-sec">
      <div className="deco"><div className="deco-grid mask-center" /><div className="orb orb-violet" style={{ width: 420, height: 420, top: "42%", left: "50%", transform: "translate(-50%,-30%)" }} /></div>
      <div className="wrap">
        <div className="sec-head sec-center">
          <span className="eyebrow-pill">{homeCopy.service.eyebrow}</span>
          <h2 className="t-h1">{homeCopy.service.title[0]}<br />{homeCopy.service.title[1]}</h2>
          <p className="t-lead" style={{ marginTop: 16 }}>{homeCopy.service.description[0]}<br />{homeCopy.service.description[1]}</p>
        </div>
        <div className="sol-bento">
          <div className="sol-col">{homeCopy.service.leftFeatures.map(({ icon, title, description }) => <SolCard key={title} icon={icon} title={title} description={description} />)}</div>
          <div className="sol-core">
            <span className="sc-ring" style={{ width: 220, height: 220 }} />
            <span className="sc-ring" style={{ width: 300, height: 300 }} />
            <span className="sc-badge"><Icon name="sparkles" size={14} /> {homeCopy.service.coreBadge}</span>
            <div className="sc-name">Replo<sup>+</sup></div>
            <p className="sc-desc">{homeCopy.service.coreDescription}</p>
          </div>
          <div className="sol-col">{homeCopy.service.rightFeatures.map(({ icon, title, description }) => <SolCard key={title} icon={icon} title={title} description={description} />)}</div>
        </div>
      </div>
    </section>
  );
}

function ApproachSection() {
  return (
    <section className="sec" id="approach-sec">
      <div className="deco"><div className="deco-grid mask-top" /></div>
      <div className="wrap">
        <div className="sec-head sec-center" style={{ maxWidth: 820 }}>
          <span className="eyebrow-pill">{homeCopy.approach.eyebrow}</span>
          <h2 className="t-h1">{homeCopy.approach.titlePrefix}<br /><span className="hero-grad">{homeCopy.approach.titleHighlight}</span>{homeCopy.approach.titleSuffix}</h2>
          <p className="t-lead" style={{ marginTop: 16 }}>{homeCopy.approach.description[0]}<br />{homeCopy.approach.description[1]}</p>
        </div>
        <div className="appr">
          <div className="appr-scroll">
            <div className="appr-table">
              <div className="appr-head">
                <div className="appr-hc category">{homeCopy.approach.categoryLabel}</div>
                <div className="appr-hc old">{homeCopy.approach.oldLabel}</div>
                <div className="appr-hc replo" aria-label={homeCopy.approach.reploLabel}><Logo onDark /></div>
              </div>
              {homeCopy.approach.comparisons.map(([category, oldWay, reploWay]) => (
                <div className="appr-row" key={category}>
                  <div className="appr-cell category">{category}</div>
                  <div className="appr-cell old"><span className="appr-mk x"><Icon name="x" size={13} stroke={2.4} /></span>{oldWay}</div>
                  <div className="appr-cell replo"><span className="appr-mk ok"><Icon name="check" size={13} stroke={2.6} /></span>{reploWay}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="appr-foot">{homeCopy.approach.footerPrefix}<b>{homeCopy.approach.footerStrong}</b>{homeCopy.approach.footerSuffix}</p>
      </div>
    </section>
  );
}

function ExpertiseSection() {
  return (
    <section className="sec expertise-sec" id="expertise-sec">
      <div className="deco"><div className="deco-dots" /></div>
      <div className="wrap expertise-grid">
        <div className="expertise-column">
          <span className="expertise-eyebrow">{homeCopy.expertise.team.eyebrow}</span>
          <h2 className="t-h1">{homeCopy.expertise.team.title}</h2>
          <p className="expertise-lead">
            {homeCopy.expertise.team.description[0]}<br />
            {homeCopy.expertise.team.description[1]}
          </p>
          <div className="expertise-stats">
            {homeCopy.expertise.team.stats.map(({ value, label }) => (
              <div className="expertise-stat" key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className="expertise-tags" aria-label="Replo 팀 전문 역량">
            {homeCopy.expertise.team.capabilities.map((capability) => <span key={capability}>{capability}</span>)}
          </div>
        </div>

        <div className="expertise-column">
          <span className="expertise-eyebrow">{homeCopy.expertise.experience.eyebrow}</span>
          <h2 className="t-h1">{homeCopy.expertise.experience.title[0]}<br />{homeCopy.expertise.experience.title[1]}</h2>
          <div className="expertise-categories">
            {homeCopy.expertise.experience.categories.map((category) => <span key={category}>{category}</span>)}
          </div>
          <div className="expertise-note">
            <span className="expertise-note-icon"><Icon name="check" size={18} stroke={2.6} /></span>
            <div>
              <h3>{homeCopy.expertise.experience.noteTitle}</h3>
              <p>{homeCopy.expertise.experience.noteDescription}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProcessSection() {
  return (
    <section className="sec-tight" id="process-sec">
      <div className="wrap">
        <div className="sec-head sec-center">
          <span className="eyebrow-pill">{homeCopy.onboarding.eyebrow}</span>
          <h2 className="t-h1">{homeCopy.onboarding.title}</h2>
          <p className="t-lead" style={{ marginTop: 16 }}>{homeCopy.onboarding.description[0]}<br />{homeCopy.onboarding.description[1]}</p>
        </div>
        <div className="proc-row">
          {homeCopy.onboarding.steps.map(({ icon, title, description }, index) => (
            <div className="proc-step" key={title}>
              <div className="proc-top">
                <span className="proc-no">{homeCopy.onboarding.stepPrefix} {String(index + 1).padStart(2, "0")}</span>
                <div className="proc-ic"><Icon name={icon} size={20} /></div>
              </div>
              <h4>{title}</h4>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CostSection() {
  const cost = homeCopy.cost;
  const hireRows = cost.rows.map(({ item, hire }) => ({ item, value: hire }));

  return (
    <section className="sec-tight cost-section" id="cost-sec">
      <div className="deco"><div className="deco-grid mask-top cost-grid" /></div>
      <div className="wrap">
        <div className="sec-head sec-center" style={{ maxWidth: 840 }}>
          <span className="eyebrow-pill">{cost.eyebrow}</span>
          <h2 className="t-h1">{cost.title[0]}<br />{cost.title[1]}</h2>
          <p className="t-lead" style={{ marginTop: 16 }}>{cost.description}</p>
        </div>

        <div className="cost-compare" aria-label="직접 채용과 Replo 라이트 비용 비교">
          <article className="cost-card cost-card-hire">
            <div className="cost-card-head">
              <span className="cost-card-kicker">In-house</span>
              <h3>{cost.headers.hire}</h3>
            </div>
            <div className="cost-price">월 {cost.hireTotal}</div>
            <p className="cost-subcopy">{cost.hireSubtitle}</p>
            <div className="cost-items">
              {hireRows.map(({ item, value }) => (
                <div className="cost-item" key={item}>
                  <span>{item}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <p className="cost-footnote">{cost.hireFootnote}</p>
          </article>

          <div className="cost-vs" aria-hidden="true">VS</div>

          <article className="cost-card cost-card-replo">
            <div className="cost-card-head">
              <span className="cost-card-kicker">Replo</span>
              <h3>{cost.reploTitle}</h3>
            </div>
            <div className="cost-price cost-price-replo">월 {cost.reploTotal}</div>
            <p className="cost-subcopy">{cost.reploSubtitle}</p>
            <div className="cost-items cost-includes">
              {cost.reploIncludes.map((item) => (
                <div className="cost-item" key={item}>
                  <span><Icon name="check" size={15} stroke={2.4} />{item}</span>
                </div>
              ))}
            </div>
            <span className="cost-saving-pill">{cost.savingsBadge}</span>
          </article>
        </div>

        <div className="cost-result">
          <span>{cost.annualLabel}</span>
          <strong>{cost.resultTitle}</strong>
          <p>{cost.resultDescription}</p>
        </div>

        <p className="cost-note"><strong>{cost.noteLabel}</strong> · {cost.note}</p>
      </div>
    </section>
  );
}

function ImpactSection() {
  return (
    <section className="sec-tight" style={{ background: "var(--bg)" }} id="impact-sec">
      <div className="deco"><div className="orb orb-violet-soft" style={{ width: 420, height: 420, top: -140, left: "50%", transform: "translateX(-50%)" }} /></div>
      <div className="wrap">
        <div className="sec-head sec-center">
          <span className="eyebrow-pill">{homeCopy.impact.eyebrow}</span>
          <h2 className="t-h1">{homeCopy.impact.title[0]}<br />{homeCopy.impact.title[1]}</h2>
          <p className="t-lead" style={{ marginTop: 16 }}>{homeCopy.impact.description}</p>
        </div>
        <div className="impact-pairs">
          {homeCopy.impact.rows.map(({ label, before, after }) => (
            <article className="impact-pair-card" key={label}>
              <h3 className="impact-pair-label">{label}</h3>
              <div className="impact-pair-grid">
                <div className="impact-pair-side impact-before">
                  <span className="impact-mini-label">{homeCopy.impact.beforeLabel}</span>
                  <span className="impact-icon"><Icon name="x" size={15} stroke={2.4} /></span>
                  <span className="impact-copy">{before}</span>
                </div>
                <div className="impact-pair-side impact-after">
                  <span className="impact-mini-label">{homeCopy.impact.afterLabel}</span>
                  <span className="impact-icon"><Icon name="check" size={15} stroke={2.6} /></span>
                  <span className="impact-copy">{after}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="impact-result"><p>{homeCopy.impact.resultPrefix}<strong>{homeCopy.impact.result}</strong></p></div>
      </div>
    </section>
  );
}

function ValuesSection() {
  return (
    <section className="sec" id="value-sec">
      <div className="deco"><div className="deco-dots" /></div>
      <div className="wrap">
        <div className="sec-head sec-center">
          <span className="eyebrow-pill">{homeCopy.values.eyebrow}</span>
          <h2 className="t-h1">{homeCopy.values.title}</h2>
        </div>
        <div className="feat-grid" style={{ marginTop: 52 }}>
          {homeCopy.values.items.map(({ icon, title, description }) => (
            <div className="feat" key={title}>
              <div className="fi"><Icon name={icon} size={23} /></div>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureMatrix() {
  const { featureLabel, bestIndex, columns, rows } = homeCopy.pricing.matrix;

  return (
    <div className="ftm-wrap" id="pricing-detail">
      <div className="ftm-scroll">
        <table className="ftm">
          <thead>
            <tr>
              <th className="f-name">{featureLabel}</th>
              {columns.map((column, index) => (
                <th className={index === bestIndex ? "best" : ""} key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, cells, kind }) => (
              <tr key={label}>
                <td className="f-name">{label}</td>
                {cells.map((value, index) => {
                  const className = index === bestIndex ? "col-best" : "";
                  if (kind === "strong") return <td className={className} key={`${label}-${index}`}><span className="f-strong">{value}</span></td>;
                  if (kind === "text") return <td className={`${className} f-text`} key={`${label}-${index}`}>{value}</td>;
                  return (
                    <td className={className} key={`${label}-${index}`}>
                      {value ? <span className="fk"><Icon name="check" size={15} stroke={2.4} /></span> : <span className="fx">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LandingPricing() {
  const [showMatrix, setShowMatrix] = useState(false);
  const pricing = homeCopy.pricing;

  return (
    <section className="sec-tight pricing-section" id="pricing-sec">
      <div className="deco"><div className="deco-grid mask-top pricing-grid" /></div>
      <div className="wrap">
        <div className="sec-head sec-center" style={{ marginBottom: 36 }}>
          <span className="eyebrow-pill">{pricing.eyebrow}</span>
          <h2 className="t-h1">{pricing.title}</h2>
          {pricing.description ? <p className="t-lead" style={{ marginTop: 16 }}>{pricing.description}</p> : null}
        </div>
        <div className="pricing4">
          {pricing.plans.map(({ en, ko, price, volume, best, description, features }) => (
            <div className={`tier${best ? " best" : ""}`} key={en}>
              <div className="tier-head">
                <div>
                  <div className="tier-name-en">{en}</div>
                  <div className="tier-name">{ko}</div>
                </div>
              </div>
              <div className="tier-price-wrap">
                <div className="tier-price">
                  {price}
                  {price.startsWith("₩") ? <small>{pricing.monthlyUnit}</small> : null}
                </div>
              </div>
              <p className="tier-desc">{description}</p>
              <span className="tier-vol">{volume}</span>
              <ul className="tier-feats">
                {features.map((feature) => <li key={feature}><Icon name="check" size={15} stroke={2.3} />{feature}</li>)}
              </ul>
              <ButtonLink size="sm" variant={best ? "primary" : "ghost"} className="btn-block tier-cta">
                {en === "Enterprise" ? pricing.enterpriseCta : pricing.standardCta}
              </ButtonLink>
            </div>
          ))}
        </div>
        <div className="matrix-toggle">
          <button
            aria-controls="pricing-detail"
            aria-expanded={showMatrix}
            className="btn btn-ghost"
            onClick={() => setShowMatrix((current) => !current)}
            type="button"
          >
            {showMatrix ? homeCopy.pricing.detailClose : homeCopy.pricing.detailOpen}
            <Icon name={showMatrix ? "chevDown" : "chevRight"} size={18} />
          </button>
        </div>
        {showMatrix ? <FeatureMatrix /> : null}
        <p className="t-sm" style={{ textAlign: "center", marginTop: 24 }}>{homeCopy.pricing.note}</p>
      </div>
    </section>
  );
}

function FaqSection() {
  const [open, setOpen] = useState(0);
  return (
    <section className="sec" id="faq-sec">
      <div className="wrap">
        <div className="sec-head sec-center" style={{ marginBottom: 40 }}>
          <span className="eyebrow-pill">{homeCopy.faq.eyebrow}</span>
          <h2 className="t-h1">{homeCopy.faq.title}</h2>
        </div>
        <div className="faq">
          {homeCopy.faq.items.map(([question, answer], index) => (
            <div className={`faq-item${open === index ? " open" : ""}`} key={question}>
              <button className="faq-q" type="button" onClick={() => setOpen(open === index ? -1 : index)}>{question}<Icon name="chevDown" size={20} /></button>
              <div className="faq-a"><div>{answer}</div></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaSection() {
  return (
    <section className="sec-tight">
      <div className="wrap">
        <div className="cta-band center">
          <div style={{ position: "relative", zIndex: 1 }}>
            <h2 className="t-h1" style={{ color: "#fff" }}>{homeCopy.finalCta.title[0]}<br />{homeCopy.finalCta.title[1]}</h2>
            <p style={{ fontSize: 17, lineHeight: 1.7, marginTop: 16 }}>{homeCopy.finalCta.description[0]}<br />{homeCopy.finalCta.description[1]}</p>
            <div className="cta-row">
              <ButtonLink size="lg" className="source-cta-white">{homeCopy.finalCta.button}</ButtonLink>
              <ButtonLink size="lg" className="source-cta-outline">{homeCopy.finalCta.secondaryButton}</ButtonLink>
            </div>
            <div className="cta-hint">{homeCopy.finalCta.hint}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <div>
            <Logo onDark />
            <p style={{ color: "rgba(255,255,255,.55)", fontSize: 14, lineHeight: 1.7, marginTop: 16, maxWidth: 300 }}>{homeCopy.footer.description}</p>
          </div>
          <div><h5>{homeCopy.footer.serviceTitle}</h5>{homeCopy.footer.serviceLinks.map(({ href, label }) => <a href={href} key={href}>{label}</a>)}</div>
          <div><h5>{homeCopy.footer.companyTitle}</h5>{homeCopy.footer.companyLinks.map(({ href, label }) => <a href={href} key={href}>{label}</a>)}</div>
          <div>
            <h5>{homeCopy.footer.informationTitle}</h5>
            <address className="foot-company">
              <span>{homeCopy.footer.companyName}</span>
              <span>{homeCopy.footer.representative}</span>
              <span>{homeCopy.footer.address}</span>
              <span>{homeCopy.footer.businessNumber}</span>
              <a href="mailto:sales@replo.kr">{homeCopy.footer.contact}</a>
              <a href="tel:07041380499">{homeCopy.footer.telephone}</a>
            </address>
          </div>
        </div>
        <div className="foot-bottom">
          <span>{homeCopy.footer.copyright}</span>
          <span>{homeCopy.footer.slogan}</span>
        </div>
      </div>
    </footer>
  );
}

export function SourceHome() {
  const router = useRouter();
  // Auth, host, and login deep-links are resolved client-side so the page can
  // be served as static HTML. `authReady` gates the nav auth control until the
  // session is known, avoiding a login/logout button flash.
  const [authReady, setAuthReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [showPortalLogin, setShowPortalLogin] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    setShowPortalLogin(shouldShowPortalLogin(window.location.hostname));

    const params = new URLSearchParams(window.location.search);
    const wantLogin = params.get("login") === "1";
    if (params.get("error") === "auth_failed") setAuthError(true);

    const supabase = createClient();
    let active = true;
    // getSession reads the session from the cookie/storage without a network
    // round-trip, so it resolves almost instantly on the client.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const isAuthed = Boolean(data.session);
      setAuthenticated(isAuthed);
      if (wantLogin && !isAuthed) setLoginOpen(true);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticated(Boolean(session));
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
    await createClient().auth.signOut();
    setAuthenticated(false);
    router.refresh();
  }

  return (
    <div className="replo-source-home">
      <div className="mkt">
        <MarketingNav
          authenticated={authenticated}
          authReady={authReady}
          onLogin={() => setLoginOpen(true)}
          onLogout={handleLogout}
          showPortalLogin={showPortalLogin}
        />
        <Hero />
        <ChecklistSection />
        <CauseSection />
        <WhyNowSection />
        <SolutionSection />
        <ApproachSection />
        <ExpertiseSection />
        <ProcessSection />
        <CostSection />
        <ImpactSection />
        <ValuesSection />
        <LandingPricing />
        <FaqSection />
        <CtaSection />
        <Footer />
      </div>
      <LoginModal authError={authError} open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}
