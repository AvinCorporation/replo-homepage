import Link from "next/link";

export const metadata = {
  title: "회원 탈퇴 완료 | Replo",
  description: "Replo 회원 탈퇴가 정상적으로 처리되었습니다.",
};

export default function AccountWithdrawnPage() {
  return (
    <main className="diagnosis-page">
      <div className="diagnosis-shell diagnosis-success-shell">
        <nav className="diagnosis-nav" aria-label="탈퇴 완료 내비게이션">
          <Link href="/" className="diagnosis-logo" aria-label="Replo 홈">
            Replo<sup>+</sup>
          </Link>
        </nav>

        <section className="diagnosis-card diagnosis-success" aria-live="polite">
          <span className="diagnosis-kicker">탈퇴 완료</span>
          <h1>회원 탈퇴가 완료되었습니다.</h1>
          <p>
            그동안 Replo를 이용해 주셔서 감사합니다. 이름·이메일 등 개인정보는 삭제했으며,
            결제와 세금 관련 기록은 관련 법령에 따라 보관합니다.
          </p>
          <Link href="/" className="diagnosis-submit diagnosis-link-button">
            홈으로 돌아가기
          </Link>
        </section>
      </div>
    </main>
  );
}
