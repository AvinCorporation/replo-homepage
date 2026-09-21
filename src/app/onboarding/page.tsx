"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { sanitizeNextPath } from "@/lib/auth/redirect";
import { trackMetaEvent } from "@/lib/meta/client";

type OnboardingForm = {
  companyName: string;
  representativeName: string;
  phone: string;
  billingEmail: string;
  brandName: string;
  websiteUrl: string;
};

const initialForm: OnboardingForm = {
  companyName: "",
  representativeName: "",
  phone: "",
  billingEmail: "",
  brandName: "",
  websiteUrl: "",
};

function normalizeWebsiteUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // 로그인 전에 보려던 화면(예: 요금제 신청)을 워크스페이스 생성 후까지 이어 갑니다.
  const nextPath = sanitizeNextPath(searchParams.get("next"));

  useEffect(() => {
    const eventId = searchParams.get("event_id");
    if (searchParams.get("registered") !== "1" || !eventId) return;

    void trackMetaEvent("CompleteRegistration", {
      eventId,
      customData: { content_name: "google_auth" },
    }).finally(() => {
      router.replace(
        nextPath ? `/onboarding?next=${encodeURIComponent(nextPath)}` : "/onboarding",
      );
    });
  }, [nextPath, router, searchParams]);

  function updateField(field: keyof OnboardingForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedWebsiteUrl = normalizeWebsiteUrl(form.websiteUrl);
    setSubmitting(true);
    setMessage("");

    const response = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, websiteUrl: normalizedWebsiteUrl }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      setSubmitting(false);
      setMessage(result.error || "워크스페이스를 만들지 못했습니다.");
      return;
    }

    await trackMetaEvent("complete_onboarding", {
      customData: {
        content_name: "workspace_onboarding",
        status: "completed",
      },
      userData: {
        email: form.billingEmail,
        phone: form.phone,
      },
    });
    router.replace(nextPath ?? "/dashboard");
    router.refresh();
  }

  return (
    <main className="onboarding-page">
      <form
        onSubmit={submit}
        className="onboarding-card"
      >
        <span className="onboarding-logo">Replo<sup>+</sup></span>
        <p className="onboarding-step">워크스페이스 설정</p>
        <h1>회사와 브랜드 정보를 입력해 주세요.</h1>
        <p className="onboarding-description">
          입력하신 정보는 워크스페이스 설정과 요금제 청구 정보로 사용됩니다.
          워크스페이스를 만들면 바로 요금제를 신청하고 결제 카드를 등록할 수 있습니다.
        </p>

        <div className="onboarding-grid">
          {[
            ["companyName", "회사명", "organization", true],
            ["representativeName", "담당자명", "name", true],
            ["phone", "휴대폰번호", "tel", false],
            ["billingEmail", "이메일", "email", false],
            ["brandName", "주요 운영 브랜드명", "organization", true],
            ["websiteUrl", "브랜드 홈페이지 URL", "url", false],
          ].map(([field, label, autoComplete, required]) => {
            const isBrandName = field === "brandName";
            const isWebsiteUrl = field === "websiteUrl";
            const isPhone = field === "phone";
            const isRepName = field === "representativeName";
            const isCompany = field === "companyName";
            const isEmail = field === "billingEmail";
            return (
            <label key={String(field)}>
              {label}
              <input
                type={field === "billingEmail" ? "email" : isPhone ? "tel" : "text"}
                required={Boolean(required)}
                autoComplete={String(autoComplete)}
                inputMode={isPhone ? "numeric" : undefined}
                placeholder={
                  isCompany
                    ? "예: 주식회사 아빈코퍼레이션"
                    : isBrandName
                      ? "예: 리플로"
                      : isWebsiteUrl
                        ? "예: https://replo.kr"
                        : isPhone
                          ? "예: 010-1234-5678"
                          : isRepName
                            ? "예) 홍길동"
                            : isEmail
                              ? "예: replo@replo.kr"
                              : undefined
                }
                value={form[field as keyof OnboardingForm]}
                onChange={(event) =>
                  updateField(
                    field as keyof OnboardingForm,
                    isPhone ? formatPhone(event.target.value) : event.target.value,
                  )
                }
              />
              {isBrandName ? (
                <small>우선 운영할 대표 브랜드명을 입력해 주세요.</small>
              ) : null}
            </label>
          );
          })}
        </div>

        {message ? (
          <p className="onboarding-error" role="alert">
            {message}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          className="onboarding-submit"
        >
          {submitting ? "생성 중..." : "워크스페이스 만들기"}
        </button>
      </form>
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <main className="onboarding-page">
          <div className="onboarding-card">
            <span className="onboarding-logo">Replo<sup>+</sup></span>
            <p className="onboarding-step">워크스페이스 설정</p>
            <h1>회사와 브랜드 정보를 입력해 주세요.</h1>
          </div>
        </main>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
