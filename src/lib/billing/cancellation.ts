import { seoulToday } from "./toss/domain.ts";
import { nextPlanEffectiveOn } from "./planChanges.ts";

// 해지 효력일 = 이미 결제한 이용기간이 끝나는 날(=다음 청구일). 그 날부터 청구서를
// 만들지 않습니다(`subscriptions.invoice_stop_date`). 다음 청구일이 없거나 이미
// 지났으면 다음 달 1일을 씁니다. 청구 기준일과 첫 결제일이 모두 1일이기 때문입니다.
export function cancellationEffectiveOn(
  nextBillingDate: string | null,
  today = seoulToday(),
): string {
  if (nextBillingDate && nextBillingDate > today) return nextBillingDate;
  // `today`는 한국 날짜이므로, 같은 한국 날짜로 해석되는 시각을 넘겨 다음 달 1일을
  // 구합니다(nextPlanEffectiveOn이 내부에서 다시 +9시간 합니다).
  return nextPlanEffectiveOn(new Date(`${today}T00:00:00Z`));
}

export type CancellationState = {
  requestedAt: string | null;
  effectiveOn: string | null;
};

export function readCancellationState(
  row: Record<string, unknown> | null,
): CancellationState {
  return {
    requestedAt: (row?.cancellation_requested_at as string | null) ?? null,
    effectiveOn: (row?.cancellation_effective_at as string | null) ?? null,
  };
}

// 해지를 신청했고 아직 효력일이 오지 않은 상태. 효력일까지는 서비스를 그대로
// 이용하고, 그 뒤로는 청구가 없습니다.
export function isCancellationPending(
  state: CancellationState,
  today = seoulToday(),
) {
  return Boolean(state.requestedAt && state.effectiveOn && state.effectiveOn > today);
}

// 해지가 이미 끝난(효력일이 지난) 구독인지.
export function isCancellationComplete(
  state: CancellationState,
  today = seoulToday(),
) {
  return Boolean(state.requestedAt && state.effectiveOn && state.effectiveOn <= today);
}
