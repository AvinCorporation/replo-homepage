import { billingAccess, errorResponse } from "@/lib/billing/toss/server";
import { createClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const access = await billingAccess();
    const db = await createClient();
    const { data, error } = await db.rpc("billing_customer_summary", {
      p_workspace: access.workspaceId,
    });
    if (error || !data) throw new Error("BILLING_DATABASE_ERROR");
    return Response.json(
      {
        ...data,
        canManage: access.canManage,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
