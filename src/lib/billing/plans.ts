export const selectablePlans = [
  {
    id: "Starter",
    label: "라이트",
    monthlyFee: 790000,
    includedTickets: 300,
    description: "월 상담 300건",
  },
  {
    id: "Basic",
    label: "Basic",
    monthlyFee: 1190000,
    includedTickets: 500,
    description: "월 상담 500건",
  },
  {
    id: "Pro",
    label: "Pro",
    monthlyFee: 1990000,
    includedTickets: 1000,
    description: "월 상담 1,000건",
  },
  {
    id: "Enterprise",
    label: "Enterprise",
    monthlyFee: 0,
    includedTickets: 2000,
    description: "월 상담 2,000건+ · 별도 협의",
  },
] as const;

export type SelectablePlanId = (typeof selectablePlans)[number]["id"];

// 화면과 안내 문구에 쓰는 한글 이름. 저장 값은 plan.id를 그대로 씁니다.
export const planLabels: Record<SelectablePlanId, string> = {
  Starter: "라이트",
  Basic: "베이직",
  Pro: "프로",
  Enterprise: "엔터프라이즈",
};

// 고객이 화면에서 직접 바꿀 수 있는 플랜. 엔터프라이즈는 협의가 필요합니다.
export const selfServicePlanIds: SelectablePlanId[] = ["Starter", "Basic", "Pro"];

export function findSelectablePlan(value: unknown) {
  return selectablePlans.find((plan) => plan.id === value);
}
