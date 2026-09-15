import { billingAccess, errorResponse } from "@/lib/billing/toss/server";
import { loadBillingSummary } from "@/lib/billing/toss/summary";
import { createClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const access = await billingAccess();
    const db = await createClient();
    return Response.json(
      await loadBillingSummary(db, access.workspaceId, access.canManage),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
