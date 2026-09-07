import type { ConnectState, IdentityState } from "./programme.ts";

/**
 * How a Stripe account maps to the states the portal shows (V4 §36).
 *
 * Pure — no `server-only`, no Stripe SDK import at runtime — so the mapping
 * that decides whether we will schedule money can be asserted directly.
 * `stripe-connect.ts` re-exports this and adds the API calls around it.
 *
 * The distinction that matters most: **RESTRICTED is not READY.** An account
 * with details submitted but outstanding requirements looks connected and is
 * not payable. Treating it as ready produces payouts that never settle.
 */

export type ConnectSnapshot = {
  state: ConnectState;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  identityStatus: IdentityState;
  identityDocument: string | null;
  identitySelfie: string | null;
  identityAddress: string | null;
  requirements: string[];
};

/**
 * The subset of a Stripe account this mapping reads.
 *
 * Declared structurally rather than as `Stripe.Account` so this module stays
 * free of the SDK and remains testable with a plain object.
 */
export type ConnectAccountShape = {
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  details_submitted?: boolean | null;
  requirements?: {
    currently_due?: string[] | null;
    past_due?: string[] | null;
    pending_verification?: string[] | null;
    disabled_reason?: string | null;
  } | null;
};

export function interpretAccount(account: ConnectAccountShape): ConnectSnapshot {
  const requirements = [
    ...(account.requirements?.currently_due ?? []),
    ...(account.requirements?.past_due ?? []),
  ];

  const detailsSubmitted = Boolean(account.details_submitted);
  const payoutsEnabled = Boolean(account.payouts_enabled);
  const disabledReason = account.requirements?.disabled_reason ?? null;

  let state: ConnectState;
  if (disabledReason && !payoutsEnabled && detailsSubmitted) {
    state = "DISABLED";
  } else if (!detailsSubmitted) {
    state = "ONBOARDING";
  } else if (payoutsEnabled && requirements.length === 0) {
    state = "READY";
  } else {
    // Details in, but Stripe still wants something. Explicitly not READY:
    // treating this as ready is what produces payouts that never settle.
    state = "RESTRICTED";
  }

  return {
    state,
    chargesEnabled: Boolean(account.charges_enabled),
    payoutsEnabled,
    detailsSubmitted,
    identityStatus: identityFromRequirements(state, requirements, account),
    identityDocument: verificationLabel(requirements, "document"),
    identitySelfie: verificationLabel(requirements, "additional_document"),
    identityAddress: verificationLabel(requirements, "address"),
    requirements,
  };
}

/**
 * Identity state, derived from what Stripe still wants.
 *
 * We never see a document. What we can honestly say is whether Stripe is still
 * asking for verification, is checking, or is satisfied — so those are the only
 * three things the UI claims.
 */
function identityFromRequirements(
  state: ConnectState,
  requirements: string[],
  account: ConnectAccountShape,
): IdentityState {
  const pendingVerification = account.requirements?.pending_verification ?? [];
  const identityRequirements = requirements.filter((entry) =>
    /verification|document|identity|dob|address/i.test(entry),
  );

  if (state === "DISABLED") return "FAILED";
  if (pendingVerification.length > 0) return "PENDING";
  if (identityRequirements.length > 0) {
    return state === "ONBOARDING" ? "REQUIRED" : "REQUIRES_UPDATE";
  }
  if (!account.details_submitted) return "NOT_STARTED";
  return "VERIFIED";
}

function verificationLabel(requirements: string[], needle: string): string | null {
  const outstanding = requirements.some((entry) => entry.includes(needle));
  return outstanding ? "Outstanding" : "Verified";
}
