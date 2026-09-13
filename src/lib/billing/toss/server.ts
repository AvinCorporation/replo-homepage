import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { billingConfig } from "./config";
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
  if (error) throw new Error("BILLING_DATABASE_ERROR");
  return data as T;
}
export function checkOrigin(request: Request) {
  if (request.headers.get("origin") !== billingConfig().site)
    throw new Error("BILLING_FORBIDDEN");
}
export function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const status =
    code === "BILLING_UNAUTHENTICATED"
      ? 401
      : code === "BILLING_FORBIDDEN"
        ? 403
        : 503;
  return Response.json(
    {
      error:
        status === 401
          ? "로그인이 필요합니다."
          : status === 403
            ? "결제 정보를 변경할 권한이 없습니다."
            : "결제 설정 또는 처리 상태를 확인해 주세요. 담당자 확인이 필요합니다.",
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
