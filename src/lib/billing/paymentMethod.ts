import "server-only";
import {
  decryptCredentialValue,
  encryptCredentialValue,
} from "@/lib/security/integrationCredentials";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TossBillingAuth } from "@/lib/billing/toss";

export type PaymentMethodSummary = {
  id: string;
  cardCompany: string | null;
  maskedNumber: string | null;
  cardType: string | null;
  status: string;
  registeredAt: string | null;
};

const columns = "id, card_company, masked_number, card_type, status, updated_at";

function toSummary(row: Record<string, unknown>): PaymentMethodSummary {
  return {
    id: String(row.id),
    cardCompany: (row.card_company as string | null) ?? null,
    maskedNumber: (row.masked_number as string | null) ?? null,
    cardType: (row.card_type as string | null) ?? null,
    status: (row.status as string | null) ?? "active",
    registeredAt: (row.updated_at as string | null) ?? null,
  };
}

export async function loadPaymentMethod(workspaceId: string): Promise<PaymentMethodSummary | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("payment_methods")
    .select(columns)
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return toSummary(data as Record<string, unknown>);
}

// 카드 등록과 카드 변경은 같은 동작입니다. 워크스페이스의 기존 카드를 지우고
// 새 빌링키로 한 건만 남깁니다.
export async function savePaymentMethod(workspaceId: string, billing: TossBillingAuth) {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  await admin.from("payment_methods").delete().eq("workspace_id", workspaceId);

  const { data, error } = await admin
    .from("payment_methods")
    .insert({
      workspace_id: workspaceId,
      provider: "toss",
      customer_key: billing.customerKey,
      billing_key_encrypted: encryptCredentialValue(billing.billingKey),
      card_company: billing.cardCompany,
      masked_number: billing.maskedNumber,
      card_type: billing.cardType,
      owner_type: billing.ownerType,
      status: "active",
      updated_at: now,
    })
    .select(columns)
    .single();

  if (error || !data) throw new Error("카드 정보를 저장하지 못했습니다.");
  return toSummary(data as Record<string, unknown>);
}

// 결제를 실행할 때만 씁니다. 빌링키는 이 함수 밖으로 나가면 안 됩니다.
export async function loadBillingCredentials(workspaceId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("payment_methods")
    .select("billing_key_encrypted, customer_key")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.billing_key_encrypted || !data.customer_key) return null;
  try {
    return {
      billingKey: decryptCredentialValue(data.billing_key_encrypted as string),
      customerKey: data.customer_key as string,
    };
  } catch {
    return null;
  }
}

export async function removePaymentMethod(workspaceId: string) {
  const admin = createAdminClient();
  const { error } = await admin.from("payment_methods").delete().eq("workspace_id", workspaceId);
  if (error) throw new Error("카드 정보를 삭제하지 못했습니다.");
}
