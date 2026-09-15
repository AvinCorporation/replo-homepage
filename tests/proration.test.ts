import assert from "node:assert/strict";
import test from "node:test";
import {
  addMonths,
  buildOrderId,
  daysInMonth,
  monthlyCyclePeriod,
  planFirstCharge,
  proratedAmount,
  remainingDays,
} from "../src/lib/billing/proration.ts";

test("remainingDays counts today", () => {
  assert.equal(remainingDays("2026-09-28"), 3);
  assert.equal(remainingDays("2026-09-01"), 30);
  assert.equal(remainingDays("2026-09-30"), 1);
  assert.equal(remainingDays("2026-01-31"), 1);
  assert.equal(remainingDays("2028-02-15"), 15);
});

test("proratedAmount matches the 9/28 example", () => {
  // 59,000원 × 3일 / 30일 = 5,900원
  assert.equal(proratedAmount(59000, "2026-09-28"), 5900);
});

test("first charge bundles the remainder and the next month", () => {
  const charge = planFirstCharge(59000, "2026-09-28");
  assert.equal(charge.totalAmount, 64900);
  assert.deepEqual(
    charge.lines.map((line) => [line.amount, line.periodStart, line.periodEnd]),
    [
      [5900, "2026-09-28", "2026-09-30"],
      [59000, "2026-10-01", "2026-10-31"],
    ],
  );
  assert.equal(charge.periodStart, "2026-09-28");
  assert.equal(charge.periodEnd, "2026-10-31");
  assert.equal(charge.nextBillingDate, "2026-11-01");
});

test("mid-month start bundles the same way", () => {
  const charge = planFirstCharge(59000, "2026-09-15");
  // 59,000 × 16 / 30 = 31,466.67 -> 31,467
  assert.equal(charge.lines[0].amount, 31467);
  assert.equal(charge.totalAmount, 31467 + 59000);
  assert.equal(charge.periodEnd, "2026-10-31");
  assert.equal(charge.nextBillingDate, "2026-11-01");
});

test("starting on the 1st charges a single month, not two", () => {
  const charge = planFirstCharge(990000, "2026-10-01");
  assert.equal(charge.lines.length, 1);
  assert.equal(charge.totalAmount, 990000);
  assert.equal(charge.periodStart, "2026-10-01");
  assert.equal(charge.periodEnd, "2026-10-31");
  assert.equal(charge.nextBillingDate, "2026-11-01");
});

test("year end rolls over", () => {
  const charge = planFirstCharge(59000, "2026-11-20");
  assert.equal(charge.periodEnd, "2026-12-31");
  assert.equal(charge.nextBillingDate, "2027-01-01");

  const december = planFirstCharge(59000, "2026-12-20");
  assert.equal(december.periodEnd, "2027-01-31");
  assert.equal(december.nextBillingDate, "2027-02-01");
  assert.equal(december.lines[1].label, "1월 이용료");
});

test("february is prorated over its own length", () => {
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(proratedAmount(59000, "2028-02-15"), Math.round((59000 * 15) / 29));
});

test("monthly cycle covers the billing month", () => {
  const cycle = monthlyCyclePeriod("2026-11-01");
  assert.deepEqual(cycle, {
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
    nextBillingDate: "2026-12-01",
  });
});

test("addMonths caps the day at the month length", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
});

test("orderId is stable for the same workspace, plan and period", () => {
  const id = buildOrderId("11111111-2222-3333-4444-555555555555", "Basic", "2026-09-28");
  assert.equal(id, buildOrderId("11111111-2222-3333-4444-555555555555", "Basic", "2026-09-28"));
  assert.notEqual(id, buildOrderId("11111111-2222-3333-4444-555555555555", "Basic", "2026-10-01"));
  assert.match(id, /^replo_[0-9a-f]{12}_Basic_20260928$/);
});
