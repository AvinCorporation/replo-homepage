const BILLING_ERRORS: Record<string, { status: number; error: string }> = {
  BILLING_UNAUTHENTICATED: {
    status: 401,
    error: "로그인이 필요합니다.",
  },
  BILLING_FORBIDDEN: {
    status: 403,
    error: "결제 정보를 변경할 권한이 없습니다.",
  },
  BILLING_POLICY_NOT_CONFIRMED: {
    status: 409,
    error: "자동결제 조건이 아직 확정되지 않았습니다. 담당자에게 문의해 주세요.",
  },
  BILLING_CONSENT_CHANGED: {
    status: 409,
    error: "결제 조건이 변경되었습니다. 최신 조건을 확인하고 다시 동의해 주세요.",
  },
  BILLING_REGISTRATION_IN_PROGRESS: {
    status: 409,
    error: "진행 중인 카드 등록이 있습니다. 잠시 후 다시 시도해 주세요.",
  },
  BILLING_PAYMENT_METHOD_LIMIT: {
    status: 409,
    error: "주 카드와 백업 카드가 이미 등록되어 있습니다. 새 카드를 등록하려면 담당자에게 문의해 주세요.",
  },
  BILLING_PAYMENT_METHOD_NOT_AVAILABLE: {
    status: 409,
    error: "선택한 카드를 주 결제수단으로 변경할 수 없습니다. 결제수단을 다시 확인해 주세요.",
  },
  BILLING_PAYMENT_IN_PROGRESS: {
    status: 409,
    error: "확인 중인 결제가 있어 주 카드를 변경할 수 없습니다. 결제 결과가 반영된 뒤 다시 시도해 주세요.",
  },
  BILLING_PLAN_CHANGE_UNAVAILABLE: {
    status: 409,
    error:
      "현재 구독 상태에서는 요금제를 변경할 수 없습니다. 담당자에게 문의해 주세요.",
  },
  BILLING_PLAN_REQUIRES_QUOTE: {
    status: 409,
    error: "엔터프라이즈 요금제는 이용 범위와 금액을 담당자와 협의해 주세요.",
  },
  BILLING_PLAN_CONSENT_CHANGED: {
    status: 409,
    error: "요금제 조건이 변경되었습니다. 최신 조건을 확인하고 다시 동의해 주세요.",
  },
  BILLING_PLAN_ALREADY_ACTIVE: {
    status: 409,
    error: "현재 이용 중인 요금제입니다. 다른 요금제를 선택해 주세요.",
  },
  REGISTRATION_ALREADY_USED: {
    status: 409,
    error: "이미 처리된 카드 등록 요청입니다. 마이페이지에서 다시 시작해 주세요.",
  },
  INVALID_REGISTRATION: {
    status: 409,
    error: "카드 등록 요청이 만료되었거나 유효하지 않습니다. 다시 시작해 주세요.",
  },
  BILLING_REGISTRATION_FAILED: {
    status: 422,
    error: "카드 등록을 완료하지 못했습니다. 기존 결제수단은 유지됩니다.",
  },
  BILLING_PROVIDER_RESPONSE_INVALID: {
    status: 502,
    error:
      "카드사 응답을 확인하지 못했습니다. 기존 결제수단은 유지됩니다. 잠시 후 다시 시도해 주세요.",
  },
};

const BILLING_RPC_SQLSTATES: Record<string, string> = {
  RB403: "BILLING_FORBIDDEN",
  RB409: "BILLING_REGISTRATION_IN_PROGRESS",
  RB410: "INVALID_REGISTRATION",
  RB429: "BILLING_PAYMENT_METHOD_LIMIT",
  RB404: "BILLING_PAYMENT_METHOD_NOT_AVAILABLE",
  RB423: "BILLING_PAYMENT_IN_PROGRESS",
  RB424: "BILLING_PLAN_CHANGE_UNAVAILABLE",
  RB425: "BILLING_PLAN_REQUIRES_QUOTE",
  RB426: "BILLING_PLAN_CONSENT_CHANGED",
  RB427: "BILLING_PLAN_ALREADY_ACTIVE",
};

export function billingRpcErrorCode(sqlState: string | undefined) {
  return (sqlState && BILLING_RPC_SQLSTATES[sqlState]) ?? null;
}

export function billingErrorDetails(code: string) {
  const response = BILLING_ERRORS[code];
  if (response) return { code, ...response };
  return {
    code: "BILLING_SERVICE_UNAVAILABLE",
    status: 503,
    error: "결제 설정 또는 처리 상태를 확인해 주세요. 담당자 확인이 필요합니다.",
  };
}
