import { NextResponse } from "next/server";
import { loadPaymentMethod } from "@/lib/billing/paymentMethod";
import { findSelectablePlan, planLabels, selfServicePlanIds } from "@/lib/billing/plans";
import {
  BillingError,
  schedulePlanChange,
  startPaidPlan,
} from "@/lib/billing/subscriptionBilling";
import { canManageWorkspace, getCurrentWorkspaceAccess } from "@/lib/workspaces/access";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function formatDate(value: string | null) {
  if (!value) return "다음 결제일";
  const [, month, day] = value.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

export async function PATCH(request: Request) {
  const access = await getCurrentWorkspaceAccess();
  if (!access) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!canManageWorkspace(access)) {
    return NextResponse.json({ error: "플랜을 변경할 권한이 없습니다." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    planId?: string;
    cancelScheduled?: boolean;
  };

  // 예약된 플랜 변경 취소.
  if (body.cancelScheduled) {
    try {
      await schedulePlanChange({
        workspaceId: access.workspace.id,
        actorUserId: access.user.id,
        planId: null,
      });
      return NextResponse.json({ ok: true, message: "예약된 플랜 변경을 취소했습니다." });
    } catch (error) {
      const status = error instanceof BillingError ? error.status : 500;
      const message = error instanceof Error ? error.message : "취소하지 못했습니다.";
      return NextResponse.json({ error: message }, { status });
    }
  }

  const plan = findSelectablePlan(body.planId);
  if (!plan || !selfServicePlanIds.includes(plan.id)) {
    return NextResponse.json({ error: "선택할 수 없는 플랜입니다." }, { status: 400 });
  }

  const paymentMethod = await loadPaymentMethod(access.workspace.id);
  if (!paymentMethod) {
    return NextResponse.json({ error: "결제 수단을 먼저 등록해 주세요." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: subscription } = await admin
    .from("subscriptions")
    .select("plan_name, status, next_billing_date")
    .eq("workspace_id", access.workspace.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const currentPlan = findSelectablePlan(subscription?.plan_name);
  const onPaidPlan = Boolean(currentPlan && subscription?.status === "active");

  if (currentPlan?.id === plan.id) {
    return NextResponse.json({ error: "이미 이용 중인 플랜입니다." }, { status: 400 });
  }

  try {
    // 이미 유료 플랜을 쓰는 중이면 이번 기간은 그대로 두고 다음 결제일부터 바꿉니다.
    if (onPaidPlan) {
      const { effectiveOn } = await schedulePlanChange({
        workspaceId: access.workspace.id,
        actorUserId: access.user.id,
        planId: plan.id,
      });
      return NextResponse.json({
        ok: true,
        scheduled: true,
        message: `${formatDate(effectiveOn)}부터 ${planLabels[plan.id]} 플랜으로 변경됩니다.`,
      });
    }

    const charge = await startPaidPlan({
      workspaceId: access.workspace.id,
      actorUserId: access.user.id,
      planId: plan.id,
    });

    return NextResponse.json({
      ok: true,
      scheduled: false,
      charge,
      message: `${planLabels[plan.id]} 플랜을 시작했습니다.`,
    });
  } catch (error) {
    const status = error instanceof BillingError ? error.status : 500;
    const message = error instanceof Error ? error.message : "플랜을 변경하지 못했습니다.";
    return NextResponse.json({ error: message }, { status });
  }
}
