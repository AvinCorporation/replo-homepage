import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// 토스 인증창에서 사용자가 취소했거나 카드사 인증이 실패했을 때 돌아오는 주소입니다.
// 토스가 붙여 보내는 message는 그대로 노출하지 않고 화면 문구로 대체합니다.
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  const url = new URL("/mypage", request.url);
  url.searchParams.set("section", "plan");
  url.searchParams.set("card", code === "USER_CANCEL" ? "cancelled" : "failed");
  return NextResponse.redirect(url);
}
