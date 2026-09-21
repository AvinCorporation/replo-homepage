import {
  billingAccess,
  checkOrigin,
  errorResponse,
} from "@/lib/billing/toss/server";
import {
  beginRegistration,
  registrationConditions,
} from "@/lib/billing/toss/registration";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const access = await billingAccess(undefined, true);
    return Response.json(await registrationConditions(access.workspaceId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const access = await billingAccess(undefined, true);
    const body = await request.json();
    if (body.agreed !== true)
      return Response.json(
        { error: "자동결제 조건에 동의해 주세요." },
        { status: 400 },
      );
    return Response.json(
      await beginRegistration(
        access.workspaceId,
        access.userId,
        body.conditions,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
