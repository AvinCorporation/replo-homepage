import test from "node:test";
import assert from "node:assert/strict";
import {
  nextPlanEffectiveOn,
  planChangeConditions,
  planChangePolicy,
} from "../../src/lib/billing/planChanges.ts";

test("next plan date follows the KST calendar month boundary", () => {
  assert.equal(
    nextPlanEffectiveOn(new Date("2026-09-30T14:59:59Z")),
    "2026-10-01",
  );
  assert.equal(
    nextPlanEffectiveOn(new Date("2026-09-30T15:00:00Z")),
    "2026-11-01",
  );
  assert.equal(
    nextPlanEffectiveOn(new Date("2026-12-31T15:00:00Z")),
    "2027-02-01",
  );
});

test("plan consent includes VAT excluded totals and the effective date", () => {
  assert.deepEqual(
    planChangeConditions({
      fromPlan: "Lite",
      plan: {
        code: "Basic",
        displayName: "베이직",
        monthlyFee: 990000,
        includedTickets: 500,
      },
      policy: planChangePolicy(),
      effectiveOn: "2026-10-01",
    }),
    {
      termsVersion: "plan-change-v2",
      fromPlan: "Lite",
      planCode: "Basic",
      planName: "베이직",
      monthlyFee: 990000,
      includedTickets: 500,
      vat: "excluded",
      vatAmount: 99000,
      totalAmount: 1089000,
      effectiveOn: "2026-10-01",
      billingCycle: "monthly",
      billingAnchorDay: 1,
      firstChargeDate: "2026-10-01",
      automaticPayment: true,
    },
  );
});
