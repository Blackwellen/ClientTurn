/**
 * Business-fact precedence (V4 §26.20).
 *
 * Pure — no `server-only`, no Supabase — so the rule can be unit-tested and the
 * UI can explain the same ordering the server enforces.
 *
 * The ordering exists because ClientTurn learns about a business from several
 * places at once, and those places disagree. A website says one service area,
 * an integration says another, a model infers a third. Without a stated
 * precedence, "what ClientTurn knows" becomes whatever wrote last — which is
 * exactly the hidden-LLM-memory failure §26 exists to prevent.
 *
 * Highest wins:
 *
 *   1. LOCKED USER FACT      — the customer's explicit, protected statement
 *   2. VERIFIED USER FACT    — the customer said it and confirmed it
 *   3. VERIFIED INTEGRATION  — a connected system of record
 *   4. VERIFIED WEBSITE      — their own published site, checked
 *   5. PERFORMANCE INSIGHT   — derived from their own results
 *   6. MODEL INFERENCE       — a guess, and treated as one
 */

export type FactSourceType =
  | "USER"
  | "WEBSITE"
  | "INTEGRATION"
  | "PERFORMANCE"
  | "AI";

export type PrecedenceInput = {
  sourceType: FactSourceType;
  verifiedByUser: boolean;
  locked: boolean;
  confidence: number;
  lastVerifiedAt?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
};

export const PRECEDENCE_TIERS = [
  { rank: 6, key: "LOCKED_USER", label: "Locked by you" },
  { rank: 5, key: "VERIFIED_USER", label: "Confirmed by you" },
  { rank: 4, key: "VERIFIED_INTEGRATION", label: "From a connected system" },
  { rank: 3, key: "VERIFIED_WEBSITE", label: "From your website" },
  { rank: 2, key: "PERFORMANCE", label: "Learned from your results" },
  { rank: 1, key: "INFERENCE", label: "Inferred" },
] as const;

export type PrecedenceKey = (typeof PRECEDENCE_TIERS)[number]["key"];

export function precedenceOf(fact: PrecedenceInput): {
  rank: number;
  key: PrecedenceKey;
  label: string;
} {
  const tier = (key: PrecedenceKey) =>
    PRECEDENCE_TIERS.find((row) => row.key === key)!;

  if (fact.sourceType === "USER" && fact.locked) return tier("LOCKED_USER");
  if (fact.sourceType === "USER") return tier("VERIFIED_USER");
  if (fact.sourceType === "INTEGRATION" && fact.verifiedByUser)
    return tier("VERIFIED_INTEGRATION");
  if (fact.sourceType === "WEBSITE" && fact.verifiedByUser)
    return tier("VERIFIED_WEBSITE");
  if (fact.sourceType === "INTEGRATION") return tier("VERIFIED_INTEGRATION");
  if (fact.sourceType === "WEBSITE") return tier("VERIFIED_WEBSITE");
  if (fact.sourceType === "PERFORMANCE") return tier("PERFORMANCE");
  return tier("INFERENCE");
}

/**
 * May `incoming` replace `existing`?
 *
 * The one absolute: a locked fact is never overwritten by anything automatic,
 * whatever its confidence. Only an authorised person unlocking it can change
 * it, which is what makes the lock worth having.
 */
export function canOverwrite(
  existing: PrecedenceInput,
  incoming: PrecedenceInput,
): { allowed: boolean; reason: string } {
  // The one absolute. A locked fact yields only to a person: WEBSITE,
  // INTEGRATION, PERFORMANCE and AI are all refused regardless of confidence,
  // which is what makes the lock worth having.
  if (existing.locked && incoming.sourceType !== "USER") {
    return {
      allowed: false,
      reason: "This fact is locked. Unlock it first to change it.",
    };
  }

  // A person is the authority on their own business. Their edit always
  // applies, including a restatement of a fact they had already locked — the
  // lock exists to stop automation, not to lock the customer out of their own
  // profile.
  if (incoming.sourceType === "USER") {
    return { allowed: true, reason: "Stated by you." };
  }

  const current = precedenceOf(existing).rank;
  const next = precedenceOf(incoming).rank;

  if (next > current) return { allowed: true, reason: "Higher-precedence source." };

  if (next === current) {
    // A tie is broken by confidence, and only decisively: replacing a fact with
    // an equally-sourced, equally-confident one churns the record for nothing.
    return incoming.confidence > existing.confidence + 0.05
      ? { allowed: true, reason: "Same source, materially higher confidence." }
      : {
          allowed: false,
          reason: "An equally reliable value is already recorded.",
        };
  }

  return {
    allowed: false,
    reason: `A more reliable value is already recorded (${precedenceOf(existing).label}).`,
  };
}

/* ------------------------------------------------------------- freshness */

/** A fact unverified for this long should be looked at again. */
export const STALE_AFTER_DAYS = 180;

export function isStale(fact: PrecedenceInput, now = new Date()): boolean {
  // Inference is never "fresh" in the sense that matters; it is flagged for
  // review on age like anything else, but a locked user fact is not stale
  // simply because nobody has re-typed it.
  if (fact.locked) return false;
  if (!fact.lastVerifiedAt) return true;
  const age = now.getTime() - new Date(fact.lastVerifiedAt).getTime();
  return age > STALE_AFTER_DAYS * 864e5;
}

/**
 * Temporal validity (§26.15). A seasonal offer or a temporary service area
 * stops applying on its own rather than needing someone to remember to delete
 * it.
 */
export function isCurrentlyValid(fact: PrecedenceInput, now = new Date()): boolean {
  const time = now.getTime();
  if (fact.validFrom && new Date(fact.validFrom).getTime() > time) return false;
  if (fact.validTo && new Date(fact.validTo).getTime() < time) return false;
  return true;
}
