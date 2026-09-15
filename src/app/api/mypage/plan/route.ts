import { NextResponse } from "next/server";
import { loadPaymentMethod } from "@/lib/billing/paymentMethod";
import { findSelectablePlan, planLabels } from "@/lib/billing/plans";
import { canManageWorkspace, getCurrentWorkspaceAccess } from "@/lib/workspaces/access";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(request: Request) {
  const access = await getCurrentWorkspaceAccess();
  if (!access) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!canManageWorkspace(access)) {
    return NextResponse.json({ error: "플랜을 변경할 권한이 없습니다." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { planId?: string };
  const plan = findSelectablePlan(body.planId);
  if (!plan) {
    return NextResponse.json({ error: "선택할 수 없는 플랜입니다." }, { status: 400 });
  }

  // 유료 플랜은 등록된 카드가 있어야 결제가 가능합니다.
  if (plan.monthlyFee > 0) {
    const paymentMethod = await loadPaymentMethod(access.workspace.id);
    if (!paymentMethod) {
      return NextResponse.json(
        { error: "결제 수단을 먼저 등록해 주세요." },
        { status: 400 },
      );
    }
  }

  const admin = createAdminClient();
  const { data: subscription } = await admin
    .from("subscriptions")
    .select("id, plan_name")
    .eq("workspace_id", access.workspace.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const subscriptionValues = {
    plan_name: plan.id,
    monthly_fee: plan.monthlyFee,
    included_tickets: plan.includedTickets,
    status: "active",
  };
  const subscriptionResult = subscription
    ? await admin.from("subscriptions").update(subscriptionValues).eq("id", subscription.id)
    : await admin.from("subscriptions").insert({
        workspace_id: access.workspace.id,
        ...subscriptionValues,
      });
  if (subscriptionResult.error) {
    return NextResponse.json({ error: "플랜을 저장하지 못했습니다." }, { status: 500 });
  }

  const now = new Date().toISOString();
  await Promise.all([
    admin
      .from("workspaces")
      .update({ status: "active", updated_at: now })
      .eq("id", access.workspace.id),
    admin.from("audit_logs").insert({
      workspace_id: access.workspace.id,
      actor_user_id: access.user.id,
      action: "subscription.plan_updated",
      target_type: "subscription",
      target_id: subscription?.id ?? null,
      metadata: { previous_plan: subscription?.plan_name ?? null, plan: plan.id },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    message: `${planLabels[plan.id]} 플랜으로 변경했습니다.`,
    plan,
  });
}
