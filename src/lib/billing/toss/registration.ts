import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { billingAccess, billingAdmin, rpc } from "./server";
import { billingConfig } from "./config";
import { encryptCredential, stateDigest } from "./crypto";
import { invoiceAmount, parsePolicy } from "./domain";
import { TossClient } from "./client";
export async function registrationConditions(workspaceId: string) {
  const { data: subscription, error } = await billingAdmin()
    .from("subscriptions")
    .select(
      "id,monthly_fee,billing_policy,next_billing_date,billing_anchor_day,auto_charge_start_date,first_period_start,enrollment_confirmed_at",
    )
    .eq("workspace_id", workspaceId)
    .not("enrollment_confirmed_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (
    error ||
    !subscription ||
    !subscription.auto_charge_start_date ||
    !subscription.first_period_start ||
    !subscription.billing_anchor_day
  )
    throw new Error("BILLING_POLICY_NOT_CONFIRMED");
  const policy = parsePolicy(subscription.billing_policy);
  const conditions = {
    policy,
    amount: invoiceAmount(subscription.monthly_fee, policy.vat),
    cycle: "monthly",
    firstChargeDate: subscription.next_billing_date,
    billingAnchorDay: subscription.billing_anchor_day,
  };
  return conditions;
}
export async function beginRegistration(
  workspaceId: string,
  userId: string,
  consent: unknown,
) {
  const conditions = await registrationConditions(workspaceId);
  // Client must affirm the exact server-generated terms, including fee/date.
  if (JSON.stringify(consent) !== JSON.stringify(conditions))
    throw new Error("BILLING_CONSENT_CHANGED");
  const state = randomBytes(32).toString("base64url");
  const id = await rpc<string>("billing_begin_registration", {
    p_workspace: workspaceId,
    p_user: userId,
    p_state_hash: stateDigest(state),
    p_policy: conditions.policy,
    p_conditions: conditions,
  });
  const { data: profile, error } = await billingAdmin()
    .from("billing_profiles")
    .select("customer_key")
    .eq("workspace_id", workspaceId)
    .single();
  if (error || !profile) throw new Error("BILLING_DATABASE_ERROR");
  const config = billingConfig();
  return {
    clientKey: config.clientKey,
    customerKey: profile.customer_key,
    successUrl: `${config.site}/mypage/billing/callback?session=${id}&state=${state}`,
    failUrl: `${config.site}/mypage/billing/callback?session=${id}&state=${state}`,
  };
}
export async function completeRegistration(input: {
  session: string;
  state: string;
  authKey: string;
  customerKey: string;
}) {
  const admin = billingAdmin();
  const { data: session, error } = await admin
    .from("billing_registration_sessions")
    .select("id,workspace_id,initiated_by,expires_at,status,state_hash")
    .eq("id", input.session)
    .maybeSingle();
  if (
    error ||
    !session ||
    session.state_hash !== stateDigest(input.state) ||
    session.status !== "pending" ||
    session.expires_at < new Date().toISOString()
  )
    throw new Error("INVALID_REGISTRATION");
  const access = await billingAccess(session.workspace_id, true);
  if (session.initiated_by !== access.userId)
    throw new Error("BILLING_FORBIDDEN");
  const { data: profile, error: profileError } = await admin
    .from("billing_profiles")
    .select("customer_key")
    .eq("workspace_id", session.workspace_id)
    .single();
  if (profileError || profile?.customer_key !== input.customerKey)
    throw new Error("INVALID_REGISTRATION");
  const { data: claimed, error: claimError } = await admin
    .from("billing_registration_sessions")
    .update({ status: "processing" })
    .eq("id", session.id)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();
  if (claimError || !claimed) throw new Error("REGISTRATION_ALREADY_USED");
  try {
    const config = billingConfig();
    const billing = await new TossClient(config.secretKey).issue(
      input.authKey,
      profile.customer_key,
      session.id,
    );
    if (
      billing.customerKey !== profile.customer_key ||
      !billing.billingKey ||
      !billing.card
    )
      throw new Error("INVALID_TOSS_BILLING");
    const methodId = randomUUID();
    const credential = encryptCredential(
      billing.billingKey,
      `${session.workspace_id}:${methodId}`,
      config.keyRing,
    );
    // Keep at most the last four visible digits even if provider masking changes.
    const lastFour =
      billing.card.number?.slice(-4).replace(/[^0-9]/g, "") ?? "";
    await rpc("billing_complete_registration", {
      p_session: session.id,
      p_user: access.userId,
      p_method: methodId,
      p_encrypted: credential.encrypted_billing_key,
      p_version: credential.encryption_key_version,
      p_card: {
        maskedNumber: `**** **** **** ${lastFour || "****"}`,
        issuerCode: billing.card.issuerCode,
        cardType: billing.card.cardType,
        ownerType: billing.card.ownerType,
      },
    });
  } catch {
    // Never revoke the prior card, retry an authKey, or log a raw credential error.
    await admin
      .from("billing_registration_sessions")
      .update({ status: "failed" })
      .eq("id", session.id)
      .eq("status", "processing");
    throw new Error("BILLING_REGISTRATION_FAILED");
  }
}
