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
    termsVersion: "plan-change-v1",
    vat: "excluded" as const,
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
  };
}
