import { billingAccess, errorResponse } from "@/lib/billing/toss/server";
import { createClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const access = await billingAccess();
    const db = await createClient();
    const results = await Promise.all([
      db
        .from("subscriptions")
        .select(
          "id,plan_name,monthly_fee,included_tickets,status,next_billing_date,billing_policy,enrollment_confirmed_at",
        )
        .eq("workspace_id", access.workspaceId)
        .order("created_at", { ascending: false })
        .limit(1),
      db
        .from("payment_methods")
        .select(
          "id,masked_number,issuer_code,card_type,owner_type,status,is_default,registered_at",
        )
        .eq("workspace_id", access.workspaceId)
        .eq("provider", "toss")
        .eq("status", "active")
        .order("is_default", { ascending: false })
        .order("registered_at", { ascending: true }),
      db
        .from("billing_invoices")
        .select(
          "id,billing_date,period_start,period_end,amount,status,next_attempt_at,paid_at",
        )
        .eq("workspace_id", access.workspaceId)
        .order("billing_date", { ascending: false })
        .limit(50),
      db
        .from("payment_attempts")
        .select(
          "id,invoice_id,amount,status,failure_category,failure_message,receipt_url,approved_at,created_at",
        )
        .eq("workspace_id", access.workspaceId)
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("payment_cancellations")
        .select("payment_attempt_id,cancel_amount,status,canceled_at")
        .eq("workspace_id", access.workspaceId)
        .order("canceled_at", { ascending: false })
        .limit(200),
      db
        .from("billing_invoices")
        .select("id,amount,billing_date,next_attempt_at,status")
        .eq("workspace_id", access.workspaceId)
        .in("status", ["scheduled", "payment_pending", "processing"])
        .order("billing_date")
        .limit(1),
    ]);
    if (results.some((r) => r.error)) throw new Error("BILLING_DATABASE_ERROR");
    return Response.json(
      {
        canManage: access.canManage,
        subscription: results[0].data?.[0] ?? null,
        paymentMethods: results[1].data ?? [],
        invoices: results[2].data,
        attempts: results[3].data,
        cancellations: results[4].data,
        nextInvoice: results[5].data?.[0] ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
