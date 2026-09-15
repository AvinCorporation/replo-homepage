import test from "node:test";
import assert from "node:assert/strict";
import { TossError, type TossPayment } from "../../src/lib/billing/toss/client.ts";
import {
  BILLING_PROVIDER_BATCH_SIZE,
  processChargesWith,
  reconcilePaymentsWith,
  type ChargeOrchestratorDependencies,
  type WorkerAttempt,
} from "../../src/lib/billing/toss/workerOrchestrator.ts";

function attempt(id: string): WorkerAttempt {
  return {
    id,
    workspace_id: `workspace-${id}`,
    invoice_id: `invoice-${id}`,
    payment_method_id: `method-${id}`,
    amount: 590000,
    order_id: `order-${id}`,
    idempotency_key: `idempotency-${id}`,
    order_name: `Replo ${id}`,
    lease_token: `lease-${id}`,
    status: "created",
  };
}

function payment(a: WorkerAttempt): TossPayment {
  return {
    orderId: a.order_id,
    paymentKey: `payment-${a.id}`,
    totalAmount: a.amount,
    status: "DONE",
    approvedAt: "2026-09-13T00:00:00Z",
  };
}

function chargeDependencies(
  overrides: Partial<ChargeOrchestratorDependencies> = {},
) {
  const deferred: string[] = [];
  const succeeded: string[] = [];
  const warnings: string[] = [];
  const base: ChargeOrchestratorDependencies = {
    chargesEnabled: () => true,
    listDueInvoices: async (limit: number) => {
      assert.equal(limit, BILLING_PROVIDER_BATCH_SIZE);
      return [{ id: "one" }, { id: "two" }];
    },
    claimInvoice: async (id: string) => attempt(id),
    loadChargeMaterial: async () => ({
      billingKey: "synthetic-key",
      customerKey: "synthetic-customer",
      secretKey: "test_sk_fixture",
    }),
    authorizeAttempt: async () => true,
    charge: async (a: WorkerAttempt) => payment(a),
    recordChargeFailure: async () => {},
    recordChargeSuccess: async (a: WorkerAttempt) => {
      succeeded.push(a.id);
    },
    deferBeforeDispatch: async (a: WorkerAttempt) => {
      deferred.push(a.id);
    },
    isTossError: (error: unknown): error is TossError =>
      error instanceof TossError,
    unknownTossError: () => new TossError("RESPONSE_UNKNOWN", 0),
    warn: (event: string) => warnings.push(event),
    ...overrides,
  };
  return { base, deferred, succeeded, warnings };
}

test("one invoice preflight failure is deferred without starving the batch", async () => {
  const state = chargeDependencies({
    loadChargeMaterial: async (a: WorkerAttempt) => {
      if (a.id === "one") throw new Error("missing credential");
      return {
        billingKey: "synthetic-key",
        customerKey: "synthetic-customer",
        secretKey: "test_sk_fixture",
      };
    },
  });
  assert.equal(await processChargesWith(state.base), 1);
  assert.deepEqual(state.deferred, ["one"]);
  assert.deepEqual(state.succeeded, ["two"]);
  assert.ok(state.warnings.includes("billing.charge_requires_review"));
});

test("a post-dispatch DB failure preserves identity and continues the batch", async () => {
  const charged: string[] = [];
  const state = chargeDependencies({
    charge: async (a: WorkerAttempt) => {
      charged.push(a.id);
      return payment(a);
    },
    recordChargeSuccess: async (a: WorkerAttempt) => {
      if (a.id === "one") throw new Error("database unavailable");
      state.succeeded.push(a.id);
    },
  });
  assert.equal(await processChargesWith(state.base), 1);
  assert.deepEqual(charged, ["one", "two"]);
  assert.deepEqual(state.deferred, []);
  assert.deepEqual(state.succeeded, ["two"]);
});

test("uncertain payments consume the reconciliation budget before successes", async () => {
  const selected: string[] = [];
  let succeededQueryCount = 0;
  const fixedNow = new Date("2026-09-13T12:00:00.000Z");
  const recovered = await reconcilePaymentsWith({
    now: () => fixedNow,
    listUnresolvedCandidates: async (cutoff, limit) => {
      assert.equal(cutoff, "2026-09-13T11:50:00.000Z");
      assert.equal(limit, 2);
      return [{ id: "one" }, { id: "two" }];
    },
    listSucceededCandidates: async () => {
      succeededQueryCount++;
      return [];
    },
    claimReconciliation: async (id) => attempt(id),
    lookup: async (a) => {
      selected.push(a.id);
      return payment(a);
    },
    recordReconciliationSuccess: async () => {},
    releaseLease: async () => {},
    warn: () => {},
  });
  assert.equal(recovered, 2);
  assert.deepEqual(selected, ["one", "two"]);
  assert.equal(succeededQueryCount, 0);
});

test("success polling uses only remaining slots, a 24h cooldown and 90d window", async () => {
  const fixedNow = new Date("2026-09-13T12:00:00.000Z");
  const released: string[] = [];
  const warnings: string[] = [];
  const recovered = await reconcilePaymentsWith({
    now: () => fixedNow,
    listUnresolvedCandidates: async () => [{ id: "unknown" }],
    listSucceededCandidates: async (checkedBefore, approvedAfter, limit) => {
      assert.equal(checkedBefore, "2026-09-12T12:00:00.000Z");
      assert.equal(approvedAfter, "2026-06-15T12:00:00.000Z");
      assert.equal(limit, 1);
      return [{ id: "succeeded" }];
    },
    claimReconciliation: async (id) => attempt(id),
    lookup: async (a) => payment(a),
    recordReconciliationSuccess: async () => {},
    releaseLease: async (a) => {
      released.push(a.id);
      if (a.id === "unknown") throw new Error("release failed");
    },
    warn: (event) => warnings.push(event),
  });
  assert.equal(recovered, 2);
  assert.deepEqual(released, ["unknown", "succeeded"]);
  assert.ok(
    warnings.includes("billing.reconciliation_lease_release_failed"),
  );
});
