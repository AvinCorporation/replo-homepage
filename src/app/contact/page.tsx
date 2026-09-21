"use client";

import { FormEvent, useState } from "react";
import { trackMetaEvent } from "@/lib/meta/client";

const businessTypeOptions = [
  "자사몰을 직접 운영해요",
  "네이버 스마트스토어, 쿠팡, 오픈마켓에서 판매해요",
  "자사몰과 오픈마켓을 함께 운영해요",
  "기타 서비스를 운영 중이에요",
];

const monthlyInquiriesOptions = [
  "50건 이하",
  "300건 이하",
  "500건 이하",
  "1,000건 이하",
  "1,000건 이상",
  "잘 모르겠어요",
];

const mainPainOptions = [
  "반복 문의를 줄이고 싶어요",
  "CS 비용을 줄이고 싶어요",
  "상담 인력이 부족해요",
  "CS 운영 기준이 없어요",
  "고객 불만·클레임 대응이 어려워요",
  "다른 고민이 있어요",
];

type DiagnosisForm = {
  businessType: string;
  monthlyInquiries: string;
  mainPain: string;
  companyName: string;
  websiteUrl: string;
  contactName: string;
  phone: string;
  workEmail: string;
};

const initialForm: DiagnosisForm = {
  businessType: "",
  monthlyInquiries: "",
  mainPain: "",
  companyName: "",
  websiteUrl: "",
  contactName: "",
  phone: "",
  workEmail: "",
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hostnamePattern =
  /^(?=.{4,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

function normalizeWebsiteUrl(value: string) {
  const input = value.trim();
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;

  try {
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (!hostnamePattern.test(url.hostname.toLowerCase())) return "";
    return url.toString();
  } catch {
    return "";
  }
}

export default function ContactPage() {
  const [form, setForm] = useState<DiagnosisForm>(initialForm);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField(name: keyof DiagnosisForm, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
    if (error) setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const hasMissingField = Object.values(form).some((value) => value.trim() === "");
    if (hasMissingField) {
      setError("모든 항목을 입력해 주세요.");
      return;
    }

    const websiteUrl = normalizeWebsiteUrl(form.websiteUrl);
    if (!websiteUrl) {
      setError("홈페이지 주소 형식을 확인해 주세요.");
      return;
    }

    if (!emailPattern.test(form.workEmail.trim())) {
      setError("직장 이메일 형식을 확인해 주세요.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/diagnosis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, websiteUrl }),
      });
      const result = await response.json();

      if (!response.ok) {
        setError(result.error ?? "운영 진단 신청 중 오류가 발생했습니다.");
        return;
      }

      await trackMetaEvent("Lead", {
        customData: {
          content_name: "contact_diagnosis",
          status: "submitted",
        },
        userData: {
          email: form.workEmail,
          phone: form.phone,
        },
      });
      window.location.assign("/contact/success");
    } catch {
      setError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="diagnosis-page">
      <div className="diagnosis-shell">
        <nav className="diagnosis-nav" aria-label="진단 신청 내비게이션">
          <a href="/" className="diagnosis-logo" aria-label="Replo home">
            Replo<sup>+</sup>
          </a>
          <a className="diagnosis-home-link" href="/">
            홈페이지로 돌아가기
          </a>
        </nav>

        <div className="diagnosis-layout">
          <section className="diagnosis-hero">
            <span className="diagnosis-kicker">무료 CS 운영 진단</span>
            <h1>
              지금 고객센터 운영,
              <br />
              채용보다 먼저 진단해 보세요.
            </h1>
            <p>
              링크 하나면 시작됩니다. 남겨주신 URL로 운영 구조를 검토하여
              연락드립니다.
            </p>

          </section>

          <section className="diagnosis-card">
            <div className="diagnosis-header">
              <span className="diagnosis-step">STEP 01</span>
              <h2>운영 진단 신청</h2>
              <p>상담원이 확인할 수 있도록 모든 항목을 입력해 주세요.</p>
            </div>

            <form className="diagnosis-form" onSubmit={handleSubmit}>
              <div className="diagnosis-field-grid">
                <label>
                  <span>운영 중인 비즈니스 유형</span>
                  <select
                    required
                    value={form.businessType}
                    onChange={(event) => updateField("businessType", event.target.value)}
                  >
                    <option value="">선택해 주세요.</option>
                    {businessTypeOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>월 평균 고객 문의량</span>
                  <select
                    required
                    value={form.monthlyInquiries}
                    onChange={(event) => updateField("monthlyInquiries", event.target.value)}
                  >
                    <option value="">선택해 주세요.</option>
                    {monthlyInquiriesOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label>
                <span>현재 가장 큰 고민</span>
                <select
                  required
                  value={form.mainPain}
                  onChange={(event) => updateField("mainPain", event.target.value)}
                >
                  <option value="">선택해 주세요.</option>
                  {mainPainOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <div className="diagnosis-divider" />

              <label>
                <span>홈페이지 주소</span>
                <input
                  required
                  value={form.websiteUrl}
                  placeholder="예: replo.kr"
                  inputMode="url"
                  onChange={(event) => updateField("websiteUrl", event.target.value)}
                />
              </label>

              <div className="diagnosis-field-grid">
                <label>
                  <span>회사 이름</span>
                  <input
                    required
                    value={form.companyName}
                    placeholder="예: 아빈코퍼레이션"
                    onChange={(event) => updateField("companyName", event.target.value)}
                  />
                </label>

                <label>
                  <span>이름</span>
                  <input
                    required
                    value={form.contactName}
                    placeholder="예: 홍길동"
                    onChange={(event) => updateField("contactName", event.target.value)}
                  />
                </label>
              </div>

              <div className="diagnosis-field-grid">
                <label>
                  <span>전화번호</span>
                  <input
                    required
                    value={form.phone}
                    placeholder="010-0000-0000"
                    inputMode="tel"
                    onChange={(event) => updateField("phone", event.target.value)}
                  />
                </label>

                <label>
                  <span>직장 이메일</span>
                  <input
                    required
                    type="email"
                    value={form.workEmail}
                    placeholder="sales@replo.kr"
                    onChange={(event) => updateField("workEmail", event.target.value)}
                  />
                </label>
              </div>

              {error ? <p className="diagnosis-error">{error}</p> : null}

              <button className="diagnosis-submit" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "신청 중..." : "무료 운영 진단 신청하기"}
              </button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
