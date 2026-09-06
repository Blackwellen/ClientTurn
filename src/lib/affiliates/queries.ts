import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/session";
import {
  referralLabel,
  type AffiliateStatus,
  type AffiliateSummary,
  type AffiliateTotals,
  type CommissionPlan,
  type CommissionRow,
  type CommissionStatus,
  type LinkRow,
  type PayoutRow,
  type PayoutStatus,
  type ReferralRow,
  type ReferralStatus,
  type ResourceCategory,
  type ResourceRow,
} from "./types";

export * from "./types";

/**
 * Affiliate portal reads (V4 §29-35).
 *
 * The affiliate's own programme rows are read through their RLS-scoped client:
 * `current_affiliate_id()` (migration 0036) restricts each row, so a bug in
 * this file cannot widen what an affiliate can see — the database refuses
 * first.
 *
 * Two tables have no browser grant at all and so must go through the service
 * role: `affiliate_commission_plans` (the platform's commercial terms) and
 * `affiliate_clicks` (raw traffic, carrying visitor hashes). Both are read
 * only after the RLS query above has already proved who the caller is, and
 * both are scoped by that resolved affiliate id — never by a request value.
 *
 * No query in this module joins to a referred tenant's own data. The only
 * bridge is `affiliate_referrals`, which carries lifecycle timestamps and a
 * plan key and nothing else.
 */

/** The signed-in user's affiliate account, or null if they do not have one. */
export const getAffiliate = cache(async (): Promise<AffiliateSummary | null> => {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("affiliates")
    .select(
      `id, code, display_name, status, status_reason, contact_email, tax_status,
       payment_profile_json, commission_plan_id, created_at, approved_at`,
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) return null;

  const profile = (data.payment_profile_json ?? {}) as Record<string, unknown>;

  return {
    id: data.id,
    code: data.code,
    displayName: data.display_name,
    status: data.status as AffiliateStatus,
    statusReason: data.status_reason,
    contactEmail: data.contact_email,
    taxStatus: data.tax_status,
    // Only ever a boolean on the way out. The account details themselves are
    // never carried into a page payload, even the affiliate's own.
    hasPaymentDetails: Boolean(profile.method),
    plan: await loadPlan(data.commission_plan_id),
    createdAt: data.created_at,
    approvedAt: data.approved_at,
  };
});

/**
 * A commission plan by id.
 *
 * Service role: `affiliate_commission_plans` is revoked from every browser
 * role. Only the plan already attached to the caller's own affiliate row is
 * ever passed in, so this cannot be used to enumerate other partners' terms.
 */
async function loadPlan(planId: string | null): Promise<CommissionPlan | null> {
  if (!planId) return null;

  const { data } = await createAdminClient()
    .from("affiliate_commission_plans")
    .select(
      `id, name, commission_type, percent, flat_amount_minor, currency,
       recurring_months, attribution_window_days, cookie_window_days,
       hold_days, minimum_payout_minor`,
    )
    .eq("id", planId)
    .maybeSingle();

  return data ? toPlan(data) : null;
}

function toPlan(row: {
  id: string;
  name: string;
  commission_type: string;
  percent: number | null;
  flat_amount_minor: number | null;
  currency: string;
  recurring_months: number | null;
  attribution_window_days: number;
  cookie_window_days: number;
  hold_days: number;
  minimum_payout_minor: number;
}): CommissionPlan {
  return {
    id: row.id,
    name: row.name,
    commissionType: row.commission_type as CommissionPlan["commissionType"],
    percent: row.percent,
    flatAmountMinor: row.flat_amount_minor,
    currency: row.currency,
    recurringMonths: row.recurring_months,
    attributionWindowDays: row.attribution_window_days,
    cookieWindowDays: row.cookie_window_days,
    holdDays: row.hold_days,
    minimumPayoutMinor: row.minimum_payout_minor,
  };
}

/* ---------------------------------------------------------------- overview -- */

export type OverviewData = {
  affiliate: AffiliateSummary;
  totals: AffiliateTotals;
  recentReferrals: ReferralRow[];
  topLinks: LinkRow[];
  /** Clicks per day for the last 30 days, oldest first. */
  clickSeries: { date: string; count: number }[];
};

export async function loadOverview(
  affiliate: AffiliateSummary,
): Promise<OverviewData> {
  const supabase = await createClient();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 29);
  since.setUTCHours(0, 0, 0, 0);

  const [clicks, referrals, commissions, links] = await Promise.all([
    createAdminClient()
      .from("affiliate_clicks")
      .select("occurred_at")
      .eq("affiliate_id", affiliate.id)
      .eq("is_bot", false)
      .gte("occurred_at", since.toISOString())
      .order("occurred_at", { ascending: true })
      .limit(5000),
    supabase
      .from("affiliate_referrals")
      .select(
        "id, display_label, status, plan_key, signup_at, paid_at, lifetime_revenue_minor, created_at",
      )
      .eq("affiliate_id", affiliate.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("affiliate_commissions")
      .select("status, commission_amount_minor")
      .eq("affiliate_id", affiliate.id)
      .limit(5000),
    supabase
      .from("affiliate_links")
      .select(
        "id, label, slug, destination_path, click_count, signup_count, paid_count, archived, created_at, affiliate_campaigns ( name )",
      )
      .eq("affiliate_id", affiliate.id)
      .eq("archived", false)
      .order("click_count", { ascending: false })
      .limit(5),
  ]);

  const referralRows = mapReferrals(referrals.data ?? []);

  // Bucketed here rather than in SQL: 30 days of one affiliate's clicks is a
  // small set, and a per-affiliate aggregate function would need SECURITY
  // DEFINER and its own authorisation check to be safe.
  const byDay = new Map<string, number>();
  for (let index = 0; index < 30; index += 1) {
    const day = new Date(since.getTime());
    day.setUTCDate(day.getUTCDate() + index);
    byDay.set(day.toISOString().slice(0, 10), 0);
  }
  for (const row of clicks.data ?? []) {
    const key = row.occurred_at.slice(0, 10);
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }

  return {
    affiliate,
    totals: {
      clicks: clicks.data?.length ?? 0,
      signups: referralRows.length,
      paying: referralRows.filter((row) => row.status === "PAID").length,
      ...commissionTotals(commissions.data ?? []),
    },
    recentReferrals: referralRows.slice(0, 8),
    topLinks: mapLinks(links.data ?? []),
    clickSeries: [...byDay.entries()].map(([date, count]) => ({ date, count })),
  };
}

function commissionTotals(
  rows: { status: string; commission_amount_minor: number }[],
): Pick<AffiliateTotals, "pendingMinor" | "payableMinor" | "paidMinor" | "lifetimeMinor"> {
  let pending = 0;
  let payable = 0;
  let paid = 0;
  let lifetime = 0;

  for (const row of rows) {
    const amount = row.commission_amount_minor;
    // A reversal is money that was taken back. It contributes to nothing:
    // counting it anywhere would show an affiliate earnings they will not get.
    if (row.status === "REVERSED") continue;

    lifetime += amount;
    if (row.status === "PENDING") pending += amount;
    else if (row.status === "APPROVED" || row.status === "PAYABLE") payable += amount;
    else if (row.status === "PAID") paid += amount;
  }

  return {
    pendingMinor: pending,
    payableMinor: payable,
    paidMinor: paid,
    lifetimeMinor: lifetime,
  };
}

/* ------------------------------------------------------------------ links -- */

export async function listLinks(affiliateId: string): Promise<{
  links: LinkRow[];
  campaigns: { id: string; name: string }[];
}> {
  const supabase = await createClient();

  const [links, campaigns] = await Promise.all([
    supabase
      .from("affiliate_links")
      .select(
        "id, label, slug, destination_path, click_count, signup_count, paid_count, archived, created_at, affiliate_campaigns ( name )",
      )
      .eq("affiliate_id", affiliateId)
      .order("archived", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("affiliate_campaigns")
      .select("id, name")
      .eq("affiliate_id", affiliateId)
      .eq("archived", false)
      .order("name", { ascending: true }),
  ]);

  return { links: mapLinks(links.data ?? []), campaigns: campaigns.data ?? [] };
}

function mapLinks(
  rows: {
    id: string;
    label: string;
    slug: string;
    destination_path: string;
    click_count: number;
    signup_count: number;
    paid_count: number;
    archived: boolean;
    created_at: string;
    affiliate_campaigns?: unknown;
  }[],
): LinkRow[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    slug: row.slug,
    destinationPath: row.destination_path,
    campaignName:
      (row.affiliate_campaigns as { name: string } | null)?.name ?? null,
    clickCount: row.click_count,
    signupCount: row.signup_count,
    paidCount: row.paid_count,
    archived: row.archived,
    createdAt: row.created_at,
  }));
}

/* -------------------------------------------------------------- referrals -- */

export async function listReferrals(affiliateId: string): Promise<ReferralRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("affiliate_referrals")
    .select(
      "id, display_label, status, plan_key, signup_at, paid_at, lifetime_revenue_minor, created_at",
    )
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false })
    .limit(500);

  return mapReferrals(data ?? []);
}

function mapReferrals(
  rows: {
    id: string;
    display_label: string | null;
    status: string;
    plan_key: string | null;
    signup_at: string | null;
    paid_at: string | null;
    lifetime_revenue_minor: number;
    created_at: string;
  }[],
): ReferralRow[] {
  return rows.map((row) => ({
    id: row.id,
    label: referralLabel(row.display_label, row.created_at),
    status: row.status as ReferralStatus,
    planKey: row.plan_key,
    signupAt: row.signup_at,
    paidAt: row.paid_at,
    lifetimeRevenueMinor: row.lifetime_revenue_minor,
    createdAt: row.created_at,
  }));
}

/* ------------------------------------------------------------ commissions -- */

export async function listCommissions(
  affiliateId: string,
): Promise<CommissionRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("affiliate_commissions")
    .select(
      `id, status, base_amount_minor, commission_amount_minor, currency, period_month,
       payable_at, paid_at, reversal_reason, created_at,
       affiliate_referrals ( display_label, created_at )`,
    )
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false })
    .limit(500);

  return (data ?? []).map((row) => {
    const referral = row.affiliate_referrals as unknown as {
      display_label: string | null;
      created_at: string;
    } | null;

    return {
      id: row.id,
      status: row.status as CommissionStatus,
      baseAmountMinor: row.base_amount_minor,
      commissionAmountMinor: row.commission_amount_minor,
      currency: row.currency,
      periodMonth: row.period_month,
      referralLabel: referral
        ? referralLabel(referral.display_label, referral.created_at)
        : "Referral",
      payableAt: row.payable_at,
      paidAt: row.paid_at,
      reversalReason: row.reversal_reason,
      createdAt: row.created_at,
    };
  });
}

/* ---------------------------------------------------------------- payouts -- */

export async function listPayouts(affiliateId: string): Promise<PayoutRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("affiliate_payouts")
    .select(
      `id, batch_reference, status, amount_minor, currency, commission_count, method,
       failure_reason, period_start, period_end, paid_at, created_at`,
    )
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false })
    .limit(200);

  return (data ?? []).map((row) => ({
    id: row.id,
    batchReference: row.batch_reference,
    status: row.status as PayoutStatus,
    amountMinor: row.amount_minor,
    currency: row.currency,
    commissionCount: row.commission_count,
    method: row.method,
    failureReason: row.failure_reason,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  }));
}

/* -------------------------------------------------------------- resources -- */

export async function listResources(): Promise<ResourceRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("affiliate_resources")
    .select(
      `id, category, title, description, resource_type, external_url, text_content,
       storage_key, file_size_bytes, dimensions, version`,
    )
    .eq("status", "PUBLISHED")
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .limit(300);

  return (data ?? []).map((row) => ({
    id: row.id,
    category: row.category as ResourceCategory,
    title: row.title,
    description: row.description,
    resourceType: row.resource_type as ResourceRow["resourceType"],
    externalUrl: row.external_url,
    textContent: row.text_content,
    // The R2 key never reaches the browser. A download goes through a route
    // that mints a short-lived signed URL after re-checking the affiliate.
    hasFile: Boolean(row.storage_key),
    fileSizeBytes: row.file_size_bytes,
    dimensions: row.dimensions,
    version: row.version,
  }));
}

/** The plan shown on the public programme page, before anyone has applied. */
export async function getPublicPlan(): Promise<CommissionPlan | null> {
  // Service role: the plans table has no browser grant. Only the headline
  // terms below leave this function -- the row itself never reaches a page.
  const { data } = await createAdminClient()
    .from("affiliate_commission_plans")
    .select(
      `id, name, commission_type, percent, flat_amount_minor, currency,
       recurring_months, attribution_window_days, cookie_window_days,
       hold_days, minimum_payout_minor`,
    )
    .eq("is_default", true)
    .eq("active", true)
    .maybeSingle();

  return data ? toPlan(data) : null;
}
