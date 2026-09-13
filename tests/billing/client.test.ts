import test from "node:test";
import assert from "node:assert/strict";
import { TossClient, TossError } from "../../src/lib/billing/toss/client.ts";
test("same attempt resend preserves provider idempotency key and exact request", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const transport: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return Response.json({
      orderId: "test-order",
      status: "DONE",
      paymentKey: "test-payment",
      totalAmount: 590000,
    });
  };
  const client = new TossClient("test_sk_fixture", transport);
  const request = {
    customerKey: "random-fixture",
    amount: 590000,
    orderId: "test-order",
    orderName: "Replo test",
  };
  await client.charge("synthetic-billing-key", request, "same-idempotency-key");
  await client.charge("synthetic-billing-key", request, "same-idempotency-key");
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(
    new Headers(calls[0].init.headers).get("Idempotency-Key"),
    "same-idempotency-key",
  );
  assert.equal(
    new Headers(calls[1].init.headers).get("Idempotency-Key"),
    "same-idempotency-key",
  );
  assert.equal(calls[0].init.cache, "no-store");
});
test("timeouts and malformed responses cannot leak a credential-bearing native error", async () => {
  const client = new TossClient("test_sk_fixture", async () => {
    throw new Error("secret-in-provider-url");
  });
  await assert.rejects(
    () =>
      client.charge(
        "synthetic-billing-key",
        {
          customerKey: "fixture",
          amount: 1,
          orderId: "test-order",
          orderName: "Replo",
        },
        "key",
      ),
    (e: TossError) => {
      assert.equal(e.category, "unknown");
      assert.equal(e.message, "TOSS_REQUEST_FAILED");
      assert.equal(e.cause, undefined);
      return true;
    },
  );
});
test("lookup uses original order; raw provider error message is discarded", async () => {
  let requested = "";
  const client = new TossClient("test_sk_fixture", async (url) => {
    requested = String(url);
    return Response.json(
      { code: "INVALID_API_KEY", message: "sensitive provider payload" },
      { status: 401 },
    );
  });
  await assert.rejects(
    () => client.lookup("replo_original-order"),
    (e: TossError) => {
      assert.equal(e.category, "configuration");
      assert.equal(e.code, "INVALID_API_KEY");
      assert.equal(e.message, "TOSS_REQUEST_FAILED");
      return true;
    },
  );
  assert.equal(
    requested,
    "https://api.tosspayments.com/v1/payments/orders/replo_original-order",
  );
});
