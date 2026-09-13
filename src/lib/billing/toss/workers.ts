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
import {
  processChargesWith,
  reconcilePaymentsWith,
  type WorkerAttempt as Attempt,
} from "./workerOrchestrator";

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
  const admin = billingAdmin();
  return processChargesWith({
    chargesEnabled: () => billingConfig().chargesEnabled,
    listDueInvoices: (limit) =>
      rpc<Array<{ id: string }>>("billing_due_invoice_ids", {
        p_limit: limit,
      }),
    claimInvoice: (invoiceId) =>
      rpc<Attempt | null>("billing_claim_invoice", {
        p_invoice: invoiceId,
      }),
    loadChargeMaterial: async (attempt) => {
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
      return {
        billingKey: decryptCredential(
          credential.encrypted_billing_key,
          credential.encryption_key_version,
          `${attempt.workspace_id}:${attempt.payment_method_id}`,
          config.keyRing,
        ),
        customerKey: profile.customer_key,
        secretKey: config.secretKey,
      };
    },
    authorizeAttempt: (attempt) =>
      rpc<boolean>("billing_authorize_attempt", {
        p_attempt: attempt.id,
        p_lease: attempt.lease_token,
      }),
    charge: (attempt, material) =>
      new TossClient(material.secretKey).charge(
        material.billingKey,
        {
          customerKey: material.customerKey,
          amount: attempt.amount,
          orderId: attempt.order_id,
          orderName: attempt.order_name,
        },
        attempt.idempotency_key,
      ),
    recordChargeFailure: saveFailure,
    recordChargeSuccess: saveSuccess,
    deferBeforeDispatch: (attempt, code) =>
      rpc("billing_defer_attempt", {
        p_attempt: attempt.id,
        p_code: code,
      }),
    isTossError: (error): error is TossError => error instanceof TossError,
    unknownTossError: () => new TossError("RESPONSE_UNKNOWN", 0),
    warn: (event, identifiers) => console.warn(event, identifiers),
  });
}

export async function reconcilePayments() {
  const admin = billingAdmin();
  return reconcilePaymentsWith({
    now: () => new Date(),
    listUnresolvedCandidates: async (lastCheckedBefore, limit) => {
      const now = new Date().toISOString();
      const { data, error } = await admin
        .from("payment_attempts")
        .select("id")
        .in("status", ["created", "processing", "unknown", "reconciling"])
        .or(`lease_until.is.null,lease_until.lt.${now}`)
        .or(
          `last_checked_at.is.null,last_checked_at.lt.${lastCheckedBefore}`,
        )
        .order("last_checked_at", { ascending: true, nullsFirst: true })
        .limit(limit);
      if (error) throw new Error("BILLING_DATABASE_ERROR");
      return data ?? [];
    },
    listSucceededCandidates: async (
      lastCheckedBefore,
      approvedAfter,
      limit,
    ) => {
      const now = new Date().toISOString();
      const { data, error } = await admin
        .from("payment_attempts")
        .select("id")
        .eq("status", "succeeded")
        .gte("approved_at", approvedAfter)
        .or(`lease_until.is.null,lease_until.lt.${now}`)
        .or(
          `last_checked_at.is.null,last_checked_at.lt.${lastCheckedBefore}`,
        )
        .order("last_checked_at", { ascending: true, nullsFirst: true })
        .limit(limit);
      if (error) throw new Error("BILLING_DATABASE_ERROR");
      return data ?? [];
    },
    claimReconciliation: (attemptId) =>
      rpc<Attempt | null>("billing_claim_reconciliation", {
        p_attempt: attemptId,
      }),
    lookup: (attempt) =>
      new TossClient(billingConfig().secretKey).lookup(attempt.order_id),
    recordReconciliationSuccess: saveSuccess,
    releaseLease: async (attempt) => {
      const { error } = await admin
        .from("payment_attempts")
        .update({ lease_until: null })
        .eq("id", attempt.id)
        .eq("lease_token", attempt.lease_token);
      if (error) throw new Error("BILLING_DATABASE_ERROR");
    },
    warn: (event, identifiers) => console.warn(event, identifiers),
  });
}
