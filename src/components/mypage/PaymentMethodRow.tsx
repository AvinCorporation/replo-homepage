"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type PaymentMethodView = {
  cardCompany: string | null;
  maskedNumber: string | null;
  cardType: string | null;
  registeredAt: string | null;
};

type Props = {
  paymentMethod: PaymentMethodView | null;
  canManage: boolean;
  clientKey: string;
  customerKey: string;
};

type TossInstance = {
  requestBillingAuth: (
    method: string,
    options: { customerKey: string; successUrl: string; failUrl: string },
  ) => Promise<void>;
};

declare global {
  interface Window {
    TossPayments?: (clientKey: string) => TossInstance;
  }
}

const SDK_SRC = "https://js.tosspayments.com/v1/payment";

function loadTossSdk() {
  return new Promise<void>((resolve, reject) => {
    if (window.TossPayments) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_SRC}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("sdk_load_failed")));
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
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const method = props.paymentMethod;
  const configured = Boolean(props.clientKey);

  // 카드 번호는 토스 인증창에서만 입력받습니다. 이 화면은 창을 열어줄 뿐입니다.
  async function openCardWindow() {
    setError("");
    setPending(true);
    try {
      await loadTossSdk();
      const toss = window.TossPayments?.(props.clientKey);
      if (!toss) throw new Error("sdk_missing");
      const origin = window.location.origin;
      await toss.requestBillingAuth("카드", {
        customerKey: props.customerKey,
        successUrl: `${origin}/api/billing/card/success`,
        failUrl: `${origin}/api/billing/card/fail`,
      });
    } catch (caught) {
      const code = (caught as { code?: string } | null)?.code;
      if (code !== "USER_CANCEL") {
        setError("카드 등록 창을 열지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
      setPending(false);
    }
  }

  async function removeCard() {
    if (!window.confirm("등록된 카드를 삭제할까요? 다음 결제가 진행되지 않습니다.")) return;
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/billing/card", { method: "DELETE" });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) setError(result.error || "카드를 삭제하지 못했습니다.");
      else router.refresh();
    } catch {
      setError("네트워크 연결을 확인해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <div>
        <strong>결제 수단</strong>
        {error ? (
          <small className="danger">{error}</small>
        ) : method ? (
          <small>{cardLabel(method)}{method.cardType ? ` · ${method.cardType}` : ""}</small>
        ) : (
          <small>
            {configured
              ? "카드를 등록하면 플랜 시작일에 자동으로 결제됩니다."
              : "결제 연동 준비 중입니다. 잠시 후 다시 확인해 주세요."}
          </small>
        )}
      </div>

      {!props.canManage ? (
        <span className="pill-disabled">owner · admin만 변경</span>
      ) : !configured ? (
        <span className="pill-disabled">준비 중</span>
      ) : method ? (
        <div className="row-actions">
          <button type="button" className="button-secondary" onClick={openCardWindow} disabled={pending}>
            카드 변경
          </button>
          <button type="button" className="button-danger" onClick={removeCard} disabled={pending}>
            삭제
          </button>
        </div>
      ) : (
        <button type="button" className="button-primary compact" onClick={openCardWindow} disabled={pending}>
          {pending ? "여는 중..." : "카드 등록"}
        </button>
      )}
    </div>
  );
}
