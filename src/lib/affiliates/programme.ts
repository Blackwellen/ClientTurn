/**
 * The affiliate programme's canonical vocabulary and policy (V4 §29-36).
 *
 * Pure — no `server-only`, no Supabase — so the portal's client components, the
 * public marketing page and `node --test` all read the same definitions.
 *
 * This module exists because the same four numbers (conversion rate,
 * attribution window, commission rate, payout threshold) appear on the public
 * page, the dashboard, the referrals page, the performance page and the FAQ.
 * When each surface computes its own, they disagree, and an affiliate who is
 * told two different attribution windows stops trusting the ledger. So: one
 * definition each, here, and every surface reads it.
 *
 * `types.ts` keeps the older shapes and the commission arithmetic. This file
 * adds the states and policy the portal proper needed and re-exports nothing —
 * import from whichever module owns the thing you want.
 */

import type { Tone } from "./types.ts";

/* ------------------------------------------------------- account states --- */

/**
 * Every state an affiliate account can be in.
 *
 * Split three ways on purpose: APPLIED/PENDING_REVIEW are pre-decision,
 * APPROVED is decided but not yet earning, ACTIVE earns. Collapsing the first
 * three into "pending" would lose the distinction a reviewer works in.
 */
export const AFFILIATE_ACCOUNT_STATES = [
  "APPLIED",
  "PENDING_REVIEW",
  "APPROVED",
  "ACTIVE",
  "SUSPENDED",
  "REJECTED",
  "CLOSED",
] as const;
export type AffiliateAccountState = (typeof AFFILIATE_ACCOUNT_STATES)[number];

export const ACCOUNT_STATE_LABEL: Record<AffiliateAccountState, string> = {
  APPLIED: "Application received",
  PENDING_REVIEW: "Under review",
  APPROVED: "Approved",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  REJECTED: "Not accepted",
  CLOSED: "Closed",
};

export const ACCOUNT_STATE_TONE: Record<AffiliateAccountState, Tone> = {
  APPLIED: "warning",
  PENDING_REVIEW: "warning",
  APPROVED: "info",
  ACTIVE: "success",
  SUSPENDED: "danger",
  REJECTED: "neutral",
  CLOSED: "neutral",
};

/** Whether this state may create links, earn commission and be paid. */
export function isEarningState(state: string): boolean {
  return state === "ACTIVE";
}

/* -------------------------------------------------- payout readiness --- */

/**
 * Whether money can actually leave the platform for this affiliate.
 *
 * Deliberately independent of account state. An ACTIVE affiliate with no
 * Stripe account is ACTIVE + ACTION_REQUIRED, and showing only the first half
 * of that is how a partner ends up wondering why a payout never arrived.
 */
export const PAYOUT_READINESS_STATES = [
  "ACTION_REQUIRED",
  "PENDING",
  "READY",
  "BLOCKED",
] as const;
export type PayoutReadiness = (typeof PAYOUT_READINESS_STATES)[number];

export const PAYOUT_READINESS_LABEL: Record<PayoutReadiness, string> = {
  ACTION_REQUIRED: "Action required",
  PENDING: "Verification in progress",
  READY: "Ready for payouts",
  BLOCKED: "Payouts blocked",
};

export const PAYOUT_READINESS_TONE: Record<PayoutReadiness, Tone> = {
  ACTION_REQUIRED: "warning",
  PENDING: "info",
  READY: "success",
  BLOCKED: "danger",
};

/* ------------------------------------------------------- Stripe Connect --- */

export const CONNECT_STATES = [
  "NOT_CONNECTED",
  "ONBOARDING",
  "RESTRICTED",
  "READY",
  "DISABLED",
] as const;
export type ConnectState = (typeof CONNECT_STATES)[number];

export const CONNECT_STATE_LABEL: Record<ConnectState, string> = {
  NOT_CONNECTED: "Not connected",
  ONBOARDING: "Finishing setup",
  RESTRICTED: "More information needed",
  READY: "Connected",
  DISABLED: "Disabled",
};

export const CONNECT_STATE_TONE: Record<ConnectState, Tone> = {
  NOT_CONNECTED: "neutral",
  ONBOARDING: "info",
  RESTRICTED: "warning",
  READY: "success",
  DISABLED: "danger",
};

/* ------------------------------------------------------------- identity --- */

export const IDENTITY_STATES = [
  "NOT_STARTED",
  "REQUIRED",
  "PENDING",
  "VERIFIED",
  "FAILED",
  "REQUIRES_UPDATE",
] as const;
export type IdentityState = (typeof IDENTITY_STATES)[number];

export const IDENTITY_STATE_LABEL: Record<IdentityState, string> = {
  NOT_STARTED: "Not started",
  REQUIRED: "Action required",
  PENDING: "In review",
  VERIFIED: "Verified",
  FAILED: "Could not be verified",
  REQUIRES_UPDATE: "Needs updating",
};

export const IDENTITY_STATE_TONE: Record<IdentityState, Tone> = {
  NOT_STARTED: "neutral",
  REQUIRED: "warning",
  PENDING: "info",
  VERIFIED: "success",
  FAILED: "danger",
  REQUIRES_UPDATE: "warning",
};

/* ------------------------------------------------------------------ tax --- */

export const TAX_STATES = ["NOT_PROVIDED", "SUBMITTED", "VERIFIED", "INVALID"] as const;
export type TaxState = (typeof TAX_STATES)[number];

export const TAX_STATE_LABEL: Record<TaxState, string> = {
  NOT_PROVIDED: "Action required",
  SUBMITTED: "Submitted",
  VERIFIED: "Completed",
  INVALID: "Needs updating",
};

export const TAX_STATE_TONE: Record<TaxState, Tone> = {
  NOT_PROVIDED: "warning",
  SUBMITTED: "info",
  VERIFIED: "success",
  INVALID: "danger",
};

export const TAX_ENTITY_TYPES = [
  { value: "INDIVIDUAL", label: "Individual" },
  { value: "SOLE_TRADER", label: "Sole trader" },
  { value: "COMPANY", label: "Limited company" },
  { value: "PARTNERSHIP", label: "Partnership" },
] as const;

/* -------------------------------------------------- referral lifecycle --- */

export const TRIAL_STATES = [
  "NOT_STARTED",
  "ACTIVE_TRIAL",
  "CONVERTED",
  "EXPIRED",
  "CANCELLED",
] as const;
export type TrialState = (typeof TRIAL_STATES)[number];

export const TRIAL_STATE_LABEL: Record<TrialState, string> = {
  NOT_STARTED: "Not started",
  ACTIVE_TRIAL: "Active trial",
  CONVERTED: "Converted",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

export const TRIAL_STATE_TONE: Record<TrialState, Tone> = {
  NOT_STARTED: "neutral",
  ACTIVE_TRIAL: "info",
  CONVERTED: "success",
  EXPIRED: "danger",
  CANCELLED: "danger",
};

export const PAID_STATES = [
  "NOT_PAID",
  "PAID",
  "REFUNDED",
  "CHARGEBACK",
  "CANCELLED",
] as const;
export type PaidState = (typeof PAID_STATES)[number];

export const PAID_STATE_LABEL: Record<PaidState, string> = {
  NOT_PAID: "Not paid",
  PAID: "Paid",
  REFUNDED: "Refunded",
  CHARGEBACK: "Chargeback",
  CANCELLED: "Cancelled",
};

export const PAID_STATE_TONE: Record<PaidState, Tone> = {
  NOT_PAID: "neutral",
  PAID: "success",
  REFUNDED: "danger",
  CHARGEBACK: "danger",
  CANCELLED: "neutral",
};

/* ------------------------------------------------------ commission types -- */

export const COMMISSION_ENTRY_TYPES = [
  "NEW_CUSTOMER",
  "RENEWAL",
  "ADJUSTMENT",
  "REVERSAL",
] as const;
export type CommissionEntryType = (typeof COMMISSION_ENTRY_TYPES)[number];

export const COMMISSION_ENTRY_LABEL: Record<CommissionEntryType, string> = {
  NEW_CUSTOMER: "New customer commission",
  RENEWAL: "Renewal commission",
  ADJUSTMENT: "Adjustment",
  REVERSAL: "Reversal",
};

/** Why a commission was taken back. Stored, never silently applied. */
export const REVERSAL_REASONS = [
  "REFUND",
  "CHARGEBACK",
  "FRAUD",
  "SELF_REFERRAL",
  "SUBSCRIPTION_INVALID",
  "POLICY_VIOLATION",
] as const;
export type ReversalReason = (typeof REVERSAL_REASONS)[number];

export const REVERSAL_REASON_LABEL: Record<ReversalReason, string> = {
  REFUND: "Customer refunded",
  CHARGEBACK: "Payment charged back",
  FRAUD: "Flagged as fraudulent",
  SELF_REFERRAL: "Self-referral",
  SUBSCRIPTION_INVALID: "Subscription invalidated",
  POLICY_VIOLATION: "Programme policy violation",
};

/* ------------------------------------------------------------------ tier -- */

export const AFFILIATE_TIERS = ["STANDARD", "PARTNER", "PREMIUM"] as const;
export type AffiliateTier = (typeof AFFILIATE_TIERS)[number];

export const TIER_LABEL: Record<AffiliateTier, string> = {
  STANDARD: "Standard",
  PARTNER: "Partner",
  PREMIUM: "Premium",
};

/**
 * What a tier actually changes today: nothing.
 *
 * The column exists so the programme can grow into tiers without a migration,
 * but no code reads it to decide a rate, and the UI says so rather than
 * implying benefits that do not exist.
 */
export const TIER_EXPLANATION =
  "Everyone earns the same published commission rate. Tiers record how long you have been with the programme and do not change your rate.";

/* --------------------------------------------------------- date ranges --- */

export const RANGE_KEYS = ["7d", "30d", "90d", "custom"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export const RANGE_LABEL: Record<RangeKey, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  custom: "Custom",
};

export const DEFAULT_RANGE: RangeKey = "30d";

export function rangeDays(key: RangeKey): number {
  if (key === "7d") return 7;
  if (key === "90d") return 90;
  return 30;
}

/** How far back a custom range may reach. */
export const MAX_CUSTOM_RANGE_DAYS = 365;

/**
 * A custom window, as two ISO dates.
 *
 * Held separately from `RangeKey` because a custom range is two extra facts
 * that the three preset keys do not carry, and widening `RangeKey` into a
 * union of key-or-dates would make every call site handle a case it does not
 * have.
 */
export type CustomRange = { fromDate: string; toDate: string };

/**
 * Parses and clamps a caller-supplied custom window.
 *
 * Everything about this is defensive because both dates arrive in a query
 * string. An unparseable date, a reversed pair, a zero-length window or a
 * ten-year span would each produce a chart that is wrong rather than empty, so
 * each is corrected here instead of being passed down to SQL.
 *
 * Returns null when the input is not usable at all, and the caller falls back
 * to the default preset rather than rendering nothing.
 */
export function parseCustomRange(
  fromValue: string | null | undefined,
  toValue: string | null | undefined,
  now: Date = new Date(),
): CustomRange | null {
  if (!fromValue || !toValue) return null;

  const start = new Date(`${fromValue}T00:00:00.000Z`);
  const end = new Date(`${toValue}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return null;
  }

  // Reversed pairs are corrected rather than rejected: someone picking the end
  // date first is making an ordering mistake, not asking for nothing.
  let low = start <= end ? start : end;
  let high = start <= end ? end : start;

  // Never past today. A window reaching into the future renders empty days
  // that read as a collapse in performance.
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  if (high > today) high = today;
  if (low > today) low = today;

  // Clamp the span. A multi-year window would ask the daily series for
  // thousands of buckets to draw a chart a few hundred pixels wide.
  const span = Math.round((high.getTime() - low.getTime()) / 86400000);
  if (span > MAX_CUSTOM_RANGE_DAYS) {
    low = new Date(high.getTime() - MAX_CUSTOM_RANGE_DAYS * 86400000);
  }

  return {
    fromDate: low.toISOString().slice(0, 10),
    toDate: high.toISOString().slice(0, 10),
  };
}

/**
 * Resolves a range into a half-open window `[from, to)`.
 *
 * Half-open because a closed window double-counts anything that lands exactly
 * on midnight, which for a daily-bucketed chart is every boundary.
 *
 * A custom window's `toDate` is inclusive to the person who picked it — they
 * chose "up to and including the 30th" — so `to` is the start of the day
 * after, and the comparison window is the same number of days immediately
 * before it.
 */
export function resolveRange(
  key: RangeKey,
  now: Date = new Date(),
  custom?: CustomRange | null,
): { from: Date; to: Date; days: number; previousFrom: Date } {
  if (key === "custom" && custom) {
    const from = new Date(`${custom.fromDate}T00:00:00.000Z`);
    const to = new Date(`${custom.toDate}T00:00:00.000Z`);
    to.setUTCDate(to.getUTCDate() + 1);

    const days = Math.max(
      1,
      Math.round((to.getTime() - from.getTime()) / 86400000),
    );
    const previousFrom = new Date(from.getTime() - days * 86400000);

    return { from, to, days, previousFrom };
  }

  const to = new Date(now);
  to.setUTCHours(0, 0, 0, 0);
  to.setUTCDate(to.getUTCDate() + 1);

  const days = rangeDays(key);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - days);

  const previousFrom = new Date(from);
  previousFrom.setUTCDate(previousFrom.getUTCDate() - days);

  return { from, to, days, previousFrom };
}

export function parseRange(value: string | null | undefined): RangeKey {
  return (RANGE_KEYS as readonly string[]).includes(value ?? "")
    ? (value as RangeKey)
    : DEFAULT_RANGE;
}

/** The comparison caption for a window, including a custom one. */
export function rangeComparisonLabel(key: RangeKey, days: number): string {
  if (key === "custom") return `vs. previous ${days} days`;
  return `vs. previous ${rangeDays(key)} days`;
}

/* ---------------------------------------------------- programme policy --- */

/**
 * The programme's commercial terms, as the portal and the public page state
 * them.
 *
 * Sourced from the default row in `affiliate_commission_plans`, so changing
 * the rate is a data change and not a deploy. `describe*` below turn it into
 * the sentences the marketing page and FAQ use, which is the whole reason this
 * is one object rather than four scattered constants.
 */
export type ProgrammePolicy = {
  attributionWindowDays: number;
  attributionModel: "LAST_TOUCH" | "FIRST_TOUCH";
  commissionType: "RECURRING_PERCENT" | "FIRST_PAYMENT_PERCENT" | "FLAT_AMOUNT";
  commissionPercent: number | null;
  commissionFlatMinor: number | null;
  recurringMonths: number | null;
  holdDays: number;
  minimumPayoutMinor: number;
  payoutFrequency: "MONTHLY";
  currency: string;
  selfReferralsAllowed: boolean;
  termsVersion: string;
};

/**
 * The terms used when no default plan row exists yet.
 *
 * Not a silent guess: the public page and the portal both show these only
 * because they match the seeded default in migration 0056. If someone changes
 * the plan row, the DB value wins everywhere.
 */
export const FALLBACK_POLICY: ProgrammePolicy = {
  attributionWindowDays: 90,
  attributionModel: "LAST_TOUCH",
  commissionType: "RECURRING_PERCENT",
  commissionPercent: 20,
  commissionFlatMinor: null,
  recurringMonths: 12,
  holdDays: 30,
  minimumPayoutMinor: 10000,
  payoutFrequency: "MONTHLY",
  currency: "GBP",
  selfReferralsAllowed: false,
  termsVersion: "2026-09",
};

/** "20%" or "£50" — the headline rate, however the plan expresses it. */
export function describeRate(policy: ProgrammePolicy): string {
  if (policy.commissionType === "FLAT_AMOUNT") {
    return formatMoney(policy.commissionFlatMinor ?? 0, policy.currency);
  }
  return `${trimNumber(policy.commissionPercent ?? 0)}%`;
}

/** The full sentence: rate plus how long it lasts. */
export function describeCommission(policy: ProgrammePolicy): string {
  const rate = describeRate(policy);
  switch (policy.commissionType) {
    case "FLAT_AMOUNT":
      return `${rate} for every customer who starts paying.`;
    case "FIRST_PAYMENT_PERCENT":
      return `${rate} of each referred customer's first payment.`;
    case "RECURRING_PERCENT":
      return policy.recurringMonths
        ? `${rate} of every payment for the first ${policy.recurringMonths} months of each referred customer.`
        : `${rate} of every payment, for as long as the customer stays.`;
  }
}

export function describeAttribution(policy: ProgrammePolicy): string {
  const model =
    policy.attributionModel === "LAST_TOUCH"
      ? "The last affiliate link a visitor clicked before signing up gets the credit."
      : "The first affiliate link a visitor clicked gets the credit.";
  return `${model} Clicks count for ${policy.attributionWindowDays} days.`;
}

export function describePayout(policy: ProgrammePolicy): string {
  return `Commission is confirmed ${policy.holdDays} days after the payment clears, then paid monthly once your approved balance reaches ${formatMoney(policy.minimumPayoutMinor, policy.currency)}.`;
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "");
}

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
}

/* ------------------------------------------------- notification prefs --- */

export const NOTIFICATION_PREFS = [
  {
    key: "new_referral",
    label: "New referral",
    description: "Get notified when someone signs up using your link",
  },
  {
    key: "commission_updates",
    label: "Commission updates",
    description: "Updates on approvals, payouts and adjustments",
  },
  {
    key: "payout_updates",
    label: "Payout updates",
    description: "When a payout is scheduled, sent or fails",
  },
  {
    key: "product_updates",
    label: "Product updates",
    description: "News about new features and improvements",
  },
  {
    key: "marketing_tips",
    label: "Marketing tips",
    description: "Tips, ideas and campaign suggestions to help you earn more",
  },
  {
    key: "monthly_report",
    label: "Monthly performance report",
    description: "A summary of your performance each month",
  },
] as const;

export type NotificationPrefKey = (typeof NOTIFICATION_PREFS)[number]["key"];

/**
 * Defaults leaning on: money and referrals are things a partner asked to hear
 * about by joining. Marketing tips are the one genuinely promotional item, so
 * that is the one that starts off.
 */
export const DEFAULT_NOTIFICATION_PREFS: Record<NotificationPrefKey, boolean> = {
  new_referral: true,
  commission_updates: true,
  payout_updates: true,
  product_updates: true,
  marketing_tips: false,
  monthly_report: true,
};

export function resolveNotificationPrefs(
  stored: unknown,
): Record<NotificationPrefKey, boolean> {
  const value = (stored ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_NOTIFICATION_PREFS };
  for (const pref of NOTIFICATION_PREFS) {
    if (typeof value[pref.key] === "boolean") {
      out[pref.key] = value[pref.key] as boolean;
    }
  }
  return out;
}

/* --------------------------------------------------------- preferences --- */

export type AffiliatePreferences = {
  defaultRange: RangeKey;
  defaultDestination: string;
  currencyDisplay: "GBP";
  resourceUpdates: boolean;
};

export const DEFAULT_PREFERENCES: AffiliatePreferences = {
  defaultRange: "30d",
  defaultDestination: "/",
  // Not a choice. The ledger is denominated in the programme currency, and
  // letting a partner switch the display would invite them to read a converted
  // number as the amount they will be paid.
  currencyDisplay: "GBP",
  resourceUpdates: true,
};

export function resolvePreferences(stored: unknown): AffiliatePreferences {
  const value = (stored ?? {}) as Record<string, unknown>;
  return {
    defaultRange: (RANGE_KEYS as readonly string[]).includes(
      String(value.defaultRange),
    )
      ? (value.defaultRange as RangeKey)
      : DEFAULT_PREFERENCES.defaultRange,
    defaultDestination:
      typeof value.defaultDestination === "string"
        ? value.defaultDestination
        : DEFAULT_PREFERENCES.defaultDestination,
    currencyDisplay: "GBP",
    resourceUpdates:
      typeof value.resourceUpdates === "boolean"
        ? value.resourceUpdates
        : DEFAULT_PREFERENCES.resourceUpdates,
  };
}

/* ------------------------------------------------------------- masking --- */

/**
 * Shows enough of an identifier to recognise it and not enough to use it.
 *
 * The full value never leaves the server for tax identifiers and bank
 * references, so in practice this formats a stored last-four. It accepts a
 * longer string too, so a caller that has one cannot leak it by accident.
 */
export function maskIdentifier(value: string | null, visible = 4): string {
  if (!value) return "—";
  const trimmed = value.trim();
  if (trimmed.length <= visible) return `${"•".repeat(5)}${trimmed}`;
  return `${"•".repeat(5)}${trimmed.slice(-visible)}`;
}

/* --------------------------------------------------- attribution expiry --- */

/**
 * How long a referral's attribution has left.
 *
 * Returned as a shape rather than a string so the caller decides the tone: the
 * referrals table colours the last fortnight amber, and a formatter that
 * returned "12 days" could not tell it that.
 */
export function attributionRemaining(
  expiresAt: string | null,
  now: Date = new Date(),
): { label: string; days: number | null; expired: boolean; urgent: boolean } {
  if (!expiresAt) return { label: "—", days: null, expired: false, urgent: false };

  const expiry = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiry)) {
    return { label: "—", days: null, expired: false, urgent: false };
  }

  const days = Math.ceil((expiry - now.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return { label: "Expired", days: 0, expired: true, urgent: false };

  return {
    label: days === 1 ? "1 day" : `${days} days`,
    days,
    expired: false,
    urgent: days <= 14,
  };
}

/* ---------------------------------------------------------- conversion --- */

/**
 * The programme's one conversion rate: paying customers per unique click.
 *
 * Signup rate and trial rate are separate funnel steps and have their own
 * helpers. Nothing in the portal may compute "conversion" any other way — if a
 * surface needs a different ratio it needs a different label.
 */
export function programmeConversionRate(
  paidCustomers: number,
  uniqueClicks: number,
): number | null {
  if (uniqueClicks <= 0) return null;
  return paidCustomers / uniqueClicks;
}

/** A step-to-step funnel percentage, null when the previous step is empty. */
export function stepRate(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return current / previous;
}

export function formatPercent(value: number | null, decimals = 1): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * A percentage-point delta, which is what a change in a rate actually is.
 *
 * Reporting "conversion up 38%" when it moved from 2.2% to 3.0% is the classic
 * dashboard lie, so rate cards use this and count cards use a plain percentage.
 */
export function formatPointDelta(current: number | null, previous: number | null): string | null {
  if (current === null || previous === null) return null;
  const points = (current - previous) * 100;
  return `${points >= 0 ? "+" : ""}${points.toFixed(1)}pp`;
}
