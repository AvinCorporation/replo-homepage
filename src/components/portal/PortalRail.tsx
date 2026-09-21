import Link from "next/link";
import styles from "./PortalRail.module.css";

export type PortalSection = "dashboard" | "reports" | "integrations" | "billing" | "account";

function NavIcon({ type }: { type: PortalSection }) {
  const paths = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    reports: (
      <>
        <path d="M5 20V10" />
        <path d="M12 20V4" />
        <path d="M19 20v-7" />
        <path d="M3 20h18" />
      </>
    ),
    integrations: (
      <>
        <path d="M8 12h8" />
        <path d="M12 8v8" />
        <rect x="3" y="3" width="18" height="18" rx="5" />
      </>
    ),
    billing: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="3" />
        <path d="M3 10h18" />
      </>
    ),
    account: (
      <>
        <circle cx="12" cy="8" r="3" />
        <path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[type]}
    </svg>
  );
}

export function PortalRail({
  active,
  workspaceName,
}: {
  active: PortalSection;
  workspaceName: string;
}) {
  const items: Array<{ id: PortalSection; href: string; label: string }> = [
    { id: "dashboard", href: "/dashboard", label: "대시보드" },
    { id: "reports", href: "/dashboard/reports", label: "리포트" },
    // 요금제 신청·결제 카드 등록은 대시보드에서 바로 갈 수 있어야 합니다.
    { id: "billing", href: "/mypage?section=plan", label: "요금제" },
    { id: "account", href: "/mypage", label: "계정" },
  ];

  return (
    <nav className={styles.rail} aria-label="주요 메뉴">
      <Link href="/" className={styles.logo} aria-label="Replo 홈">
        R<sup>+</sup>
      </Link>
      <div className={styles.menu}>
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className={`${styles.link} ${active === item.id ? styles.active : ""}`}
            aria-current={active === item.id ? "page" : undefined}
          >
            <NavIcon type={item.id} />
            <span>{item.label}</span>
          </Link>
        ))}
      </div>
      <Link href="/mypage" className={styles.profile} aria-label="마이페이지">
        {workspaceName.slice(0, 1) || "R"}
      </Link>
    </nav>
  );
}
