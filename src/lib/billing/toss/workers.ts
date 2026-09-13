import "server-only";
import { billingAdmin, rpc } from "./server";
import { billingConfig } from "./config";
import { decryptCredential } from "./crypto";
import {
  invoiceAmount,
  nextCycle,
  parsePolicy,
  retryAt,
  safeFailureMessage,
  seoulToday,
} from "./domain";
import { TossClient, TossError, type TossPayment } from "./client";
const BATCH_SIZE = 2; // Each provider request allows 65s; bounded within the route duration.
type Attempt = {
  id: string;
  workspace_id: string;
  invoice_id: string;
  payment_method_id: string;
  amount: number;
  order_id: string;
  idempotency_key: string;
  order_name: string;
  lease_token: string;
  status: string;
};
export async function generateInvoices() {
  const admin = billingAdmin();
  const today = seoulToday();
  const { data: subscriptions, error } = await admin
    .from("subscriptions")
    .select("*")
    .not("enrollment_confirmed_at", "is", null)
    .or(
      `invoice_generation_date.lte.${today},and(invoice_generation_date.is.null,next_billing_date.lte.${today})`,
    )
    .in("status", ["active", "past_due", "pending_payment_method"])
    .order("billing_generation_checked_at", {
      ascending: true,
      nullsFirst: true,
    })
    .order("next_billing_date")
    .limit(50);
  if (error) throw new Error("BILLING_DATABASE_ERROR");
  let generated = 0;
  for (const s of subscriptions ?? []) {
    try {
      const checked = await admin
        .from("subscriptions")
        .update({ billing_generation_checked_at: new Date().toISOString() })
        .eq("id", s.id);
      if (checked.error) throw new Error("BILLING_DATABASE_ERROR");
      const policy = parsePolicy(s.billing_policy);
      if (
        !s.auto_charge_start_date ||
        !s.first_period_start ||
        !s.billing_anchor_day
      )
        continue;
      const { data: latest, error: latestError } = await admin
        .from("billing_invoices")
        .select("next_billing_date")
        .eq("subscription_id", s.id)
        .order("billing_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) throw new Error("BILLING_DATABASE_ERROR");
      let date: string = latest?.next_billing_date ?? s.next_billing_date;
      if (!latest && policy.firstCharge === "registration") {
        const { data: card, error: cardError } = await admin
          .from("payment_methods")
          .select("registered_at")
          .eq("workspace_id", s.workspace_id)
          .eq("provider", "toss")
          .eq("status", "active")
          .eq("is_default", true)
          .maybeSingle();
        if (cardError) throw new Error("BILLING_DATABASE_ERROR");
        if (!card?.registered_at) continue;
        date = seoulToday(new Date(card.registered_at));
      }
      // Enrollment dates are explicitly confirmed; never infer historic arrears.
      const start = latest ? date : s.first_period_start;
      if (
        date > today ||
        date < s.auto_charge_start_date ||
        start < s.auto_charge_start_date ||
        (s.paid_through && start < s.paid_through) ||
        (s.invoice_stop_date && date >= s.invoice_stop_date)
      )
        continue;
      const amount = invoiceAmount(s.monthly_fee, policy.vat);
      if (amount === 0) continue;
      const next = nextCycle(date, s.billing_anchor_day);
      const created = await rpc<boolean>("billing_create_invoice", {
        p_subscription: s.id,
        p_updated_at: s.updated_at,
        p_invoice: {
          billing_date: date,
          period_start: start,
          period_end: next,
          amount,
          policy_snapshot: policy,
          next_billing_date: next,
          next_attempt_at: `${date}T00:00:00+09:00`,
        },
      });
      if (created) generated++;
    } catch {
      console.warn("billing.invoice_generation_requires_review", {
        subscription_id: s.id,
        workspace_id: s.workspace_id,
      });
    }
  }
  return generated;
}
async function saveSuccess(attempt: Attempt, payment: TossPayment) {
  if (
    payment.orderId !== attempt.order_id ||
    payment.totalAmount !== attempt.amount ||
    !payment.paymentKey ||
    !["DONE", "PARTIAL_CANCELED", "CANCELED"].includes(payment.status) ||
    !payment.approvedAt
  )
    throw new Error("PAYMENT_MISMATCH");
  let receipt: string | null = null;
  if (payment.receipt?.url) {
    try {
      const url = new URL(payment.receipt.url);
      if (url.protocol === "https:") receipt = url.href;
    } catch {}
  }
  await rpc("billing_record_success", {
    p_attempt: attempt.id,
    p_payment_key: payment.paymentKey,
    p_amount: payment.totalAmount,
    p_approved_at: payment.approvedAt,
    p_receipt: receipt,
  });
  for (const cancel of payment.cancels ?? []) {
    await rpc("billing_record_cancellation", {
      p_attempt: attempt.id,
      p_transaction: cancel.transactionKey,
      p_amount: cancel.cancelAmount,
      p_status: cancel.cancelStatus,
      p_canceled_at: cancel.canceledAt,
    });
  }
}
async function saveFailure(attempt: Attempt, error: TossError) {
  const { data: invoice, error: invoiceError } = await billingAdmin()
    .from("billing_invoices")
    .select("billing_date,policy_snapshot,retry_count")
    .eq("id", attempt.invoice_id)
    .single();
  if (invoiceError || !invoice) throw new Error("BILLING_DATABASE_ERROR");
  const next =
    error.category === "retryable"
      ? retryAt(
          parsePolicy(invoice.policy_snapshot).retry,
          invoice.billing_date,
          new Date().toISOString(),
          invoice.retry_count,
        )
      : null;
  await rpc("billing_record_failure", {
    p_attempt: attempt.id,
    p_category: error.category,
    p_code: error.code,
    p_message: safeFailureMessage(error.category),
    p_retry_at: next,
  });
}
export async function processCharges() {
  if (!billingConfig().chargesEnabled) return 0;
  const admin = billingAdmin();
  const invoices = await rpc<Array<{ id: string }>>("billing_due_invoice_ids", {
    p_limit: BATCH_SIZE,
  });
  let charged = 0;
  for (const invoice of invoices ?? []) {
    if (!billingConfig().chargesEnabled) break;
    const attempt = await rpc<Attempt | null>("billing_claim_invoice", {
      p_invoice: invoice.id,
    });
    if (!attempt) continue;
    const { data: credential, error: credentialError } = await admin
      .from("billing_credentials")
      .select("encrypted_billing_key,encryption_key_version")
      .eq("workspace_id", attempt.workspace_id)
      .eq("payment_method_id", attempt.payment_method_id)
      .eq("status", "active")
      .single();
    const { data: profile, error: profileError } = await admin
      .from("billing_profiles")
      .select("customer_key")
      .eq("workspace_id", attempt.workspace_id)
      .single();
    if (credentialError || profileError || !credential || !profile)
      throw new Error("BILLING_CREDENTIAL_UNAVAILABLE");
    const config = billingConfig();
    const key = decryptCredential(
      credential.encrypted_billing_key,
      credential.encryption_key_version,
      `${attempt.workspace_id}:${attempt.payment_method_id}`,
      config.keyRing,
    );
    if (!billingConfig().chargesEnabled) break;
    if (
      !(await rpc<boolean>("billing_authorize_attempt", {
        p_attempt: attempt.id,
        p_lease: attempt.lease_token,
      }))
    )
      continue;
    let payment: TossPayment;
    try {
      payment = await new TossClient(config.secretKey).charge(
        key,
        {
          customerKey: profile.customer_key,
          amount: attempt.amount,
          orderId: attempt.order_id,
          orderName: attempt.order_name,
        },
        attempt.idempotency_key,
      );
    } catch (error) {
      await saveFailure(
        attempt,
        error instanceof TossError
          ? error
          : new TossError("RESPONSE_UNKNOWN", 0),
      );
      continue;
    }
    // Deliberately outside the provider-error catch: a DB write error after approval
    // leaves the original processing attempt for reconciliation, never retry creation.
    await saveSuccess(attempt, payment);
    charged++;
  }
  return charged;
}
export async function reconcilePayments() {
  const admin = billingAdmin();
  const now = new Date().toISOString();
  const { data: attempts, error } = await admin
    .from("payment_attempts")
    .select("id")
    .in("status", [
      "created",
      "processing",
      "unknown",
      "reconciling",
      "succeeded",
    ])
    .or(`lease_until.is.null,lease_until.lt.${now}`)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);
  if (error) throw new Error("BILLING_DATABASE_ERROR");
  let recovered = 0;
  for (const row of attempts ?? []) {
    const a = await rpc<Attempt | null>("billing_claim_reconciliation", {
      p_attempt: row.id,
    });
    if (!a) continue;
    try {
      const payment = await new TossClient(billingConfig().secretKey).lookup(
        a.order_id,
      );
      await saveSuccess(a, payment);
      recovered++;
    } catch {
      console.warn("billing.reconciliation_pending", {
        payment_attempt_id: a.id,
        invoice_id: a.invoice_id,
      });
      // Includes NOT_FOUND_PAYMENT: absence alone does not prove a timed-out charge failed.
      // Preserve identity and require subsequent lookup/operator resolution; never send a new order.
    } finally {
      const { error: releaseError } = await admin
        .from("payment_attempts")
        .update({ lease_until: null })
        .eq("id", a.id)
        .eq("lease_token", a.lease_token);
      if (releaseError) throw new Error("BILLING_DATABASE_ERROR");
    }
  }
  return recovered;
}
