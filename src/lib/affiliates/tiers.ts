import "server-only";
import { recordAudit } from "@/lib/audit";
import { isSchemaMissing } from "@/lib/billing/stripe-events";
import { notifyAffiliate } from "./notifications";
import { loadTiers, untypedDb } from "./programme-settings";
import {
  countsTowardTier,
  evaluateTier,
  isTierKey,
  isTierReviewDay,
  salesTierBreakdown,
  tierProgress,
  type SalesTierRow,
  type TierDefinition,
  type TierKey,
  type TierMetrics,
  type TierProgress,
} from "./tier-rules";

/**
 * Partner tiers and sales-tier tracking (affiliate audit 17, §3).
 *
 * The rules are pure (`tier-rules.ts`). This module measures a partner (paid
 * referred customers whose first payment is in the last 12 months, which is
 * what a tier qualifies on, plus active customers' real MRR from 0165's
 * `subscriptions.mrr_minor` for the sales-tier display), recalculates every
 * active partner's tier on the daily ledger job, keeps the history, and tells
 * the partner when it moves.
 *
 * Nothing here names a referred customer: the partner sees counts and money
 * grouped by plan, never a business.
 */

type ActiveReferral = { planKey: string | null; mrrMinor: number | null };

/**
 * Paid referred customers in the last 12 months: referrals (not held, not
 * rejected) whose FIRST payment is inside the tier window. A customer who
 * paid and later cancelled still counts until their first payment is more
 * than 12 months old: the partner earned their one-off commission for them.
 */
async function paidCustomersInWindow(affiliateId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await untypedDb()
    .from("affiliate_referrals")
    .select("paid_at, status")
    .eq("affiliate_id", affiliateId)
    .is("flagged_reason", null)
    .gte("paid_at", since)
    .limit(5000);
  return ((data ?? []) as { paid_at: string | null; status: string | null }[]).filter(
    (row) => row.status !== "REJECTED" && countsTowardTier(row.paid_at, now),
  ).length;
}

async function activeReferrals(affiliateId: string): Promise<ActiveReferral[]> {
  const db = untypedDb();
  const { data: referrals } = await db
    .from("affiliate_referrals")
    .select("business_id, plan_key")
    .eq("affiliate_id", affiliateId)
    .eq("status", "PAID")
    .eq("paid_state", "PAID")
    .is("flagged_reason", null)
    .limit(5000);
  const rows = (referrals ?? []) as { business_id: string; plan_key: string | null }[];
  if (rows.length === 0) return [];

  const out: ActiveReferral[] = [];
  for (let index = 0; index < rows.length; index += 200) {
    const slice = rows.slice(index, index + 200);
    const { data: subs, error } = await db
      .from("subscriptions")
      .select("business_id, plan, status, mrr_minor")
      .in("business_id", slice.map((row) => row.business_id));
    // Before 0165 there is no mrr_minor: count customers, MRR unknown (0).
    const fallback = error && isSchemaMissing(error)
      ? ((await db.from("subscriptions").select("business_id, plan, status").in("business_id", slice.map((row) => row.business_id))).data ?? [])
      : null;
    const list = (fallback ?? subs ?? []) as { business_id: string; plan: string | null; status: string; mrr_minor?: number | null }[];
    for (const sub of list) {
      if (sub.status !== "ACTIVE" && sub.status !== "PAST_DUE") continue;
      out.push({ planKey: sub.plan, mrrMinor: sub.mrr_minor ?? 0 });
    }
  }
  return out;
}

export async function measureAffiliate(
  affiliateId: string,
  now: Date = new Date(),
): Promise<{ metrics: TierMetrics; sales: SalesTierRow[] }> {
  const [rows, paidCustomers] = await Promise.all([
    activeReferrals(affiliateId),
    paidCustomersInWindow(affiliateId, now),
  ]);
  const sales = salesTierBreakdown(rows);
  return {
    metrics: {
      // What a tier qualifies on (tier-rules.ts): paid in the last 12 months.
      activeCustomers: paidCustomers,
      referredMrrMinor: sales.reduce((sum, row) => sum + row.mrrMinor, 0),
    },
    sales,
  };
}

export type TierHistoryEntry = {
  fromTier: string | null;
  toTier: string;
  reason: string;
  activeCustomers: number;
  referredMrrMinor: number;
  createdAt: string;
};

export type TierSnapshot = {
  tier: TierKey;
  locked: boolean;
  tiers: TierDefinition[];
  metrics: TierMetrics;
  progress: TierProgress;
  sales: SalesTierRow[];
  history: TierHistoryEntry[];
};

/** What the partner dashboard and the admin detail show about tiers. */
export async function getTierSnapshot(affiliateId: string): Promise<TierSnapshot> {
  const db = untypedDb();
  const [tiers, measured, affiliateRes, historyRes] = await Promise.all([
    loadTiers(),
    measureAffiliate(affiliateId),
    db.from("affiliates").select("tier, tier_locked").eq("id", affiliateId).maybeSingle(),
    db
      .from("affiliate_tier_history")
      .select("from_tier, to_tier, reason, active_customers, referred_mrr_minor, created_at")
      .eq("affiliate_id", affiliateId)
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  // `tier_locked` arrives with 0166; before it, read the tier alone.
  let row = affiliateRes.data as { tier: string | null; tier_locked?: boolean } | null;
  if (affiliateRes.error && isSchemaMissing(affiliateRes.error)) {
    row = ((await db.from("affiliates").select("tier").eq("id", affiliateId).maybeSingle()).data ?? null) as { tier: string | null } | null;
  }
  const tier: TierKey = isTierKey(row?.tier) ? row.tier : "STANDARD";

  return {
    tier,
    locked: Boolean(row?.tier_locked),
    tiers,
    metrics: measured.metrics,
    progress: tierProgress(tiers, measured.metrics, tier),
    sales: measured.sales,
    history: ((historyRes.data ?? []) as Record<string, unknown>[]).map((entry) => ({
      fromTier: (entry.from_tier as string | null) ?? null,
      toTier: String(entry.to_tier),
      reason: String(entry.reason),
      activeCustomers: Number(entry.active_customers ?? 0),
      referredMrrMinor: Number(entry.referred_mrr_minor ?? 0),
      createdAt: String(entry.created_at),
    })),
  };
}

/**
 * The scheduled recalculation (daily, from the ledger job). Promotions apply
 * at once; demotions only on the monthly review day. A locked tier is left
 * where an admin put it. Every change is written to the history and the
 * partner is notified.
 */
export async function recalculateTiers(now: Date = new Date()): Promise<{ evaluated: number; changed: number }> {
  const db = untypedDb();
  const { data, error } = await db
    .from("affiliates")
    .select("id, tier, tier_locked")
    .eq("status", "ACTIVE")
    .limit(2000);
  if (error) {
    // 0166 not applied: no lock column, no history. Skip rather than guess.
    if (!isSchemaMissing(error)) console.error("[affiliates] tier recalculation read failed", error.message);
    return { evaluated: 0, changed: 0 };
  }

  const tiers = await loadTiers();
  const allowDowngrade = isTierReviewDay(now);
  let changed = 0;
  const rows = (data ?? []) as { id: string; tier: string | null; tier_locked: boolean }[];

  for (const affiliate of rows) {
    const { metrics } = await measureAffiliate(affiliate.id, now);
    const current: TierKey = isTierKey(affiliate.tier) ? affiliate.tier : "STANDARD";
    const decision = evaluateTier({ tiers, metrics, current, locked: affiliate.tier_locked, allowDowngrade });

    await db
      .from("affiliates")
      .update({
        tier: decision.tier,
        tier_evaluated_at: now.toISOString(),
        tier_active_customers: metrics.activeCustomers,
        tier_referred_mrr_minor: metrics.referredMrrMinor,
      })
      .eq("id", affiliate.id);

    if (!decision.changed) continue;
    changed += 1;
    await recordTierChange({
      affiliateId: affiliate.id,
      from: current,
      to: decision.tier,
      metrics,
      reason: "SCHEDULED",
      actorUserId: null,
      tiers,
    });
  }
  return { evaluated: rows.length, changed };
}

export async function recordTierChange(input: {
  affiliateId: string;
  from: TierKey | null;
  to: TierKey;
  metrics: TierMetrics;
  reason: "SCHEDULED" | "ADMIN_OVERRIDE" | "ADMIN_UNLOCK";
  actorUserId: string | null;
  tiers: readonly TierDefinition[];
}): Promise<void> {
  await untypedDb().from("affiliate_tier_history").insert({
    affiliate_id: input.affiliateId,
    from_tier: input.from,
    to_tier: input.to,
    active_customers: input.metrics.activeCustomers,
    referred_mrr_minor: input.metrics.referredMrrMinor,
    reason: input.reason,
    actor_user_id: input.actorUserId,
  });

  await recordAudit({
    businessId: null,
    actorUserId: input.actorUserId,
    actorType: input.actorUserId ? "platform_admin" : "system",
    action: "affiliate.tier_changed",
    entityType: "affiliate",
    entityId: input.affiliateId,
    metadata: { from: input.from, to: input.to, reason: input.reason, ...input.metrics },
  });

  const name = (key: TierKey | null) => input.tiers.find((tier) => tier.key === key)?.name ?? key ?? "Partner";
  const rank = (key: TierKey | null) => input.tiers.find((tier) => tier.key === key)?.rank ?? 0;
  const up = rank(input.to) > rank(input.from);
  await notifyAffiliate(input.affiliateId, "commission_updates", {
    kind: "tier.changed",
    title: up ? `You reached the ${name(input.to)} tier` : `Your tier is now ${name(input.to)}`,
    body: up
      ? `Your paid referred customers moved you from ${name(input.from)} to ${name(input.to)}. New one-off commission uses the ${name(input.to)} rate.`
      : `At the monthly review your tier moved from ${name(input.from)} to ${name(input.to)}. Commission already earned is unchanged.`,
    href: "/affiliates/app",
  });
}
