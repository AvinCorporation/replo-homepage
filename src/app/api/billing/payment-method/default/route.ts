import {
  billingAccess,
  checkOrigin,
  errorResponse,
  rpc,
} from "@/lib/billing/toss/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const access = await billingAccess(undefined, true);
    const body = (await request.json()) as { paymentMethodId?: unknown };
    if (
      typeof body.paymentMethodId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        body.paymentMethodId,
      )
    ) {
      return Response.json(
        { error: "변경할 결제수단을 다시 선택해 주세요." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    await rpc("billing_set_default_payment_method", {
      p_workspace: access.workspaceId,
      p_method: body.paymentMethodId,
      p_user: access.userId,
    });
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
