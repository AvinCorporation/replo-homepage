import test from "node:test";
import assert from "node:assert/strict";
import {
  billingErrorDetails,
  billingRpcErrorCode,
} from "../../src/lib/billing/toss/errors.ts";

test("expected customer actions use conflict or validation responses", () => {
  assert.equal(
    billingErrorDetails("BILLING_POLICY_NOT_CONFIRMED").status,
    409,
  );
  assert.equal(billingErrorDetails("BILLING_CONSENT_CHANGED").status, 409);
  assert.equal(
    billingErrorDetails("BILLING_REGISTRATION_IN_PROGRESS").status,
    409,
  );
  assert.equal(billingErrorDetails("BILLING_REGISTRATION_FAILED").status, 422);
  assert.equal(
    billingErrorDetails("BILLING_PROVIDER_RESPONSE_INVALID").status,
    502,
  );
  assert.equal(billingErrorDetails("BILLING_PAYMENT_METHOD_LIMIT").status, 409);
  assert.equal(
    billingErrorDetails("BILLING_PAYMENT_METHOD_NOT_AVAILABLE").status,
    409,
  );
  assert.equal(billingErrorDetails("BILLING_PAYMENT_IN_PROGRESS").status, 409);
  assert.equal(
    billingErrorDetails("BILLING_PLAN_CHANGE_UNAVAILABLE").status,
    409,
  );
  assert.equal(billingErrorDetails("BILLING_PLAN_REQUIRES_QUOTE").status, 409);
  assert.equal(billingErrorDetails("BILLING_PLAN_CONSENT_CHANGED").status, 409);
  assert.equal(billingErrorDetails("BILLING_PLAN_ALREADY_ACTIVE").status, 409);
});

test("unknown internal errors keep a generic 503 surface", () => {
  assert.deepEqual(billingErrorDetails("raw database message"), {
    code: "BILLING_SERVICE_UNAVAILABLE",
    status: 503,
    error:
      "결제 설정 또는 처리 상태를 확인해 주세요. 담당자 확인이 필요합니다.",
  });
});

test("RPC errors are classified by exact SQLSTATE", () => {
  assert.equal(billingRpcErrorCode("RB403"), "BILLING_FORBIDDEN");
  assert.equal(
    billingRpcErrorCode("RB409"),
    "BILLING_REGISTRATION_IN_PROGRESS",
  );
  assert.equal(billingRpcErrorCode("RB429"), "BILLING_PAYMENT_METHOD_LIMIT");
  assert.equal(
    billingRpcErrorCode("RB404"),
    "BILLING_PAYMENT_METHOD_NOT_AVAILABLE",
  );
  assert.equal(billingRpcErrorCode("RB423"), "BILLING_PAYMENT_IN_PROGRESS");
  assert.equal(billingRpcErrorCode("RB424"), "BILLING_PLAN_CHANGE_UNAVAILABLE");
  assert.equal(billingRpcErrorCode("RB425"), "BILLING_PLAN_REQUIRES_QUOTE");
  assert.equal(billingRpcErrorCode("RB426"), "BILLING_PLAN_CONSENT_CHANGED");
  assert.equal(billingRpcErrorCode("RB427"), "BILLING_PLAN_ALREADY_ACTIVE");
  assert.equal(billingRpcErrorCode("23505"), null);
  assert.equal(billingRpcErrorCode(undefined), null);
});
