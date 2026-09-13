import { randomBytes } from "node:crypto";
export const dynamic = "force-dynamic";
export function GET() {
  const nonce = randomBytes(18).toString("base64");
  // Standalone response deliberately bypasses the root analytics/chat layout.
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>자동결제 카드 등록</title><body><main><h1>자동결제 카드 등록</h1><p id="result" role="status">카드 등록 결과를 확인 중입니다.</p><a href="/mypage">마이페이지로 돌아가기</a></main><script nonce="${nonce}">
  const q=new URLSearchParams(location.search);
  const input={session:q.get('session'),state:q.get('state'),authKey:q.get('authKey'),customerKey:q.get('customerKey')};
  history.replaceState(null,'','/mypage/billing/callback');
  const result=document.getElementById('result');
  if(!input.authKey){result.textContent='카드 인증이 완료되지 않았습니다. 기존 결제수단은 유지됩니다.';}
  else fetch('/api/billing/callback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}).then(r=>{if(!r.ok)throw Error();result.textContent='카드가 등록되었습니다. 카드 등록은 이용료 결제 완료를 의미하지 않습니다.';}).catch(()=>{result.textContent='카드 등록을 확인하지 못했습니다. 마이페이지에서 결제수단을 확인해 주세요.';});
  </script></body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    },
  });
}
