import {
  billingAccess,
  billingAdmin,
  checkOrigin,
  errorResponse,
  rpc,
} from "@/lib/billing/toss/server";
import {
  nextPlanEffectiveOn,
  planChangeConditions,
  planChangePolicy,
} from "@/lib/billing/planChanges";
import { sameJsonValue } from "@/lib/billing/toss/json";

export const dynamic = "force-dynamic";

type CatalogRow = {
  code: string;
  display_name: string;
  monthly_fee: number | null;
  included_tickets: number;
  vat: "excluded";
  self_service: boolean;
  sort_order: number;
};

async function loadPlanData(workspaceId: string) {
  const db = billingAdmin();
  const subscriptionResult = await db
    .from("subscriptions")
    .select(
      "id,plan_name,monthly_fee,included_tickets,status,billing_policy,enrollment_confirmed_at",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subscriptionResult.error || !subscriptionResult.data)
    throw new Error("BILLING_PLAN_CHANGE_UNAVAILABLE");

  const [catalogResult, pendingResult] = await Promise.all([
    db
      .from("billing_plan_catalog")
      .select(
        "code,display_name,monthly_fee,included_tickets,vat,self_service,sort_order",
      )
      .order("sort_order"),
    db
      .from("subscription_plan_changes")
      .select(
        "id,to_plan_code,to_monthly_fee,to_included_tickets,effective_on,status,agreed_at",
      )
      .eq("subscription_id", subscriptionResult.data.id)
      .eq("status", "scheduled")
      .maybeSingle(),
  ]);

  if (catalogResult.error || pendingResult.error)
    throw new Error("BILLING_DATABASE_ERROR");

  return {
    subscription: subscriptionResult.data,
    catalog: (catalogResult.data ?? []) as CatalogRow[],
    pendingChange: pendingResult.data,
  };
}

function normalizePlanName(planName: string | null) {
  return planName === "Starter" ? "Lite" : planName;
}

export async function GET() {
  try {
    const access = await billingAccess();
    const { subscription, catalog, pendingChange } = await loadPlanData(
      access.workspaceId,
    );
    const policy = planChangePolicy();
    const effectiveOn = nextPlanEffectiveOn();
    const currentPlan = normalizePlanName(subscription.plan_name);

    return Response.json(
      {
        canManage: access.canManage,
        changeAvailable:
          ["active", "past_due", "pending_payment_method"].includes(
            subscription.status,
          ),
        currentPlan: {
          code: currentPlan,
          monthlyFee: subscription.monthly_fee,
          includedTickets: subscription.included_tickets,
        },
        effectiveOn,
        plans: catalog.map((plan) => ({
          code: plan.code,
          name: plan.display_name,
          monthlyFee: plan.monthly_fee,
          includedTickets: plan.included_tickets,
          vat: plan.vat,
          selfService: plan.self_service,
          conditions:
            plan.self_service && plan.monthly_fee !== null
              ? planChangeConditions({
                  fromPlan: subscription.plan_name,
                  plan: {
                    code: plan.code,
                    displayName: plan.display_name,
                    monthlyFee: plan.monthly_fee,
                    includedTickets: plan.included_tickets,
                  },
                  policy,
                  effectiveOn,
                })
              : null,
        })),
        pendingChange,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const access = await billingAccess(undefined, true);
    const body = (await request.json()) as {
      agreed?: unknown;
      planCode?: unknown;
      conditions?: unknown;
    };
    if (body.agreed !== true)
      return Response.json(
        { error: "변경할 요금제와 적용일에 동의해 주세요." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    if (typeof body.planCode !== "string")
      return Response.json(
        { error: "변경할 요금제를 다시 선택해 주세요." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );

    const { subscription, catalog } = await loadPlanData(access.workspaceId);
    if (
      !["active", "past_due", "pending_payment_method"].includes(
        subscription.status,
      )
    )
      throw new Error("BILLING_PLAN_CHANGE_UNAVAILABLE");

    const plan = catalog.find((candidate) => candidate.code === body.planCode);
    if (!plan || !plan.self_service || plan.monthly_fee === null)
      throw new Error("BILLING_PLAN_REQUIRES_QUOTE");

    const policy = planChangePolicy();
    const effectiveOn = nextPlanEffectiveOn();
    const conditions = planChangeConditions({
      fromPlan: subscription.plan_name,
      plan: {
        code: plan.code,
        displayName: plan.display_name,
        monthlyFee: plan.monthly_fee,
        includedTickets: plan.included_tickets,
      },
      policy,
      effectiveOn,
    });
    if (!sameJsonValue(body.conditions, conditions))
      throw new Error("BILLING_PLAN_CONSENT_CHANGED");

    const id = await rpc<string>("billing_schedule_plan_change", {
      p_workspace: access.workspaceId,
      p_subscription: subscription.id,
      p_user: access.userId,
      p_plan_code: plan.code,
      p_expected_effective_on: effectiveOn,
      p_policy: policy,
      p_conditions: conditions,
    });

    return Response.json(
      {
        ok: true,
        id,
        effectiveOn,
        message: `${plan.display_name} 요금제가 ${effectiveOn}부터 적용됩니다.`,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  return POST(request);
}
