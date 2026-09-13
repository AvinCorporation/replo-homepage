import type { KeyRing } from "./crypto";
export function billingConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const environment = env.BILLING_ENVIRONMENT;
  const production = env.VERCEL_ENV === "production";
  if (
    !["test", "production"].includes(environment ?? "") ||
    production !== (environment === "production")
  )
    throw new Error("BILLING_ENVIRONMENT_MISMATCH");
  const expected =
    environment === "production"
      ? env.BILLING_PRODUCTION_SUPABASE_URL
      : env.BILLING_TEST_SUPABASE_URL;
  if (
    !expected ||
    expected !== env.NEXT_PUBLIC_SUPABASE_URL ||
    (environment === "test" && expected === env.BILLING_PRODUCTION_SUPABASE_URL)
  )
    throw new Error("BILLING_DATABASE_MISMATCH");
  const prefix = environment === "production" ? "live_" : "test_";
  const clientKey = env.TOSS_CLIENT_KEY ?? "";
  const secretKey = env.TOSS_SECRET_KEY ?? "";
  if (
    !clientKey.startsWith(`${prefix}ck_`) ||
    !secretKey.startsWith(`${prefix}sk_`)
  )
    throw new Error("BILLING_KEY_ENVIRONMENT_MISMATCH");
  const site = new URL(env.BILLING_SITE_URL ?? "");
  if (
    site.protocol !== "https:" &&
    !(
      environment === "test" &&
      ["localhost", "127.0.0.1"].includes(site.hostname)
    )
  )
    throw new Error("BILLING_SITE_INVALID");
  const keys = JSON.parse(env.BILLING_ENCRYPTION_KEYS ?? "{}") as Record<
    string,
    string
  >;
  const keyRing: KeyRing = {
    active: env.BILLING_ENCRYPTION_KEY_VERSION ?? "",
    keys,
  };
  if (
    !keyRing.active ||
    Buffer.from(keys[keyRing.active] ?? "", "base64").length !== 32
  )
    throw new Error("BILLING_ENCRYPTION_NOT_CONFIGURED");
  return {
    environment,
    clientKey,
    secretKey,
    site: site.origin,
    keyRing,
    chargesEnabled: env.BILLING_CHARGES_ENABLED === "true",
  };
}
