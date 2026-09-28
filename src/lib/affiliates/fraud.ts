import "server-only";
import { recordAudit } from "@/lib/audit";
import { isSchemaMissing } from "@/lib/billing/stripe-events";
import { untypedDb } from "./programme-settings";
import {
  assessPayment,
  decideFlag,
  deviceHash,
  ipHash,
  type FraudSignal,
} from "./fraud-rules";

/**
 * The fraud and self-referral side of the programme (affiliate audit 17, §1).
 *
 * Rules are pure (`fraud-rules.ts`); this module reads and writes around them.
 * Everything here is best-effort against a missing migration 0166: a fraud
 * check that cannot run must never block a signup or a webhook, and the
 * existing hard guard (the affiliate's own user id) still applies without it.
 */

function secret(): string {
  // Production uses the dedicated secret only (internal review IR-06).
  const key =
    process.env.AFFILIATE_COOKIE_SECRET ||
    (process.env.NODE_ENV === "production" ? undefined : process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) throw new Error("Missing AFFILIATE_COOKIE_SECRET for affiliate fingerprints");
  return key;
}

export function hashesFor(ip: string, userAgent: string): { ipHash: string; deviceHash: string } {
  const key = secret();
  return { ipHash: ipHash(key, ip), deviceHash: deviceHash(key, ip, userAgent) };
}

/**
 * Remembers the network and device an affiliate uses the portal from, as
 * keyed hashes, so a referral signed up from the same place can be held for
 * review. Purged after the retention window (0166 purge function).
 */
export async function recordAffiliatePresence(affiliateId: string, ip: string, userAgent: string): Promise<void> {
  if (!ip || ip === "unknown") return;
  try {
    const { ipHash: ipValue, deviceHash: deviceValue } = hashesFor(ip, userAgent);
    const now = new Date().toISOString();
    const { error } = await untypedDb()
      .from("affiliate_fingerprints")
      .upsert(
        [
          { affiliate_id: affiliateId, kind: "IP", value_hash: ipValue, last_seen_at: now },
          { affiliate_id: affiliateId, kind: "DEVICE", value_hash: deviceValue, last_seen_at: now },
        ],
        { onConflict: "affiliate_id,kind,value_hash" },
      );
    if (error && !isSchemaMissing(error)) console.error("[affiliates] presence not recorded", error.message);
  } catch (error) {
    console.error("[affiliates] presence not recorded", error instanceof Error ? error.message : String(error));
  }
}

export async function affiliateFingerprints(affiliateId: string): Promise<{ ipHashes: string[]; deviceHashes: string[] }> {
  const { data, error } = await untypedDb()
    .from("affiliate_fingerprints")
    .select("kind, value_hash")
    .eq("affiliate_id", affiliateId)
    .in("kind", ["IP", "DEVICE"])
    .limit(500);
  if (error) return { ipHashes: [], deviceHashes: [] };
  const rows = (data ?? []) as { kind: string; value_hash: string }[];
  return {
    ipHashes: rows.filter((row) => row.kind === "IP").map((row) => row.value_hash),
    deviceHashes: rows.filter((row) => row.kind === "DEVICE").map((row) => row.value_hash),
  };
}

/**
 * Writes the signals for one referral and applies the decision.
 *
 * - reject: the referral is REJECTED with the reason (no commission, ever,
 *   unless an admin clears it);
 * - hold: `flagged_reason` is set, which stops accrual, approval and payout
 *   claiming until an admin clears or confirms it;
 * - none: INFO signals are still stored for context.
 */
export async function applySignals(input: {
  affiliateId: string;
  referralId: string;
  businessId: string;
  signals: readonly FraudSignal[];
  source: "SIGNUP" | "PAYMENT";
}): Promise<"none" | "hold" | "reject"> {
  if (input.signals.length === 0) return "none";
  const db = untypedDb();

  const inserted = await db.from("affiliate_fraud_flags").upsert(
    input.signals.map((signal) => ({
      affiliate_id: input.affiliateId,
      referral_id: input.referralId,
      business_id: input.businessId,
      code: signal.code,
      severity: signal.severity,
      source: input.source,
      status: signal.severity === "BLOCK" ? "CONFIRMED" : signal.severity === "REVIEW" ? "OPEN" : "CLEARED",
    })),
    { onConflict: "referral_id,code", ignoreDuplicates: true },
  );
  if (inserted.error && !isSchemaMissing(inserted.error)) {
    console.error("[affiliates] fraud flags not written", inserted.error.message);
  }

  const decision = decideFlag(input.signals);
  if (decision.action === "none") return "none";

  const update =
    decision.action === "reject"
      ? { flagged_reason: decision.reason, status: "REJECTED" }
      : { flagged_reason: decision.reason };
  await db.from("affiliate_referrals").update(update).eq("id", input.referralId).is("flagged_reason", null);

  await recordAudit({
    businessId: input.businessId,
    actorType: "system",
    action: decision.action === "reject" ? "affiliate.referral_rejected" : "affiliate.referral_held",
    entityType: "affiliate_referral",
    entityId: input.referralId,
    metadata: { reason: decision.reason, codes: input.signals.map((signal) => signal.code), source: input.source },
  });

  return decision.action;
}

/* ------------------------------------------------------ payment check -- */

export type CardFingerprintLister = (customerId: string) => Promise<string[]>;

/**
 * Once a referral pays: is the referred customer the affiliate's own Stripe
 * customer or card, or is the affiliate a member of the referred workspace?
 *
 * Runs in the daily ledger job (provider I/O is allowed in a job, never in a
 * webhook). `listCards` is injected so the tests use a fake Stripe. Each
 * attribution is checked once (`payment_checked_at`).
 */
export async function checkPaidReferrals(listCards: CardFingerprintLister, limit = 100): Promise<number> {
  const db = untypedDb();
  const { data, error } = await db
    .from("affiliate_attributions")
    .select("id, affiliate_id, business_id")
    .is("payment_checked_at", null)
    .is("rejected_reason", null)
    .not("business_id", "is", null)
    .order("attributed_at", { ascending: true })
    .limit(limit);
  if (error) {
    if (!isSchemaMissing(error)) console.error("[affiliates] payment check read failed", error.message);
    return 0;
  }

  let flagged = 0;
  for (const attribution of (data ?? []) as { id: string; affiliate_id: string; business_id: string }[]) {
    const { data: referral } = await db
      .from("affiliate_referrals")
      .select("id, paid_at, flagged_reason")
      .eq("business_id", attribution.business_id)
      .eq("affiliate_id", attribution.affiliate_id)
      .maybeSingle();
    const ref = referral as { id: string; paid_at: string | null; flagged_reason: string | null } | null;
    // Not paying yet: check again on a later run.
    if (!ref || !ref.paid_at) continue;

    const signals = await paymentSignals(attribution.affiliate_id, attribution.business_id, listCards);
    if (!ref.flagged_reason) {
      const outcome = await applySignals({
        affiliateId: attribution.affiliate_id,
        referralId: ref.id,
        businessId: attribution.business_id,
        signals,
        source: "PAYMENT",
      });
      if (outcome !== "none") flagged += 1;
    }
    await db.from("affiliate_attributions").update({ payment_checked_at: new Date().toISOString() }).eq("id", attribution.id);
  }
  return flagged;
}

async function paymentSignals(
  affiliateId: string,
  businessId: string,
  listCards: CardFingerprintLister,
): Promise<FraudSignal[]> {
  const db = untypedDb();
  const { data: affiliate } = await db.from("affiliates").select("user_id").eq("id", affiliateId).maybeSingle();
  const userId = (affiliate as { user_id: string } | null)?.user_id;
  if (!userId) return [];

  const [{ data: memberships }, { data: referredSub }] = await Promise.all([
    db.from("business_members").select("business_id").eq("user_id", userId),
    db.from("subscriptions").select("stripe_customer_id").eq("business_id", businessId).maybeSingle(),
  ]);
  const ownBusinesses = ((memberships ?? []) as { business_id: string }[]).map((row) => row.business_id);
  const referredCustomerId = (referredSub as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null;

  const ownCustomers: string[] = [];
  if (ownBusinesses.length > 0) {
    const { data: ownSubs } = await db
      .from("subscriptions")
      .select("stripe_customer_id")
      .in("business_id", ownBusinesses.filter((id) => id !== businessId));
    for (const row of (ownSubs ?? []) as { stripe_customer_id: string | null }[]) {
      if (row.stripe_customer_id) ownCustomers.push(row.stripe_customer_id);
    }
  }

  let referredCards: string[] = [];
  const ownCards: string[] = [];
  try {
    if (referredCustomerId && ownCustomers.length > 0) {
      referredCards = await listCards(referredCustomerId);
      for (const customer of ownCustomers) ownCards.push(...(await listCards(customer)));
    }
  } catch (error) {
    // A Stripe outage skips the card comparison; the id comparisons still ran.
    console.error("[affiliates] card fingerprints unavailable", error instanceof Error ? error.message : String(error));
  }

  // Remembered so an admin can see what the comparison was made against.
  const prints = [
    ...ownCustomers.map((value) => ({ affiliate_id: affiliateId, kind: "STRIPE_CUSTOMER", value_hash: value })),
    ...ownCards.map((value) => ({ affiliate_id: affiliateId, kind: "CARD", value_hash: value })),
  ];
  if (prints.length > 0) {
    await db.from("affiliate_fingerprints").upsert(prints, { onConflict: "affiliate_id,kind,value_hash" });
  }

  return assessPayment({
    referredCustomerId,
    affiliateCustomerIds: ownCustomers,
    referredCardFingerprints: referredCards,
    affiliateCardFingerprints: ownCards,
    affiliateIsMember: ownBusinesses.includes(businessId),
  });
}
