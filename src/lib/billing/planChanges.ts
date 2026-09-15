import { invoiceAmount } from "./toss/domain.ts";

export type PlanChangePlan = {
  code: string;
  displayName: string;
  monthlyFee: number;
  includedTickets: number;
};

export function nextPlanEffectiveOn(now = new Date()): string {
  const korea = new Date(now.getTime() + 9 * 60 * 60_000);
  return new Date(
    Date.UTC(korea.getUTCFullYear(), korea.getUTCMonth() + 1, 1),
  )
    .toISOString()
    .slice(0, 10);
}

export function planChangePolicy() {
  return {
    version: "self-service-plan-v1",
    termsVersion: "plan-change-v2",
    vat: "excluded" as const,
    firstCharge: "contract_date" as const,
    retry: { basis: "billing_date" as const, days: [] as number[] },
    cardChangeArrears: "manual_approval" as const,
    cancellationInstructions: "마이페이지 문의하기를 통해 요청",
  };
}

export function planChangeConditions(input: {
  fromPlan: string | null;
  plan: PlanChangePlan;
  policy: ReturnType<typeof planChangePolicy>;
  effectiveOn: string;
}) {
  const totalAmount = invoiceAmount(input.plan.monthlyFee, "excluded");
  return {
    termsVersion: input.policy.termsVersion,
    fromPlan: input.fromPlan,
    planCode: input.plan.code,
    planName: input.plan.displayName,
    monthlyFee: input.plan.monthlyFee,
    includedTickets: input.plan.includedTickets,
    vat: "excluded" as const,
    vatAmount: totalAmount - input.plan.monthlyFee,
    totalAmount,
    effectiveOn: input.effectiveOn,
    billingCycle: "monthly" as const,
    billingAnchorDay: 1,
    firstChargeDate: input.effectiveOn,
    automaticPayment: true,
  };
}
