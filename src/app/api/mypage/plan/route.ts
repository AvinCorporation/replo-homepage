import { NextResponse } from "next/server";
import { planChangeConditions, planChangePolicy, nextPlanEffectiveOn } from "@/lib/billing/planChanges";
import { findSelectablePlan, planLabels, selfServicePlanIds } from "@/lib/billing/plans";
import { billingAdmin, billingAccess, checkOrigin, errorResponse, rpc } from "@/lib/billing/toss/server";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    checkOrigin(request);
    const access = await billingAccess(undefined, true);
    const body = (await request.json().catch(() => ({}))) as {
      planId?: string;
      agreed?: boolean;
      cancelScheduled?: boolean;
    };
    const admin = billingAdmin();

    let { data: subscription, error: subscriptionError } = await admin
      .from("subscriptions")
      .select("id,plan_name,monthly_fee,included_tickets,status")
      .eq("workspace_id", access.workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subscriptionError) throw new Error("BILLING_DATABASE_ERROR");

    if (!subscription) {
      const created = await admin
        .from("subscriptions")
        .insert({
          workspace_id: access.workspaceId,
          plan_name: "Free",
          monthly_fee: 0,
          included_tickets: 0,
          status: "active",
        })
        .select("id,plan_name,monthly_fee,included_tickets,status")
        .single();
      if (created.error || !created.data) throw new Error("BILLING_DATABASE_ERROR");
      subscription = created.data;
    }

    if (body.cancelScheduled) {
      const { data: canceled, error } = await admin
        .from("subscription_plan_changes")
        .update({
          status: "canceled",
          canceled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", access.workspaceId)
        .eq("subscription_id", subscription.id)
        .eq("status", "scheduled")
        .select("id");
      if (error) throw new Error("BILLING_DATABASE_ERROR");
      return NextResponse.json({
        ok: true,
        message: canceled?.length
          ? "예약된 요금제 변경을 취소했습니다."
          : "취소할 요금제 변경이 없습니다.",
      });
    }

    if (body.agreed !== true) {
      return NextResponse.json(
        { error: "요금과 다음 달 시작일을 확인해 주세요." },
        { status: 400 },
      );
    }

    const plan = findSelectablePlan(body.planId);
    if (!plan || !selfServicePlanIds.includes(plan.id)) {
      return NextResponse.json(
        { error: "선택할 수 없는 요금제입니다." },
        { status: 400 },
      );
    }

    const policy = planChangePolicy();
    const effectiveOn = nextPlanEffectiveOn();
    const billingPlanCode = plan.id === "Starter" ? "Lite" : plan.id;
    const conditions = planChangeConditions({
      fromPlan: subscription.plan_name,
      plan: {
        code: billingPlanCode,
        displayName: planLabels[plan.id],
        monthlyFee: plan.monthlyFee,
        includedTickets: plan.includedTickets,
      },
      policy,
      effectiveOn,
    });

    await rpc<string>("billing_schedule_plan_change", {
      p_workspace: access.workspaceId,
      p_subscription: subscription.id,
      p_user: access.userId,
      p_plan_code: billingPlanCode,
      p_expected_effective_on: effectiveOn,
      p_policy: policy,
      p_conditions: conditions,
    });

    return NextResponse.json({
      ok: true,
      scheduled: true,
      effectiveOn,
      message: `${planLabels[plan.id]} 요금제가 ${effectiveOn}부터 시작됩니다. 카드가 없다면 아래에서 등록해 주세요.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
