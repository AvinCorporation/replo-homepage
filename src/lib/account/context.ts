import "server-only";
import { findSelectablePlan } from "@/lib/billing/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { withdrawalBlock, type WithdrawalBlock, type WithdrawalContext } from "./withdrawal";

export type WorkspaceMembershipState = WithdrawalContext & {
  membershipId: string;
  workspaceId: string;
  role: string;
};

export type AccountWithdrawalState = {
  memberships: WorkspaceMembershipState[];
  // 탈퇴하면 종료되는 워크스페이스가 하나라도 있는지(= 마지막 owner인 곳).
  closesWorkspace: boolean;
  blocked: WithdrawalBlock | null;
};

// 탈퇴는 계정 단위입니다. 사용자가 여러 워크스페이스에 속해 있으면 모든 곳에서
// 나가야 하므로, 워크스페이스마다 상태를 확인하고 한 곳이라도 막히면 막습니다.
export async function loadAccountWithdrawalState(
  userId: string,
): Promise<AccountWithdrawalState> {
  const admin = createAdminClient();

  const { data: myMemberships, error } = await admin
    .from("workspace_members")
    .select("id, workspace_id, role")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw new Error("ACCOUNT_WITHDRAWAL_STATE_FAILED");

  const memberships = await Promise.all(
    (myMemberships ?? []).map(async (membership) => {
      const state = await workspaceState(
        membership.workspace_id as string,
        userId,
      );
      return {
        membershipId: membership.id as string,
        workspaceId: membership.workspace_id as string,
        role: membership.role as string,
        ...state,
      };
    }),
  );

  const blocked =
    memberships.map((membership) => withdrawalBlock(membership)).find(Boolean) ?? null;

  return {
    memberships,
    closesWorkspace: memberships.some((membership) => membership.isLastOwner),
    blocked,
  };
}

async function workspaceState(
  workspaceId: string,
  userId: string,
): Promise<WithdrawalContext> {
  const admin = createAdminClient();

  const [ownerResult, subscriptionResult] = await Promise.all([
    admin
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("role", "owner")
      .eq("status", "active"),
    admin
      .from("subscriptions")
      .select("id,plan_name,status,cancellation_requested_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const owners = (ownerResult.data ?? []) as Array<{ user_id: string }>;
  const isLastOwner =
    owners.length > 0 && owners.every((owner) => owner.user_id === userId);

  const subscription = subscriptionResult.data as Record<string, unknown> | null;
  const status = (subscription?.status as string | null) ?? null;
  const planName = subscription?.plan_name === "Lite" ? "Starter" : subscription?.plan_name;
  const hasPaidPlan = Boolean(
    subscription && status !== "canceled" && findSelectablePlan(planName),
  );

  // 마지막 owner가 아니면 구독 상태는 탈퇴를 막지 않으므로 더 조회하지 않습니다.
  const scheduledResult =
    isLastOwner && subscription?.id
      ? await admin
          .from("subscription_plan_changes")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("subscription_id", subscription.id as string)
          .eq("status", "scheduled")
          .limit(1)
          .maybeSingle()
      : { data: null };

  return {
    isLastOwner,
    hasPaidPlan,
    hasScheduledPlanChange: Boolean(scheduledResult.data),
    cancellationRequested: Boolean(subscription?.cancellation_requested_at),
    subscriptionStatus: status,
  };
}
