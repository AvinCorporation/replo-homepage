"use client";
import Script from "next/script";
import { useEffect, useState } from "react";
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
type Summary = {
  canManage: boolean;
  subscription: {
    plan_name: string;
    monthly_fee: number | null;
    included_tickets: number | null;
    status: string;
    next_billing_date: string | null;
    billing_policy: BillingPolicy | null;
  } | null;
  paymentMethod: {
    masked_number: string;
    issuer_code: string;
    card_type: string;
    status: string;
  } | null;
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
  const [sdkReady, setSdkReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    fetch("/api/billing/summary", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        if (mounted) setData(d);
      })
      .catch(() => {
        if (mounted)
          setError(
            "결제 정보를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.",
          );
      });
    return () => {
      mounted = false;
    };
  }, []);
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
            <h2>이용 플랜</h2>
            {s ? (
              <div className="current-plan-summary">
                <div>
                  <span>현재 플랜</span>
                  <strong>{s.plan_name}</strong>
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
            <p>
              {data.paymentMethod
                ? `${cardIssuerName(data.paymentMethod.issuer_code)} · ${data.paymentMethod.masked_number} · ${data.paymentMethod.card_type} · 등록됨`
                : "등록된 자동결제 카드가 없습니다."}
            </p>
            {data.canManage ? (
              <button
                className="billing-primary"
                onClick={showConditions}
                disabled={busy}
              >
                {data.paymentMethod ? "카드 변경" : "카드 등록"}
              </button>
            ) : (
              <p>카드 등록·변경은 소유자 또는 관리자에게 요청해 주세요.</p>
            )}
            {conditions && (
              <div className="billing-consent">
                <h3>자동결제 조건 확인</h3>
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
                  카드 변경: 이 화면에서 변경할 수 있습니다. 기존 미납금
                  재결제는 별도 확인 후 진행합니다.
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
                  {busy ? "처리 중…" : "동의하고 카드 인증"}
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
