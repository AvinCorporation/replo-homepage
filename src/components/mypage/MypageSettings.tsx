"use client";

import Link from "next/link";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MemberManagement } from "@/components/mypage/MemberManagement";
import {
  PaymentMethodRow,
  cardLabel,
  type PaymentMethodView,
} from "@/components/mypage/PaymentMethodRow";
import { PortalRail } from "@/components/portal/PortalRail";
import {
  planLabels,
  selectablePlans,
  selfServicePlanIds,
  type SelectablePlanId,
} from "@/lib/billing/plans";
import { createClient } from "@/lib/supabase/client";

export type MypageSection = "profile" | "plan" | "members";

type CurrentPlan = {
  planId: SelectablePlanId | null;
  label: string;
  monthlyFee: number;
  includedTickets: number;
  nextBillingDate: string | null;
  status: string;
};

type PlanUsage = {
  periodStart: string;
  periodEnd: string;
  handledCount: number;
  billableCount: number;
  projectedBillableCount: number;
  recommendedPlanId: SelectablePlanId | null;
  hasData: boolean;
};

type Props = {
  canManage: boolean;
  initialSection: MypageSection;
  loginEmail: string;
  roleLabel: string;
  customer: {
    companyName: string;
    brandName: string;
    representativeName: string;
    contactName: string;
    email: string;
    phone: string;
    websiteUrl: string;
    businessNumber: string;
    billingEmail: string;
  };
  usage: PlanUsage;
  plan: CurrentPlan;
  startedAt: string | null;
  memberCount: number;
  paymentMethod: PaymentMethodView | null;
  tossClientKey: string;
  customerKey: string;
  cardNotice: { tone: "success" | "error"; text: string } | null;
};

const sectionTitles: Record<MypageSection, [string, string]> = {
  profile: ["고객 정보", "고객사와 브랜드의 기본 정보를 관리합니다."],
  plan: ["이용 플랜", "현재 이용 중인 플랜과 이번 달 상담 운영량을 확인합니다."],
  members: ["멤버 관리", "워크스페이스 구성원과 역할을 관리합니다."],
};

// 사이드바 아이콘. 대시보드 레일(PortalRail)과 같은 스트로크 규격을 씁니다.
function MenuIcon({ section }: { section: MypageSection }) {
  const paths: Record<MypageSection, ReactNode> = {
    profile: (
      <>
        <path d="M4 20V9l8-5 8 5v11" />
        <path d="M9 20v-6h6v6" />
      </>
    ),
    plan: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="3" />
        <path d="M3 10h18" />
      </>
    ),
    members: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 19c.6-3.4 2.7-5 6-5s5.4 1.6 6 5" />
        <path d="M16 7.5a3 3 0 0 1 0 5.4" />
        <path d="M18.5 19c-.3-2-1-3.4-2.2-4.3" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[section]}
    </svg>
  );
}

const ArrowIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

type ProfileField = keyof Props["customer"];

const profileFields: Array<{
  key: ProfileField;
  label: string;
  required: boolean;
  placeholder: string;
}> = [
  { key: "companyName", label: "회사명", required: true, placeholder: "주식회사 리플로" },
  { key: "brandName", label: "브랜드명", required: true, placeholder: "Replo" },
  { key: "representativeName", label: "대표 담당자", required: true, placeholder: "김리플" },
  { key: "contactName", label: "실무 담당자", required: false, placeholder: "운영 담당자" },
  { key: "email", label: "고객 연락 이메일", required: true, placeholder: "hello@company.com" },
  { key: "billingEmail", label: "청구 이메일", required: false, placeholder: "billing@company.com" },
  { key: "phone", label: "연락처", required: false, placeholder: "02-0000-0000" },
  { key: "websiteUrl", label: "웹사이트", required: false, placeholder: "https://example.com" },
  { key: "businessNumber", label: "사업자등록번호", required: false, placeholder: "000-00-00000" },
];

const planHighlights: Record<SelectablePlanId, string[]> = {
  Starter: ["채팅 · 게시판 · 이메일 응대", "반복 문의 자동화", "월간 운영 리포트"],
  Basic: ["라이트 전체 포함", "교환 · 환불 · 클레임 운영", "격주 운영 리포트"],
  Pro: ["전화 채널 추가 운영", "CS 정책 설계 지원", "주간 운영 리포트"],
  Enterprise: ["전담 상담 매니저", "API · 시스템 연동", "정기 CX 운영 미팅"],
};

// 게이지 기준선: 가장 큰 정량 플랜(프로 1,000건)까지를 100%로 봅니다.
const gaugeMax = 1000;

const numberFormat = new Intl.NumberFormat("ko-KR");

function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(parsed)
    .replace(/\.$/, "");
}

function formatPeriod(start: string, end: string) {
  const startLabel = start.replace(/-/g, ". ");
  const endLabel = end.slice(5).replace(/-/g, ". ");
  return `${startLabel} – ${endLabel}`;
}

export function MypageSettings(props: Props) {
  const router = useRouter();
  const [active, setActive] = useState<MypageSection>(props.initialSection);
  const [profile, setProfile] = useState(props.customer);
  const [message, setMessage] = useState(
    props.cardNotice?.tone === "success" ? props.cardNotice.text : "",
  );
  const [error, setError] = useState(
    props.cardNotice?.tone === "error" ? props.cardNotice.text : "",
  );
  const [saving, setSaving] = useState(false);
  const [changingPlanId, setChangingPlanId] = useState<SelectablePlanId | null>(null);

  // 카드 등록 결과는 한 번만 보여 주고 주소에서 지웁니다.
  useEffect(() => {
    if (!props.cardNotice || typeof window === "undefined") return;
    window.history.replaceState(window.history.state, "", `/mypage?section=${props.initialSection}`);
  }, [props.cardNotice, props.initialSection]);

  const title = sectionTitles[active];
  const usage = props.usage;
  const currentPlan = props.plan;
  const gaugeWidth = Math.min(100, (usage.projectedBillableCount / gaugeMax) * 100);

  // 이미 예상 상담량을 감당하는 플랜을 쓰고 있으면 상위 플랜을 권하지 않습니다.
  const currentPlanCoversUsage =
    currentPlan.includedTickets > 0 &&
    usage.projectedBillableCount <= currentPlan.includedTickets;
  const recommendedPlan =
    usage.recommendedPlanId && !currentPlanCoversUsage
      ? selectablePlans.find((plan) => plan.id === usage.recommendedPlanId)
      : undefined;

  const menus: Array<{ id: MypageSection; label: string; badge: ReactNode }> = [
    { id: "profile", label: "고객 정보", badge: null },
    { id: "plan", label: "이용 플랜", badge: <span className="menu-badge">{currentPlan.label}</span> },
    {
      id: "members",
      label: "멤버 관리",
      badge: props.memberCount ? <span className="menu-count">{props.memberCount}</span> : null,
    },
  ];

  // 탭을 URL과 맞춰 둡니다. /mypage?section=plan 링크로 바로 들어올 수 있고,
  // 탭을 눌러도 다시 서버를 왕복하지 않습니다.
  function selectSection(next: MypageSection) {
    setActive(next);
    setMessage("");
    setError("");
    if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", `/mypage?section=${next}`);
    }
  }

  // 플랜 변경은 구독 정보를 바꿀 뿐, 이 호출이 즉시 결제를 일으키지는 않습니다.
  async function changePlan(planId: SelectablePlanId, label: string, monthlyFee: number) {
    setMessage("");
    setError("");
    if (monthlyFee > 0 && !props.paymentMethod) {
      setError("결제 수단을 먼저 등록해 주세요.");
      return;
    }
    const price = monthlyFee > 0 ? `월 ₩${numberFormat.format(monthlyFee)} (부가세 별도)` : "무료";
    if (!window.confirm(`${label} 플랜(${price})으로 변경할까요?`)) return;

    setChangingPlanId(planId);
    try {
      const response = await fetch("/api/mypage/plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        setError(result.error || "플랜을 변경하지 못했습니다.");
      } else {
        setMessage(result.message || "플랜을 변경했습니다.");
        router.refresh();
      }
    } catch {
      setError("네트워크 연결을 확인해 주세요.");
    } finally {
      setChangingPlanId(null);
    }
  }

  const signOut = async () => {
    await createClient().auth.signOut();
    router.replace("/");
    router.refresh();
  };

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/mypage/customer", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) setError(result.error || "고객 정보를 저장하지 못했습니다.");
      else setMessage(result.message || "고객 정보를 저장했습니다.");
    } catch {
      setError("네트워크 연결을 확인해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mypage-shell">
      <PortalRail active="account" workspaceName={profile.brandName} />

      <aside className="mypage-menu">
        <Link href="/dashboard" className="mypage-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          대시보드로 돌아가기
        </Link>

        <div className="mypage-workspace">
          <span aria-hidden="true">{profile.brandName.slice(0, 1) || "R"}</span>
          <div>
            <strong>{profile.brandName}</strong>
            <small>{props.roleLabel} · 워크스페이스</small>
          </div>
        </div>

        <p className="mypage-menu-label">설정</p>
        <nav className="mypage-menu-list" aria-label="설정 메뉴">
          {menus.map((menu) => (
            <button
              key={menu.id}
              type="button"
              className={active === menu.id ? "active" : ""}
              aria-current={active === menu.id ? "page" : undefined}
              onClick={() => selectSection(menu.id)}
            >
              <MenuIcon section={menu.id} />
              {menu.label}
              {menu.badge}
            </button>
          ))}
        </nav>

        <button type="button" className="mypage-logout" onClick={signOut}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
            <path d="M10 16l-4-4 4-4" />
            <path d="M6 12h10" />
          </svg>
          로그아웃
        </button>
      </aside>

      <main className="mypage-content">
        <header className="mypage-title">
          <div>
            <p>워크스페이스 설정</p>
            <h1>{title[0]}</h1>
            <span>{title[1]}</span>
          </div>
          <Link href="/contact" className="mypage-title-action">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
            </svg>
            운영 매니저 문의
          </Link>
        </header>

        {message ? <p className="mypage-message success" role="status">{message}</p> : null}
        {error ? <p className="mypage-message error" role="alert">{error}</p> : null}

        {active === "profile" ? (
          <form className="mypage-card profile-form" onSubmit={saveProfile}>
            <div className="mypage-card-head">
              <div>
                <h2>기본 정보</h2>
                <p>대시보드와 운영 문서에 표시되는 정보입니다.</p>
              </div>
              <span>{props.roleLabel}</span>
            </div>
            <div className="mypage-form-grid">
              {profileFields.map((field) => (
                <label key={field.key}>
                  <span>{field.label}{field.required ? " *" : ""}</span>
                  <input
                    type={field.key.toLowerCase().includes("email") ? "email" : "text"}
                    required={field.required}
                    placeholder={field.placeholder}
                    value={profile[field.key]}
                    disabled={!props.canManage}
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                  />
                </label>
              ))}
              <label>
                <span>로그인 이메일</span>
                <input value={props.loginEmail} disabled readOnly />
                <small>Google 계정 식별자는 이 화면에서 변경할 수 없습니다.</small>
              </label>
            </div>
            <div className="mypage-form-actions">
              <button type="submit" disabled={!props.canManage || saving}>
                {saving ? "저장 중..." : "변경사항 저장"}
              </button>
              {!props.canManage ? <p>owner 또는 admin만 수정할 수 있습니다.</p> : null}
            </div>
          </form>
        ) : null}

        {active === "plan" ? (
          <div className="plan-stack">
            <section className="mypage-card plan-hero">
              <div className="plan-hero-main">
                <div className="plan-chips">
                  <span className="chip chip-status"><i />이용 중</span>
                </div>
                <h2>{currentPlan.label} 플랜</h2>
                <p>
                  {currentPlan.planId
                    ? props.paymentMethod
                      ? `월 상담 ${numberFormat.format(currentPlan.includedTickets)}건까지 포함된 플랜입니다. 등록된 카드로 매월 결제됩니다.`
                      : `월 상담 ${numberFormat.format(currentPlan.includedTickets)}건까지 포함된 플랜입니다. 카드를 등록해야 다음 결제가 진행됩니다.`
                    : "지금은 Free 플랜으로 상담 응대와 리포트를 이용하고 있습니다. 카드를 등록하고 아래에서 플랜을 선택하면 바로 시작할 수 있습니다."}
                </p>
                <div className="plan-hero-actions">
                  <Link href="/contact" className="button-primary">
                    정식 플랜 상담 신청
                    {ArrowIcon}
                  </Link>
                  <a href="#plan-ladder" className="button-secondary">플랜 상세 비교</a>
                </div>
              </div>
              <dl className="info-rows">
                <div>
                  <dt>월 이용료</dt>
                  <dd className="strong">
                    ₩{numberFormat.format(currentPlan.monthlyFee)}
                    {currentPlan.monthlyFee > 0 ? <small> · 부가세 별도</small> : null}
                  </dd>
                </div>
                <div>
                  <dt>{currentPlan.nextBillingDate ? "다음 결제일" : "이용 시작일"}</dt>
                  <dd>{formatDate(currentPlan.nextBillingDate ?? props.startedAt)}</dd>
                </div>
                <div>
                  <dt>워크스페이스 멤버</dt>
                  <dd>{props.memberCount ? `${props.memberCount}명` : "-"}</dd>
                </div>
                <div>
                  <dt>결제 수단</dt>
                  <dd className={props.paymentMethod ? "" : "muted"}>
                    {props.paymentMethod ? cardLabel(props.paymentMethod) : "미등록"}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="mypage-card">
              <div className="mypage-card-head">
                <div>
                  <h2>이번 달 운영 현황</h2>
                  <p>플랜을 고를 때 기준이 되는 상담량입니다. 대시보드 집계와 같은 값입니다.</p>
                </div>
                <span className="chip chip-plain">{formatPeriod(usage.periodStart, usage.periodEnd)}</span>
              </div>

              {usage.hasData ? (
                <>
                  <div className="usage-grid">
                    <div className="usage-tile">
                      <p>처리한 상담</p>
                      <strong>{numberFormat.format(usage.handledCount)}<small>건</small></strong>
                    </div>
                    <div className="usage-tile">
                      <p>과금 기준 상담</p>
                      <strong>{numberFormat.format(usage.billableCount)}<small>건</small></strong>
                    </div>
                    <div className="usage-tile">
                      <p>이번 달 예상</p>
                      <strong>{numberFormat.format(usage.projectedBillableCount)}<small>건</small></strong>
                    </div>
                  </div>

                  <div className="usage-gauge">
                    <div className="usage-gauge-head">
                      <strong>
                        이번 달 예상 상담량 <b>{numberFormat.format(usage.projectedBillableCount)}건</b>
                      </strong>
                      <span>현재 속도 기준 월말 추정치</span>
                    </div>
                    <div className="gauge-track">
                      <div className="gauge-fill" style={{ width: `${gaugeWidth}%` }} />
                      <i className="gauge-tick" style={{ left: "20%" }} />
                      <i className="gauge-tick" style={{ left: "50%" }} />
                    </div>
                    <div className="gauge-scale">
                      <span>라이트 · 200건</span>
                      <span>베이직 · 500건</span>
                      <span>프로 · 1,000건</span>
                    </div>
                    {recommendedPlan ? (
                      <div className="usage-recommend">
                        <p>
                          지금 추세라면 <strong>{planLabels[recommendedPlan.id]} 플랜({recommendedPlan.description})</strong>이
                          적정 구간입니다.
                        </p>
                        <a href="#plan-ladder" className="button-ghost">
                          플랜 변경하기
                          {ArrowIcon}
                        </a>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="usage-empty">
                  <strong>아직 집계된 상담 데이터가 없습니다.</strong>
                  <p>채널을 연동하고 상담이 쌓이면 이번 달 상담량과 적정 플랜을 여기에서 안내드립니다.</p>
                  <Link href="/dashboard" className="button-secondary">대시보드에서 연동 상태 보기</Link>
                </div>
              )}
            </section>

            <section className="mypage-card" id="plan-ladder">
              <div className="mypage-card-head">
                <div>
                  <h2>플랜</h2>
                  <p>
                    {props.canManage
                      ? "상담량에 맞는 플랜을 직접 선택할 수 있습니다. 엔터프라이즈는 협의 후 적용됩니다."
                      : "플랜 변경은 owner 또는 admin만 할 수 있습니다."}
                  </p>
                </div>
              </div>

              <div className="plan-ladder">
                {selectablePlans.map((plan) => {
                  const isCurrent = plan.id === currentPlan.planId;
                  const recommended = !isCurrent && plan.id === recommendedPlan?.id;
                  const enterprise = plan.id === "Enterprise";
                  const selfService = selfServicePlanIds.includes(plan.id);
                  return (
                    <article
                      key={plan.id}
                      className={`plan-tier${isCurrent ? " current" : ""}${recommended ? " recommended" : ""}${enterprise ? " enterprise" : ""}`}
                    >
                      <div className="plan-tier-head">
                        <strong>{planLabels[plan.id]}</strong>
                        {isCurrent ? (
                          <span className="chip chip-purple small">이용 중</span>
                        ) : recommended ? (
                          <span className="chip chip-purple small">사용량 기준 추천</span>
                        ) : null}
                      </div>
                      <div className="plan-tier-price">
                        <b>{enterprise ? "별도 협의" : `₩${numberFormat.format(plan.monthlyFee)}`}</b>
                        <span>{enterprise ? "운영 범위에 맞춰 설계" : "/ 월 · 부가세 별도"}</span>
                      </div>
                      <span className="plan-tier-volume">{plan.description}</span>
                      <ul>
                        {planHighlights[plan.id].map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                      {isCurrent ? (
                        <span className="plan-tier-current">현재 이용 중인 플랜</span>
                      ) : selfService && props.canManage ? (
                        <button
                          type="button"
                          className={recommended ? "button-primary block" : "button-secondary block"}
                          disabled={changingPlanId !== null}
                          onClick={() =>
                            void changePlan(plan.id, planLabels[plan.id], plan.monthlyFee)
                          }
                        >
                          {changingPlanId === plan.id ? "변경 중..." : "이 플랜으로 변경"}
                        </button>
                      ) : (
                        <Link href="/contact" className="button-secondary block">
                          {enterprise ? "영업팀 문의" : "상담 신청"}
                        </Link>
                      )}
                    </article>
                  );
                })}
              </div>

              <p className="plan-note">
                모든 금액은 부가세 별도이며, 제공량을 초과한 상담은 건당 과금됩니다.
                {props.paymentMethod
                  ? " 변경한 플랜은 등록된 카드로 다음 결제일에 청구됩니다."
                  : " 유료 플랜으로 변경하려면 아래에서 카드를 먼저 등록해 주세요."}
              </p>
            </section>

            <section className="mypage-card">
              <div className="mypage-card-head">
                <div>
                  <h2>결제 · 청구 정보</h2>
                  <p>청구서 발송과 자동 결제에 사용합니다. 카드 번호는 토스페이먼츠 인증창에서만 입력하며, 이 화면에는 저장되지 않습니다.</p>
                </div>
              </div>
              <div className="info-rows boxed">
                <div>
                  <div>
                    <strong>청구 이메일</strong>
                    <small>{profile.billingEmail || "미등록 · 고객 연락 이메일로 발송됩니다."}</small>
                  </div>
                  <button type="button" className="button-secondary" onClick={() => selectSection("profile")}>
                    수정
                  </button>
                </div>
                <div>
                  <div>
                    <strong>사업자등록번호</strong>
                    <small>{profile.businessNumber || "미등록 · 세금계산서 발행에 필요합니다."}</small>
                  </div>
                  <button type="button" className="button-secondary" onClick={() => selectSection("profile")}>
                    수정
                  </button>
                </div>
                <PaymentMethodRow
                  paymentMethod={props.paymentMethod}
                  canManage={props.canManage}
                  clientKey={props.tossClientKey}
                  customerKey={props.customerKey}
                />
              </div>
            </section>

            <p className="plan-help">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.5.2-.7.6-.7 1.1v.5" />
                <path d="M12 17h.01" />
              </svg>
              <span>
                플랜이나 운영 범위가 고민되시면 <Link href="/contact">담당 매니저에게 문의</Link>해 주세요.
              </span>
            </p>
          </div>
        ) : null}

        {active === "members" ? <div className="embedded-settings"><MemberManagement /></div> : null}
      </main>
    </div>
  );
}
