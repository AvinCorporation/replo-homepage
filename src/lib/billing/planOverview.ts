import "server-only";
import { calendarMonthRange } from "@/lib/dashboard/dates";
import {
  findSelectablePlan,
  planLabels,
  selectablePlans,
  type SelectablePlanId,
} from "@/lib/billing/plans";
import { createAdminClient } from "@/lib/supabase/admin";

export type PlanUsage = {
  periodStart: string;
  periodEnd: string;
  handledCount: number;
  billableCount: number;
  projectedBillableCount: number;
  recommendedPlanId: SelectablePlanId | null;
  hasData: boolean;
};

// 구독 행이 없거나 알 수 없는 plan_name이면 Free로 봅니다.
export type CurrentPlan = {
  planId: SelectablePlanId | null;
  label: string;
  monthlyFee: number;
  includedTickets: number;
  nextBillingDate: string | null;
  currentPeriodEnd: string | null;
  scheduledPlanId: SelectablePlanId | null;
  status: string;
};

export type PlanOverview = {
  usage: PlanUsage;
  plan: CurrentPlan;
  startedAt: string | null;
  memberCount: number;
};

const freePlan: CurrentPlan = {
  planId: null,
  label: "Free",
  monthlyFee: 0,
  includedTickets: 0,
  nextBillingDate: null,
  currentPeriodEnd: null,
  scheduledPlanId: null,
  status: "active",
};

function daysInMonth(dateKey: string) {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// 이번 달 예상 상담량에 맞는 가장 작은 플랜. 최상위 제공량을 넘으면 Enterprise.
export function recommendPlan(projectedCount: number): SelectablePlanId | null {
  if (projectedCount <= 0) return null;
  const fit = selectablePlans.find((plan) => projectedCount <= plan.includedTickets);
  return (fit ?? selectablePlans[selectablePlans.length - 1]).id;
}

const emptyUsage = (periodStart: string, periodEnd: string): PlanUsage => ({
  periodStart,
  periodEnd,
  handledCount: 0,
  billableCount: 0,
  projectedBillableCount: 0,
  recommendedPlanId: null,
  hasData: false,
});

// 이용 플랜 화면이 쓰는 값만 모읍니다. 집계 데이터가 없으면 빈 상태로 돌려주고
// 화면에서는 숫자 대신 안내 문구를 노출합니다(더미 수치를 만들지 않습니다).
export async function loadPlanOverview(workspaceId: string): Promise<PlanOverview> {
  const admin = createAdminClient();

  const workspaceResult = await admin
    .from("workspaces")
    .select("created_at, timezone")
    .eq("id", workspaceId)
    .maybeSingle();

  const timezone = (workspaceResult.data?.timezone as string | null) || "Asia/Seoul";
  const startedAt = (workspaceResult.data?.created_at as string | null) ?? null;
  const { start, end } = calendarMonthRange(timezone);

  const [metricsResult, memberResult, subscriptionResult] = await Promise.all([
    admin
      .from("daily_operation_metrics")
      .select("total_count, billable_count")
      .eq("workspace_id", workspaceId)
      .gte("date_key", start)
      .lte("date_key", end),
    admin
      .from("workspace_members")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "active"),
    admin
      .from("subscriptions")
      .select(
        "plan_name, monthly_fee, included_tickets, next_billing_date, current_period_end, scheduled_plan_name, status",
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const memberCount = memberResult.count ?? 0;
  const plan = toCurrentPlan(subscriptionResult.data as Record<string, unknown> | null);

  if (metricsResult.error || !metricsResult.data?.length) {
    return { usage: emptyUsage(start, end), plan, startedAt, memberCount };
  }

  const rows = metricsResult.data as Array<{
    total_count: number | string | null;
    billable_count: number | string | null;
  }>;
  const handledCount = rows.reduce((sum, row) => sum + Number(row.total_count ?? 0), 0);
  const billableCount = rows.reduce((sum, row) => sum + Number(row.billable_count ?? 0), 0);
  const elapsedDays = Math.max(1, Number(end.slice(8, 10)));
  const projectedBillableCount = Math.round((billableCount / elapsedDays) * daysInMonth(end));

  return {
    usage: {
      periodStart: start,
      periodEnd: end,
      handledCount,
      billableCount,
      projectedBillableCount,
      recommendedPlanId: recommendPlan(projectedBillableCount),
      hasData: handledCount > 0,
    },
    plan,
    startedAt,
    memberCount,
  };
}

function toCurrentPlan(row: Record<string, unknown> | null): CurrentPlan {
  if (!row) return freePlan;
  const status = (row.status as string | null) ?? "active";
  const plan = findSelectablePlan(row.plan_name);
  if (!plan || status === "canceled") return freePlan;

  const scheduled = findSelectablePlan(row.scheduled_plan_name);
  return {
    planId: plan.id,
    label: planLabels[plan.id],
    monthlyFee: Number(row.monthly_fee ?? plan.monthlyFee),
    includedTickets: Number(row.included_tickets ?? plan.includedTickets),
    nextBillingDate: (row.next_billing_date as string | null) ?? null,
    currentPeriodEnd: (row.current_period_end as string | null) ?? null,
    scheduledPlanId: scheduled?.id ?? null,
    status,
  };
}
