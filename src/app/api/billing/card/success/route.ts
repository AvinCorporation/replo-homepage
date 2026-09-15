import { NextResponse } from "next/server";
import { savePaymentMethod } from "@/lib/billing/paymentMethod";
import { TossError, issueBillingKey, workspaceCustomerKey } from "@/lib/billing/toss";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageWorkspace, getCurrentWorkspaceAccess } from "@/lib/workspaces/access";

export const dynamic = "force-dynamic";

// 토스 카드 등록 인증창이 성공 시 돌려보내는 주소입니다.
// authKey를 빌링키로 교환한 뒤 마이페이지로 돌려보냅니다.
function backToPlan(request: Request, card: string) {
  const url = new URL("/mypage", request.url);
  url.searchParams.set("section", "plan");
  url.searchParams.set("card", card);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const access = await getCurrentWorkspaceAccess();
  if (!access) return NextResponse.redirect(new URL("/login", request.url));
  if (!canManageWorkspace(access)) return backToPlan(request, "forbidden");

  const query = new URL(request.url).searchParams;
  const authKey = query.get("authKey");
  const customerKey = query.get("customerKey");

  // 리다이렉트로 돌아온 값이므로 로그인한 워크스페이스의 것인지 대조합니다.
  if (!authKey || !customerKey || customerKey !== workspaceCustomerKey(access.workspace.id)) {
    return backToPlan(request, "failed");
  }

  try {
    const billing = await issueBillingKey({ authKey, customerKey });
    const saved = await savePaymentMethod(access.workspace.id, billing);

    await createAdminClient()
      .from("audit_logs")
      .insert({
        workspace_id: access.workspace.id,
        actor_user_id: access.user.id,
        action: "billing.card_registered",
        target_type: "payment_method",
        target_id: saved.id,
        metadata: { card_company: saved.cardCompany, masked_number: saved.maskedNumber },
      });

    return backToPlan(request, "registered");
  } catch (error) {
    if (error instanceof TossError && error.code === "not_configured") {
      return backToPlan(request, "unavailable");
    }
    return backToPlan(request, "failed");
  }
}
