import "server-only";
import type Stripe from "stripe";
import { stripe } from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { interpretAccount, type ConnectSnapshot } from "./connect-rules";

/**
 * Stripe Connect for affiliate payouts (V4 §36).
 *
 * Connect, not a bank form. We deliberately do not collect sort codes, account
 * numbers, passports or tax identifiers ourselves: Stripe's hosted onboarding
 * collects them, holds them, and tells us only whether it is satisfied. That
 * is both less to leak and a better verification than we could run.
 *
 * What we store is therefore tiny: an account id, four booleans mirrored from
 * Stripe, and a derived state. The account id is never selected into a page
 * payload — it is enough to address the connected account and an affiliate has
 * no use for it.
 *
 * **Payouts here are transfers to a connected account**, not the platform's own
 * Stripe payout. Those are different objects with the same word attached, and
 * confusing them is how a platform ends up paying itself.
 */

/* --------------------------------------------------------------- account -- */

/**
 * Returns the affiliate's connected account, creating one if needed.
 *
 * Reuses an existing id whenever there is one. Creating a second Express
 * account for someone who already has one strands their completed
 * verification, which they then have to do again.
 */
export async function ensureConnectAccount(input: {
  affiliateId: string;
  email: string;
  country: string | null;
  businessName: string | null;
}): Promise<{ accountId: string; created: boolean }> {
  const db = createAdminClient();

  const { data: affiliate } = await db
    .from("affiliates")
    .select("stripe_connect_account_id")
    .eq("id", input.affiliateId)
    .maybeSingle();

  if (affiliate?.stripe_connect_account_id) {
    return { accountId: affiliate.stripe_connect_account_id, created: false };
  }

  const account = await stripe.accounts.create({
    type: "express",
    // Defaults to GB rather than guessing from a free-text country field: a
    // wrong country on a Connect account cannot be changed afterwards.
    country: normaliseCountry(input.country),
    email: input.email,
    business_profile: {
      name: input.businessName ?? undefined,
      product_description: "ClientTurn affiliate programme partner",
    },
    capabilities: { transfers: { requested: true } },
    metadata: { affiliate_id: input.affiliateId, platform: "clientturn_affiliates" },
  });

  await db
    .from("affiliates")
    .update({
      stripe_connect_account_id: account.id,
      stripe_connect_status: "ONBOARDING",
      identity_status: "REQUIRED",
    })
    .eq("id", input.affiliateId);

  await recordAudit({
    businessId: null,
    actorType: "system",
    action: "affiliate.payment_method_connected",
    entityType: "affiliate",
    entityId: input.affiliateId,
    // The account id is fine in an audit record — that is a server-side log
    // an affiliate never reads.
    metadata: { stripeAccountId: account.id },
  });

  return { accountId: account.id, created: true };
}

/**
 * A one-time hosted onboarding link.
 *
 * Stripe account links expire in minutes and can only be used once, which is
 * why this is generated on click rather than rendered into the page.
 */
export async function createOnboardingLink(input: {
  accountId: string;
  origin: string;
}): Promise<string> {
  const link = await stripe.accountLinks.create({
    account: input.accountId,
    // `refresh_url` is hit when the link has expired before it was used; it
    // bounces straight back through this same flow for a fresh one.
    refresh_url: `${input.origin}/affiliates/app/settings/connect/refresh`,
    return_url: `${input.origin}/affiliates/app/settings?section=payments&connected=1`,
    type: "account_onboarding",
  });

  return link.url;
}

/** A link into the Stripe-hosted dashboard for an already-onboarded account. */
export async function createDashboardLink(accountId: string): Promise<string> {
  const link = await stripe.accounts.createLoginLink(accountId);
  return link.url;
}

/* ----------------------------------------------------------------- state -- */

// The mapping from a Stripe account to portal state is pure and lives in
// `connect-rules.ts`, so the RESTRICTED-vs-READY decision is testable without
// a Stripe call. Re-exported so callers reach one module.
export {
  interpretAccount,
  type ConnectAccountShape,
  type ConnectSnapshot,
} from "./connect-rules";

/**
 * Reads live account state from Stripe and mirrors it locally.
 *
 * Called on returning from onboarding and whenever the settings page loads, so
 * the portal reflects Stripe rather than a stale cached boolean. If Stripe is
 * unreachable the stored state is left alone and the caller shows what it has —
 * an outage should not make a verified partner look unverified.
 */
export async function refreshConnectState(
  affiliateId: string,
): Promise<ConnectSnapshot | null> {
  const db = createAdminClient();

  const { data: affiliate } = await db
    .from("affiliates")
    .select("stripe_connect_account_id")
    .eq("id", affiliateId)
    .maybeSingle();

  if (!affiliate?.stripe_connect_account_id) return null;

  let account: Stripe.Account;
  try {
    account = await stripe.accounts.retrieve(affiliate.stripe_connect_account_id);
  } catch {
    return null;
  }

  const snapshot = interpretAccount(account);

  await db
    .from("affiliates")
    .update({
      stripe_connect_status: snapshot.state,
      stripe_charges_enabled: snapshot.chargesEnabled,
      stripe_payouts_enabled: snapshot.payoutsEnabled,
      stripe_details_submitted: snapshot.detailsSubmitted,
      stripe_requirements: snapshot.requirements,
      stripe_synced_at: new Date().toISOString(),
      identity_status: snapshot.identityStatus,
      identity_document_state: snapshot.identityDocument,
      identity_selfie_state: snapshot.identitySelfie,
      identity_address_state: snapshot.identityAddress,
      identity_checked_at: new Date().toISOString(),
    })
    .eq("id", affiliateId);

  return snapshot;
}

/* --------------------------------------------------------------- payouts -- */

/**
 * Sends a payout to a connected account.
 *
 * A Stripe **transfer** to the connected account, keyed by our own payout id.
 * Stripe's idempotency key means a retried call after a timeout returns the
 * original transfer instead of sending the money twice — which, combined with
 * the status guard in `markPayoutPaid`, is the double-payment defence.
 *
 * Not wired to an automatic scheduler in this release. The payout run creates
 * the payout record and claims its commissions; sending is invoked
 * deliberately, so no money moves without a person or a job that a person
 * enabled.
 */
export async function sendConnectTransfer(input: {
  accountId: string;
  amountMinor: number;
  currency: string;
  payoutId: string;
  description: string;
}): Promise<{ ok: true; transferId: string } | { ok: false; error: string; code: string }> {
  if (input.amountMinor <= 0) {
    return { ok: false, error: "Nothing to send.", code: "zero_amount" };
  }

  try {
    const transfer = await stripe.transfers.create(
      {
        amount: input.amountMinor,
        currency: input.currency.toLowerCase(),
        destination: input.accountId,
        description: input.description,
        metadata: { affiliate_payout_id: input.payoutId },
      },
      { idempotencyKey: `affiliate_payout_${input.payoutId}` },
    );

    return { ok: true, transferId: transfer.id };
  } catch (error) {
    const stripeError = error as Stripe.errors.StripeError;
    return {
      ok: false,
      error: stripeError.message ?? "The transfer could not be sent.",
      code: stripeError.code ?? "transfer_failed",
    };
  }
}

/**
 * A country code Stripe will accept.
 *
 * The stored country is free text from an application form, so anything we do
 * not recognise falls back to GB — the programme's home market — rather than
 * failing account creation on a typo.
 */
function normaliseCountry(country: string | null): string {
  if (!country) return "GB";
  const trimmed = country.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();

  const known: Record<string, string> = {
    "united kingdom": "GB",
    uk: "GB",
    "great britain": "GB",
    england: "GB",
    scotland: "GB",
    wales: "GB",
    "northern ireland": "GB",
    ireland: "IE",
    "united states": "US",
    usa: "US",
    canada: "CA",
    australia: "AU",
  };

  return known[trimmed.toLowerCase()] ?? "GB";
}
