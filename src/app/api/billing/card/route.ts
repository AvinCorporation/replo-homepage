import { NextResponse } from "next/server";
import { loadPaymentMethod, removePaymentMethod } from "@/lib/billing/paymentMethod";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageWorkspace, getCurrentWorkspaceAccess } from "@/lib/workspaces/access";

export const dynamic = "force-dynamic";

export async function DELETE() {
  const access = await getCurrentWorkspaceAccess();
  if (!access) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!canManageWorkspace(access)) {
    return NextResponse.json({ error: "결제 수단을 변경할 권한이 없습니다." }, { status: 403 });
  }

  const current = await loadPaymentMethod(access.workspace.id);
  if (!current) {
    return NextResponse.json({ error: "등록된 카드가 없습니다." }, { status: 404 });
  }

  try {
    await removePaymentMethod(access.workspace.id);
  } catch {
    return NextResponse.json({ error: "카드를 삭제하지 못했습니다." }, { status: 500 });
  }

  await createAdminClient()
    .from("audit_logs")
    .insert({
      workspace_id: access.workspace.id,
      actor_user_id: access.user.id,
      action: "billing.card_removed",
      target_type: "payment_method",
      target_id: current.id,
      metadata: { masked_number: current.maskedNumber },
    });

  return NextResponse.json({ ok: true, message: "등록된 카드를 삭제했습니다." });
}
