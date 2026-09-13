import { randomBytes } from "node:crypto";
export const dynamic = "force-dynamic";
export function GET() {
  const nonce = randomBytes(18).toString("base64");
  // Standalone response deliberately bypasses the root analytics/chat layout.
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>자동결제 카드 등록</title><style nonce="${nonce}">
  :root{color-scheme:light;font-family:Pretendard,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#182033;background:#f4f5f8}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at top,#eeeaff 0,#f4f5f8 42%)}main{width:min(100%,520px);padding:40px;border:1px solid #e0e3ea;border-radius:20px;background:#fff;box-shadow:0 18px 60px rgba(30,35,55,.10)}.brand{margin:0 0 28px;color:#5b47e0;font-size:13px;font-weight:800;letter-spacing:.12em}h1{margin:0;font-size:28px;line-height:1.3}#result{min-height:52px;margin:18px 0 26px;color:#566074;line-height:1.65}#result[data-state="success"]{color:#26724b}#result[data-state="error"]{color:#b33a3a}a{display:inline-flex;align-items:center;justify-content:center;width:100%;padding:13px 18px;border-radius:10px;background:#5b47e0;color:#fff;font-weight:700;text-decoration:none}.hint{margin:14px 0 0;color:#8a91a1;font-size:12px;text-align:center}@media(max-width:520px){main{padding:30px 24px;border-radius:16px}h1{font-size:24px}}
  </style></head><body><main><p class="brand">REPLO BILLING</p><h1>자동결제 카드 등록</h1><p id="result" role="status">카드 등록 결과를 확인 중입니다.</p><a href="/mypage?section=plan">이용 플랜으로 돌아가기</a><p class="hint">등록 완료는 이용료 결제 완료를 의미하지 않습니다.</p></main><script nonce="${nonce}">
  const q=new URLSearchParams(location.search);
  const input={session:q.get('session'),state:q.get('state'),authKey:q.get('authKey'),customerKey:q.get('customerKey')};
  history.replaceState(null,'','/mypage/billing/callback');
  const result=document.getElementById('result');
  if(!input.authKey){result.dataset.state='error';result.textContent='카드 인증이 완료되지 않았습니다. 기존 결제수단은 유지됩니다.';}
  else fetch('/api/billing/callback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(typeof d.error==='string'?d.error:'카드 등록을 확인하지 못했습니다.');result.dataset.state='success';result.textContent='카드가 등록되었습니다. 잠시 후 이용 플랜으로 돌아갑니다.';setTimeout(()=>location.replace('/mypage?section=plan'),2200);}).catch(e=>{result.dataset.state='error';result.textContent=e instanceof Error&&e.message?e.message:'카드 등록을 확인하지 못했습니다. 마이페이지에서 결제수단을 확인해 주세요.';});
  </script></body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    },
  });
}
