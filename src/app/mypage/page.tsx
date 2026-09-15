import { redirect } from "next/navigation";
import { MypageSettings, type MypageSection } from "@/components/mypage/MypageSettings";
import { loadPlanOverview } from "@/lib/billing/planOverview";
import { getCurrentWorkspaceAccess } from "@/lib/workspaces/access";
import { getSessionClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";
import "./mypage.css";

export const dynamic = "force-dynamic";

const roleLabels: Record<string, string> = {
  owner: "소유자",
  admin: "관리자",
  editor: "편집자",
  viewer: "뷰어",
};

const sections: MypageSection[] = ["profile", "plan", "members"];

function parseSection(value: string | string[] | undefined): MypageSection {
  const candidate = Array.isArray(value) ? value[0] : value;
  return sections.find((section) => section === candidate) ?? "profile";
}

export default async function MyPage({
  searchParams,
}: {
  searchParams?: { section?: string | string[] };
}) {
  const claims = await getSessionClaims();
  if (!claims) redirect("/login");

  const access = await getCurrentWorkspaceAccess();
  if (!access) redirect("/onboarding");
  const loginEmail = claims.email;
  if (!loginEmail) redirect("/login");

  const supabase = await createClient();

  const [brandResult, planOverview] = await Promise.all([
    supabase
      .from("brands")
      .select("name")
      .eq("workspace_id", access.workspace.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    loadPlanOverview(access.workspace.id),
  ]);

  const customer = access.workspace;

  return (
    <MypageSettings
      canManage={access.membership.role === "owner" || access.membership.role === "admin"}
      initialSection={parseSection(searchParams?.section)}
      loginEmail={loginEmail}
      roleLabel={roleLabels[access.membership.role] ?? access.membership.role}
      customer={{
        companyName: customer.company_name,
        brandName:
          brandResult.data?.name ??
          customer.company_name,
        representativeName: customer.representative_name ?? customer.contact_name ?? "",
        contactName: customer.contact_name ?? "",
        email: customer.email,
        phone: customer.phone ?? "",
        websiteUrl: customer.website_url ?? "",
        businessNumber: customer.business_number ?? "",
        billingEmail: customer.billing_email ?? "",
      }}
      usage={planOverview.usage}
      startedAt={planOverview.startedAt}
      memberCount={planOverview.memberCount}
    />
  );
}
