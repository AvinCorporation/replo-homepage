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
