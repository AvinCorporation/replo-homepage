import { checkOrigin, errorResponse } from "@/lib/billing/toss/server";
import { completeRegistration } from "@/lib/billing/toss/registration";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = await request.json();
    for (const field of ["session", "state", "authKey", "customerKey"])
      if (
        typeof body[field] !== "string" ||
        !body[field] ||
        body[field].length > 300
      )
        return Response.json(
          { error: "등록 요청이 유효하지 않습니다." },
          { status: 400 },
        );
    await completeRegistration(body);
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
