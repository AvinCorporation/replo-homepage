"use client";

import { useState } from "react";

// Small client island: the "요금제 더보기" toggle reveals additional plan
// tiers that differ by monthly inquiry volume and service scope. Kept out of
// the server page so the rest of /ads stays static-friendly. The CTA target
// (with forwarded utm/fbclid query string) is passed down from the page.

const Chevron = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
);
const Check = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12.5l5 5 11-11" /></svg>
);
const Arrow = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

type Tier = {
  name: string;
  price: string;
  orig?: string;
  note?: string;
  volume: string;
  badge?: string;
  pop?: boolean;
  features: string[];
};

// Mirrors the real plan ladder (src/lib/billing/plans.ts + homeCopy pricing):
// Lite 79만원/300건, Basic 119만원/500건,
// Pro 199만원/1,000건, Enterprise 별도 협의/2,000건+.
const tiers: Tier[] = [
  {
    name: "Lite",
    price: "월 79만원",
    volume: "월 상담 300건",
    badge: "추천",
    pop: true,
    features: [
      "상담 응대 (채팅 · 게시판 · 이메일)",
      "반복 문의 자동화",
      "챗봇 구조설계",
      "FAQ · SOP 정리",
      "운영 대시보드 제공",
    ],
  },
  {
    name: "Basic",
    price: "월 119만원",
    volume: "월 상담 500건",
    features: [
      "Lite 전체 포함",
      "응대 가이드 제공",
      "교환 · 환불 · 클레임 운영",
      "운영 인사이트 분석",
    ],
  },
  {
    name: "Pro",
    price: "월 199만원",
    volume: "월 상담 1,000건",
    features: [
      "전화 · 채팅 · 게시판 · 이메일 응대",
      "CS 정책 설계 · 응대 가이드",
      "실시간 운영 대시보드",
      "VOC 분석 · 개선 제안",
    ],
  },
  {
    name: "Enterprise",
    price: "별도 협의",
    volume: "월 상담 2,000건+",
    features: [
      "전담 매니저 · 정기 CX 미팅",
      "API · 시스템 연동",
      "맞춤 운영 체계 설계",
    ],
  },
];

export function PlanTiers({ contactHref }: { contactHref: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="ads-tiers-wrap">
      <button
        type="button"
        className="ads-more"
        aria-expanded={open}
        aria-controls="ads-tier-list"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "요금제 접기" : "문의량별 요금제 더보기"}
        {Chevron}
      </button>

      {open && (
        <div className="ads-tiers" id="ads-tier-list">
          <p className="hint">문의 응대량과 서비스 범위에 따라 선택할 수 있습니다.</p>
          {tiers.map((t) => (
            <div className={`ads-tier${t.pop ? " pop" : ""}`} key={t.name}>
              <div className="thead">
                <span className="tname">
                  {t.name}
                  {t.badge && <span className="tbadge">{t.badge}</span>}
                </span>
                <span className="tprice">
                  <b>{t.price}</b>
                  {(t.note || t.orig) && (
                    <em>
                      {t.note}
                      {t.note && t.orig ? " · " : ""}
                      {t.orig && <s>{t.orig}</s>}
                    </em>
                  )}
                </span>
              </div>
              <span className="tvol">{t.volume}</span>
              <ul>
                {t.features.map((f) => (
                  <li key={f}>{Check}{f}</li>
                ))}
              </ul>
              <a className="ads-cta" href={contactHref}>
                무료 진단으로 시작{Arrow}
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
