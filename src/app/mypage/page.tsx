import { redirect } from "next/navigation";
import { MypageSettings, type MypageSection } from "@/components/mypage/MypageSettings";
import { loginPathWithNext } from "@/lib/auth/redirect";
import { loadPaymentMethods } from "@/lib/billing/paymentMethod";
import { findSelectablePlan, selfServicePlanIds, type SelectablePlanId } from "@/lib/billing/plans";
import { loadPlanOverview } from "@/lib/billing/planOverview";
import { seoulToday } from "@/lib/billing/toss/domain";
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

// 홈페이지 요금제에서 `?plan=Starter`로 들어오면 해당 요금제 신청 창을 바로 엽니다.
function parseRequestedPlan(value: string | string[] | undefined): SelectablePlanId | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  const plan = findSelectablePlan(candidate);
  return plan && selfServicePlanIds.includes(plan.id) ? plan.id : null;
}

// 로그인·온보딩을 거친 뒤에도 원래 보려던 마이페이지 화면으로 돌아오게 합니다.
function currentPath(searchParams?: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  Object.entries(searchParams ?? {}).forEach(([key, value]) => {
    const single = Array.isArray(value) ? value[0] : value;
    if (single) query.set(key, single);
  });
  const suffix = query.toString();
  return suffix ? `/mypage?${suffix}` : "/mypage";
}

export default async function MyPage({
  searchParams,
}: {
  searchParams?: {
    section?: string | string[];
    card?: string | string[];
    plan?: string | string[];
  };
}) {
  const destination = currentPath(searchParams);
  const claims = await getSessionClaims();
  if (!claims) redirect(loginPathWithNext(destination));

  const access = await getCurrentWorkspaceAccess();
  if (!access) redirect(`/onboarding?next=${encodeURIComponent(destination)}`);
  const loginEmail = claims.email;
  if (!loginEmail) redirect(loginPathWithNext(destination));

  const supabase = await createClient();

  const [brandResult, planOverview, paymentMethods] = await Promise.all([
    supabase
      .from("brands")
      .select("name")
      .eq("workspace_id", access.workspace.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    loadPlanOverview(access.workspace.id),
    loadPaymentMethods(access.workspace.id),
  ]);

  const customer = access.workspace;

  const requestedPlanId = parseRequestedPlan(searchParams?.plan);

  return (
    <MypageSettings
      canManage={access.membership.role === "owner" || access.membership.role === "admin"}
      initialSection={requestedPlanId ? "plan" : parseSection(searchParams?.section)}
      requestedPlanId={requestedPlanId}
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
      plan={planOverview.plan}
      today={seoulToday()}
      startedAt={planOverview.startedAt}
      memberCount={planOverview.memberCount}
      paymentMethods={paymentMethods}
      cardNotice={parseCardNotice(searchParams?.card)}
    />
  );
}
