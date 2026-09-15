import type { TossError, TossPayment } from "./client.ts";

export const BILLING_PROVIDER_BATCH_SIZE = 2;
export const UNRESOLVED_RECONCILIATION_COOLDOWN_MS = 10 * 60_000;
export const SUCCEEDED_PAYMENT_POLL_COOLDOWN_MS = 24 * 60 * 60_000;
export const SUCCEEDED_PAYMENT_POLL_WINDOW_MS = 90 * 24 * 60 * 60_000;

export type WorkerAttempt = {
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

export type ChargeMaterial = {
  billingKey: string;
  customerKey: string;
  secretKey: string;
};

export type ChargeOrchestratorDependencies = {
  chargesEnabled(): boolean;
  listDueInvoices(limit: number): Promise<Array<{ id: string }>>;
  claimInvoice(invoiceId: string): Promise<WorkerAttempt | null>;
  loadChargeMaterial(attempt: WorkerAttempt): Promise<ChargeMaterial>;
  authorizeAttempt(attempt: WorkerAttempt): Promise<boolean>;
  charge(
    attempt: WorkerAttempt,
    material: ChargeMaterial,
  ): Promise<TossPayment>;
  recordChargeFailure(attempt: WorkerAttempt, error: TossError): Promise<void>;
  recordChargeSuccess(
    attempt: WorkerAttempt,
    payment: TossPayment,
  ): Promise<void>;
  deferBeforeDispatch(attempt: WorkerAttempt, code: string): Promise<void>;
  isTossError(error: unknown): error is TossError;
  unknownTossError(): TossError;
  warn(event: string, identifiers: Record<string, string>): void;
};

export async function processChargesWith(
  deps: ChargeOrchestratorDependencies,
): Promise<number> {
  if (!deps.chargesEnabled()) return 0;

  const invoices = await deps.listDueInvoices(BILLING_PROVIDER_BATCH_SIZE);
  let charged = 0;

  for (const invoice of invoices) {
    if (!deps.chargesEnabled()) break;

    let attempt: WorkerAttempt | null = null;
    let providerRequestStarted = false;
    try {
      attempt = await deps.claimInvoice(invoice.id);
      if (!attempt) continue;

      const material = await deps.loadChargeMaterial(attempt);
      if (!deps.chargesEnabled()) {
        await deps.deferBeforeDispatch(attempt, "ENVIRONMENT_CHARGE_PAUSED");
        continue;
      }
      if (!(await deps.authorizeAttempt(attempt))) continue;

      providerRequestStarted = true;
      let payment: TossPayment;
      try {
        payment = await deps.charge(attempt, material);
      } catch (error) {
        await deps.recordChargeFailure(
          attempt,
          deps.isTossError(error) ? error : deps.unknownTossError(),
        );
        continue;
      }

      // Preserve request identity after dispatch so orderId reconciliation can
      // determine the provider result. Never defer it as an unsent attempt.
      await deps.recordChargeSuccess(attempt, payment);
      charged++;
    } catch {
      if (attempt && !providerRequestStarted) {
        try {
          await deps.deferBeforeDispatch(attempt, "CHARGE_PREFLIGHT_FAILED");
        } catch {
          deps.warn("billing.charge_preflight_defer_failed", {
            invoice_id: attempt.invoice_id,
            payment_attempt_id: attempt.id,
          });
        }
      }
      deps.warn("billing.charge_requires_review", {
        invoice_id: attempt?.invoice_id ?? invoice.id,
        ...(attempt ? { payment_attempt_id: attempt.id } : {}),
      });
    }
  }

  return charged;
}

export type ReconciliationOrchestratorDependencies = {
  now(): Date;
  listUnresolvedCandidates(
    lastCheckedBefore: string,
    limit: number,
  ): Promise<Array<{ id: string }>>;
  listSucceededCandidates(
    lastCheckedBefore: string,
    approvedAfter: string,
    limit: number,
  ): Promise<Array<{ id: string }>>;
  claimReconciliation(attemptId: string): Promise<WorkerAttempt | null>;
  lookup(attempt: WorkerAttempt): Promise<TossPayment>;
  recordReconciliationSuccess(
    attempt: WorkerAttempt,
    payment: TossPayment,
  ): Promise<void>;
  releaseLease(attempt: WorkerAttempt): Promise<void>;
  warn(event: string, identifiers: Record<string, string>): void;
};

export async function reconcilePaymentsWith(
  deps: ReconciliationOrchestratorDependencies,
): Promise<number> {
  const now = deps.now();
  const unresolvedCutoff = new Date(
    now.getTime() - UNRESOLVED_RECONCILIATION_COOLDOWN_MS,
  ).toISOString();
  const succeededCutoff = new Date(
    now.getTime() - SUCCEEDED_PAYMENT_POLL_COOLDOWN_MS,
  ).toISOString();
  const approvedAfter = new Date(
    now.getTime() - SUCCEEDED_PAYMENT_POLL_WINDOW_MS,
  ).toISOString();

  // Uncertain payments always consume the provider lookup budget first.
  const unresolved = await deps.listUnresolvedCandidates(
    unresolvedCutoff,
    BILLING_PROVIDER_BATCH_SIZE,
  );
  const remaining = Math.max(
    0,
    BILLING_PROVIDER_BATCH_SIZE - unresolved.length,
  );
  const succeeded = remaining
    ? await deps.listSucceededCandidates(
        succeededCutoff,
        approvedAfter,
        remaining,
      )
    : [];

  let recovered = 0;
  for (const row of [...unresolved, ...succeeded]) {
    const attempt = await deps.claimReconciliation(row.id);
    if (!attempt) continue;
    try {
      const payment = await deps.lookup(attempt);
      await deps.recordReconciliationSuccess(attempt, payment);
      recovered++;
    } catch {
      deps.warn("billing.reconciliation_pending", {
        payment_attempt_id: attempt.id,
        invoice_id: attempt.invoice_id,
      });
    } finally {
      try {
        await deps.releaseLease(attempt);
      } catch {
        deps.warn("billing.reconciliation_lease_release_failed", {
          payment_attempt_id: attempt.id,
          invoice_id: attempt.invoice_id,
        });
      }
    }
  }

  return recovered;
}
