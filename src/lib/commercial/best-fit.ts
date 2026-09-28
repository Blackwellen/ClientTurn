/**
 * Best fit across the catalogue (commercial rules, 0174).
 *
 * A deterministic scorer. It ranks the workspace's offers (`services`) and
 * their priced items (`catalogue_items`) for one lead, from facts already
 * captured, and returns the top one with short machine reason codes. Nothing
 * here asks a model anything: CLAUDE.md resolved conflict 1 (deterministic
 * rules decide; AI may only word the result, in approved facts).
 *
 * The rules (points are fixed, not learned):
 *
 *   Demand: what the lead wants. A recommendation needs at least one.
 *     LEAD_SERVICE      +40  the lead came in on this offer
 *     OPEN_INTEREST     +30  an open opportunity on this offer (0144)
 *     NAMED_INTEREST    +25  a product-interest fact or a lead tag names it
 *   Fit: whether it suits them. Never enough on its own.
 *     BUDGET_FITS       +15  budget (GBP) at or above the price floor
 *     BUDGET_MAY_BE_LOW -10  an INFERRED budget below the floor
 *     REGION_MATCH      +10  the lead's postcode is in the offer's area
 *     SIZE_MATCH        +10  company size inside the offer's target bands
 *     SIZE_OUTSIDE_TARGET -15 company size outside them
 *   Exclusions: the candidate is not eligible at all.
 *     OUT_OF_TARGET        the lead's agent does not sell it
 *     BUDGET_BELOW_PRICE   a CONFIRMED budget below the price floor
 *     REGION_EXCLUDED      the lead's postcode is outside the offer's area
 *     SIZE_EXCLUDED        company size inside the offer's excluded bands
 *   Lead-level notes (shown, never ranked): ICP_FIT_STRONG, ICP_FIT_WEAK,
 *     TIMELINE_KNOWN, BUDGET_UNKNOWN.
 *
 * No guess: with no demand signal on any eligible candidate, or a tie between
 * different offers, the answer is INSUFFICIENT_DATA with the reason. A tie
 * between an offer and its own items resolves to the single matching item
 * when there is exactly one (MOST_SPECIFIC), otherwise to the offer.
 *
 * Prices are used to compare, never rendered: no reason code or line carries
 * an amount (a price reaches a prompt only as published wording).
 *
 * Pure: relative `.ts` imports, no server-only, no Supabase.
 */

import { parseOfferProfile } from "../qualification-intelligence/types.ts";

export const BEST_FIT_VERSION = "fit-1" as const;

export const FIT_POINTS = {
  LEAD_SERVICE: 40,
  OPEN_INTEREST: 30,
  NAMED_INTEREST: 25,
  BUDGET_FITS: 15,
  BUDGET_MAY_BE_LOW: -10,
  REGION_MATCH: 10,
  SIZE_MATCH: 10,
  SIZE_OUTSIDE_TARGET: -15,
} as const;

export const DEMAND_REASONS = ["LEAD_SERVICE", "OPEN_INTEREST", "NAMED_INTEREST"] as const;
export const EXCLUSION_REASONS = ["OUT_OF_TARGET", "BUDGET_BELOW_PRICE", "REGION_EXCLUDED", "SIZE_EXCLUDED"] as const;
export const LEAD_NOTES = ["ICP_FIT_STRONG", "ICP_FIT_WEAK", "TIMELINE_KNOWN", "BUDGET_UNKNOWN"] as const;

export type ScoredReason = keyof typeof FIT_POINTS;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];
export type LeadNote = (typeof LEAD_NOTES)[number];
export type FitReason = ScoredReason | ExclusionReason | LeadNote | "MOST_SPECIFIC";

export type InsufficientReason = "NO_CATALOGUE" | "NONE_ELIGIBLE" | "NO_STATED_NEED" | "TIED";

export const FIT_REASON_LABEL: Record<FitReason, string> = {
  LEAD_SERVICE: "Came in on this offer",
  OPEN_INTEREST: "Has an open interest in it",
  NAMED_INTEREST: "Named it as something they want",
  BUDGET_FITS: "Budget covers it",
  BUDGET_MAY_BE_LOW: "Budget (not confirmed) may be too low",
  REGION_MATCH: "In its service area",
  SIZE_MATCH: "Company size fits",
  SIZE_OUTSIDE_TARGET: "Company size outside its usual customers",
  OUT_OF_TARGET: "Not sold by this lead's agent",
  BUDGET_BELOW_PRICE: "Confirmed budget is below its price",
  REGION_EXCLUDED: "Outside its service area",
  SIZE_EXCLUDED: "Company size it excludes",
  ICP_FIT_STRONG: "Strong fit with your ideal customer",
  ICP_FIT_WEAK: "Weak fit with your ideal customer",
  TIMELINE_KNOWN: "Timeline known",
  BUDGET_UNKNOWN: "Budget not known yet",
  MOST_SPECIFIC: "The one product that matches",
};

export const INSUFFICIENT_LABEL: Record<InsufficientReason, string> = {
  NO_CATALOGUE: "There is nothing in the catalogue to recommend yet.",
  NONE_ELIGIBLE: "Nothing in the catalogue suits what is known about this lead.",
  NO_STATED_NEED: "Not enough is known about what this lead wants to recommend one offer.",
  TIED: "More than one offer fits equally well; ask what matters most to them.",
};

/* ------------------------------------------------------------------ input */

export type FitCandidate = {
  kind: "SERVICE" | "ITEM";
  id: string;
  /** The offer this is (SERVICE) or sits under (ITEM). Null = a standalone item. */
  serviceId: string | null;
  name: string;
  /**
   * INTERNAL. The lowest price it can be bought at, minor units: an item's unit
   * price; an offer's cheapest active item. Compared, never rendered.
   */
  priceFloorMinor: number | null;
  currency: string | null;
  /** services.offer_profile.geography.postcodePrefixes (outward-code prefixes). */
  postcodePrefixes?: readonly string[];
  /** services.offer_profile targetCustomer.sizes / excludedCustomer.sizes. */
  targetSizes?: readonly string[];
  excludedSizes?: readonly string[];
};

export type FitFact = {
  dimension: string;
  /** Offer-scoped fact (0144) or null for the whole lead. */
  serviceId: string | null;
  value: string;
  valueNormalised: string | null;
  state: "CONFIRMED" | "INFERRED";
};

export type FitLead = {
  serviceId: string | null;
  openInterestServiceIds: readonly string[];
  postcode: string | null;
  facts: readonly FitFact[];
  /** Active lead tags (lead_tags.tag), e.g. "SEO_AUDIT". */
  tags?: readonly string[];
  /** The current lead score grade (lead_scores), A best. */
  icpGrade?: "A" | "B" | "C" | "D" | null;
};

export type RankedCandidate = {
  key: string;
  kind: FitCandidate["kind"];
  id: string;
  serviceId: string | null;
  name: string;
  score: number;
  eligible: boolean;
  reasons: FitReason[];
  excludedBy: ExclusionReason | null;
};

export type BestFit =
  | {
      status: "RECOMMENDED";
      version: typeof BEST_FIT_VERSION;
      top: RankedCandidate;
      reasons: FitReason[];
      leadNotes: LeadNote[];
      ranked: RankedCandidate[];
    }
  | {
      status: "INSUFFICIENT_DATA";
      version: typeof BEST_FIT_VERSION;
      reason: InsufficientReason;
      leadNotes: LeadNote[];
      ranked: RankedCandidate[];
    };

/**
 * Candidates from the live catalogue: every active offer, and every active,
 * sellable item (not archived, not add-on-only). An item inherits its offer's
 * area and customer bands; an offer's price floor is its cheapest item.
 */
export function buildFitCandidates(
  services: readonly { id: string; name: string; offerProfile?: unknown }[],
  items: readonly {
    id: string;
    serviceId: string | null;
    name: string;
    unitPriceMinor: number | null;
    currency: string | null;
    addOnOnly?: boolean;
  }[],
): FitCandidate[] {
  const sellable = items.filter((item) => !item.addOnOnly);
  const shape = new Map<string, Pick<FitCandidate, "postcodePrefixes" | "targetSizes" | "excludedSizes">>();
  const out: FitCandidate[] = [];
  for (const service of services) {
    const { profile } = parseOfferProfile(service.offerProfile ?? {});
    const s = {
      postcodePrefixes: profile.geography?.postcodePrefixes ?? [],
      targetSizes: profile.targetCustomer?.sizes ?? [],
      excludedSizes: profile.excludedCustomer?.sizes ?? [],
    };
    shape.set(service.id, s);
    const own = sellable.filter((item) => item.serviceId === service.id && item.unitPriceMinor !== null);
    const floor = own.length ? own.reduce((min, item) => Math.min(min, item.unitPriceMinor!), Number.POSITIVE_INFINITY) : null;
    out.push({
      kind: "SERVICE",
      id: service.id,
      serviceId: service.id,
      name: service.name,
      priceFloorMinor: floor,
      currency: own[0]?.currency ?? null,
      ...s,
    });
  }
  for (const item of sellable) {
    out.push({
      kind: "ITEM",
      id: item.id,
      serviceId: item.serviceId,
      name: item.name,
      priceFloorMinor: item.unitPriceMinor,
      currency: item.currency,
      ...((item.serviceId && shape.get(item.serviceId)) || {}),
    });
  }
  return out;
}

/**
 * The stored facts the scorer may read: live (not superseded, not expired),
 * CONFIRMED or INFERRED, and an AI-extracted candidate only at the same
 * confidence floor the engine uses (0.85). REJECTED and CONFLICTING never count.
 */
export function liveFitFacts(
  facts: readonly {
    dimension: string;
    serviceId: string | null;
    value: string;
    valueNormalised: string | null;
    state: string;
    source: string;
    confidence: number;
    validUntil: string | null;
    supersededAt: string | null;
  }[],
  now: Date,
): FitFact[] {
  const at = now.getTime();
  return facts
    .filter((f) => !f.supersededAt && (f.state === "CONFIRMED" || f.state === "INFERRED"))
    .filter((f) => !f.validUntil || Date.parse(f.validUntil) > at)
    .filter((f) => f.source !== "AI_ASSIST" || f.confidence >= 0.85)
    .map((f) => ({
      dimension: f.dimension,
      serviceId: f.serviceId,
      value: f.value,
      valueNormalised: f.valueNormalised,
      state: f.state as FitFact["state"],
    }));
}

/* ---------------------------------------------------------------- helpers */

function norm(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[_]+/g, " ")
    .replace(/[^a-z0-9£%]+/g, " ")
    .trim();
}

function containsPhrase(haystack: string, needle: string): boolean {
  const n = norm(needle);
  return n.length >= 3 && ` ${norm(haystack)} `.includes(` ${n} `);
}

/** The fact for a dimension that applies to this offer: offer-scoped first, then lead-wide. */
function factFor(facts: readonly FitFact[], dimension: string, serviceId: string | null): FitFact | null {
  const matching = facts.filter((f) => f.dimension === dimension);
  const scoped = serviceId ? matching.find((f) => f.serviceId === serviceId) : undefined;
  const pick = (list: FitFact[]) => list.find((f) => f.state === "CONFIRMED") ?? list[0] ?? null;
  return scoped ?? pick(matching.filter((f) => f.serviceId === null));
}

function budgetGbp(fact: FitFact | null): number | null {
  const n = fact?.valueNormalised ?? null;
  const m = n ? /^gbp:(\d+)$/.exec(n) : null;
  return m ? Number(m[1]) : null;
}

function outwardCode(postcode: string | null, facts: readonly FitFact[]): string | null {
  const location = facts.find((f) => f.dimension === "LOCATION" && f.valueNormalised?.startsWith("pc:"));
  if (location) return location.valueNormalised!.slice(3).toUpperCase();
  if (!postcode) return null;
  const m = /^\s*([A-Za-z]{1,2}\d[A-Za-z\d]?)/.exec(postcode);
  return m ? m[1].toUpperCase() : null;
}

/** "S" covers "S1" but not "SW1"; "SW1" covers "SW1A" but not "SW10". */
export function postcodeInPrefix(outward: string, prefix: string): boolean {
  const o = outward.toUpperCase();
  const p = prefix.toUpperCase();
  if (!p || !o.startsWith(p)) return false;
  const next = o.charAt(p.length);
  if (!next) return true;
  if (/^[A-Z]+$/.test(p)) return /\d/.test(next);
  if (/\d$/.test(p)) return !/\d/.test(next);
  return true;
}

function companySize(facts: readonly FitFact[]): number | null {
  const fact = facts.find((f) => f.dimension === "COMPANY_SIZE" || f.dimension === "TEAM_SIZE");
  const raw = fact?.valueNormalised ?? fact?.value ?? null;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "1-9", "10-49", "250+": whether n is in any band. Null when no band parses. */
export function inSizeBands(n: number, bands: readonly string[]): boolean | null {
  let parsed = false;
  for (const band of bands) {
    const range = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(band);
    const open = /^\s*(\d+)\s*\+\s*$/.exec(band);
    if (range) {
      parsed = true;
      if (n >= Number(range[1]) && n <= Number(range[2])) return true;
    } else if (open) {
      parsed = true;
      if (n >= Number(open[1])) return true;
    }
  }
  return parsed ? false : null;
}

function timelineKnown(facts: readonly FitFact[]): boolean {
  return facts.some((f) => f.dimension === "TIMING" && (f.valueNormalised?.startsWith("days:") ?? false));
}

/* ------------------------------------------------------------------ score */

export function scoreCandidate(
  candidate: FitCandidate,
  lead: FitLead,
  inTarget: boolean = true,
): RankedCandidate {
  const reasons: FitReason[] = [];
  let score = 0;
  let excludedBy: ExclusionReason | null = null;
  const add = (reason: ScoredReason) => {
    reasons.push(reason);
    score += FIT_POINTS[reason];
  };
  const exclude = (reason: ExclusionReason) => {
    if (!excludedBy) excludedBy = reason;
    reasons.push(reason);
  };

  if (!inTarget) exclude("OUT_OF_TARGET");

  // ---- demand
  if (candidate.serviceId && lead.serviceId === candidate.serviceId) add("LEAD_SERVICE");
  if (candidate.serviceId && lead.openInterestServiceIds.includes(candidate.serviceId)) add("OPEN_INTEREST");
  const interestTexts = [
    ...lead.facts.filter((f) => f.dimension === "PRODUCT_INTEREST").map((f) => f.value),
    ...(lead.tags ?? []),
  ];
  if (interestTexts.some((text) => containsPhrase(text, candidate.name))) add("NAMED_INTEREST");

  // ---- budget (GBP only; another currency is not compared)
  const budgetFact = factFor(lead.facts, "BUDGET", candidate.serviceId);
  const budget = budgetGbp(budgetFact);
  if (budget !== null && candidate.priceFloorMinor !== null && (candidate.currency ?? "GBP") === "GBP") {
    if (budget * 100 >= candidate.priceFloorMinor) add("BUDGET_FITS");
    else if (budgetFact!.state === "CONFIRMED") exclude("BUDGET_BELOW_PRICE");
    else add("BUDGET_MAY_BE_LOW");
  }

  // ---- region
  const prefixes = (candidate.postcodePrefixes ?? []).map((p) => p.toUpperCase());
  const outward = outwardCode(lead.postcode, lead.facts);
  if (prefixes.length > 0 && outward) {
    if (prefixes.some((p) => postcodeInPrefix(outward, p))) add("REGION_MATCH");
    else exclude("REGION_EXCLUDED");
  }

  // ---- company size
  const size = companySize(lead.facts);
  if (size !== null) {
    if (candidate.excludedSizes?.length && inSizeBands(size, candidate.excludedSizes) === true) exclude("SIZE_EXCLUDED");
    else if (candidate.targetSizes?.length) {
      const inside = inSizeBands(size, candidate.targetSizes);
      if (inside === true) add("SIZE_MATCH");
      else if (inside === false) add("SIZE_OUTSIDE_TARGET");
    }
  }

  return {
    key: `${candidate.kind === "SERVICE" ? "service" : "item"}:${candidate.id}`,
    kind: candidate.kind,
    id: candidate.id,
    serviceId: candidate.serviceId,
    name: candidate.name,
    score,
    eligible: excludedBy === null,
    reasons,
    excludedBy,
  };
}

function leadNotes(lead: FitLead): LeadNote[] {
  const notes: LeadNote[] = [];
  if (lead.icpGrade === "A" || lead.icpGrade === "B") notes.push("ICP_FIT_STRONG");
  if (lead.icpGrade === "D") notes.push("ICP_FIT_WEAK");
  if (timelineKnown(lead.facts)) notes.push("TIMELINE_KNOWN");
  if (!lead.facts.some((f) => f.dimension === "BUDGET")) notes.push("BUDGET_UNKNOWN");
  return notes;
}

const hasDemand = (c: RankedCandidate) => c.reasons.some((r) => (DEMAND_REASONS as readonly string[]).includes(r));

/** Stable order: eligible first, score, demand, SERVICE before ITEM, name, id. */
function compare(a: RankedCandidate, b: RankedCandidate): number {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
  if (a.score !== b.score) return b.score - a.score;
  if (hasDemand(a) !== hasDemand(b)) return hasDemand(a) ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === "SERVICE" ? -1 : 1;
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/**
 * Ranks every candidate and picks one, or says why it cannot. Deterministic:
 * the same catalogue and facts give the same answer, in the same order.
 */
export function recommendBestFit(input: {
  candidates: readonly FitCandidate[];
  lead: FitLead;
  /** The lead's agent target (offer-target.ts). Absent = the whole catalogue. */
  inTarget?: (candidate: FitCandidate) => boolean;
}): BestFit {
  const notes = leadNotes(input.lead);
  const ranked = input.candidates
    .map((candidate) => scoreCandidate(candidate, input.lead, input.inTarget ? input.inTarget(candidate) : true))
    .sort(compare);

  const insufficient = (reason: InsufficientReason): BestFit => ({
    status: "INSUFFICIENT_DATA",
    version: BEST_FIT_VERSION,
    reason,
    leadNotes: notes,
    ranked,
  });

  if (ranked.length === 0) return insufficient("NO_CATALOGUE");
  const eligible = ranked.filter((c) => c.eligible);
  if (eligible.length === 0) return insufficient("NONE_ELIGIBLE");
  const withDemand = eligible.filter(hasDemand);
  if (withDemand.length === 0) return insufficient("NO_STATED_NEED");

  const best = withDemand[0].score;
  const tied = withDemand.filter((c) => c.score === best);
  let top = tied[0];
  const reasons: FitReason[] = [];
  if (tied.length > 1) {
    const offers = new Set(tied.map((c) => c.serviceId ?? `item:${c.id}`));
    if (offers.size > 1) return insufficient("TIED");
    // One offer and its own items: the single matching item, else the offer.
    const items = tied.filter((c) => c.kind === "ITEM");
    const service = tied.find((c) => c.kind === "SERVICE");
    if (items.length === 1) {
      top = items[0];
      reasons.push("MOST_SPECIFIC");
    } else if (service) {
      top = service;
    } else {
      return insufficient("TIED");
    }
  }

  return {
    status: "RECOMMENDED",
    version: BEST_FIT_VERSION,
    top,
    reasons: [...top.reasons, ...reasons],
    leadNotes: notes,
    ranked,
  };
}

/* ------------------------------------------------------------------ render */

/**
 * The offer card's RECOMMENDED FIT line. Names the offer and its reason codes,
 * never a price. The model may suggest it in the card's approved words only.
 */
export function renderRecommendation(fit: BestFit | null): string | null {
  if (!fit) return null;
  if (fit.status === "RECOMMENDED") {
    return (
      `${fit.top.name} (${fit.reasons.join(", ")}). Suggest it only if it helps the lead, ` +
      "in the approved words above; state no price that is not published."
    );
  }
  if (fit.reason === "NO_CATALOGUE") return null;
  return `None yet (${fit.reason}). Do not guess an offer; ask what they need.`;
}
