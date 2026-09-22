import { NextResponse } from "next/server";
import { cancellationEffectiveOn, isCancellationComplete } from "@/lib/billing/cancellation";
import { planChangePolicy } from "@/lib/billing/planChanges";
import { billingAccess, billingAdmin, checkOrigin, errorResponse } from "@/lib/billing/toss/server";

export const dynamic = "force-dynamic";

const SUBSCRIPTION_FIELDS =
  "id,plan_name,status,next_billing_date,cancellation_requested_at,cancellation_effective_at";

async function currentSubscription(workspaceId: string) {
  const { data, error } = await billingAdmin()
    .from("subscriptions")
    .select(SUBSCRIPTION_FIELDS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("BILLING_DATABASE_ERROR");
  return data;
}

// 해지 신청. 이미 결제한 이용기간은 그대로 두고, 효력일부터 청구서를 만들지
// 않습니다. 예약된 요금제 변경이 있으면 함께 취소합니다(해지하는데 다음 달에
// 새 요금제가 적용되면 안 됩니다).
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const access = await billingAccess(undefined, true);
    const body = (await request.json().catch(() => ({}))) as { agreed?: boolean };
    if (body.agreed !== true) {
      return NextResponse.json(
        { error: "해지 조건을 확인해 주세요." },
        { status: 400 },
      );
    }

    const admin = billingAdmin();
    const subscription = await currentSubscription(access.workspaceId);
    if (!subscription || subscription.status === "canceled" || !subscription.plan_name || subscription.plan_name === "Free") {
      return NextResponse.json(
        { error: "해지할 유료 요금제가 없습니다." },
        { status: 409 },
      );
    }
    if (subscription.cancellation_requested_at) {
      return NextResponse.json(
        { error: "이미 해지를 신청했습니다." },
        { status: 409 },
      );
    }

    const effectiveOn = cancellationEffectiveOn(subscription.next_billing_date);
    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("subscriptions")
      .update({
        cancellation_requested_at: now,
        cancellation_effective_at: effectiveOn,
        invoice_stop_date: effectiveOn,
        updated_at: now,
      })
      .eq("id", subscription.id)
      .eq("workspace_id", access.workspaceId);
    if (updateError) throw new Error("BILLING_DATABASE_ERROR");

    await admin
      .from("subscription_plan_changes")
      .update({ status: "canceled", canceled_at: now, updated_at: now })
      .eq("workspace_id", access.workspaceId)
      .eq("subscription_id", subscription.id)
      .eq("status", "scheduled");

    await admin.from("billing_events").insert({
      workspace_id: access.workspaceId,
      event_type: "subscription.cancellation_requested",
      message: `${effectiveOn}부터 청구가 중지됩니다.`,
    });
    await admin.from("audit_logs").insert({
      workspace_id: access.workspaceId,
      actor_user_id: access.userId,
      action: "subscription.cancellation_requested",
      target_type: "subscription",
      target_id: subscription.id,
      metadata: {
        effective_on: effectiveOn,
        plan_name: subscription.plan_name,
        terms_version: planChangePolicy().termsVersion,
      },
    });

    return NextResponse.json({
      ok: true,
      effectiveOn,
      message: `${effectiveOn}까지 이용하고 그 이후로는 청구되지 않습니다.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// 해지 신청 철회. 효력일이 지나기 전까지만 가능합니다.
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const access = await billingAccess(undefined, true);
    const admin = billingAdmin();
    const subscription = await currentSubscription(access.workspaceId);
    if (!subscription?.cancellation_requested_at) {
      return NextResponse.json(
        { error: "철회할 해지 신청이 없습니다." },
        { status: 409 },
      );
    }
    // 효력일이 지나면 이미 청구가 멈춘 상태라 화면에서 되돌릴 수 없습니다.
    if (
      isCancellationComplete({
        requestedAt: subscription.cancellation_requested_at,
        effectiveOn: subscription.cancellation_effective_at,
      })
    ) {
      return NextResponse.json(
        { error: "이미 해지가 완료되었습니다. 다시 이용하시려면 담당 매니저에게 문의해 주세요." },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("subscriptions")
      .update({
        cancellation_requested_at: null,
        cancellation_effective_at: null,
        invoice_stop_date: null,
        updated_at: now,
      })
      .eq("id", subscription.id)
      .eq("workspace_id", access.workspaceId);
    if (updateError) throw new Error("BILLING_DATABASE_ERROR");

    await admin.from("billing_events").insert({
      workspace_id: access.workspaceId,
      event_type: "subscription.cancellation_revoked",
      message: "해지 신청이 철회되어 자동결제가 유지됩니다.",
    });
    await admin.from("audit_logs").insert({
      workspace_id: access.workspaceId,
      actor_user_id: access.userId,
      action: "subscription.cancellation_revoked",
      target_type: "subscription",
      target_id: subscription.id,
      metadata: { previous_effective_on: subscription.cancellation_effective_at },
    });

    return NextResponse.json({
      ok: true,
      message: "해지 신청을 철회했습니다. 요금제가 그대로 유지됩니다.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
