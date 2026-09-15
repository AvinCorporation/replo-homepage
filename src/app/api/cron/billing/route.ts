import { NextResponse } from "next/server";
import { runDueBilling } from "@/lib/billing/subscriptionBilling";
import { isValidBearerSecret } from "@/lib/security/cron";

export const dynamic = "force-dynamic";

// 매월 1일에 호출합니다. next_billing_date가 지난 활성 구독을 한 달치 청구하고,
// 예약된 플랜 변경을 이 시점에 적용합니다. 실패한 건은 상태를 그대로 두므로
// 다시 호출하면 재시도되고, 이미 청구된 건은 order_id로 걸러집니다.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !isValidBearerSecret(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await runDueBilling();
    const failed = results.filter((result) => result.status === "failed").length;
    return NextResponse.json({
      ok: true,
      charged: results.filter((result) => result.status === "charged").length,
      skipped: results.filter((result) => result.status === "skipped").length,
      failed,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "정기 결제에 실패했습니다." },
      { status: 500 },
    );
  }
}
