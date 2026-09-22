// 회원 탈퇴 자격 판정. 화면과 API가 같은 기준을 쓰도록 순수 함수로 분리합니다.
// (관리자 클라이언트를 쓰는 실행부는 execute.ts에 있습니다.)

export type WithdrawalContext = {
  // 워크스페이스에 남은 active owner가 본인뿐인지.
  isLastOwner: boolean;
  // 유료 요금제를 이용 중인지(Free는 false).
  hasPaidPlan: boolean;
  // 다음 달부터 적용되도록 예약해 둔 요금제 변경이 있는지.
  hasScheduledPlanChange: boolean;
  // 해지를 신청해 둔 상태인지(효력일 도래 여부는 상관없음).
  cancellationRequested: boolean;
  // 구독 상태. 미납(past_due)은 운영 확인이 필요합니다.
  subscriptionStatus: string | null;
};

export type WithdrawalBlock = {
  code:
    | "ACCOUNT_WITHDRAWAL_PAST_DUE"
    | "ACCOUNT_WITHDRAWAL_ACTIVE_PLAN"
    | "ACCOUNT_WITHDRAWAL_SCHEDULED_PLAN";
  message: string;
};

// 탈퇴를 막아야 하는 사유. 없으면 null.
//
// owner가 더 있는 워크스페이스라면 본인 멤버십만 정리하면 되므로 구독 상태와
// 무관하게 탈퇴할 수 있습니다. 마지막 owner는 탈퇴와 함께 워크스페이스가
// 종료되므로, 청구가 남아 있는 상태로는 나갈 수 없습니다.
export function withdrawalBlock(context: WithdrawalContext): WithdrawalBlock | null {
  if (!context.isLastOwner) return null;

  if (context.subscriptionStatus === "past_due") {
    return {
      code: "ACCOUNT_WITHDRAWAL_PAST_DUE",
      message:
        "결제가 완료되지 않은 청구가 있어 탈퇴할 수 없습니다. 담당 매니저에게 문의해 주세요.",
    };
  }
  if (context.hasPaidPlan && !context.cancellationRequested) {
    return {
      code: "ACCOUNT_WITHDRAWAL_ACTIVE_PLAN",
      message:
        "이용 중인 유료 요금제가 있습니다. 이용 플랜에서 구독 해지를 신청한 뒤 탈퇴할 수 있습니다.",
    };
  }
  if (context.hasScheduledPlanChange) {
    return {
      code: "ACCOUNT_WITHDRAWAL_SCHEDULED_PLAN",
      message:
        "예약된 요금제 변경이 있습니다. 이용 플랜에서 예약을 취소한 뒤 탈퇴할 수 있습니다.",
    };
  }
  return null;
}

// 탈퇴 계정의 users 행에 남길 값. 이메일은 not null이라 비울 수 없어, 다시
// 로그인에 쓰이지 않는 형태로 치환합니다.
export function anonymizedUserFields(userId: string) {
  return {
    name: null,
    email: `withdrawn-${userId.replace(/-/g, "").slice(0, 12)}@deleted.replo.invalid`,
    avatar_url: null,
    updated_at: new Date().toISOString(),
  };
}
