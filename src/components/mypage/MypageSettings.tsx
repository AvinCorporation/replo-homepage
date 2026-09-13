"use client";

import Link from "next/link";
import { BillingSettings } from "./BillingSettings";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { MemberManagement } from "@/components/mypage/MemberManagement";
import { PortalRail } from "@/components/portal/PortalRail";
import { createClient } from "@/lib/supabase/client";

type Section = "profile" | "plan" | "members";

type Props = {
  initialSection?: Section;
  canManage: boolean;
  loginEmail: string;
  roleLabel: string;
  customer: {
    companyName: string;
    brandName: string;
    representativeName: string;
    contactName: string;
    email: string;
    phone: string;
    websiteUrl: string;
    businessNumber: string;
    billingEmail: string;
  };

};

const menus: Array<{ id: Section; label: string; description: string }> = [
  { id: "profile", label: "고객 정보", description: "회사와 브랜드 정보" },
  { id: "plan", label: "이용 플랜", description: "플랜과 자동결제" },
  { id: "members", label: "멤버 관리", description: "구성원과 역할" },
];

const sectionTitles: Record<Section, [string, string]> = {
  profile: ["고객 정보", "고객사와 브랜드의 기본 정보를 관리합니다."],
  plan: ["이용 플랜", "이용 조건과 결제수단, 청구 내역을 확인합니다."],
  members: ["멤버 관리", "워크스페이스 구성원과 역할을 관리합니다."],
};

type ProfileField = keyof Props["customer"];

const profileFields: Array<{
  key: ProfileField;
  label: string;
  required: boolean;
  placeholder: string;
}> = [
  { key: "companyName", label: "회사명", required: true, placeholder: "주식회사 리플로" },
  { key: "brandName", label: "브랜드명", required: true, placeholder: "Replo" },
  { key: "representativeName", label: "대표 담당자", required: true, placeholder: "김리플" },
  { key: "contactName", label: "실무 담당자", required: false, placeholder: "운영 담당자" },
  { key: "email", label: "고객 연락 이메일", required: true, placeholder: "hello@company.com" },
  { key: "phone", label: "연락처", required: false, placeholder: "02-0000-0000" },
  { key: "websiteUrl", label: "웹사이트", required: false, placeholder: "https://example.com" },
  { key: "businessNumber", label: "사업자등록번호", required: false, placeholder: "000-00-00000" },
];

export function MypageSettings(props: Props) {
  const router = useRouter();
  const [active, setActive] = useState<Section>(
    props.initialSection ?? "profile",
  );
  const [profile, setProfile] = useState(props.customer);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const title = sectionTitles[active];
  const signOut = async () => {
    await createClient().auth.signOut();
    router.replace("/");
    router.refresh();
  };

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/mypage/customer", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) setError(result.error || "고객 정보를 저장하지 못했습니다.");
      else setMessage(result.message || "고객 정보를 저장했습니다.");
    } catch {
      setError("네트워크 연결을 확인해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mypage-shell">
      <PortalRail active="account" workspaceName={profile.brandName} />

      <aside className="mypage-menu">
        <div className="mypage-menu-head">
          <Link href="/dashboard" aria-label="대시보드로 돌아가기">‹</Link>
          <strong>설정</strong>
        </div>
        <div className="mypage-menu-list">
          {menus.map((menu) => (
            <button
              key={menu.id}
              type="button"
              className={active === menu.id ? "active" : ""}
              onClick={() => {
                setActive(menu.id);
                router.replace(`/mypage?section=${menu.id}`, { scroll: false });
                setMessage("");
                setError("");
              }}
            >
              <strong>{menu.label}</strong>
              <span>{menu.description}</span>
            </button>
          ))}
        </div>
        <button type="button" className="mypage-logout" onClick={signOut}>로그아웃</button>
      </aside>

      <main className="mypage-content">
        <header className="mypage-title">
          <p>WORKSPACE SETTINGS</p>
          <h1>{title[0]}</h1>
          <span>{title[1]}</span>
        </header>

        {message ? <p className="mypage-message success" role="status">{message}</p> : null}
        {error ? <p className="mypage-message error" role="alert">{error}</p> : null}

        {active === "profile" ? (
          <form className="mypage-card profile-form" onSubmit={saveProfile}>
            <div className="mypage-card-head">
              <div>
                <h2>기본 정보</h2>
                <p>대시보드와 운영 문서에 표시되는 정보입니다.</p>
              </div>
              <span>{props.roleLabel}</span>
            </div>
            <div className="mypage-form-grid">
              {profileFields.map((field) => (
                <label key={field.key}>
                  <span>{field.label}{field.required ? " *" : ""}</span>
                  <input
                    type={field.key.toLowerCase().includes("email") ? "email" : "text"}
                    required={field.required}
                    placeholder={field.placeholder}
                    value={profile[field.key]}
                    disabled={!props.canManage}
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                  />
                </label>
              ))}
              <label>
                <span>로그인 이메일</span>
                <input value={props.loginEmail} disabled readOnly />
                <small>Google 계정 식별자는 이 화면에서 변경할 수 없습니다.</small>
              </label>
            </div>
            <div className="mypage-form-actions">
              <button type="submit" disabled={!props.canManage || saving}>
                {saving ? "저장 중..." : "변경사항 저장"}
              </button>
              {!props.canManage ? <p>owner 또는 admin만 수정할 수 있습니다.</p> : null}
            </div>
          </form>
        ) : null}

        {active === "plan" ? <BillingSettings /> : null}

        {active === "members" ? <div className="embedded-settings"><MemberManagement /></div> : null}
      </main>
    </div>
  );
}
