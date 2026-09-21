import { isValidBearerSecret } from "@/lib/security/cron";
import { billingConfig } from "@/lib/billing/toss/config";
import {
  applyPlanChanges,
  generateInvoices,
  processCharges,
  reconcilePayments,
} from "@/lib/billing/toss/workers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.BILLING_CRON_SECRET;
  if (
    !secret ||
    !isValidBearerSecret(request.headers.get("authorization"), secret)
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const config = billingConfig();
    const recovered = await reconcilePayments();
    const planChangesApplied = await applyPlanChanges();
    const generated = await generateInvoices();
    const charged = config.chargesEnabled ? await processCharges() : 0;
    return Response.json(
      {
        recovered,
        planChangesApplied,
        generated,
        charged,
        chargesEnabled: config.chargesEnabled,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    console.error("billing.worker_failed");
    return Response.json(
      { error: "Billing worker requires operator review" },
      { status: 503 },
    );
  }
}
