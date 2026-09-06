/**
 * The sourcing cost model (V4 §11.10, §55.4).
 *
 * Pure, so the estimate the customer is shown before approving a run and the
 * reservation the worker takes before each provider batch are computed by the
 * *same* arithmetic. A quoted estimate that the worker then disagrees with is
 * how a run overruns a cap that looked fine on screen.
 *
 * All figures are in minor units (pence). They are internal: nothing in this
 * module is ever rendered to a customer as a per-record price — §90/§112 keep
 * provider unit cost admin-only. What the customer sees is the run total
 * against their own cap.
 */

export type Capability =
  | "COMPANY_SEARCH"
  | "CONTACT_DISCOVERY"
  | "COMPANY_ENRICHMENT"
  | "CONTACT_ENRICHMENT"
  | "EMAIL_VERIFICATION"
  | "INTENT"
  | "WEBSITE_INTELLIGENCE";

export const CAPABILITIES: Capability[] = [
  "COMPANY_SEARCH",
  "CONTACT_DISCOVERY",
  "COMPANY_ENRICHMENT",
  "CONTACT_ENRICHMENT",
  "EMAIL_VERIFICATION",
  "INTENT",
  "WEBSITE_INTELLIGENCE",
];

/**
 * Fallback unit costs, used only when `provider_price_book` has no live row
 * for a provider/capability pair. They are intentionally pessimistic: an
 * under-estimate would let a run start that the budget cannot actually fund,
 * and discovering that mid-run is worse than refusing it up front.
 */
export const FALLBACK_UNIT_COST_MINOR: Record<Capability, number> = {
  COMPANY_SEARCH: 1,
  CONTACT_DISCOVERY: 2,
  COMPANY_ENRICHMENT: 4,
  CONTACT_ENRICHMENT: 6,
  EMAIL_VERIFICATION: 1,
  INTENT: 3,
  WEBSITE_INTELLIGENCE: 2,
};

/**
 * The waterfall's shape, expressed as how many records reach each capability
 * per one *verified* prospect the customer asked for. These are the funnel
 * assumptions the cheap-first ordering is built on: many companies are cheap
 * to find, few are worth enriching.
 *
 * Deliberately conservative — real yields vary by vertical, and the run
 * reconciles against actuals as it goes rather than trusting these.
 */
export const FUNNEL_MULTIPLIER: Record<Capability, number> = {
  COMPANY_SEARCH: 9,
  CONTACT_DISCOVERY: 6,
  // Enrichment only runs on records that cleared the cheap pre-filter, which
  // is the entire point of stage 5 sitting before stage 6.
  COMPANY_ENRICHMENT: 2.5,
  CONTACT_ENRICHMENT: 1.8,
  EMAIL_VERIFICATION: 1.6,
  INTENT: 1.2,
  WEBSITE_INTELLIGENCE: 0,
};

export type UnitCosts = Partial<Record<Capability, number>>;

export type CostEstimate = {
  /** What the whole run is expected to cost, in pence. */
  totalMinor: number;
  /** Per-capability breakdown, for the admin cost view and the reservation. */
  byCapability: Record<Capability, number>;
  /** Expected provider calls, used for the estimate stored on the strategy. */
  callsByCapability: Record<Capability, number>;
};

/**
 * Estimates the provider spend for `targetVerified` verified prospects.
 *
 * `unitCosts` comes from the price book; anything missing falls back above.
 */
export function estimateRunCost(
  targetVerified: number,
  unitCosts: UnitCosts = {},
  options: { intentEnabled?: boolean } = {},
): CostEstimate {
  const target = Math.max(0, Math.floor(targetVerified));
  const byCapability = {} as Record<Capability, number>;
  const callsByCapability = {} as Record<Capability, number>;
  let totalMinor = 0;

  for (const capability of CAPABILITIES) {
    const skipIntent = capability === "INTENT" && options.intentEnabled === false;
    const calls = skipIntent
      ? 0
      : Math.ceil(target * FUNNEL_MULTIPLIER[capability]);
    const unit = unitCosts[capability] ?? FALLBACK_UNIT_COST_MINOR[capability];
    const cost = Math.ceil(calls * unit);

    callsByCapability[capability] = calls;
    byCapability[capability] = cost;
    totalMinor += cost;
  }

  return { totalMinor, byCapability, callsByCapability };
}

/**
 * The inverse: the largest target affordable within `budgetMinor`.
 *
 * Used to clamp a customer's requested target down to what their remaining
 * budget can actually fund, rather than starting a run that will pause on
 * stage 6 having spent the money and produced nothing usable.
 */
export function targetAffordableWithin(
  budgetMinor: number,
  unitCosts: UnitCosts = {},
  options: { intentEnabled?: boolean } = {},
): number {
  if (budgetMinor <= 0) return 0;
  const perProspect = estimateRunCost(1, unitCosts, options).totalMinor;
  if (perProspect <= 0) return 0;
  return Math.floor(budgetMinor / perProspect);
}

/**
 * The cost band shown against a strategy. Bands, not numbers, are what the
 * plan panel shows before approval — the exact figure belongs to the budget
 * meter on the run, where it is the customer's own cap being spent.
 */
export type CostBand = "WITHIN_PLAN" | "NEAR_LIMIT" | "EXCEEDS_PLAN" | "REQUIRES_OVERAGE";

export function costBand(
  estimateMinor: number,
  availableMinor: number,
  overageAvailable: boolean,
): CostBand {
  if (availableMinor <= 0) return overageAvailable ? "REQUIRES_OVERAGE" : "EXCEEDS_PLAN";
  if (estimateMinor <= availableMinor * 0.8) return "WITHIN_PLAN";
  if (estimateMinor <= availableMinor) return "NEAR_LIMIT";
  return overageAvailable ? "REQUIRES_OVERAGE" : "EXCEEDS_PLAN";
}
