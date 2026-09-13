import test from "node:test";
import assert from "node:assert/strict";
import {
  nextCycle,
  invoiceAmount,
  parsePolicy,
  retryAt,
  failureCategory,
  seoulToday,
} from "../../src/lib/billing/toss/domain.ts";
import {
  encryptCredential,
  decryptCredential,
} from "../../src/lib/billing/toss/crypto.ts";
import { billingConfig } from "../../src/lib/billing/toss/config.ts";
const ring = {
  active: "v2",
  keys: {
    v1: Buffer.alloc(32, 1).toString("base64"),
    v2: Buffer.alloc(32, 2).toString("base64"),
  },
};
test("31-day anchor survives leap February and delayed approval", () => {
  assert.equal(nextCycle("2028-01-31", 31), "2028-02-29");
  assert.equal(nextCycle("2028-02-29", 31), "2028-03-31");
  assert.equal(nextCycle("2027-02-28", 31), "2027-03-31");
  assert.equal(seoulToday(new Date("2026-09-12T15:00:00Z")), "2026-09-13");
});
test("integer KRW and VAT never silently round", () => {
  assert.equal(invoiceAmount(590000, "included"), 590000);
  assert.equal(invoiceAmount(590000, "excluded"), 649000);
  assert.throws(() => invoiceAmount(101, "excluded"));
  assert.throws(() => invoiceAmount(-1, "included"));
  assert.throws(() => invoiceAmount(1.2, "included"));
});
test("unconfirmed business rules do not get production defaults", () => {
  assert.throws(() => parsePolicy({}));
  assert.throws(() =>
    parsePolicy({
      version: "v1",
      termsVersion: "v1",
      vat: "included",
      firstCharge: "contract_date",
      cardChangeArrears: "manual_approval",
      cancellationInstructions: "담당자 문의",
      retry: { basis: "billing_date", days: [3, 1] },
    }),
  );
});
test("retry schedule anchored explicitly and no catch-up bursts", () => {
  assert.equal(
    retryAt(
      { basis: "billing_date", days: [1, 3, 5] },
      "2026-09-01",
      "2026-09-01T00:00:00Z",
      0,
    ),
    "2026-09-01T15:00:00.000Z",
  );
  assert.equal(
    retryAt(
      { basis: "billing_date", days: [1, 3, 5] },
      "2026-09-01",
      "2026-09-05T00:00:00Z",
      0,
    ),
    null,
  );
  assert.equal(
    retryAt(
      { basis: "previous_failure", days: [1] },
      "2026-09-01",
      "2026-09-05T00:00:00Z",
      0,
    ),
    "2026-09-06T00:00:00.000Z",
  );
  assert.equal(
    retryAt(
      { basis: "previous_failure", days: [1] },
      "2026-09-01",
      "2026-09-05T00:00:00Z",
      1,
    ),
    null,
  );
});
test("network/5xx/unmapped errors are unknown, not retryable", () => {
  assert.equal(failureCategory("RESPONSE_UNKNOWN", 0), "unknown");
  assert.equal(failureCategory("NOT_ENOUGH_BALANCE", 500), "unknown");
  assert.equal(failureCategory("NEW_PROVIDER_ERROR", 400), "unknown");
  assert.equal(failureCategory("NOT_ENOUGH_BALANCE", 400), "retryable");
});
test("credential randomized encryption, workspace binding and rotation", () => {
  const a = encryptCredential("test-credential", "workspace-a:card-a", ring);
  const b = encryptCredential("test-credential", "workspace-a:card-a", ring);
  assert.notEqual(a.encrypted_billing_key, b.encrypted_billing_key);
  assert.equal(
    decryptCredential(
      a.encrypted_billing_key,
      a.encryption_key_version,
      "workspace-a:card-a",
      ring,
    ),
    "test-credential",
  );
  assert.throws(() =>
    decryptCredential(
      a.encrypted_billing_key,
      "v2",
      "workspace-b:card-a",
      ring,
    ),
  );
  assert.throws(() =>
    decryptCredential(
      a.encrypted_billing_key,
      "v1",
      "workspace-a:card-a",
      ring,
    ),
  );
  const pieces = a.encrypted_billing_key.split(".");
  pieces[2] = Buffer.from("tampered").toString("base64");
  assert.throws(() =>
    decryptCredential(pieces.join("."), "v2", "workspace-a:card-a", ring),
  );
});
const env = {
  BILLING_ENVIRONMENT: "test",
  VERCEL_ENV: "preview",
  BILLING_TEST_SUPABASE_URL: "https://test.invalid",
  NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid",
  BILLING_PRODUCTION_SUPABASE_URL: "https://production.invalid",
  TOSS_CLIENT_KEY: "test_ck_fixture",
  TOSS_SECRET_KEY: "test_sk_fixture",
  BILLING_SITE_URL: "http://localhost:3000",
  BILLING_ENCRYPTION_KEY_VERSION: "v2",
  BILLING_ENCRYPTION_KEYS: JSON.stringify(ring.keys),
};
test("billing is off by default and preview cannot use production keys/database", () => {
  assert.equal(billingConfig(env).chargesEnabled, false);
  assert.throws(() =>
    billingConfig({ ...env, TOSS_SECRET_KEY: "live_sk_fixture" }),
  );
  assert.throws(() =>
    billingConfig({
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: "https://production.invalid",
    }),
  );
  assert.throws(() =>
    billingConfig({ ...env, BILLING_ENVIRONMENT: "production" }),
  );
  assert.throws(() =>
    billingConfig({ ...env, BILLING_TEST_SUPABASE_URL: undefined }),
  );
});
