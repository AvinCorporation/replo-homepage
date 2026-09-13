import { failureCategory, type FailureCategory } from "./domain.ts";
export class TossError extends Error {
  readonly category: FailureCategory;
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, httpStatus: number) {
    super("TOSS_REQUEST_FAILED");
    this.code = code;
    this.httpStatus = httpStatus;
    this.category = failureCategory(code, httpStatus);
  }
}
export type TossPayment = {
  orderId: string;
  paymentKey: string;
  totalAmount: number;
  status: string;
  approvedAt: string;
  receipt?: { url: string };
  cancels?: Array<{
    transactionKey: string;
    cancelAmount: number;
    canceledAt: string;
    cancelStatus: string;
  }>;
};
export type TossBilling = {
  billingKey: string;
  customerKey: string;
  authenticatedAt: string;
  card: {
    issuerCode: string;
    number: string;
    cardType: string;
    ownerType: string;
  };
};
export class TossClient {
  private readonly secret: string;
  private readonly transport: typeof fetch;
  constructor(secret: string, transport: typeof fetch = fetch) {
    this.secret = secret;
    this.transport = transport;
  }
  private async request<T>(
    path: string,
    method = "GET",
    body?: object,
    idempotencyKey?: string,
  ): Promise<T> {
    try {
      const response = await this.transport(
        `https://api.tosspayments.com${path}`,
        {
          method,
          cache: "no-store",
          signal: AbortSignal.timeout(65000),
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.secret}:`).toString("base64")}`,
            "Content-Type": "application/json",
            ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new TossError(
          typeof data.code === "string" && /^[A-Z0-9_]{1,100}$/.test(data.code)
            ? data.code
            : "UNMAPPED_ERROR",
          response.status,
        );
      return data as T;
    } catch (error) {
      if (error instanceof TossError) throw error;
      // Do not retain the native error: it may contain a credential-bearing URL.
      throw new TossError("RESPONSE_UNKNOWN", 0);
    }
  }
  issue(authKey: string, customerKey: string, sessionId: string) {
    return this.request<TossBilling>(
      "/v1/billing/authorizations/issue",
      "POST",
      { authKey, customerKey },
      sessionId,
    );
  }
  charge(
    billingKey: string,
    request: {
      customerKey: string;
      amount: number;
      orderId: string;
      orderName: string;
    },
    idempotencyKey: string,
  ) {
    return this.request<TossPayment>(
      `/v1/billing/${encodeURIComponent(billingKey)}`,
      "POST",
      request,
      idempotencyKey,
    );
  }
  lookup(orderId: string) {
    return this.request<TossPayment>(
      `/v1/payments/orders/${encodeURIComponent(orderId)}`,
    );
  }
}
