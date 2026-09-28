/**
 * Subscription lifecycle: the trial state machine, the dunning schedule and
 * the grace policy (Phase 8.10).
 *
 * Pure -- no `server-only`, no Supabase, no Stripe -- so `getEntitlements`, the
 * Stripe webhook, the daily retry job, the app shell and the unit tests all
 * reach the same verdict from the same inputs.
 *
 * ## The model
 *
 * A workspace is usable only while Stripe holds a subscription for it:
 *
 *   signup ─► AWAITING_CARD ─(Checkout, card verified, terms accepted)─► TRIALING
 *   TRIALING ─(trial ends, invoice paid)─► ACTIVE
 *   TRIALING/ACTIVE ─(invoice fails)─► PAST_DUE_GRACE ─(day 3)─► PAST_DUE_RESTRICTED
 *   PAST_DUE_* ─(any retry succeeds, or the card is updated and paid)─► ACTIVE
 *   PAST_DUE_* ─(30 daily retries exhausted)─► CANCELLED (read-only)
 *
 * ## Grace policy (decided here, documented in the final report and the terms)
 *
 *   * Days 0-2 after the first failed charge: full access. A card that expired
 *     over a weekend should not stop anyone's follow-up.
 *   * Day 3 onwards: sending and AI are paused. Leads keep arriving and are
 *     stored, the inbox and every record stay readable, and nothing is
 *     deleted. Queued sends are deferred (not dropped) so they go out as soon
 *     as the payment clears.
 *   * The charge is retried once a day, every day, for up to 30 days from the
 *     first failure, and retrying stops the moment an invoice is paid.
 *   * After the 30th failed retry the subscription is cancelled at Stripe and
 *     the workspace becomes read-only: data intact and exportable, no billable
 *     work. Re-subscribing (without a second trial) restores it.
 */

import { TRIAL, allowancesFor } from "./plans.ts";

export const DAY_MS = 86_400_000;

/** Daily retries after the first failed charge. */
export const MAX_DUNNING_ATTEMPTS = 30;
/** Days after the first failure that retries may run on. */
export const DUNNING_WINDOW_DAYS = 30;
/** Days of full access after the first failed charge (days 0, 1, 2). */
export const GRACE_FULL_ACCESS_DAYS = 3;
/** The day a "last chance" warning goes out before cancellation. */
export const DUNNING_FINAL_WARNING_DAY = 25;
/**
 * A Stripe trial still marked TRIALING this long after `trial_ends_at` means
 * the transition webhook was lost; the workspace stops being treated as in
 * trial rather than trialling forever.
 */
export const TRIAL_STALE_MARGIN_DAYS = 3;
/** Stripe Checkout refuses a `trial_end` sooner than 48 hours away. */
export const MIN_CHECKOUT_TRIAL_MS = 48 * 60 * 60 * 1000;

export type SubscriptionRowLike = {
  plan: string;
  status: string;
  trial_ends_at: string | null;
  stripe_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  lead_limit: number;
  user_limit: number;
  whatsapp_enabled: boolean;
  campaigns_enabled: boolean;
  ai_assist_allowed: boolean;
};

export type DunningStatus = "OPEN" | "RECOVERED" | "EXHAUSTED" | "CLOSED";

export type DunningLike = {
  status: DunningStatus;
  first_failed_at: string;
  attempts: number;
  last_attempt_on: string | null;
};

export type LifecycleState =
  | "AWAITING_CARD"
  | "TRIALING"
  | "TRIAL_EXPIRED"
  | "ACTIVE"
  | "PAST_DUE_GRACE"
  | "PAST_DUE_RESTRICTED"
  | "CANCELLED";

/**
 * What the workspace may do.
 *
 *   full       -- everything its plan allows
 *   restricted -- dunning pause: no sending, no AI; reads and lead intake go on
 *   read_only  -- no billable work at all; records readable and exportable
 */
export type BillingAccess = "full" | "restricted" | "read_only";

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/** `YYYY-MM-DD` in UTC -- the unit dunning is idempotent on. */
export function dayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function lifecycleState(
  row: SubscriptionRowLike | null,
  dunning: DunningLike | null,
  now: Date,
): LifecycleState {
  if (!row) return "AWAITING_CARD";
  if (row.status === "CANCELLED") return "CANCELLED";

  // No Stripe subscription: either a workspace that has not been through
  // Checkout yet, or one from before card-first trials (8.10) whose app-local
  // trial is honoured until the date it was promised.
  if (!row.stripe_subscription_id) {
    if (row.status === "ACTIVE") return "ACTIVE"; // sales-provisioned, off Stripe
    if (row.status === "TRIALING") {
      return row.trial_ends_at && new Date(row.trial_ends_at).getTime() > now.getTime()
        ? "TRIALING"
        : "TRIAL_EXPIRED";
    }
    return "AWAITING_CARD";
  }

  switch (row.status) {
    case "TRIALING": {
      if (row.trial_ends_at) {
        const staleAt =
          new Date(row.trial_ends_at).getTime() + TRIAL_STALE_MARGIN_DAYS * DAY_MS;
        if (now.getTime() > staleAt) return "TRIAL_EXPIRED";
      }
      return "TRIALING";
    }
    case "ACTIVE":
      return "ACTIVE";
    case "PAST_DUE":
    case "UNPAID": {
      if (dunning?.status === "EXHAUSTED") return "CANCELLED";
      // No dunning row yet (the webhooks raced): the failure is at most minutes
      // old, which is inside the grace window by definition.
      if (!dunning || dunning.status !== "OPEN") return "PAST_DUE_GRACE";
      return graceStage(new Date(dunning.first_failed_at), now) === "grace"
        ? "PAST_DUE_GRACE"
        : "PAST_DUE_RESTRICTED";
    }
    // `incomplete`: Checkout created the subscription but the first payment
    // needs action. Not usable until Stripe says otherwise.
    default:
      return "AWAITING_CARD";
  }
}

export function accessFor(state: LifecycleState): BillingAccess {
  switch (state) {
    case "TRIALING":
    case "ACTIVE":
    case "PAST_DUE_GRACE":
      return "full";
    case "PAST_DUE_RESTRICTED":
      return "restricted";
    default:
      return "read_only";
  }
}

/** Whether the app should send the owner to Checkout before anything else. */
export function needsCheckout(state: LifecycleState): boolean {
  return state === "AWAITING_CARD" || state === "TRIAL_EXPIRED";
}

export function graceStage(firstFailedAt: Date, now: Date): "grace" | "restricted" {
  return daysBetween(firstFailedAt, now) < GRACE_FULL_ACCESS_DAYS ? "grace" : "restricted";
}

/* ------------------------------------------------------------ entitlements */

export type DerivedEntitlements = {
  /** The plan key limits are resolved against. "trial" while trialling. */
  plan: string;
  /** The tier chosen at checkout; differs from `plan` during a trial. */
  selectedPlan: string;
  status: string;
  state: LifecycleState;
  access: BillingAccess;
  leadLimit: number;
  userLimit: number;
  whatsappEnabled: boolean;
  campaignsEnabled: boolean;
  aiAssistAllowed: boolean;
  /** Subscription permits billable work right now. */
  active: boolean;
  /** Sending is permitted right now (false in a dunning pause). */
  sendingAllowed: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  trialEndsAt: string | null;
};

export function deriveEntitlements(
  row: SubscriptionRowLike | null,
  dunning: DunningLike | null,
  now: Date,
): DerivedEntitlements {
  const state = lifecycleState(row, dunning, now);
  const access = accessFor(state);
  const full = access === "full";
  const trialing = state === "TRIALING";

  // During a trial the trial's limits apply whatever tier was chosen, and they
  // come from the one TRIAL constant rather than the row's snapshot -- which
  // is how a legacy row written with different numbers stops disagreeing.
  const limits = trialing || !row
    ? {
        leadLimit: TRIAL.leadLimit,
        userLimit: TRIAL.userLimit,
        whatsappEnabled: TRIAL.whatsappEnabled,
        campaignsEnabled: TRIAL.campaignsEnabled,
        aiAssistAllowed: TRIAL.aiAssistAllowed,
      }
    : {
        leadLimit: row.lead_limit,
        userLimit: row.user_limit,
        whatsappEnabled: row.whatsapp_enabled,
        campaignsEnabled: row.campaigns_enabled,
        aiAssistAllowed: row.ai_assist_allowed,
      };

  return {
    plan: trialing || !row ? "trial" : row.plan,
    selectedPlan: row?.plan ?? "trial",
    status: row?.status ?? "INCOMPLETE",
    state,
    access,
    leadLimit: limits.leadLimit,
    userLimit: limits.userLimit,
    whatsappEnabled: full && limits.whatsappEnabled,
    campaignsEnabled: full && limits.campaignsEnabled,
    aiAssistAllowed: full && limits.aiAssistAllowed,
    active: full,
    sendingAllowed: full,
    periodStart: row?.current_period_start ?? null,
    periodEnd: row?.current_period_end ?? null,
    trialEndsAt: row?.trial_ends_at ?? null,
  };
}

/**
 * The entitlement snapshot the webhook writes onto the subscription row.
 * While trialling it is the trial's, so the row never claims a paid tier's
 * limits before a paid tier has been paid for.
 */
export function entitlementSnapshot(plan: string, trialing: boolean) {
  const allowances = allowancesFor(trialing ? "trial" : plan);
  return {
    lead_limit: allowances.leadLimit,
    user_limit: allowances.userLimit,
    whatsapp_enabled: allowances.whatsappEnabled,
    campaigns_enabled: allowances.campaignsEnabled,
    ai_assist_allowed: allowances.aiAssistAllowed,
  };
}

/* ------------------------------------------------------------ checkout */

export type TrialOffer =
  | { kind: "trial_days"; days: number }
  | { kind: "none"; reason: "trial_used" | "legacy_trial_expired" };

/**
 * How long a trial the Checkout session should carry.
 *
 *   * A new workspace: the full TRIAL.days.
 *   * A workspace that already had a Stripe subscription: none -- one trial
 *     per business (terms 5.4).
 *   * A workspace from before card-first trials, part-way through its
 *     app-local trial: the days it has left (at least one), so moving to
 *     card-first neither shortens nor extends what it was promised.
 *   * Such a workspace whose trial already ended: none; it is charged now.
 */
export function trialOffer(row: SubscriptionRowLike | null, now: Date): TrialOffer {
  if (!row) return { kind: "trial_days", days: TRIAL.days };
  if (row.stripe_subscription_id) return { kind: "none", reason: "trial_used" };

  if (row.status === "TRIALING" && row.trial_ends_at) {
    const remaining = new Date(row.trial_ends_at).getTime() - now.getTime();
    if (remaining <= 0) return { kind: "none", reason: "legacy_trial_expired" };
    return { kind: "trial_days", days: Math.min(TRIAL.days, Math.max(1, Math.ceil(remaining / DAY_MS))) };
  }

  return { kind: "trial_days", days: TRIAL.days };
}

/* ------------------------------------------------------------ dunning */

export type DunningDecision =
  | { action: "retry"; attemptNumber: number }
  | { action: "wait"; reason: "already_attempted_today" | "failed_today" }
  | { action: "exhaust"; reason: "max_attempts" | "window_elapsed" }
  | { action: "stop"; reason: "not_open" };

/**
 * What the daily job should do with one dunning record today.
 *
 * Idempotent per day: a record attempted today (or whose first failure was
 * today -- Stripe's own trial-end attempt is day 0) waits, so a second cron
 * fire, a job retry or an overlapping worker never charges twice in a day.
 */
export function dunningDecision(
  dunning: DunningLike,
  now: Date,
): DunningDecision {
  if (dunning.status !== "OPEN") return { action: "stop", reason: "not_open" };
  if (dunning.attempts >= MAX_DUNNING_ATTEMPTS) {
    return { action: "exhaust", reason: "max_attempts" };
  }

  const firstFailed = new Date(dunning.first_failed_at);
  if (daysBetween(firstFailed, now) > DUNNING_WINDOW_DAYS) {
    return { action: "exhaust", reason: "window_elapsed" };
  }

  const today = dayKey(now);
  if (dunning.last_attempt_on === today) {
    return { action: "wait", reason: "already_attempted_today" };
  }
  if (dayKey(firstFailed) === today) {
    return { action: "wait", reason: "failed_today" };
  }

  return { action: "retry", attemptNumber: dunning.attempts + 1 };
}

/** Whether a failed retry that brought attempts to `attempts` ends dunning. */
export function exhaustedAfter(attempts: number): boolean {
  return attempts >= MAX_DUNNING_ATTEMPTS;
}

export type DunningNotice = "failed" | "restricted" | "final_warning" | "cancelled" | "recovered";

/**
 * The notice due for a dunning record on a given day, if any. Each is sent
 * once (the caller keys it on invoice + notice).
 */
export function dunningNoticeFor(firstFailedAt: Date, now: Date): DunningNotice | null {
  const day = daysBetween(firstFailedAt, now);
  if (day >= DUNNING_FINAL_WARNING_DAY) return "final_warning";
  if (day >= GRACE_FULL_ACCESS_DAYS) return "restricted";
  return null;
}

/* ------------------------------------------------------------ add-on items */

/**
 * The subscription status the add-on gates (voice) should see. Add-on items
 * (the Pro voice item, the dedicated-number item) sit ON the subscription and
 * are dunned with it, so they follow the same grace policy as the plan:
 *
 *   * PAST_DUE inside the grace days (access "full")  -> treated as ACTIVE:
 *     voice keeps working exactly as sending and AI do;
 *   * from day 3 (access "restricted")               -> PAST_DUE: paused;
 *   * cancelled / read-only                          -> as stored: off.
 *
 * Before this, voice read the raw status and stopped the moment any invoice
 * failed, while the rest of the product was still in its grace days.
 */
export function addOnSubscriptionStatus(entitlements: { status: string; access: BillingAccess }): string {
  if ((entitlements.status === "PAST_DUE" || entitlements.status === "UNPAID") && entitlements.access === "full") {
    return "ACTIVE";
  }
  return entitlements.status;
}
