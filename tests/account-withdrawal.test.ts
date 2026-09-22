import assert from "node:assert/strict";
import test from "node:test";
import {
  anonymizedUserFields,
  withdrawalBlock,
  type WithdrawalContext,
} from "../src/lib/account/withdrawal.ts";
import {
  cancellationEffectiveOn,
  isCancellationComplete,
  isCancellationPending,
} from "../src/lib/billing/cancellation.ts";

const base: WithdrawalContext = {
  isLastOwner: true,
  hasPaidPlan: false,
  hasScheduledPlanChange: false,
  cancellationRequested: false,
  subscriptionStatus: "active",
};

test("a member who is not the last owner can always withdraw", () => {
  assert.equal(
    withdrawalBlock({
      ...base,
      isLastOwner: false,
      hasPaidPlan: true,
      hasScheduledPlanChange: true,
      subscriptionStatus: "past_due",
    }),
    null,
  );
});

test("the last owner on a free plan can withdraw", () => {
  assert.equal(withdrawalBlock(base), null);
});

test("an active paid plan blocks the last owner until cancellation is requested", () => {
  const blocked = withdrawalBlock({ ...base, hasPaidPlan: true });
  assert.equal(blocked?.code, "ACCOUNT_WITHDRAWAL_ACTIVE_PLAN");

  assert.equal(
    withdrawalBlock({ ...base, hasPaidPlan: true, cancellationRequested: true }),
    null,
  );
});

test("a scheduled plan change blocks the last owner", () => {
  const blocked = withdrawalBlock({ ...base, hasScheduledPlanChange: true });
  assert.equal(blocked?.code, "ACCOUNT_WITHDRAWAL_SCHEDULED_PLAN");
});

test("unpaid charges take precedence and always block", () => {
  const blocked = withdrawalBlock({
    ...base,
    hasPaidPlan: true,
    cancellationRequested: true,
    subscriptionStatus: "past_due",
  });
  assert.equal(blocked?.code, "ACCOUNT_WITHDRAWAL_PAST_DUE");
});

test("anonymized profile keeps a unique, unusable email", () => {
  const fields = anonymizedUserFields("3f1a2b7c-1111-2222-3333-444455556666");
  assert.equal(fields.name, null);
  assert.equal(fields.avatar_url, null);
  assert.ok(fields.email.endsWith("@deleted.replo.invalid"));
  assert.ok(!fields.email.includes("-".repeat(2)));
  assert.notEqual(
    fields.email,
    anonymizedUserFields("99999999-1111-2222-3333-444455556666").email,
  );
});

test("cancellation stops billing at the next billing date", () => {
  assert.equal(cancellationEffectiveOn("2026-11-01", "2026-10-04"), "2026-11-01");
});

test("a missing or past billing date falls back to the first of next month", () => {
  const fallback = cancellationEffectiveOn(null, "2026-10-04");
  assert.match(fallback, /^\d{4}-\d{2}-01$/);
  assert.ok(fallback > "2026-10-04");

  const past = cancellationEffectiveOn("2026-09-01", "2026-10-04");
  assert.match(past, /^\d{4}-\d{2}-01$/);
  assert.ok(past > "2026-10-04");
});

test("cancellation is pending until the effective date arrives", () => {
  const state = { requestedAt: "2026-10-04T01:00:00Z", effectiveOn: "2026-11-01" };
  assert.equal(isCancellationPending(state, "2026-10-31"), true);
  assert.equal(isCancellationComplete(state, "2026-10-31"), false);

  assert.equal(isCancellationPending(state, "2026-11-01"), false);
  assert.equal(isCancellationComplete(state, "2026-11-01"), true);

  const none = { requestedAt: null, effectiveOn: null };
  assert.equal(isCancellationPending(none, "2026-10-31"), false);
  assert.equal(isCancellationComplete(none, "2026-10-31"), false);
});
