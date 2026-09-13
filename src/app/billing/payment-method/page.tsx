import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Preserve old bookmarks while the billing settings live under /mypage.
export default function PaymentMethodPage() {
  redirect("/mypage?section=plan");
}
