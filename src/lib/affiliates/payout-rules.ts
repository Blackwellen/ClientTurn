import type { PayoutReadiness } from "./programme.ts";

/**
 * Payout eligibility rules (V4 §35).
 *
 * Pure — no `server-only`, no Supabase, no Stripe — so the rules that decide
 * whether money may be sent can be asserted directly in tests rather than only
 * exercised through a database. `payouts.ts` re-exports these and adds the
 * ledger reads around them.
 */

export type ReadinessCheck = {
  key: string;
  label: string;
  description: string;
  state: "complete" | "pending" | "incomplete";
};

export type PayoutReadinessReport = {
  readiness: PayoutReadiness;
  checks: ReadinessCheck[];
  /** The single next thing to do, or null when everything is done. */
  blocker: string | null;
};

/**
 * Whether this affiliate can actually be paid, and what is missing.
 *
 * Deliberately not a boolean. "Ready" is the conjunction of five independent
 * facts, and an affiliate looking at a disabled payout needs to know which one
 * failed — a greyed-out button that explains nothing generates a support
 * ticket every time.
 *
 * Note what is *not* sufficient: a connected Stripe account. `payoutsEnabled`
 * is a separate flag that Stripe sets only once its own requirements are met,
 * and treating OAuth completion as readiness is the classic way to schedule a
 * payout that can never settle.
 */
export function assessReadiness(input: {
  status: string;
  connectState: string;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  identityStatus: string;
  taxStatus: string;
  availableMinor: number;
  minimumPayoutMinor: number;
}): PayoutReadinessReport {
  const checks: ReadinessCheck[] = [
    {
      key: "connected",
      label: "Account connected",
      description: "Your Stripe account is linked to the programme.",
      state: input.connectState === "NOT_CONNECTED" ? "incomplete" : "complete",
    },
    {
      key: "details",
      label: "Details submitted",
      description: "Stripe has everything it needs about you.",
      state: input.detailsSubmitted
        ? "complete"
        : input.connectState === "ONBOARDING"
          ? "pending"
          : "incomplete",
    },
    {
      key: "identity",
      label: "Identity verification",
      description: "Required before any money can be sent.",
      state:
        input.identityStatus === "VERIFIED"
          ? "complete"
          : input.identityStatus === "PENDING"
            ? "pending"
            : "incomplete",
    },
    {
      key: "tax",
      label: "Tax information",
      description: "Needed for compliance and to avoid withholding.",
      state:
        input.taxStatus === "VERIFIED"
          ? "complete"
          : input.taxStatus === "SUBMITTED"
            ? "pending"
            : "incomplete",
    },
    {
      key: "payouts",
      label: "Payouts enabled",
      description: "Stripe has confirmed it can send you money.",
      state: input.payoutsEnabled ? "complete" : "incomplete",
    },
    {
      key: "threshold",
      label: "Minimum threshold",
      description: "Payouts run once your approved balance reaches the minimum.",
      state:
        input.availableMinor >= input.minimumPayoutMinor ? "complete" : "incomplete",
    },
  ];

  if (input.status === "SUSPENDED" || input.status === "CLOSED") {
    return {
      readiness: "BLOCKED",
      checks,
      blocker: "Your account is not active, so payouts are on hold.",
    };
  }

  // Threshold is excluded from the readiness verdict: an affiliate who has
  // done everything asked of them is READY even with £0 earned. Conflating
  // "set up correctly" with "has enough money yet" would show ACTION_REQUIRED
  // to someone with nothing left to do.
  const setup = checks.filter((check) => check.key !== "threshold");

  if (setup.every((check) => check.state === "complete")) {
    return { readiness: "READY", checks, blocker: null };
  }

  const firstIncomplete = setup.find((check) => check.state === "incomplete");
  if (firstIncomplete) {
    return {
      readiness: "ACTION_REQUIRED",
      checks,
      blocker: `${firstIncomplete.label}: ${firstIncomplete.description}`,
    };
  }

  return {
    readiness: "PENDING",
    checks,
    blocker: "We are waiting on verification. This usually takes a day or two.",
  };
}

/**
 * The next scheduled payout date: the last day of the current month.
 *
 * Monthly is the programme's stated frequency, so this is derived rather than
 * stored. A stored "next payout date" drifts out of sync with the schedule the
 * moment a run is late.
 */
export function nextPayoutDate(now: Date = new Date()): Date {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 12, 0, 0),
  );
  // Already past this month's run: point at next month's.
  if (next.getTime() < now.getTime()) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0, 12, 0, 0));
  }
  return next;
}
