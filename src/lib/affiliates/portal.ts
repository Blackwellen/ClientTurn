import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/session";
import {
  referralLabel,
  type CommissionPlan,
  type CommissionStatus,
  type PayoutStatus,
  type ReferralStatus,
  type ResourceCategory,
} from "./types";
import {
  FALLBACK_POLICY,
  resolveNotificationPrefs,
  resolvePreferences,
  type AffiliateAccountState,
  type AffiliatePreferences,
  type AffiliateTier,
  type ConnectState,
  type IdentityState,
  type NotificationPrefKey,
  type PaidState,
  type PayoutReadiness,
  type ProgrammePolicy,
  type TaxState,
  type TrialState,
} from "./programme";

/**
 * Portal reads for the partner surfaces (V4 §30-36).
 *
 * Sits alongside `queries.ts`, which keeps the original six-page portal's
 * reads. This module carries the richer shapes the redesigned portal needs:
 * the full account record, the referral lifecycle, the resource hub and the
 * payout ledger.
 *
 * Two boundaries every function here holds:
 *
 * - **The affiliate is resolved from the session, never from a parameter that
 *   originated in a request.** `getAffiliateAccount()` reads through the
 *   RLS-scoped client, so `current_affiliate_id()` is the real gate and a bug
 *   in this file cannot widen it.
 * - **Nothing joins to a referred tenant's own data.** The only bridge is
 *   `affiliate_referrals`, which carries lifecycle timestamps and a plan key.
 *   An affiliate can see that a business they introduced is on Growth and
 *   started paying in April. They cannot see its leads, its messages, its
 *   invoices or its users.
 */

/* --------------------------------------------------------------- account -- */

export type AffiliateAccount = {
  id: string;
  code: string;
  displayName: string;
  contactEmail: string;
  companyName: string | null;
  websiteUrl: string | null;
  country: string | null;
  timezone: string;
  phone: string | null;
  preferredLanguage: string;
  status: AffiliateAccountState;
  statusReason: string | null;
  tier: AffiliateTier;
  joinedAt: string;
  approvedAt: string | null;
  /** Public-facing reference, e.g. CT-AFF-78429. Derived, never stored. */
  reference: string;

  connectState: ConnectState;
  /** Whether a Connect account exists at all. The id itself never leaves here. */
  hasConnectAccount: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  connectSyncedAt: string | null;

  identityStatus: IdentityState;
  identityDocument: string | null;
  identitySelfie: string | null;
  identityAddress: string | null;
  identityCheckedAt: string | null;

  taxStatus: TaxState;
  taxCountry: string | null;
  taxEntityType: string | null;
  /** Last four characters only. The full identifier is never stored. */
  taxIdentifierLast4: string | null;
  taxSubmittedAt: string | null;

  payoutReadiness: PayoutReadiness;
  notificationPrefs: Record<NotificationPrefKey, boolean>;
  preferences: AffiliatePreferences;
  policy: ProgrammePolicy;
};

/**
 * The signed-in user's affiliate account, or null.
 *
 * Read through the RLS client so the database decides what is visible. The
 * commission plan is then loaded with the service role — that table has no
 * browser grant at all, and only the plan already attached to this account is
 * ever fetched, so it cannot be used to enumerate other partners' terms.
 */
export const getAffiliateAccount = cache(
  async (): Promise<AffiliateAccount | null> => {
    const user = await getUser();
    if (!user) return null;

    const supabase = await createClient();
    const { data } = await supabase
      .from("affiliates")
      .select(
        `id, code, display_name, contact_email, company_name, website_url, country,
         timezone, phone, preferred_language, status, status_reason, tier,
         created_at, approved_at,
         stripe_connect_account_id, stripe_connect_status, stripe_charges_enabled,
         stripe_payouts_enabled, stripe_details_submitted, stripe_synced_at,
         identity_status, identity_document_state, identity_selfie_state,
         identity_address_state, identity_checked_at,
         tax_status, tax_country, tax_entity_type, tax_identifier_last4, tax_submitted_at,
         payout_readiness, notification_prefs, preferences, commission_plan_id`,
      )
      .eq("user_id", user.id)
      .maybeSingle();

    if (!data) return null;

    return {
      id: data.id,
      code: data.code,
      displayName: data.display_name,
      contactEmail: data.contact_email,
      companyName: data.company_name,
      websiteUrl: data.website_url,
      country: data.country,
      timezone: data.timezone ?? "Europe/London",
      phone: data.phone,
      preferredLanguage: data.preferred_language ?? "en-GB",
      status: data.status as AffiliateAccountState,
      statusReason: data.status_reason,
      tier: (data.tier ?? "STANDARD") as AffiliateTier,
      joinedAt: data.created_at,
      approvedAt: data.approved_at,
      reference: affiliateReference(data.id),

      connectState: (data.stripe_connect_status ?? "NOT_CONNECTED") as ConnectState,
      // A boolean, never the id. An affiliate has no use for the account id and
      // it is enough to address the account in the Stripe API.
      hasConnectAccount: Boolean(data.stripe_connect_account_id),
      chargesEnabled: Boolean(data.stripe_charges_enabled),
      payoutsEnabled: Boolean(data.stripe_payouts_enabled),
      detailsSubmitted: Boolean(data.stripe_details_submitted),
      connectSyncedAt: data.stripe_synced_at,

      identityStatus: (data.identity_status ?? "NOT_STARTED") as IdentityState,
      identityDocument: data.identity_document_state,
      identitySelfie: data.identity_selfie_state,
      identityAddress: data.identity_address_state,
      identityCheckedAt: data.identity_checked_at,

      taxStatus: (data.tax_status ?? "NOT_PROVIDED") as TaxState,
      taxCountry: data.tax_country,
      taxEntityType: data.tax_entity_type,
      taxIdentifierLast4: data.tax_identifier_last4,
      taxSubmittedAt: data.tax_submitted_at,

      payoutReadiness: (data.payout_readiness ?? "ACTION_REQUIRED") as PayoutReadiness,
      notificationPrefs: resolveNotificationPrefs(data.notification_prefs),
      preferences: resolvePreferences(data.preferences),
      policy: await loadPolicy(data.commission_plan_id),
    };
  },
);

/**
 * A stable, non-guessable-looking public reference.
 *
 * Derived from the account uuid rather than stored, so it cannot drift, and it
 * reveals nothing the uuid did not already — it is shown to the affiliate
 * themselves and quoted in support conversations.
 */
export function affiliateReference(id: string): string {
  const digits = id.replace(/\D/g, "").slice(0, 5).padEnd(5, "0");
  return `CT-AFF-${digits}`;
}

/** The programme's terms, from the plan attached to this account. */
async function loadPolicy(planId: string | null): Promise<ProgrammePolicy> {
  const db = createAdminClient();
  const query = db
    .from("affiliate_commission_plans")
    .select(
      `commission_type, percent, flat_amount_minor, currency, recurring_months,
       attribution_window_days, hold_days, minimum_payout_minor`,
    );

  const { data } = planId
    ? await query.eq("id", planId).maybeSingle()
    : await query.eq("is_default", true).eq("active", true).maybeSingle();

  if (!data) return FALLBACK_POLICY;

  return {
    attributionWindowDays: data.attribution_window_days,
    attributionModel: "LAST_TOUCH",
    commissionType: data.commission_type as ProgrammePolicy["commissionType"],
    commissionPercent: data.percent,
    commissionFlatMinor: data.flat_amount_minor,
    recurringMonths: data.recurring_months,
    holdDays: data.hold_days,
    minimumPayoutMinor: data.minimum_payout_minor,
    payoutFrequency: "MONTHLY",
    currency: data.currency,
    selfReferralsAllowed: false,
    termsVersion: FALLBACK_POLICY.termsVersion,
  };
}

/** The public programme terms, for the marketing page. */
export const getPublicPolicy = cache(async (): Promise<ProgrammePolicy> => {
  return loadPolicy(null);
});

/* ------------------------------------------------------------- referrals -- */

export type PortalReferral = {
  id: string;
  label: string;
  /** Masked contact identity, or null where we have none to show. */
  maskedContact: string | null;
  sourceLabel: string | null;
  status: ReferralStatus;
  trialState: TrialState;
  paidState: PaidState;
  commissionState: CommissionStatus | null;
  planKey: string | null;
  signupAt: string | null;
  paidAt: string | null;
  attributionExpiresAt: string | null;
  lifetimeRevenueMinor: number;
  commissionMinor: number;
  createdAt: string;
};

export type ReferralPage = {
  rows: PortalReferral[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * A page of referrals.
 *
 * Server-side paginated because an established affiliate has thousands and the
 * table shows ten. The commission state is joined from the ledger rather than
 * recomputed, so the chip and the payouts page can never disagree.
 *
 * Note what the projection does *not* include: no business name unless the
 * customer opted into being named, no email, no user id, no plan price. See
 * `referralLabel` in `types.ts` for the reasoning.
 */
export async function listReferralPage(
  affiliateId: string,
  options: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
    source?: string;
  } = {},
): Promise<ReferralPage> {
  const supabase = await createClient();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(50, Math.max(5, options.pageSize ?? 10));
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("affiliate_referrals")
    .select(
      `id, display_label, status, trial_state, paid_state, plan_key, signup_at,
       paid_at, attribution_expires_at, lifetime_revenue_minor, created_at,
       affiliate_links ( label ),
       affiliate_commissions ( status, commission_amount_minor )`,
      { count: "exact" },
    )
    .eq("affiliate_id", affiliateId);

  if (options.status && options.status !== "all") {
    query = query.eq("status", options.status);
  }
  if (options.search?.trim()) {
    // Only the display label is searchable. There is no customer identity here
    // to search against, which is the point.
    query = query.ilike("display_label", `%${options.search.trim()}%`);
  }

  const { data, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  const rows = (data ?? []).map((row) => {
    const commissions = (row.affiliate_commissions ?? []) as unknown as {
      status: string;
      commission_amount_minor: number;
    }[];

    const link = row.affiliate_links as unknown as { label: string } | null;

    return {
      id: row.id,
      label: referralLabel(row.display_label, row.created_at),
      maskedContact: null,
      sourceLabel: link?.label ?? null,
      status: row.status as ReferralStatus,
      trialState: (row.trial_state ?? "NOT_STARTED") as TrialState,
      paidState: (row.paid_state ?? "NOT_PAID") as PaidState,
      commissionState: headlineCommissionState(commissions),
      planKey: row.plan_key,
      signupAt: row.signup_at,
      paidAt: row.paid_at,
      attributionExpiresAt: row.attribution_expires_at,
      lifetimeRevenueMinor: Number(row.lifetime_revenue_minor ?? 0),
      commissionMinor: commissions
        .filter((entry) => entry.status !== "REVERSED")
        .reduce((sum, entry) => sum + Number(entry.commission_amount_minor), 0),
      createdAt: row.created_at,
    };
  });

  return { rows, total: count ?? rows.length, page, pageSize };
}

/**
 * The one commission state to show for a referral with several entries.
 *
 * Worst-news-first: a reversal or a review is what the affiliate needs to see,
 * even if three other entries on the same referral are happily paid.
 */
function headlineCommissionState(
  entries: { status: string }[],
): CommissionStatus | null {
  if (entries.length === 0) return null;
  const order: CommissionStatus[] = [
    "REVERSED",
    "PENDING",
    "APPROVED",
    "PAYABLE",
    "PAID",
  ];
  for (const state of order) {
    if (entries.some((entry) => entry.status === state)) return state;
  }
  return null;
}

/* -------------------------------------------------------- referral events -- */

export type ReferralEvent = {
  id: string;
  label: string;
  kind: "signup" | "trial" | "paid" | "renewal" | "expired" | "churned";
  at: string;
};

/**
 * The recent activity strip.
 *
 * Derived from referral timestamps rather than from an event table: the
 * timestamps are already the record of what happened, and a parallel event log
 * would be a second thing to keep in step.
 */
export async function listReferralEvents(
  affiliateId: string,
  limit = 6,
): Promise<ReferralEvent[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("affiliate_referrals")
    .select(
      "id, display_label, created_at, signup_at, trial_at, paid_at, renewed_at, churned_at, trial_state",
    )
    .eq("affiliate_id", affiliateId)
    .order("updated_at", { ascending: false })
    .limit(40);

  const events: ReferralEvent[] = [];

  for (const row of data ?? []) {
    const label = referralLabel(row.display_label, row.created_at);
    const push = (kind: ReferralEvent["kind"], at: string | null, verb: string) => {
      if (at) events.push({ id: `${row.id}:${kind}`, label: `${label} ${verb}`, kind, at });
    };

    push("signup", row.signup_at, "signed up");
    push("trial", row.trial_at, "started a trial");
    push("paid", row.paid_at, "made a payment");
    push("renewal", row.renewed_at, "renewed");
    push("churned", row.churned_at, "cancelled");
    if (row.trial_state === "EXPIRED") {
      push("expired", row.trial_at, "trial expired");
    }
  }

  return events
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}

/* --------------------------------------------------------------- payouts -- */

export type PortalPayout = {
  id: string;
  reference: string;
  status: PayoutStatus;
  amountMinor: number;
  grossAmountMinor: number;
  adjustmentsMinor: number;
  currency: string;
  commissionCount: number;
  method: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  periodLabel: string;
  scheduledAt: string | null;
  approvedAt: string | null;
  processedAt: string | null;
  paidAt: string | null;
  failureCode: string | null;
  failureReason: string | null;
  notes: string | null;
  createdAt: string;
};

export async function listPortalPayouts(
  affiliateId: string,
  limit = 50,
): Promise<PortalPayout[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("affiliate_payouts")
    .select(
      `id, batch_reference, status, amount_minor, gross_amount_minor, adjustments_minor,
       currency, commission_count, method, period_start, period_end, scheduled_at,
       approved_at, processed_at, paid_at, failure_code, failure_reason, notes, created_at`,
    )
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row, index) => ({
    id: row.id,
    // A readable reference for support conversations. Falls back to a
    // sequence-style label when no batch reference was assigned.
    reference:
      row.batch_reference ??
      `PAYOUT-${String((data?.length ?? 0) - index).padStart(3, "0")}`,
    status: row.status as PayoutStatus,
    amountMinor: Number(row.amount_minor ?? 0),
    grossAmountMinor: Number(row.gross_amount_minor ?? row.amount_minor ?? 0),
    adjustmentsMinor: Number(row.adjustments_minor ?? 0),
    currency: row.currency,
    commissionCount: Number(row.commission_count ?? 0),
    method: row.method,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    periodLabel: periodLabel(row.period_start, row.period_end, row.created_at),
    scheduledAt: row.scheduled_at,
    approvedAt: row.approved_at,
    processedAt: row.processed_at,
    paidAt: row.paid_at,
    failureCode: row.failure_code,
    failureReason: row.failure_reason,
    notes: row.notes,
    createdAt: row.created_at,
  }));
}

function periodLabel(
  start: string | null,
  end: string | null,
  fallback: string,
): string {
  const source = start ?? end ?? fallback;
  return new Date(source).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
}

/* ------------------------------------------------------------- resources -- */

export type PortalResource = {
  id: string;
  category: ResourceCategory;
  title: string;
  description: string | null;
  resourceType: "FILE" | "IMAGE" | "VIDEO" | "TEXT" | "LINK";
  externalUrl: string | null;
  textContent: string | null;
  hasFile: boolean;
  fileSizeBytes: number | null;
  fileTypeLabel: string | null;
  dimensions: string | null;
  version: string;
  usageRights: string;
  publishedAt: string | null;
  updatedAt: string;
  saved: boolean;
};

export type ResourceHub = {
  resources: PortalResource[];
  counts: {
    total: number;
    packs: number;
    updatedThisMonth: number;
    saved: number;
  };
};

/**
 * The resource hub.
 *
 * Published rows only, enforced by RLS as well as by the filter here. The R2
 * storage key never leaves the server: `hasFile` is a boolean and the download
 * route mints a short-lived signed URL after re-checking the session. That is
 * what keeps affiliate-only packs from becoming public objects the moment
 * someone shares a page.
 */
export async function getResourceHub(affiliateId: string): Promise<ResourceHub> {
  const supabase = await createClient();

  const [resources, saves] = await Promise.all([
    supabase
      .from("affiliate_resources")
      .select(
        `id, category, title, description, resource_type, external_url, text_content,
         storage_key, file_size_bytes, file_type_label, dimensions, version,
         usage_rights, published_at, updated_at`,
      )
      .eq("status", "PUBLISHED")
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("sort_order", { ascending: true })
      .limit(300),
    supabase
      .from("affiliate_resource_saves")
      .select("resource_id")
      .eq("affiliate_id", affiliateId),
  ]);

  const savedIds = new Set((saves.data ?? []).map((row) => row.resource_id));

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const rows: PortalResource[] = (resources.data ?? []).map((row) => ({
    id: row.id,
    category: row.category as ResourceCategory,
    title: row.title,
    description: row.description,
    resourceType: row.resource_type as PortalResource["resourceType"],
    externalUrl: row.external_url,
    textContent: row.text_content,
    hasFile: Boolean(row.storage_key),
    fileSizeBytes: row.file_size_bytes,
    fileTypeLabel: row.file_type_label,
    dimensions: row.dimensions,
    version: row.version,
    usageRights: row.usage_rights ?? "Commercial use allowed",
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    saved: savedIds.has(row.id),
  }));

  return {
    resources: rows,
    counts: {
      total: rows.length,
      packs: rows.filter((row) => row.category === "CAMPAIGN_PACK").length,
      updatedThisMonth: rows.filter(
        (row) => new Date(row.updatedAt).getTime() >= startOfMonth.getTime(),
      ).length,
      saved: savedIds.size,
    },
  };
}

/* ----------------------------------------------------------- promo codes -- */

export type PortalPromoCode = {
  id: string;
  code: string;
  offer: string;
  status: "ACTIVE" | "PAUSED" | "EXPIRED" | "SCHEDULED";
  redemptionCount: number;
  maxRedemptions: number | null;
  expiresAt: string | null;
};

export type PromoOffer = {
  id: string;
  key: string;
  name: string;
  description: string;
};

export async function listPromoCodes(affiliateId: string): Promise<{
  codes: PortalPromoCode[];
  offers: PromoOffer[];
}> {
  const supabase = await createClient();

  const [codes, offers] = await Promise.all([
    supabase
      .from("affiliate_promo_codes")
      .select(
        `id, code, description, status, redemption_count, max_redemptions, expires_at,
         affiliate_promo_offers ( name )`,
      )
      .eq("affiliate_id", affiliateId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("affiliate_promo_offers")
      .select("id, key, name, description")
      .eq("active", true)
      .order("name", { ascending: true }),
  ]);

  const now = Date.now();

  return {
    codes: (codes.data ?? []).map((row) => {
      const offer = row.affiliate_promo_offers as unknown as { name: string } | null;
      const expired =
        row.expires_at !== null && new Date(row.expires_at).getTime() < now;

      return {
        id: row.id,
        code: row.code,
        offer: offer?.name ?? row.description ?? "Offer",
        status: expired ? "EXPIRED" : (row.status as PortalPromoCode["status"]),
        redemptionCount: Number(row.redemption_count ?? 0),
        maxRedemptions: row.max_redemptions,
        expiresAt: row.expires_at,
      };
    }),
    offers: offers.data ?? [],
  };
}

/* ------------------------------------------------------------- utilities -- */

/** Re-exported so pages import one module rather than two. */
export type { CommissionPlan };
