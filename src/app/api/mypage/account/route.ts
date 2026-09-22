import { NextResponse } from "next/server";
import { loadAccountWithdrawalState } from "@/lib/account/context";
import { executeWithdrawal } from "@/lib/account/execute";
import { isSameOrigin } from "@/lib/http/origin";
import { getSessionClaims } from "@/lib/supabase/claims";

export const dynamic = "force-dynamic";

// 회원 탈퇴. 본인 계정만 처리하며, 속한 모든 워크스페이스에서 나갑니다. 마지막
// owner인 워크스페이스는 함께 종료됩니다.
export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 403 });
  }

  const claims = await getSessionClaims();
  if (!claims) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { agreed?: boolean };
  if (body.agreed !== true) {
    return NextResponse.json(
      { error: "탈퇴 안내를 확인하고 동의해 주세요." },
      { status: 400 },
    );
  }

  try {
    const state = await loadAccountWithdrawalState(claims.userId);
    if (state.blocked) {
      return NextResponse.json(
        { code: state.blocked.code, error: state.blocked.message },
        { status: 409 },
      );
    }

    const result = await executeWithdrawal(claims.userId, state.memberships);
    return NextResponse.json({
      ok: true,
      closedWorkspaces: result.closedWorkspaces,
      message: result.closedWorkspaces
        ? "탈퇴가 완료되었습니다. 워크스페이스도 함께 종료되었습니다."
        : "탈퇴가 완료되었습니다.",
    });
  } catch (error) {
    console.error(
      "Account withdrawal failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json(
      { error: "탈퇴를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}
