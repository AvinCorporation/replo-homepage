"use client";

import { useState } from "react";

export type PaymentMethodView = {
  id: string;
  cardCompany: string | null;
  maskedNumber: string | null;
  cardType: string | null;
  registeredAt: string | null;
  isDefault: boolean;
};

type Props = {
  paymentMethods: PaymentMethodView[];
  canManage: boolean;
  registrationReady: boolean;
};

type RegistrationConditions = {
  amount: number;
  cycle: "monthly";
  firstChargeDate: string;
  billingAnchorDay: number;
  policy: {
    cancellationInstructions: string;
    retry: { days: number[] };
  };
};

type TossPayment = {
  requestBillingAuth: (options: {
    method: "CARD";
    successUrl: string;
    failUrl: string;
  }) => Promise<void>;
};

declare global {
  interface Window {
    TossPayments?: (clientKey: string) => {
      payment: (options: { customerKey: string }) => TossPayment;
    };
  }
}

const SDK_SRC = "https://js.tosspayments.com/v2/standard";

function loadTossSdk() {
  return new Promise<void>((resolve, reject) => {
    if (window.TossPayments) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SDK_SRC}"]`,
    );
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("sdk_load_failed")),
      { once: true },
    );
    if (!existing) {
      script.src = SDK_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

export function cardLabel(method: PaymentMethodView) {
  const company = method.cardCompany?.trim();
  const number = method.maskedNumber?.trim();
  if (company && number) return `${company} ${number}`;
  return number || company || "등록된 카드";
}

export function PaymentMethodRow(props: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conditions, setConditions] =
    useState<RegistrationConditions | null>(null);
  const [agreed, setAgreed] = useState(false);
  const method = props.paymentMethods.find((item) => item.isDefault) ?? props.paymentMethods[0] ?? null;

  async function makePrimary(paymentMethodId: string) {
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/billing/payment-method/default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethodId }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error || "주 카드를 변경하지 못했습니다.");
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "주 카드를 변경하지 못했습니다.");
      setPending(false);
    }
  }

  async function showConditions() {
    setError("");
    if (!props.registrationReady) {
      setError("먼저 사용할 유료 요금제를 선택해 주세요. 신청 후 카드를 등록할 수 있어요.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/billing/registration", {
        cache: "no-store",
      });
      const result = (await response.json().catch(() => ({}))) as
        | RegistrationConditions
        | { error?: string };
      if (!response.ok || !("amount" in result)) {
        throw new Error(
          "error" in result && result.error
            ? result.error
            : "카드 등록 정보를 불러오지 못했습니다.",
        );
      }
      setConditions(result);
      setAgreed(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "카드 등록 정보를 불러오지 못했습니다.",
      );
    } finally {
      setPending(false);
    }
  }

  async function registerCard() {
    if (!conditions || !agreed) return;
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/billing/registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agreed: true, conditions }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        clientKey?: string;
        customerKey?: string;
        successUrl?: string;
        failUrl?: string;
        error?: string;
      };
      if (
        !response.ok ||
        !result.clientKey ||
        !result.customerKey ||
        !result.successUrl ||
        !result.failUrl
      ) {
        throw new Error(result.error || "카드 등록을 시작하지 못했습니다.");
      }

      await loadTossSdk();
      const toss = window.TossPayments?.(result.clientKey);
      if (!toss) throw new Error("결제 모듈을 불러오지 못했습니다.");
      await toss
        .payment({ customerKey: result.customerKey })
        .requestBillingAuth({
          method: "CARD",
          successUrl: result.successUrl,
          failUrl: result.failUrl,
        });
    } catch (caught) {
      const code = (caught as { code?: string } | null)?.code;
      if (code !== "USER_CANCEL") {
        setError(
          caught instanceof Error
            ? caught.message
            : "카드 등록 창을 열지 못했습니다. 잠시 후 다시 시도해 주세요.",
        );
      }
      setPending(false);
    }
  }

  return (
    <div className="payment-method-row">
      <div>
        <strong>결제 수단</strong>
        {error ? (
          <small className="danger">{error}</small>
        ) : props.paymentMethods.length ? (
          <div className="payment-card-list">
            {props.paymentMethods.map((item) => (
              <small key={item.id}>
                <span>{item.isDefault ? "주 카드" : "백업 카드"}</span>
                {cardLabel(item)}{item.cardType ? ` · ${item.cardType}` : ""}
                {!item.isDefault && props.canManage ? (
                  <button type="button" onClick={() => void makePrimary(item.id)} disabled={pending}>
                    주 카드로 변경
                  </button>
                ) : null}
              </small>
            ))}
          </div>
        ) : (
          <small>카드를 등록하면 플랜 시작일부터 자동결제돼요.</small>
        )}
      </div>

      {props.canManage && props.paymentMethods.length < 2 ? (
        <button
          type="button"
          className={method ? "button-secondary" : "button-primary compact"}
          onClick={showConditions}
          disabled={pending}
        >
          {pending ? "확인 중..." : method ? "백업 카드 등록" : "카드 등록"}
        </button>
      ) : !props.canManage ? (
        <span className="pill-disabled">소유자·관리자만 변경</span>
      ) : null}

      {conditions ? (
        <div
          className="payment-consent"
          role="group"
          aria-label="카드 등록 조건"
        >
          <strong>카드 등록 전 확인해 주세요</strong>
          <p>
            {conditions.firstChargeDate}부터 매월{" "}
            {conditions.billingAnchorDay}일에{" "}
            {conditions.amount.toLocaleString("ko-KR")}원이 결제돼요.
          </p>
          <p>
            결제 실패 시{" "}
            {conditions.policy.retry.days.length
              ? `${conditions.policy.retry.days.join(", ")}일 뒤 다시 시도해요.`
              : "자동으로 다시 결제하지 않아요."}
          </p>
          <p>해지 문의: {conditions.policy.cancellationInstructions}</p>
          <label>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
            />{" "}
            결제 금액과 시작일을 확인하고 카드 등록에 동의합니다.
          </label>
          <div className="payment-consent-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                setConditions(null);
                setAgreed(false);
              }}
              disabled={pending}
            >
              취소
            </button>
            <button
              type="button"
              className="button-primary"
              onClick={registerCard}
              disabled={!agreed || pending}
            >
              {pending ? "여는 중..." : "동의하고 카드 등록"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
