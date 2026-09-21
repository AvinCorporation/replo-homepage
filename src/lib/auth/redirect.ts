const PRODUCTION_SITE_URL = "https://replo.kr";
const LOCAL_SITE_URL = "http://localhost:3000";

function isLocalhost(url: URL) {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

function normalizeSiteUrl(value: string | undefined) {
  if (!value?.trim()) {
    return null;
  }

  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

export function getSiteUrl() {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const configuredUrl = normalizeSiteUrl(configuredSiteUrl);

  if (configuredUrl) {
    if (process.env.NODE_ENV !== "production" || !isLocalhost(configuredUrl)) {
      return configuredUrl.origin;
    }

    console.warn(
      "NEXT_PUBLIC_SITE_URL points to localhost in a production build. Using the current deployment origin.",
    );
  } else if (configuredSiteUrl) {
    console.warn("NEXT_PUBLIC_SITE_URL is invalid. Using the current deployment origin.");
  }

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  const vercelUrl = normalizeSiteUrl(
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  );

  if (vercelUrl) {
    return vercelUrl.origin;
  }

  return process.env.NODE_ENV === "production" ? PRODUCTION_SITE_URL : LOCAL_SITE_URL;
}

// 로그인 뒤 돌아갈 내부 경로만 허용합니다. 외부 주소(`//evil.com`, `https://...`)나
// 경로가 아닌 값은 버리고, 호출한 쪽이 기본 경로를 쓰게 합니다.
export function sanitizeNextPath(value: string | null | undefined) {
  const candidate = value?.trim();
  if (!candidate) return null;
  if (!candidate.startsWith("/")) return null;
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return null;
  return candidate;
}

// Supabase는 허용 목록에 등록된 redirect URL만 사용합니다. 쿼리를 덧붙이면 목록과
// 어긋나 로그인 자체가 깨질 수 있어, 복귀 경로는 쿼리 대신 아래 쿠키로 전달합니다.
export const LOGIN_NEXT_COOKIE = "replo_login_next";

export function getAuthCallbackUrl() {
  return new URL("/auth/callback", getSiteUrl()).toString();
}

// OAuth로 떠나기 전에 복귀 경로를 잠깐 저장합니다(10분). 같은 사이트 top-level
// 이동으로 돌아오므로 SameSite=Lax로 충분합니다.
export function rememberLoginNextPath(next: string | null | undefined) {
  const safeNext = sanitizeNextPath(next);
  if (!safeNext || typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${LOGIN_NEXT_COOKIE}=${encodeURIComponent(safeNext)}; path=/; max-age=600; samesite=lax${secure}`;
}

// `/mypage?section=plan`처럼 로그인이 필요한 화면으로 보낼 때, 로그인 후 돌아올
// 경로를 함께 넘깁니다.
export function loginPathWithNext(next: string) {
  const safeNext = sanitizeNextPath(next);
  return safeNext ? `/login?next=${encodeURIComponent(safeNext)}` : "/login";
}
