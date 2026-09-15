import { redirect } from "next/navigation";
import { MypageSettings, type MypageSection } from "@/components/mypage/MypageSettings";
import { loadPaymentMethod } from "@/lib/billing/paymentMethod";
import { loadPlanOverview } from "@/lib/billing/planOverview";
import { workspaceCustomerKey } from "@/lib/billing/toss";
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

// 토스 카드 등록 창에서 돌아올 때 붙는 ?card= 결과값.
const cardNotices: Record<string, { tone: "success" | "error"; text: string }> = {
  registered: { tone: "success", text: "카드를 등록했습니다." },
  cancelled: { tone: "error", text: "카드 등록을 취소했습니다." },
  failed: { tone: "error", text: "카드를 등록하지 못했습니다. 카드사 인증을 다시 시도해 주세요." },
  forbidden: { tone: "error", text: "결제 수단을 변경할 권한이 없습니다." },
  unavailable: { tone: "error", text: "결제 연동이 아직 설정되지 않았습니다." },
};

function parseCardNotice(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return (candidate && cardNotices[candidate]) || null;
}

export default async function MyPage({
  searchParams,
}: {
  searchParams?: { section?: string | string[]; card?: string | string[] };
}) {
  const claims = await getSessionClaims();
  if (!claims) redirect("/login");

  const access = await getCurrentWorkspaceAccess();
  if (!access) redirect("/onboarding");
  const loginEmail = claims.email;
  if (!loginEmail) redirect("/login");

  const supabase = await createClient();

  const [brandResult, planOverview, paymentMethod] = await Promise.all([
    supabase
      .from("brands")
      .select("name")
      .eq("workspace_id", access.workspace.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    loadPlanOverview(access.workspace.id),
    loadPaymentMethod(access.workspace.id),
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
      paymentMethod={
        paymentMethod
          ? {
              cardCompany: paymentMethod.cardCompany,
              maskedNumber: paymentMethod.maskedNumber,
              cardType: paymentMethod.cardType,
              registeredAt: paymentMethod.registeredAt,
            }
          : null
      }
      tossClientKey={process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? ""}
      customerKey={workspaceCustomerKey(access.workspace.id)}
      cardNotice={parseCardNotice(searchParams?.card)}
    />
  );
}
