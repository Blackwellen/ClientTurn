import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import {
  type AdminAffiliateRow,
  type AdminAffiliatesData,
  type AdminCommissionRow,
  type AdminPayoutRow,
  type AdminReferralRow,
  type AdminResourceRow,
  type AdminAffiliateDetail,
  type AdminFlagRow,
  type AdminTierRow,
  type AffiliateTab,
} from "./affiliates-types";
import { getProgrammeSettings, loadTiers, untypedDb } from "@/lib/affiliates/programme-settings";
import { getTierSnapshot } from "@/lib/affiliates/tiers";
import { getBalances } from "@/lib/affiliates/payouts";
import { FRAUD_LABEL, type FraudCode } from "@/lib/affiliates/fraud-rules";
import { autoDispatchEnabled } from "@/lib/affiliates/dispatch";

export * from "./affiliates-types";

/**
 * Admin -> Affiliates (V4 section 41).
 *
 * Platform-only, and asserted here rather than inherited from the layout: this
 * reads every partner's earnings and every referred business's name, which is
 * exactly the join the affiliate portal is built to prevent.
 *
 * The per-affiliate aggregates come from `affiliate_summaries()` (migration
 * 0052) so clicks and commissions are counted in Postgres. Counting them here
 * would mean pulling every click row for every partner on the page.
 */

export async function loadAdminAffiliates(
  tab: AffiliateTab,
  detailId: string | null = null,
): Promise<AdminAffiliatesData> {
  await requirePlatformAdmin();
  const db = createAdminClient();

  const [affiliateRows, summaries, plans] = await Promise.all([
    db
      .from("affiliates")
      .select(
        `id, code, display_name, company_name, contact_email, website_url, country,
         audience_description, promotion_methods, status, status_reason, tax_status,
         payment_profile_json, commission_plan_id, created_at, approved_at, tier`,
      )
      // Applications first: the queue exists to be worked, and a list sorted
      // by join date buries the one thing on it that needs a decision.
      .order("status", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(500),
    db.rpc("affiliate_summaries"),
    db.from("affiliate_commission_plans").select("id, name"),
  ]);

  const summaryById = new Map(
    (summaries.data ?? []).map((row) => [row.affiliate_id, row]),
  );
  const planById = new Map((plans.data ?? []).map((row) => [row.id, row.name]));

  const affiliates: AdminAffiliateRow[] = (affiliateRows.data ?? []).map((row) => {
    const summary = summaryById.get(row.id);
    const profile = (row.payment_profile_json ?? {}) as Record<string, unknown>;

    return {
      id: row.id,
      code: row.code,
      displayName: row.display_name,
      companyName: row.company_name,
      contactEmail: row.contact_email,
      websiteUrl: row.website_url,
      country: row.country,
      audienceDescription: row.audience_description,
      promotionMethods: row.promotion_methods ?? [],
      status: row.status,
      statusReason: row.status_reason,
      taxStatus: row.tax_status,
      // A boolean, never the details. An operator approving a partner has no
      // need to see their bank reference on a list page.
      hasPaymentDetails: Boolean(profile.method),
      planName: row.commission_plan_id
        ? (planById.get(row.commission_plan_id) ?? null)
        : null,
      clicks: Number(summary?.click_count ?? 0),
      referrals: Number(summary?.referral_count ?? 0),
      paying: Number(summary?.paying_count ?? 0),
      pendingMinor: Number(summary?.pending_minor ?? 0),
      payableMinor: Number(summary?.payable_minor ?? 0),
      paidMinor: Number(summary?.paid_minor ?? 0),
      lifetimeMinor: Number(summary?.lifetime_minor ?? 0),
      createdAt: row.created_at,
      approvedAt: row.approved_at,
      tier: row.tier ?? "STANDARD",
    };
  });

  const nameById = new Map(affiliates.map((row) => [row.id, row.displayName]));

  const totals = {
    activeAffiliates: affiliates.filter((row) => row.status === "ACTIVE").length,
    pendingApplications: affiliates.filter((row) => row.status === "APPLIED").length,
    referrals: affiliates.reduce((sum, row) => sum + row.referrals, 0),
    payingReferrals: affiliates.reduce((sum, row) => sum + row.paying, 0),
    pendingMinor: affiliates.reduce((sum, row) => sum + row.pendingMinor, 0),
    payableMinor: affiliates.reduce((sum, row) => sum + row.payableMinor, 0),
    paidMinor: affiliates.reduce((sum, row) => sum + row.paidMinor, 0),
  };

  // Only the active tab's rows are loaded. Fetching all five on every render
  // would make the Overview tab pay for four tables nobody is looking at.
  const [referrals, commissions, payouts, resources, flags, tiers, settings, detail] = await Promise.all([
    tab === "referrals" ? loadReferrals(nameById) : Promise.resolve([]),
    tab === "commissions" ? loadCommissions(nameById) : Promise.resolve([]),
    tab === "payouts" ? loadPayouts(nameById) : Promise.resolve([]),
    tab === "resources" ? loadResources() : Promise.resolve([]),
    tab === "flags" ? loadFlags(nameById) : Promise.resolve([]),
    tab === "tiers" ? loadTierRows() : Promise.resolve([]),
    loadSettings(),
    detailId ? loadAffiliateDetail(detailId, affiliates) : Promise.resolve(null),
  ]);

  return { tab, totals, affiliates, referrals, commissions, payouts, resources, flags, tiers, settings, detail };
}

async function loadSettings(): Promise<AdminAffiliatesData["settings"]> {
  const settings = await getProgrammeSettings();
  return {
    autoApprovePayouts: settings.autoApprovePayouts,
    autoDispatchPayouts: settings.autoDispatchPayouts,
    envAutoPayout: autoDispatchEnabled(),
    available: settings.available,
  };
}

async function loadTierRows(): Promise<AdminTierRow[]> {
  return (await loadTiers()).map((tier) => ({ ...tier }));
}

/**
 * The fraud review queue: referrals held (REVIEW) or rejected (BLOCK), with
 * their signals from `affiliate_fraud_flags` (0166, service-role only). The
 * partner is never told which signal fired.
 */
async function loadFlags(nameById: Map<string, string>): Promise<AdminFlagRow[]> {
  const db = untypedDb();
  const { data: referrals } = await db
    .from("affiliate_referrals")
    .select("id, affiliate_id, status, flagged_reason, created_at, businesses ( name )")
    .not("flagged_reason", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (referrals ?? []) as unknown as {
    id: string;
    affiliate_id: string;
    status: string;
    flagged_reason: string | null;
    created_at: string;
    businesses: { name: string } | null;
  }[];
  if (rows.length === 0) return [];

  const { data: flags } = await db
    .from("affiliate_fraud_flags")
    .select("referral_id, code, severity, status, source")
    .in("referral_id", rows.map((row) => row.id));
  const byReferral = new Map<string, AdminFlagRow["signals"]>();
  for (const flag of (flags ?? []) as { referral_id: string; code: string; severity: string; status: string; source: string }[]) {
    const list = byReferral.get(flag.referral_id) ?? [];
    list.push({
      code: flag.code,
      label: FRAUD_LABEL[flag.code as FraudCode] ?? flag.code,
      severity: flag.severity,
      status: flag.status,
      source: flag.source,
    });
    byReferral.set(flag.referral_id, list);
  }

  return rows.map((row) => ({
    referralId: row.id,
    affiliateId: row.affiliate_id,
    affiliateName: nameById.get(row.affiliate_id) ?? "Unknown partner",
    businessName: row.businesses?.name ?? null,
    referralStatus: row.status,
    heldReason: row.flagged_reason,
    signals: byReferral.get(row.id) ?? [],
    createdAt: row.created_at,
  }));
}

async function loadAffiliateDetail(
  affiliateId: string,
  affiliates: AdminAffiliateRow[],
): Promise<AdminAffiliateDetail | null> {
  const row = affiliates.find((entry) => entry.id === affiliateId);
  if (!row) return null;
  const db = createAdminClient();
  const [snapshot, balances, account, flags] = await Promise.all([
    getTierSnapshot(affiliateId),
    getBalances(affiliateId),
    db.from("affiliates").select("payout_readiness, stripe_connect_status").eq("id", affiliateId).maybeSingle(),
    untypedDb()
      .from("affiliate_fraud_flags")
      .select("id", { count: "exact", head: true })
      .eq("affiliate_id", affiliateId)
      .eq("status", "OPEN"),
  ]);
  return {
    id: row.id,
    displayName: row.displayName,
    code: row.code,
    status: row.status,
    tier: snapshot.tier,
    tierLocked: snapshot.locked,
    activeCustomers: snapshot.metrics.activeCustomers,
    referredMrrMinor: snapshot.metrics.referredMrrMinor,
    nextTier: snapshot.progress.next?.name ?? null,
    tierPercent: snapshot.progress.percent,
    sales: snapshot.sales.map((sale) => ({ label: sale.label, customers: sale.customers, mrrMinor: sale.mrrMinor })),
    tierHistory: snapshot.history.map((entry) => ({
      fromTier: entry.fromTier,
      toTier: entry.toTier,
      reason: entry.reason,
      createdAt: entry.createdAt,
    })),
    balances: {
      pendingMinor: balances.pendingMinor,
      approvedMinor: balances.approvedMinor,
      availableMinor: balances.availableMinor,
      paidMinor: balances.paidMinor,
      reversedMinor: balances.reversedMinor,
    },
    payoutReadiness: account.data?.payout_readiness ?? "ACTION_REQUIRED",
    connectState: account.data?.stripe_connect_status ?? "NOT_CONNECTED",
    openFlags: flags.count ?? 0,
  };
}

async function loadReferrals(
  nameById: Map<string, string>,
): Promise<AdminReferralRow[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("affiliate_referrals")
    .select(
      `id, affiliate_id, status, plan_key, signup_at, paid_at,
       lifetime_revenue_minor, created_at, businesses ( name )`,
    )
    .order("created_at", { ascending: false })
    .limit(300);

  return (data ?? []).map((row) => ({
    id: row.id,
    affiliateName: nameById.get(row.affiliate_id) ?? "Unknown partner",
    businessName: (row.businesses as unknown as { name: string } | null)?.name ?? null,
    status: row.status,
    planKey: row.plan_key,
    signupAt: row.signup_at,
    paidAt: row.paid_at,
    lifetimeRevenueMinor: row.lifetime_revenue_minor,
    createdAt: row.created_at,
  }));
}

async function loadCommissions(
  nameById: Map<string, string>,
): Promise<AdminCommissionRow[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("affiliate_commissions")
    .select(
      `id, affiliate_id, entry_type, reversal_reason, status, base_amount_minor, commission_amount_minor,
       currency, period_month, payable_at, created_at, businesses ( name )`,
    )
    // Pending first: those are the ones an operator can still act on.
    .order("status", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(300);

  return (data ?? []).map((row) => ({
    id: row.id,
    affiliateName: nameById.get(row.affiliate_id) ?? "Unknown partner",
    businessName: (row.businesses as unknown as { name: string } | null)?.name ?? null,
    entryType: (row as { entry_type?: string | null }).entry_type ?? null,
    reversalReason: (row as { reversal_reason?: string | null }).reversal_reason ?? null,
    status: row.status,
    baseAmountMinor: row.base_amount_minor,
    commissionAmountMinor: row.commission_amount_minor,
    currency: row.currency,
    periodMonth: row.period_month,
    payableAt: row.payable_at,
    createdAt: row.created_at,
  }));
}

async function loadPayouts(
  nameById: Map<string, string>,
): Promise<AdminPayoutRow[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("affiliate_payouts")
    .select(
      `id, affiliate_id, batch_reference, status, amount_minor, currency,
       commission_count, method, paid_at, created_at, failure_reason`,
    )
    .order("created_at", { ascending: false })
    .limit(300);

  return (data ?? []).map((row) => ({
    id: row.id,
    affiliateName: nameById.get(row.affiliate_id) ?? "Unknown partner",
    batchReference: row.batch_reference,
    status: row.status,
    amountMinor: row.amount_minor,
    currency: row.currency,
    commissionCount: row.commission_count,
    method: row.method,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    failureReason: row.failure_reason,
  }));
}

async function loadResources(): Promise<AdminResourceRow[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("affiliate_resources")
    .select("id, category, title, status, version, download_count, updated_at")
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .limit(300);

  return (data ?? []).map((row) => ({
    id: row.id,
    category: row.category,
    title: row.title,
    status: row.status,
    version: row.version,
    downloadCount: row.download_count,
    updatedAt: row.updated_at,
  }));
}
