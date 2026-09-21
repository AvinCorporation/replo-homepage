import { redirect } from "next/navigation";
import { sanitizeNextPath } from "@/lib/auth/redirect";

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { error?: string; next?: string | string[] };
}) {
  const query = new URLSearchParams({ login: "1" });
  if (searchParams?.error === "auth_failed") {
    query.set("error", "auth_failed");
  }
  // 요금제 신청처럼 목적지가 있는 로그인은 돌아갈 경로를 홈 로그인 창까지 넘깁니다.
  const nextParam = Array.isArray(searchParams?.next)
    ? searchParams?.next[0]
    : searchParams?.next;
  const next = sanitizeNextPath(nextParam);
  if (next) {
    query.set("next", next);
  }
  redirect(`/?${query.toString()}`);
}
