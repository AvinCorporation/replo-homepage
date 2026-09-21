import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { billingConfig } from "./config";
import { billingErrorDetails, billingRpcErrorCode } from "./errors";
export async function billingAccess(workspaceId?: string, manage = false) {
  const client = await createClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) throw new Error("BILLING_UNAUTHENTICATED");
  let query = client
    .from("workspace_members")
    .select("workspace_id,role")
    .eq("user_id", user.id)
    .eq("status", "active");
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  const { data: membership, error: membershipError } = await query
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (
    membershipError ||
    !membership ||
    (manage && !["owner", "admin"].includes(membership.role))
  )
    throw new Error("BILLING_FORBIDDEN");
  return {
    userId: user.id,
    workspaceId: membership.workspace_id as string,
    canManage: ["owner", "admin"].includes(membership.role),
  };
}
export function billingAdmin() {
  billingConfig();
  return createAdminClient();
}
export async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await billingAdmin().rpc(name, args);
  if (error) {
    throw new Error(billingRpcErrorCode(error.code) ?? "BILLING_DATABASE_ERROR");
  }
  return data as T;
}
export function checkOrigin(request: Request) {
  if (request.headers.get("origin") !== billingConfig().site)
    throw new Error("BILLING_FORBIDDEN");
}
export function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const response = billingErrorDetails(code);
  // 5xx는 고객이 해결할 수 없는 상태입니다. 어떤 설정/처리에서 막혔는지 서버 로그로
  // 남겨야 "요금제를 변경할 수 없다"는 문의를 추적할 수 있습니다.
  if (response.status >= 500) {
    console.error(
      "Billing request failed:",
      code || "UNKNOWN_BILLING_ERROR",
      error instanceof Error ? error.stack : undefined,
    );
  }
  return Response.json(
    { code: response.code, error: response.error },
    {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
