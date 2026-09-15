import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { cardIssuerName } from "@/lib/billing/toss/domain";

export type PaymentMethodSummary = {
  id: string;
  cardCompany: string | null;
  maskedNumber: string | null;
  cardType: string | null;
  status: string;
  registeredAt: string | null;
  isDefault: boolean;
};

export async function loadPaymentMethods(
  workspaceId: string,
): Promise<PaymentMethodSummary[]> {
  const { data, error } = await createAdminClient()
    .from("payment_methods")
    .select(
      "id,masked_number,issuer_code,card_type,status,registered_at,is_default",
    )
    .eq("workspace_id", workspaceId)
    .eq("provider", "toss")
    .eq("status", "active")
    .order("is_default", { ascending: false })
    .order("registered_at", { ascending: false })
    .limit(2);

  if (error || !data) return [];
  return data.map((method) => ({
    id: method.id,
    cardCompany:
      typeof method.issuer_code === "string"
        ? cardIssuerName(method.issuer_code)
        : null,
    maskedNumber: method.masked_number,
    cardType: method.card_type,
    status: method.status,
    registeredAt: method.registered_at,
    isDefault: method.is_default,
  }));
}

export async function loadPaymentMethod(workspaceId: string) {
  return (await loadPaymentMethods(workspaceId))[0] ?? null;
}
