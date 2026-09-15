import "server-only";
import { calendarMonthRange } from "@/lib/dashboard/dates";
import { selectablePlans, type SelectablePlanId } from "@/lib/billing/plans";
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

export type PlanOverview = {
  usage: PlanUsage;
  startedAt: string | null;
  memberCount: number;
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

  const [metricsResult, memberResult] = await Promise.all([
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
  ]);

  const memberCount = memberResult.count ?? 0;
  if (metricsResult.error || !metricsResult.data?.length) {
    return { usage: emptyUsage(start, end), startedAt, memberCount };
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
    startedAt,
    memberCount,
  };
}
