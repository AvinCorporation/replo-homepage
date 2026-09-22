// 상태를 바꾸는 요청은 같은 사이트에서 온 것만 받습니다. 결제 API의 checkOrigin은
// 토스 설정(billingConfig)에 의존하므로, 결제와 무관한 API는 이 검사를 씁니다.
export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
