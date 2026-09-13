"use client";
import Script from "next/script";
import { useCallback, useEffect, useState } from "react";
import {
  invoiceAmount,
  parsePolicy,
  cardIssuerName,
  type BillingPolicy,
} from "@/lib/billing/toss/domain";
type Invoice = {
  id: string;
  amount: number;
  billing_date: string;
  period_start: string;
  period_end: string;
  status: string;
  next_attempt_at: string | null;
};
type Attempt = {
  id: string;
  invoice_id: string;
  status: string;
  failure_message: string | null;
  receipt_url: string | null;
  approved_at: string | null;
  created_at?: string;
};
type PaymentMethod = {
  id: string;
  masked_number: string;
  issuer_code: string;
  card_type: string;
  owner_type: string;
  status: string;
  is_default: boolean;
  registered_at: string | null;
};
type Summary = {
  canManage: boolean;
  subscription: {
    plan_name: string;
    monthly_fee: number | null;
    included_tickets: number | null;
    status: string;
    next_billing_date: string | null;
    billing_policy: BillingPolicy | null;
    enrollment_confirmed_at: string | null;
  } | null;
  paymentMethods: PaymentMethod[];
  invoices: Invoice[];
  attempts: Attempt[];
  cancellations: Array<{
    payment_attempt_id: string;
    cancel_amount: number;
    status: string;
  }>;
  nextInvoice: {
    amount: number;
    billing_date: string;
    next_attempt_at?: string | null;
    status?: string;
  } | null;
};
type Conditions = {
  policy: BillingPolicy;
  amount: number;
  cycle: string;
  firstChargeDate: string | null;
  billingAnchorDay: number;
};
type PlanChangeConditions = {
  termsVersion: string;
  fromPlan: string | null;
  planCode: string;
  planName: string;
  monthlyFee: number;
  includedTickets: number;
  vat: "excluded";
  vatAmount: number;
  totalAmount: number;
  effectiveOn: string;
};
type PlanOption = {
  code: string;
  name: string;
  monthlyFee: number | null;
  includedTickets: number;
  vat: "excluded";
  selfService: boolean;
  conditions: PlanChangeConditions | null;
};
type PlanData = {
  canManage: boolean;
  changeAvailable: boolean;
  currentPlan: {
    code: string | null;
    monthlyFee: number | null;
    includedTickets: number | null;
  };
  effectiveOn: string;
  plans: PlanOption[];
  pendingChange: {
    id: string;
    to_plan_code: string;
    to_monthly_fee: number;
    to_included_tickets: number;
    effective_on: string;
    status: "scheduled";
    agreed_at: string;
  } | null;
};
declare global {
  interface Window {
    TossPayments?: (key: string) => {
      payment: (input: { customerKey: string }) => {
        requestBillingAuth: (input: {
          method: "CARD";
          successUrl: string;
          failUrl: string;
        }) => Promise<void>;
      };
    };
  }
}
const won = (n: number | null) =>
  n === null ? "금액 확인 필요" : `${n.toLocaleString("ko-KR")}원`;
const statuses: Record<string, string> = {
  active: "이용 중",
  past_due: "미납 확인 필요",
  paused: "청구 중지",
  canceled: "취소",
  pending_payment_method: "카드 등록 필요",
  scheduled: "결제 예정",
  payment_pending: "재시도 예정",
  processing: "결과 확인 중",
  paid: "결제 완료",
  failed: "결제 실패",
};
export function BillingSettings() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [conditions, setConditions] = useState<Conditions | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [planData, setPlanData] = useState<PlanData | null>(null);
  const [planPanelOpen, setPlanPanelOpen] = useState(false);
  const [selectedPlanCode, setSelectedPlanCode] = useState("");
  const [planAgreed, setPlanAgreed] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [planMessage, setPlanMessage] = useState("");
  const loadSummary = useCallback(async () => {
    const response = await fetch("/api/billing/summary", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setData(result);
  }, []);
  const loadPlans = useCallback(async () => {
    const response = await fetch("/api/mypage/plan", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setPlanData(result);
    return result as PlanData;
  }, []);
  useEffect(() => {
    let mounted = true;
    loadSummary().catch(() => {
      if (mounted)
        setError(
          "결제 정보를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.",
        );
    });
    loadPlans().catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [loadPlans, loadSummary]);
  async function showPlanChange() {
    setPlanPanelOpen(true);
    setPlanBusy(true);
    setPlanAgreed(false);
    setPlanMessage("");
    setError("");
    try {
      await loadPlans();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "요금제 정보를 불러오지 못했습니다.",
      );
    } finally {
      setPlanBusy(false);
    }
  }
  async function schedulePlanChange() {
    const selected = planData?.plans.find(
      (plan) => plan.code === selectedPlanCode,
    );
    if (!selected?.conditions || !planAgreed) return;
    setPlanBusy(true);
    setPlanMessage("");
    setError("");
    try {
      const response = await fetch("/api/mypage/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agreed: true,
          planCode: selected.code,
          conditions: selected.conditions,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "요금제 변경을 예약하지 못했습니다.",
        );
      setPlanMessage(result.message);
      setPlanAgreed(false);
      setSelectedPlanCode("");
      await loadPlans();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "요금제 변경을 예약하지 못했습니다.",
      );
    } finally {
      setPlanBusy(false);
    }
  }
  async function showConditions() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/billing/registration", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setConditions(d);
      setAgreed(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "자동결제 조건을 확인하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function register() {
    if (!agreed || !conditions || !window.TossPayments) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/billing/registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agreed, conditions }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(
          typeof d.error === "string"
            ? d.error
            : "카드 등록 요청을 처리하지 못했습니다.",
        );
        return;
      }
      await window
        .TossPayments(d.clientKey)
        .payment({ customerKey: d.customerKey })
        .requestBillingAuth({
          method: "CARD",
          successUrl: d.successUrl,
          failUrl: d.failUrl,
        });
    } catch {
      setError(
        "카드 등록이 완료되지 않았습니다. 기존 결제수단은 유지됩니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function setPrimary(method: PaymentMethod) {
    setSwitchingId(method.id);
    setError("");
    try {
      const response = await fetch("/api/billing/payment-method/default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethodId: method.id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "주 결제수단을 변경하지 못했습니다.",
        );
      await loadSummary();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "주 결제수단을 변경하지 못했습니다.",
      );
    } finally {
      setSwitchingId(null);
    }
  }
  const s = data?.subscription;
  let expected: number | null = null;
  if (s?.billing_policy)
    try {
      if (s.monthly_fee !== null)
        expected = invoiceAmount(
          s.monthly_fee,
          parsePolicy(s.billing_policy).vat,
        );
    } catch {}
  const selectedPlan = planData?.plans.find(
    (plan) => plan.code === selectedPlanCode,
  );
  const currentPlanCode = s?.plan_name === "Starter" ? "Lite" : s?.plan_name;
  const currentPlanLabel =
    planData?.plans.find((plan) => plan.code === currentPlanCode)?.name ??
    s?.plan_name;
  return (
    <div className="billing-settings">
      {data?.canManage && (
        <Script
          src="https://js.tosspayments.com/v2/standard"
          onReady={() => setSdkReady(true)}
          onError={() => setError("카드 등록 창을 불러오지 못했습니다.")}
        />
      )}
      {error && (
        <p role="alert" className="mypage-message error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">결제 정보를 불러오는 중입니다.</p>}
      {data && (
        <>
          <section className="mypage-card">
            <div className="billing-section-head">
              <h2>이용 플랜</h2>
              {data.canManage && s ? (
                <button
                  type="button"
                  className="billing-secondary"
                  onClick={showPlanChange}
                  disabled={planBusy}
                >
                  요금제 변경
                </button>
              ) : null}
            </div>
            {s ? (
              <div className="current-plan-summary">
                <div>
                  <span>현재 플랜</span>
                  <strong>{currentPlanLabel}</strong>
                </div>
                <div>
                  <span>
                    월 기본 이용료
                    {s.billing_policy
                      ? ` · VAT ${s.billing_policy.vat === "included" ? "포함" : "별도"}`
                      : ""}
                  </span>
                  <strong>{won(s.monthly_fee)}</strong>
                </div>
                <div>
                  <span>포함 문의량</span>
                  <strong>
                    {s.included_tickets === null
                      ? "확인 필요"
                      : `${s.included_tickets.toLocaleString()}건`}
                  </strong>
                </div>
                <div>
                  <span>구독 상태</span>
                  <strong>{statuses[s.status] ?? s.status}</strong>
                </div>
              </div>
            ) : (
              <p>확정된 이용 플랜이 없습니다. 담당자에게 문의해 주세요.</p>
            )}
            {planData?.pendingChange ? (
              <p className="billing-plan-pending" role="status">
                <strong>
                  {planData.plans.find(
                    (plan) => plan.code === planData.pendingChange?.to_plan_code,
                  )?.name ?? planData.pendingChange.to_plan_code}
                </strong>{" "}
                요금제로
                변경 예약됨 · {planData.pendingChange.effective_on}부터 적용
              </p>
            ) : null}
            {planMessage ? (
              <p className="mypage-message success" role="status">
                {planMessage}
              </p>
            ) : null}
            {s && !data.canManage ? (
              <p className="billing-action-notice">
                요금제 변경은 소유자 또는 관리자에게 요청해 주세요.{" "}
                <a href="/mypage?section=members">멤버 확인</a>
              </p>
            ) : null}
            {planPanelOpen ? (
              <div className="billing-plan-change">
                <div className="billing-consent-head">
                  <div>
                    <h3>변경할 요금제 선택</h3>
                    <p>
                      선택한 요금제는 다음 달 1일부터 적용됩니다. 요금제 변경
                      동의는 카드 등록과 별도로 저장됩니다.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="billing-close"
                    onClick={() => {
                      setPlanPanelOpen(false);
                      setSelectedPlanCode("");
                      setPlanAgreed(false);
                    }}
                    disabled={planBusy}
                  >
                    닫기
                  </button>
                </div>
                {!planData && planBusy ? (
                  <div className="billing-plan-loading" role="status">
                    요금제를 불러오는 중입니다.
                  </div>
                ) : (
                  <div className="billing-plan-grid">
                    {planData?.plans.map((plan) => {
                      const current = plan.code === currentPlanCode;
                      const pending =
                        plan.code === planData.pendingChange?.to_plan_code;
                      const selected = plan.code === selectedPlanCode;
                      if (!plan.selfService)
                        return (
                          <article className="billing-plan-option enterprise" key={plan.code}>
                            <span>별도 협의</span>
                            <strong>{plan.name}</strong>
                            <b>맞춤 견적</b>
                            <small>
                              월 상담 {plan.includedTickets.toLocaleString()}건 이상
                            </small>
                            <a href="/contact">담당자와 상담</a>
                          </article>
                        );
                      return (
                        <button
                          type="button"
                          key={plan.code}
                          className={`billing-plan-option${selected ? " selected" : ""}`}
                          onClick={() => {
                            setSelectedPlanCode(plan.code);
                            setPlanAgreed(false);
                          }}
                          disabled={current || pending || planBusy}
                          aria-pressed={selected}
                        >
                          <span>
                            {current
                              ? "현재 이용 중"
                              : pending
                                ? "변경 예약됨"
                                : "선택"}
                          </span>
                          <strong>{plan.name}</strong>
                          <b>{won(plan.monthlyFee)}</b>
                          <small>
                            VAT 별도 · 월 상담{" "}
                            {plan.includedTickets.toLocaleString()}건
                          </small>
                        </button>
                      );
                    })}
                  </div>
                )}
                {selectedPlan?.conditions ? (
                  <div className="billing-plan-consent">
                    <h4>{selectedPlan.name} 요금제 변경 조건</h4>
                    <dl>
                      <div>
                        <dt>월 기본 이용료</dt>
                        <dd>{won(selectedPlan.conditions.monthlyFee)}</dd>
                      </div>
                      <div>
                        <dt>VAT 10%</dt>
                        <dd>{won(selectedPlan.conditions.vatAmount)}</dd>
                      </div>
                      <div>
                        <dt>월 청구액</dt>
                        <dd>{won(selectedPlan.conditions.totalAmount)}</dd>
                      </div>
                      <div>
                        <dt>적용일</dt>
                        <dd>{selectedPlan.conditions.effectiveOn}</dd>
                      </div>
                    </dl>
                    <p>
                      적용일부터 새로 생성되는 청구에 변경 요금이 반영됩니다.
                      이미 생성된 청구서는 변경되지 않으며 일할 계산은 하지 않습니다.
                    </p>
                    <label>
                      <input
                        type="checkbox"
                        checked={planAgreed}
                        onChange={(event) => setPlanAgreed(event.target.checked)}
                      />{" "}
                      위 요금제, 월 청구액, 적용일을 확인했으며 변경에 동의합니다.
                    </label>
                    <button
                      type="button"
                      className="billing-primary"
                      onClick={schedulePlanChange}
                      disabled={!planAgreed || planBusy}
                    >
                      {planBusy ? "예약 중…" : "다음 달 1일 변경 예약"}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
          <section className="mypage-card">
            <h2>다음 결제</h2>
            <div className="current-plan-summary">
              <div>
                <span>결제 예정일</span>
                <strong>
                  {(data.nextInvoice?.status === "processing"
                    ? "결제 결과 확인 중"
                    : data.nextInvoice?.next_attempt_at
                      ? new Date(
                          data.nextInvoice.next_attempt_at,
                        ).toLocaleDateString("ko-KR", {
                          timeZone: "Asia/Seoul",
                        })
                      : data.nextInvoice?.billing_date) ??
                    s?.next_billing_date ??
                    "미정"}
                </strong>
              </div>
              <div>
                <span>결제 예정금액 · VAT 포함</span>
                <strong>
                  {data.nextInvoice
                    ? won(data.nextInvoice.amount)
                    : expected !== null
                      ? won(expected)
                      : "청구 조건 확인 필요"}
                </strong>
              </div>
            </div>
          </section>
          <section className="mypage-card">
            <h2>결제수단</h2>
            {data.paymentMethods.length ? (
              <div className="billing-card-list">
                {data.paymentMethods.map((method) => (
                  <article className="billing-card-item" key={method.id}>
                    <div>
                      <span className={method.is_default ? "primary" : "backup"}>
                        {method.is_default ? "주 카드" : "백업 카드"}
                      </span>
                      <strong>
                        {cardIssuerName(method.issuer_code)} ·{" "}
                        {method.masked_number}
                      </strong>
                      <small>{method.card_type}</small>
                    </div>
                    {data.canManage && !method.is_default ? (
                      <button
                        type="button"
                        className="billing-secondary"
                        onClick={() => setPrimary(method)}
                        disabled={switchingId !== null || busy}
                      >
                        {switchingId === method.id
                          ? "변경 중…"
                          : "주 결제수단으로 변경"}
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <p>등록된 자동결제 카드가 없습니다.</p>
            )}
            <p className="billing-card-note">
              결제는 주 카드로만 진행됩니다. 백업 카드는 자동 승인에 사용되지
              않으며, 주 결제수단으로 변경한 뒤부터 사용됩니다.
            </p>
            {!s?.enrollment_confirmed_at ? (
              <p className="billing-action-notice">
                담당자 확인 후 자동결제를 시작할 수 있습니다.{" "}
                <a href="/contact">문의하기</a>
              </p>
            ) : data.canManage ? (
              data.paymentMethods.length < 2 ? (
                <button
                  className="billing-primary"
                  onClick={showConditions}
                  disabled={busy}
                >
                  {data.paymentMethods.length === 0
                    ? "주 카드 등록"
                    : "백업 카드 등록"}
                </button>
              ) : (
                <p className="billing-action-notice">
                  주 카드와 백업 카드가 모두 등록되어 있습니다. 새 카드 등록은{" "}
                  <a href="/contact">담당자에게 문의해 주세요.</a>
                </p>
              )
            ) : (
              <p className="billing-action-notice">
                카드 등록·변경은 소유자 또는 관리자에게 요청해 주세요.{" "}
                <a href="/mypage?section=members">멤버 확인</a>
              </p>
            )}
            {conditions && (
              <div className="billing-consent">
                <div className="billing-consent-head">
                  <h3>
                    {data.paymentMethods.length === 0
                      ? "주 카드 자동결제 조건 확인"
                      : "백업 카드 등록 조건 확인"}
                  </h3>
                  <button
                    type="button"
                    className="billing-close"
                    onClick={() => {
                      setConditions(null);
                      setAgreed(false);
                    }}
                    disabled={busy}
                  >
                    닫기
                  </button>
                </div>
                <p>월 청구금액: {won(conditions.amount)} (VAT 포함)</p>
                <p>
                  결제주기: 매월 {conditions.billingAnchorDay}일 · 해당 날짜가
                  없으면 말일
                </p>
                <p>
                  첫 결제:{" "}
                  {conditions.policy.firstCharge === "registration"
                    ? "카드 등록 후 첫 청구 작업 시"
                    : (conditions.firstChargeDate ?? "담당자 확인 필요")}
                </p>
                <p>
                  재시도:{" "}
                  {conditions.policy.retry.days.length
                    ? `${conditions.policy.retry.basis === "billing_date" ? "최초 청구일" : "직전 실패일"} 기준 ${conditions.policy.retry.days.join(", ")}일 후`
                    : "자동 재시도 없음"}
                </p>
                <p>
                  {data.paymentMethods.length === 0
                    ? "등록한 첫 카드는 주 결제수단이 됩니다."
                    : "새 카드는 백업으로 저장되며 기존 주 카드는 유지됩니다. 등록에 실패해도 기존 카드는 바뀌지 않습니다."}{" "}
                  기존 미납금 재결제는 별도 확인 후 진행합니다.
                </p>
                <p>해지 요청: {conditions.policy.cancellationInstructions}</p>
                <label>
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                  />{" "}
                  위 자동결제 조건에 동의합니다.
                </label>
                <button
                  className="billing-primary"
                  onClick={register}
                  disabled={!agreed || busy || !sdkReady}
                >
                  {busy
                    ? "처리 중…"
                    : !sdkReady
                      ? "결제 모듈 불러오는 중…"
                      : "동의하고 카드 인증"}
                </button>
              </div>
            )}
          </section>
          <section className="mypage-card">
            <h2>결제내역</h2>
            <p>최근 청구 50건 · 청구기간의 종료일은 다음 기간 시작일입니다.</p>
            {data.invoices.length === 0 ? (
              <p>결제내역이 없습니다.</p>
            ) : (
              <div
                className="billing-table-scroll"
                tabIndex={0}
                aria-label="청구 및 결제내역 표. 좁은 화면에서는 좌우로 스크롤할 수 있습니다."
              >
                <table>
                  <thead>
                    <tr>
                      <th>청구일 / 기간</th>
                      <th>금액</th>
                      <th>상태 / 재시도</th>
                      <th>영수증 / 취소</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.invoices.map((i) => {
                      const a = data.attempts.find(
                        (x) => x.invoice_id === i.id,
                      );
                      const cancels = data.cancellations
                        .filter(
                          (c) =>
                            c.payment_attempt_id === a?.id &&
                            c.status === "DONE",
                        )
                        .reduce((sum, c) => sum + c.cancel_amount, 0);
                      return (
                        <tr key={i.id}>
                          <td>
                            {i.billing_date}
                            <small>
                              {i.period_start} ~ {i.period_end}
                            </small>
                            {a?.approved_at && (
                              <small>
                                승인:{" "}
                                {new Date(a.approved_at).toLocaleString(
                                  "ko-KR",
                                  { timeZone: "Asia/Seoul" },
                                )}
                              </small>
                            )}
                          </td>
                          <td>{won(i.amount)}</td>
                          <td>
                            {statuses[i.status] ?? i.status}
                            {data.attempts.filter((x) => x.invoice_id === i.id)
                              .length > 1 && (
                              <details>
                                <summary>결제 시도 내역</summary>
                                {data.attempts
                                  .filter((x) => x.invoice_id === i.id)
                                  .map((item) => (
                                    <p key={item.id}>
                                      {item.approved_at || item.created_at
                                        ? new Date(
                                            item.approved_at ||
                                              item.created_at!,
                                          ).toLocaleString("ko-KR", {
                                            timeZone: "Asia/Seoul",
                                          })
                                        : ""}{" "}
                                      ·{" "}
                                      {item.status === "succeeded"
                                        ? "결제 성공"
                                        : item.status === "failed"
                                          ? "결제 실패"
                                          : "결과 확인 중"}
                                      {item.failure_message && (
                                        <small>{item.failure_message}</small>
                                      )}
                                    </p>
                                  ))}
                              </details>
                            )}
                            {a?.failure_message && (
                              <small>{a.failure_message}</small>
                            )}
                            {i.next_attempt_at &&
                              i.status === "payment_pending" && (
                                <small>
                                  재시도:{" "}
                                  {new Date(i.next_attempt_at).toLocaleString(
                                    "ko-KR",
                                    { timeZone: "Asia/Seoul" },
                                  )}
                                </small>
                              )}
                          </td>
                          <td>
                            {a?.receipt_url && (
                              <a
                                href={a.receipt_url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                영수증 보기
                              </a>
                            )}
                            {cancels > 0 && (
                              <small>
                                {cancels === i.amount
                                  ? "전액 취소"
                                  : "부분 취소"}{" "}
                                · {won(cancels)}
                              </small>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
