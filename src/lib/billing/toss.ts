import "server-only";

const TOSS_API_BASE = "https://api.tosspayments.com/v1";

export class TossError extends Error {
  code: string | null;

  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "TossError";
    this.code = code;
  }
}

function secretKey() {
  const key = process.env.TOSS_SECRET_KEY;
  if (!key) throw new TossError("결제 연동이 아직 설정되지 않았습니다.", "not_configured");
  return key;
}

/**
 * 인증창을 여는 클라이언트 키. 공개되는 값이지만 서버 컴포넌트에서 읽어
 * props로 내려 주므로 NEXT_PUBLIC_ 접두어가 필수는 아닙니다.
 * TOSS_CLIENT_KEY를 먼저 보고, 없으면 NEXT_PUBLIC_ 쪽을 씁니다.
 */
export function tossClientKey() {
  return process.env.TOSS_CLIENT_KEY || process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY || "";
}

export function isTossConfigured() {
  return Boolean(process.env.TOSS_SECRET_KEY && tossClientKey());
}

// 토스 customerKey. 워크스페이스당 하나로 고정해, 돌아온 리다이렉트가
// 로그인한 워크스페이스의 것인지 대조할 수 있게 합니다.
export function workspaceCustomerKey(workspaceId: string) {
  return `ws_${workspaceId}`;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export type TossBillingAuth = {
  billingKey: string;
  customerKey: string;
  cardCompany: string | null;
  maskedNumber: string | null;
  cardType: string | null;
  ownerType: string | null;
};

// 인증창이 돌려준 authKey를 빌링키로 교환합니다. 카드 실번호는 이 응답에도
// 들어오지 않고, 마스킹된 번호만 옵니다.
export async function issueBillingKey(input: {
  authKey: string;
  customerKey: string;
}): Promise<TossBillingAuth> {
  const authorization = Buffer.from(`${secretKey()}:`).toString("base64");
  const response = await fetch(`${TOSS_API_BASE}/billing/authorizations/issue`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ authKey: input.authKey, customerKey: input.customerKey }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new TossError(
      text(payload.message) ?? "카드를 등록하지 못했습니다.",
      text(payload.code),
    );
  }

  const billingKey = text(payload.billingKey);
  if (!billingKey) throw new TossError("카드를 등록하지 못했습니다.", "missing_billing_key");

  const card = (payload.card ?? {}) as Record<string, unknown>;
  return {
    billingKey,
    customerKey: text(payload.customerKey) ?? input.customerKey,
    cardCompany: text(payload.cardCompany) ?? text(card.issuerCode),
    maskedNumber: text(card.number),
    cardType: text(card.cardType),
    ownerType: text(card.ownerType),
  };
}

export type TossCharge = {
  paymentKey: string | null;
  orderId: string;
  status: string | null;
  approvedAt: string | null;
};

// 빌링키로 실제 결제를 실행합니다. orderId는 워크스페이스·플랜·기간으로
// 결정되는 값이라, 같은 기간을 두 번 청구하면 토스가 중복으로 거절합니다.
export async function chargeBillingKey(input: {
  billingKey: string;
  customerKey: string;
  amount: number;
  orderId: string;
  orderName: string;
}): Promise<TossCharge> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new TossError("결제 금액이 올바르지 않습니다.", "invalid_amount");
  }

  const authorization = Buffer.from(`${secretKey()}:`).toString("base64");
  const response = await fetch(`${TOSS_API_BASE}/billing/${encodeURIComponent(input.billingKey)}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.orderId,
    },
    body: JSON.stringify({
      customerKey: input.customerKey,
      amount: input.amount,
      orderId: input.orderId,
      orderName: input.orderName,
    }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new TossError(text(payload.message) ?? "결제에 실패했습니다.", text(payload.code));
  }

  return {
    paymentKey: text(payload.paymentKey),
    orderId: text(payload.orderId) ?? input.orderId,
    status: text(payload.status),
    approvedAt: text(payload.approvedAt),
  };
}
