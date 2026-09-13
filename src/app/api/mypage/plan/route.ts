import { NextResponse } from "next/server";
import { billingAccess, errorResponse } from "@/lib/billing/toss/server";
export async function PATCH() {
  try {
    await billingAccess();
    return NextResponse.json(
      { error: "플랜과 월 이용료 변경은 담당자에게 요청해 주세요." },
      { status: 403 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
