import test from "node:test";
import assert from "node:assert/strict";
import {
  nextPlanEffectiveOn,
  planChangeConditions,
} from "../../src/lib/billing/planChanges.ts";
import { parsePolicy } from "../../src/lib/billing/toss/domain.ts";

const policy = parsePolicy({
  version: "v1",
  termsVersion: "terms-v1",
  vat: "included",
  firstCharge: "contract_date",
  cardChangeArrears: "manual_approval",
  cancellationInstructions: "담당자 문의",
  retry: { basis: "billing_date", days: [1, 3, 5] },
});

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
      policy: { ...policy, vat: "excluded" },
      effectiveOn: "2026-10-01",
    }),
    {
      termsVersion: "terms-v1",
      fromPlan: "Lite",
      planCode: "Basic",
      planName: "베이직",
      monthlyFee: 990000,
      includedTickets: 500,
      vat: "excluded",
      vatAmount: 99000,
      totalAmount: 1089000,
      effectiveOn: "2026-10-01",
    },
  );
});
