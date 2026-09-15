import "server-only";
import { loadBillingCredentials } from "@/lib/billing/paymentMethod";
import { findSelectablePlan, planLabels, type SelectablePlanId } from "@/lib/billing/plans";
import {
  buildOrderId,
  monthlyCyclePeriod,
  planFirstCharge,
  type FirstCharge,
} from "@/lib/billing/proration";
import { TossError, chargeBillingKey } from "@/lib/billing/toss";
import { dateKeyInTimeZone } from "@/lib/dashboard/dates";
import { createAdminClient } from "@/lib/supabase/admin";

export class BillingError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "BillingError";
    this.status = status;
  }
}

export function todayInSeoul() {
  return dateKeyInTimeZone(new Date(), "Asia/Seoul");
}

type SubscriptionRow = {
  id: string;
  plan_name: string | null;
  status: string | null;
  next_billing_date: string | null;
  current_period_end: string | null;
  scheduled_plan_name: string | null;
};

const subscriptionColumns =
  "id, plan_name, status, next_billing_date, current_period_end, scheduled_plan_name";

async function latestSubscription(workspaceId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("subscriptions")
    .select(subscriptionColumns)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SubscriptionRow | null) ?? null;
}

// 이미 같은 order_id로 청구한 적이 있으면 다시 긁지 않습니다.
async function alreadyCharged(orderId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("billing_events")
    .select("id")
    .eq("order_id", orderId)
    .eq("status", "paid")
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

async function recordBillingEvent(input: {
  workspaceId: string;
  subscriptionId: string | null;
  eventType: string;
  status: string;
  message: string | null;
  amount: number;
  orderId: string;
  planId: SelectablePlanId;
  periodStart: string;
  periodEnd: string;
  paymentKey: string | null;
}) {
  const admin = createAdminClient();
  await admin.from("billing_events").insert({
    workspace_id: input.workspaceId,
    subscription_id: input.subscriptionId,
    event_type: input.eventType,
    status: input.status,
    message: input.message,
    amount: input.amount,
    order_id: input.orderId,
    plan_name: input.planId,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    provider: "toss",
    provider_payment_key: input.paymentKey,
  });
}

async function chargeOnce(input: {
  workspaceId: string;
  subscriptionId: string | null;
  planId: SelectablePlanId;
  amount: number;
  orderName: string;
  periodStart: string;
  periodEnd: string;
}) {
  const orderId = buildOrderId(input.workspaceId, input.planId, input.periodStart);
  if (await alreadyCharged(orderId)) return { orderId, paymentKey: null, skipped: true };

  const credentials = await loadBillingCredentials(input.workspaceId);
  if (!credentials) throw new BillingError("등록된 결제 수단이 없습니다.", 400);

  try {
    const charge = await chargeBillingKey({
      billingKey: credentials.billingKey,
      customerKey: credentials.customerKey,
      amount: input.amount,
      orderId,
      orderName: input.orderName,
    });
    await recordBillingEvent({
      workspaceId: input.workspaceId,
      subscriptionId: input.subscriptionId,
      eventType: "payment.succeeded",
      status: "paid",
      message: null,
      amount: input.amount,
      orderId,
      planId: input.planId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      paymentKey: charge.paymentKey,
    });
    return { orderId, paymentKey: charge.paymentKey, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "결제에 실패했습니다.";
    await recordBillingEvent({
      workspaceId: input.workspaceId,
      subscriptionId: input.subscriptionId,
      eventType: "payment.failed",
      status: "failed",
      message,
      amount: input.amount,
      orderId,
      planId: input.planId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      paymentKey: null,
    });
    throw new BillingError(
      error instanceof TossError ? message : "결제에 실패했습니다. 카드사 상태를 확인해 주세요.",
      402,
    );
  }
}

export function previewFirstCharge(planId: SelectablePlanId, today = todayInSeoul()): FirstCharge {
  const plan = findSelectablePlan(planId);
  if (!plan) throw new BillingError("선택할 수 없는 플랜입니다.");
  return planFirstCharge(plan.monthlyFee, today);
}

/**
 * 무료 -> 유료 전환. 이번 달 잔여와 다음 달 이용료를 한 번에 청구하고,
 * 결제가 성공한 뒤에만 구독을 활성화합니다.
 */
export async function startPaidPlan(input: {
  workspaceId: string;
  actorUserId: string;
  planId: SelectablePlanId;
  today?: string;
}) {
  const plan = findSelectablePlan(input.planId);
  if (!plan || plan.monthlyFee <= 0) throw new BillingError("결제할 수 없는 플랜입니다.");

  const today = input.today ?? todayInSeoul();
  const charge = planFirstCharge(plan.monthlyFee, today);
  const subscription = await latestSubscription(input.workspaceId);

  await chargeOnce({
    workspaceId: input.workspaceId,
    subscriptionId: subscription?.id ?? null,
    planId: input.planId,
    amount: charge.totalAmount,
    orderName: `Replo ${planLabels[input.planId]} 플랜`,
    periodStart: charge.periodStart,
    periodEnd: charge.periodEnd,
  });

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const values = {
    plan_name: plan.id,
    monthly_fee: plan.monthlyFee,
    included_tickets: plan.includedTickets,
    status: "active",
    current_period_start: charge.periodStart,
    current_period_end: charge.periodEnd,
    next_billing_date: charge.nextBillingDate,
    scheduled_plan_name: null,
    updated_at: now,
  };

  if (subscription) {
    await admin.from("subscriptions").update(values).eq("id", subscription.id);
  } else {
    await admin.from("subscriptions").insert({ workspace_id: input.workspaceId, ...values });
  }

  await Promise.all([
    admin
      .from("workspaces")
      .update({ status: "active", updated_at: now })
      .eq("id", input.workspaceId),
    admin.from("audit_logs").insert({
      workspace_id: input.workspaceId,
      actor_user_id: input.actorUserId,
      action: "subscription.started",
      target_type: "subscription",
      target_id: subscription?.id ?? null,
      metadata: { plan: plan.id, amount: charge.totalAmount, period_end: charge.periodEnd },
    }),
  ]);

  return charge;
}

/** 유료 -> 유료 변경. 지금 청구하지 않고 다음 결제일부터 적용합니다. */
export async function schedulePlanChange(input: {
  workspaceId: string;
  actorUserId: string;
  planId: SelectablePlanId | null;
}) {
  const subscription = await latestSubscription(input.workspaceId);
  if (!subscription) throw new BillingError("이용 중인 플랜이 없습니다.");

  const admin = createAdminClient();
  await admin
    .from("subscriptions")
    .update({ scheduled_plan_name: input.planId, updated_at: new Date().toISOString() })
    .eq("id", subscription.id);

  await admin.from("audit_logs").insert({
    workspace_id: input.workspaceId,
    actor_user_id: input.actorUserId,
    action: input.planId ? "subscription.change_scheduled" : "subscription.change_canceled",
    target_type: "subscription",
    target_id: subscription.id,
    metadata: { plan: input.planId, effective_on: subscription.next_billing_date },
  });

  return { effectiveOn: subscription.next_billing_date };
}

export type BillingRunResult = {
  workspaceId: string;
  planId: string | null;
  status: "charged" | "skipped" | "failed";
  amount?: number;
  message?: string;
};

/**
 * 매월 1일 정기 결제. next_billing_date가 지난 활성 구독을 한 달치 청구하고,
 * 예약된 플랜 변경이 있으면 이 시점에 적용합니다.
 */
export async function runDueBilling(today = todayInSeoul()): Promise<BillingRunResult[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("subscriptions")
    .select(`workspace_id, ${subscriptionColumns}`)
    .eq("status", "active")
    .not("next_billing_date", "is", null)
    .lte("next_billing_date", today);
  if (error) throw error;

  const results: BillingRunResult[] = [];
  for (const row of (data ?? []) as Array<SubscriptionRow & { workspace_id: string }>) {
    const planId = row.scheduled_plan_name ?? row.plan_name;
    const plan = findSelectablePlan(planId);
    if (!plan || plan.monthlyFee <= 0) {
      results.push({ workspaceId: row.workspace_id, planId, status: "skipped", message: "청구 대상 플랜이 아닙니다." });
      continue;
    }

    const cycle = monthlyCyclePeriod(row.next_billing_date ?? today);
    try {
      const charge = await chargeOnce({
        workspaceId: row.workspace_id,
        subscriptionId: row.id,
        planId: plan.id,
        amount: plan.monthlyFee,
        orderName: `Replo ${planLabels[plan.id]} 플랜`,
        periodStart: cycle.periodStart,
        periodEnd: cycle.periodEnd,
      });

      await admin
        .from("subscriptions")
        .update({
          plan_name: plan.id,
          monthly_fee: plan.monthlyFee,
          included_tickets: plan.includedTickets,
          scheduled_plan_name: null,
          current_period_start: cycle.periodStart,
          current_period_end: cycle.periodEnd,
          next_billing_date: cycle.nextBillingDate,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      results.push({
        workspaceId: row.workspace_id,
        planId: plan.id,
        status: charge.skipped ? "skipped" : "charged",
        amount: plan.monthlyFee,
      });
    } catch (caught) {
      // 결제 실패는 구독 상태를 그대로 두고 다음 실행에서 다시 시도합니다.
      results.push({
        workspaceId: row.workspace_id,
        planId: plan.id,
        status: "failed",
        message: caught instanceof Error ? caught.message : "결제에 실패했습니다.",
      });
    }
  }

  return results;
}
