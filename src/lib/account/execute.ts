import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkspaceMembershipState } from "./context";
import { anonymizedUserFields } from "./withdrawal";

export type WithdrawalResult = {
  // 이번 탈퇴로 종료된 워크스페이스 수(= 마지막 owner였던 곳).
  closedWorkspaces: number;
  leftWorkspaces: number;
  // auth 계정까지 지웠는지. 결제 동의·카드 등록 기록이 남은 계정은 참조 제약 때문에
  // 지울 수 없어, 개인정보만 지운 상태로 남습니다.
  authAccountDeleted: boolean;
};

// 탈퇴 처리. 결제·세금 관련 기록은 전자상거래법상 보존 대상이라 워크스페이스
// 단위로 남기고, 개인을 식별할 수 있는 값만 지웁니다.
export async function executeWithdrawal(
  userId: string,
  memberships: WorkspaceMembershipState[],
): Promise<WithdrawalResult> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  let closedWorkspaces = 0;

  for (const membership of memberships) {
    // 1. 감사 로그를 먼저 남깁니다. 아래에서 계정이 사라지면 actor는 null이 됩니다.
    await admin.from("audit_logs").insert({
      workspace_id: membership.workspaceId,
      actor_user_id: userId,
      action: "account.withdrawn",
      target_type: "user",
      target_id: userId,
      metadata: {
        role: membership.role,
        last_owner: membership.isLastOwner,
        withdrawn_at: now,
      },
    });

    // 2. 마지막 owner면 워크스페이스를 종료하고 연동을 끊습니다. 남은 멤버가 없는데
    //    동기화가 계속 돌면 안 됩니다.
    if (membership.isLastOwner) {
      await admin
        .from("workspaces")
        .update({ status: "disabled", updated_at: now })
        .eq("id", membership.workspaceId);
      await admin
        .from("channel_integrations")
        .update({ status: "disconnected", updated_at: now })
        .eq("workspace_id", membership.workspaceId)
        .neq("status", "disconnected");
      await admin
        .from("member_invites")
        .update({ status: "revoked", updated_at: now })
        .eq("workspace_id", membership.workspaceId)
        .eq("status", "pending");
      closedWorkspaces += 1;
    }

    // 3. 멤버십을 정리합니다.
    const { error: membershipError } = await admin
      .from("workspace_members")
      .delete()
      .eq("id", membership.membershipId)
      .eq("workspace_id", membership.workspaceId);
    if (membershipError) throw new Error("ACCOUNT_WITHDRAWAL_FAILED");
  }

  // 4. 프로필의 개인정보를 지웁니다. 이 시점부터 이름·이메일로 식별되지 않습니다.
  const { error: profileError } = await admin
    .from("users")
    .update(anonymizedUserFields(userId))
    .eq("id", userId);
  if (profileError) throw new Error("ACCOUNT_WITHDRAWAL_FAILED");

  // 5. 로그인 계정을 삭제합니다. 결제 동의(billing_consents)·카드 등록 세션 등이
  //    auth.users를 참조하고 있으면 지울 수 없는데, 그 기록은 보존 대상이므로
  //    실패를 오류로 다루지 않고 익명화 상태로 둡니다.
  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError) {
    console.warn(
      "Withdrawn account kept in anonymized form (auth user is still referenced):",
      authError.message,
    );
  }

  return {
    closedWorkspaces,
    leftWorkspaces: memberships.length - closedWorkspaces,
    authAccountDeleted: !authError,
  };
}
