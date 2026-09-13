export type RetryPolicy = {
  basis: "billing_date" | "previous_failure";
  days: number[];
};
export type BillingPolicy = {
  version: string;
  termsVersion: string;
  vat: "included" | "excluded";
  firstCharge: "registration" | "contract_date";
  retry: RetryPolicy;
  cardChangeArrears: "manual_approval";
  cancellationInstructions: string;
};
export function parsePolicy(value: unknown): BillingPolicy {
  const p = value as BillingPolicy;
  if (
    !p ||
    !p.version ||
    !p.termsVersion ||
    !["included", "excluded"].includes(p.vat) ||
    !["registration", "contract_date"].includes(p.firstCharge) ||
    p.cardChangeArrears !== "manual_approval" ||
    !p.cancellationInstructions ||
    !p.retry ||
    !["billing_date", "previous_failure"].includes(p.retry.basis) ||
    !Array.isArray(p.retry.days) ||
    p.retry.days.length > 10 ||
    p.retry.days.some(
      (n, i, a) =>
        !Number.isInteger(n) || n < 1 || n > 90 || (i > 0 && n <= a[i - 1]),
    )
  ) {
    throw new Error("BILLING_POLICY_NOT_CONFIRMED");
  }
  return p;
}
export function krw(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647)
    throw new Error("INVALID_KRW");
  return value;
}
export function invoiceAmount(
  monthlyFee: number,
  vat: BillingPolicy["vat"],
): number {
  krw(monthlyFee);
  // Never guess a VAT rounding rule: fractional VAT requires an explicitly agreed fee.
  return krw(vat === "included" ? monthlyFee : (monthlyFee * 11) / 10);
}
export function dateOnly(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new Error("INVALID_DATE");
  return value;
}
export function confirmedFirstChargeDate(
  firstCharge: BillingPolicy["firstCharge"],
  value: string | null,
): string | null {
  if (firstCharge === "contract_date" && !value)
    throw new Error("BILLING_POLICY_NOT_CONFIRMED");
  return value === null ? null : dateOnly(value);
}
export function cycleDate(year: number, month: number, anchor: number): string {
  if (!Number.isInteger(anchor) || anchor < 1 || anchor > 31)
    throw new Error("INVALID_ANCHOR");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1, Math.min(anchor, last)))
    .toISOString()
    .slice(0, 10);
}
export function nextCycle(billingDate: string, anchor: number): string {
  const d = new Date(`${dateOnly(billingDate)}T00:00:00Z`);
  return cycleDate(d.getUTCFullYear(), d.getUTCMonth() + 2, anchor);
}
export function addDays(date: string, days: number): string {
  const d = new Date(`${dateOnly(date)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function retryAt(
  policy: RetryPolicy,
  billingDate: string,
  failureAt: string,
  retryCount: number,
): string | null {
  const days = policy.days[retryCount];
  if (days === undefined) return null;
  if (policy.basis === "previous_failure")
    return new Date(
      new Date(failureAt).getTime() + days * 86400000,
    ).toISOString();
  const candidate = new Date(
    `${addDays(billingDate, days)}T00:00:00+09:00`,
  ).toISOString();
  // Missed windows never cause a burst of catch-up charges.
  return candidate > failureAt ? candidate : null;
}
export function seoulToday(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
export type FailureCategory =
  "retryable" | "action_required" | "configuration" | "unknown";
export function failureCategory(
  code: string,
  httpStatus: number,
): FailureCategory {
  if (
    httpStatus >= 500 ||
    httpStatus === 408 ||
    httpStatus === 409 ||
    httpStatus === 429
  )
    return "unknown";
  if (
    [
      "EXCEED_MAX_CARD_INSTALLMENT_PLAN",
      "INVALID_API_KEY",
      "UNAUTHORIZED_KEY",
      "FORBIDDEN_REQUEST",
      "NOT_SUPPORTED_METHOD",
    ].includes(code) ||
    [401, 403].includes(httpStatus)
  )
    return "configuration";
  if (
    [
      "INVALID_CARD_EXPIRATION",
      "INVALID_CARD_NUMBER",
      "INVALID_BILL_KEY",
      "NOT_FOUND_BILLING",
      "REJECT_CARD_PAYMENT",
    ].includes(code)
  )
    return "action_required";
  if (
    [
      "NOT_ENOUGH_BALANCE",
      "EXCEED_MAX_DAILY_PAYMENT_COUNT",
      "EXCEED_MAX_PAYMENT_AMOUNT",
    ].includes(code)
  )
    return "retryable";
  // Unmapped responses are never authority to submit a new charge.
  return "unknown";
}
export function safeFailureMessage(category: FailureCategory): string {
  return {
    retryable: "카드 승인이 거절되었습니다. 예정된 일정에 다시 시도합니다.",
    action_required: "결제수단을 확인하거나 카드를 변경해 주세요.",
    configuration: "결제 설정을 확인 중입니다. 담당자가 확인 후 안내드립니다.",
    unknown:
      "결제 결과를 확인 중입니다. 확인이 끝날 때까지 추가 결제하지 않습니다.",
  }[category];
}

// Provider issuer codes verified against https://docs.tosspayments.com/codes/org-codes
export function cardIssuerName(code: string): string {
  const issuers: Record<string, string> = {
    "3K": "기업 BC",
    "46": "광주은행",
    "71": "롯데카드",
    "30": "한국산업은행",
    "31": "BC카드",
    "51": "삼성카드",
    "38": "새마을금고",
    "41": "신한카드",
    "62": "신협",
    "36": "씨티카드",
    "33": "우리BC카드",
    W1: "우리카드",
    "37": "우체국예금보험",
    "39": "저축은행중앙회",
    "35": "전북은행",
    "42": "제주은행",
    "15": "카카오뱅크",
    "3A": "케이뱅크",
    "24": "토스뱅크",
    "21": "하나카드",
    "61": "현대카드",
    "11": "KB국민카드",
    "91": "NH농협카드",
    "34": "Sh수협은행",
  };
  return issuers[code] ?? "등록 카드";
}
