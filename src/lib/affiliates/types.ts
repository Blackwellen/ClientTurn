/**
 * The affiliate programme (V4 §29-35, §41).
 *
 * Pure — no `server-only`, no Supabase — so the portal's client components can
 * import labels, tones and the commission arithmetic without pulling the
 * service-role client into the browser graph.
 *
 * The boundary this module exists to keep visible: an affiliate is a
 * platform-level actor, never a member of the workspace they referred. Nothing
 * here has a shape that could carry a referred tenant's leads, prospects or
 * messages, and `referralLabel()` below is the only identity an affiliate ever
 * sees for a business they introduced.
 */

/* ------------------------------------------------------------- affiliate --- */

export const AFFILIATE_STATUSES = [
  "APPLIED",
  "ACTIVE",
  "SUSPENDED",
  "REJECTED",
] as const;
export type AffiliateStatus = (typeof AFFILIATE_STATUSES)[number];

export const AFFILIATE_STATUS_LABEL: Record<AffiliateStatus, string> = {
  APPLIED: "Application under review",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  REJECTED: "Not accepted",
};

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export const AFFILIATE_STATUS_TONE: Record<AffiliateStatus, Tone> = {
  APPLIED: "warning",
  ACTIVE: "success",
  SUSPENDED: "danger",
  REJECTED: "neutral",
};

/* -------------------------------------------------------------- referrals --- */

export const REFERRAL_STATUSES = [
  "SIGNED_UP",
  "TRIALING",
  "PAID",
  "CHURNED",
  "REFUNDED",
  "REJECTED",
] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  SIGNED_UP: "Signed up",
  TRIALING: "On trial",
  PAID: "Paying",
  CHURNED: "Churned",
  REFUNDED: "Refunded",
  REJECTED: "Not eligible",
};

export const REFERRAL_STATUS_TONE: Record<ReferralStatus, Tone> = {
  SIGNED_UP: "info",
  TRIALING: "accent",
  PAID: "success",
  CHURNED: "neutral",
  REFUNDED: "danger",
  REJECTED: "neutral",
};

/* ------------------------------------------------------------ commissions --- */

export const COMMISSION_STATUSES = [
  "PENDING",
  "APPROVED",
  "REVERSED",
  "PAYABLE",
  "PAID",
] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export const COMMISSION_STATUS_LABEL: Record<CommissionStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REVERSED: "Reversed",
  PAYABLE: "Ready to pay",
  PAID: "Paid",
};

export const COMMISSION_STATUS_TONE: Record<CommissionStatus, Tone> = {
  PENDING: "warning",
  APPROVED: "info",
  REVERSED: "danger",
  PAYABLE: "accent",
  PAID: "success",
};

/**
 * What each commission state actually means for the affiliate's money. Written
 * as sentences because "Pending" on its own tells someone nothing about when
 * they will be paid, and a payouts page that cannot answer that generates
 * support tickets.
 */
export const COMMISSION_STATUS_MEANING: Record<CommissionStatus, string> = {
  PENDING: "Earned, but still inside the refund hold period.",
  APPROVED: "Past the hold period and confirmed. It joins the next payout run.",
  REVERSED: "The customer refunded or charged back, so this was taken off.",
  PAYABLE: "Included in a payout that has not been sent yet.",
  PAID: "Sent to you.",
};

export const PAYOUT_STATUSES = [
  "DRAFT",
  "APPROVED",
  "PROCESSING",
  "PAID",
  "FAILED",
  "CANCELLED",
] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved",
  PROCESSING: "Processing",
  PAID: "Paid",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const PAYOUT_STATUS_TONE: Record<PayoutStatus, Tone> = {
  DRAFT: "neutral",
  APPROVED: "info",
  PROCESSING: "accent",
  PAID: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
};

/* --------------------------------------------------------------- resources -- */

export const RESOURCE_CATEGORIES = [
  "BRAND",
  "SCREENSHOT",
  "AD_CREATIVE",
  "VIDEO",
  "COPY",
  "EDUCATION",
  "CAMPAIGN_PACK",
] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

export const RESOURCE_CATEGORY_LABEL: Record<ResourceCategory, string> = {
  BRAND: "Brand assets",
  SCREENSHOT: "Product screenshots",
  AD_CREATIVE: "Ad creative",
  VIDEO: "Video",
  COPY: "Copy and templates",
  EDUCATION: "How to promote",
  CAMPAIGN_PACK: "Campaign packs",
};

/* ------------------------------------------------------------------ codes --- */

/** Characters that survive being read aloud, handwritten or dictated badly. */
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/**
 * Turns a display name into a referral code candidate.
 *
 * Uniqueness is the database's job (`affiliates.code` is unique) — this only
 * produces a candidate that reads well in a URL. The caller retries with a
 * suffix on collision rather than trusting this to be unique.
 */
export function codeCandidate(displayName: string, salt = ""): string {
  const base = displayName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  const stem = base.length >= 3 ? base : "partner";
  return salt ? `${stem}-${salt}` : stem;
}

/** A random suffix for collision retries. Not a secret — codes are public. */
export function randomSuffix(length = 4, random: () => number = Math.random): string {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** Slugs live in a URL path, so the accepted shape is deliberately narrow. */
export function isValidSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(value);
}

/**
 * The full referral URL for a link.
 *
 * `destinationPath` is appended as a query parameter rather than interpolated
 * into the path: a destination is affiliate-supplied, and an affiliate must not
 * be able to make their link resolve to an arbitrary path on the marketing site.
 */
export function referralUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, "")}/r/${slug}`;
}

/**
 * Only paths we are willing to send a stranger to. An affiliate chooses where
 * their audience lands, but from a fixed list — an open redirect on a link that
 * carries our brand is a phishing primitive, not a feature.
 */
export const ALLOWED_DESTINATIONS = [
  { path: "/", label: "Home page" },
  { path: "/pricing", label: "Pricing" },
  { path: "/signup", label: "Sign up" },
  { path: "/contact-sales", label: "Contact sales" },
] as const;

export function isAllowedDestination(path: string): boolean {
  return ALLOWED_DESTINATIONS.some((entry) => entry.path === path);
}

/* -------------------------------------------------------------- arithmetic -- */

export type CommissionPlan = {
  id: string;
  name: string;
  commissionType: "RECURRING_PERCENT" | "FIRST_PAYMENT_PERCENT" | "FLAT_AMOUNT";
  percent: number | null;
  flatAmountMinor: number | null;
  currency: string;
  recurringMonths: number | null;
  attributionWindowDays: number;
  cookieWindowDays: number;
  holdDays: number;
  minimumPayoutMinor: number;
};

/**
 * What a single billing event earns under a plan.
 *
 * Rounds to whole minor units with `Math.round`, so a half-penny does not
 * silently favour either side, and never returns more than the base amount —
 * a misconfigured percent over 100 would otherwise pay out more than the
 * customer paid.
 */
export function commissionFor(
  plan: CommissionPlan,
  baseAmountMinor: number,
  paymentIndex: number,
): number {
  if (baseAmountMinor <= 0) return 0;

  switch (plan.commissionType) {
    case "FLAT_AMOUNT":
      return Math.min(Math.max(plan.flatAmountMinor ?? 0, 0), baseAmountMinor);

    case "FIRST_PAYMENT_PERCENT":
      if (paymentIndex > 0) return 0;
      return capped(baseAmountMinor, plan.percent);

    case "RECURRING_PERCENT": {
      // A null `recurringMonths` means "for the life of the customer".
      if (plan.recurringMonths !== null && paymentIndex >= plan.recurringMonths) {
        return 0;
      }
      return capped(baseAmountMinor, plan.percent);
    }

    default:
      return 0;
  }
}

function capped(baseAmountMinor: number, percent: number | null): number {
  if (!percent || percent <= 0) return 0;
  return Math.min(Math.round((baseAmountMinor * percent) / 100), baseAmountMinor);
}

/** The date a commission clears its refund hold and becomes approvable. */
export function holdClearsAt(plan: CommissionPlan, earnedAt: Date): Date {
  const clears = new Date(earnedAt.getTime());
  clears.setUTCDate(clears.getUTCDate() + plan.holdDays);
  return clears;
}

/**
 * Whether a payout can be raised, and if not, why.
 *
 * Returned as a reason rather than a bare boolean because "Request payout" that
 * is merely disabled tells an affiliate nothing about what to fix.
 */
export function payoutBlocker(input: {
  status: AffiliateStatus;
  taxStatus: string;
  hasPaymentDetails: boolean;
  payableMinor: number;
  minimumPayoutMinor: number;
}): string | null {
  if (input.status !== "ACTIVE") {
    return "Your account is not active, so payouts are on hold.";
  }
  if (!input.hasPaymentDetails) {
    return "Add your payment details before a payout can be sent.";
  }
  if (input.taxStatus === "INVALID") {
    return "Your tax details could not be verified. Update them to continue.";
  }
  if (input.payableMinor < input.minimumPayoutMinor) {
    return `You need ${formatMinor(input.minimumPayoutMinor)} in approved commission before a payout is raised. You have ${formatMinor(input.payableMinor)}.`;
  }
  return null;
}

/* ----------------------------------------------------------- presentation -- */

export function formatMinor(value: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value / 100);
}

/** A rate that is null rather than 0 when nothing has happened yet. */
export function conversionRate(
  signups: number,
  clicks: number,
): number | null {
  if (clicks <= 0) return null;
  return signups / clicks;
}

export function formatRate(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
}

/**
 * What an affiliate is allowed to see of a business they referred.
 *
 * Deliberately not the workspace name: an affiliate has no relationship with
 * the customer and no right to their identity. The stored `display_label` is
 * shown only where the customer opted into being named as a reference.
 */
export function referralLabel(
  displayLabel: string | null,
  createdAt: string,
): string {
  if (displayLabel && displayLabel.trim()) return displayLabel.trim();
  return `Referral · ${new Date(createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

/* ---------------------------------------------------------------- shapes --- */

export type AffiliateSummary = {
  id: string;
  code: string;
  displayName: string;
  status: AffiliateStatus;
  statusReason: string | null;
  contactEmail: string;
  taxStatus: string;
  hasPaymentDetails: boolean;
  plan: CommissionPlan | null;
  createdAt: string;
  approvedAt: string | null;
};

export type AffiliateTotals = {
  clicks: number;
  signups: number;
  paying: number;
  pendingMinor: number;
  payableMinor: number;
  paidMinor: number;
  lifetimeMinor: number;
};

export type LinkRow = {
  id: string;
  label: string;
  slug: string;
  destinationPath: string;
  campaignName: string | null;
  clickCount: number;
  signupCount: number;
  paidCount: number;
  archived: boolean;
  createdAt: string;
};

export type ReferralRow = {
  id: string;
  label: string;
  status: ReferralStatus;
  planKey: string | null;
  signupAt: string | null;
  paidAt: string | null;
  lifetimeRevenueMinor: number;
  createdAt: string;
};

export type CommissionRow = {
  id: string;
  status: CommissionStatus;
  baseAmountMinor: number;
  commissionAmountMinor: number;
  currency: string;
  periodMonth: string | null;
  referralLabel: string;
  payableAt: string | null;
  paidAt: string | null;
  reversalReason: string | null;
  createdAt: string;
};

export type PayoutRow = {
  id: string;
  batchReference: string | null;
  status: PayoutStatus;
  amountMinor: number;
  currency: string;
  commissionCount: number;
  method: string | null;
  failureReason: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type ResourceRow = {
  id: string;
  category: ResourceCategory;
  title: string;
  description: string | null;
  resourceType: "FILE" | "IMAGE" | "VIDEO" | "TEXT" | "LINK";
  externalUrl: string | null;
  textContent: string | null;
  hasFile: boolean;
  fileSizeBytes: number | null;
  dimensions: string | null;
  version: string;
};
