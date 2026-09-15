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

export function isTossConfigured() {
  return Boolean(process.env.TOSS_SECRET_KEY && process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY);
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
