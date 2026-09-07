/**
 * The rules governing prospect research (V4 §13.3).
 *
 * Pure — no `server-only`, no Supabase, no model client — so the two things
 * that actually protect a customer here can be unit-tested on their own:
 *
 *   1. **The spending bounds.** A refresh calls a paid provider, so there is a
 *      per-prospect cooldown and a per-workspace daily cap.
 *   2. **The citation guard.** An AI summary claim that cites evidence which
 *      was never supplied is discarded. That is the difference between asking a
 *      model not to invent things and making an invention unusable.
 */

/** One refresh per prospect per day. The answer to "has this company changed"
 *  does not differ between 10:00 and 10:05. */
export const RESEARCH_COOLDOWN_HOURS = 24;

/** How many prospects a workspace may refresh in a rolling day, so the
 *  cooldown cannot simply be spread across many records instead. */
export const RESEARCH_DAILY_WORKSPACE_LIMIT = 25;

/** A claim as the model returns it, before it has been checked. */
export type UncheckedClaim = {
  text: string;
  evidence_ids: string[];
};

/** Normalised so a formatting difference cannot lose a real citation. */
function normaliseRef(ref: string): string {
  return ref.trim().toUpperCase();
}

/**
 * Keeps only claims that cite evidence which was actually supplied.
 *
 * A claim citing an unknown reference is **dropped, never repaired**. Silently
 * re-pointing a bad citation at some other evidence would launder a
 * fabrication into something that looks sourced, which is worse than showing
 * nothing.
 *
 * A claim citing a mix of real and invented references is kept, with the
 * invented ones removed: the surviving citations still support it, and the
 * caller renders only what is returned here.
 */
export function keepCitedClaims<T extends UncheckedClaim>(
  claims: T[],
  suppliedRefs: string[],
): { claim: T; citedRefs: string[] }[] {
  const known = new Set(suppliedRefs.map(normaliseRef));

  const out: { claim: T; citedRefs: string[] }[] = [];
  for (const claim of claims) {
    if (!claim.text?.trim()) continue;

    const citedRefs = claim.evidence_ids
      .map(normaliseRef)
      .filter((ref) => known.has(ref));

    if (citedRefs.length === 0) continue;
    out.push({ claim, citedRefs: [...new Set(citedRefs)] });
  }

  return out;
}
