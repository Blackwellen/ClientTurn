import { z } from "zod";
import type { Grade } from "@/lib/prospects/types";

/**
 * The structured search plan (V4 §10.4).
 *
 * This is the contract between three parties that do not trust each other:
 * the customer editing the plan in the browser, the Search Agent proposing
 * changes to it, and the sourcing worker that will spend real money executing
 * it. Nothing reaches the worker without passing this schema, which is why it
 * lives here — pure, no `server-only`, no Supabase import — and is imported by
 * the client editor, the server action and the job handler alike.
 *
 * Every bound is deliberate. `targetVerifiedProspects` and `maxProviderCostMinor`
 * are capped in the schema *and* clamped again by the budget engine against
 * live entitlement; the schema bound stops an absurd value from ever being
 * persisted, the budget engine stops a merely-optimistic one from being run.
 */

/* ------------------------------------------------------------- vocabularies */

export const ORGANIZATION_TYPES = [
  "COMMERCIAL",
  "RESIDENTIAL",
  "PUBLIC_SECTOR",
  "NON_PROFIT",
  "MIXED",
] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const REVIEW_MODES = ["HUMAN_REVIEW", "AUTO_CONTACT"] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

export const CONVERSION_GOAL_TYPES = [
  "BOOK_APPOINTMENT",
  "BOOK_SITE_VISIT",
  "BOOK_DEMO",
  "REQUEST_QUOTE",
  "PHONE_CALL",
  "DIRECT_SIGNUP",
  "DIRECT_PURCHASE",
  "HUMAN_HANDOVER",
] as const;
export type ConversionGoalType = (typeof CONVERSION_GOAL_TYPES)[number];

export const GRADES = ["A+", "A", "B", "C", "D"] as const;

export const INTENT_FRESHNESS_DAYS = [7, 30, 90, 180] as const;

/* ----------------------------------------------------------------- schema */

export const planLocationSchema = z.object({
  /** ISO-3166 alpha-2. Bounded to the countries the compliance packs cover. */
  country: z.string().trim().length(2).toUpperCase().default("GB"),
  region: z.string().trim().max(120).nullable().default(null),
  city: z.string().trim().max(120).nullable().default(null),
  /**
   * Stored in kilometres. The UI presents miles for a UK audience and converts
   * at the edge, so exactly one unit is ever persisted.
   */
  radiusKm: z.number().int().min(0).max(500).nullable().default(null),
  /** Resolved server-side by `validate_target_location`; never sent by the browser. */
  lat: z.number().min(-90).max(90).nullable().default(null),
  lon: z.number().min(-180).max(180).nullable().default(null),
  resolved: z.boolean().default(false),
});
export type PlanLocation = z.infer<typeof planLocationSchema>;

export const planCompanySchema = z.object({
  minEmployees: z.number().int().min(0).max(1_000_000).nullable().default(null),
  maxEmployees: z.number().int().min(0).max(1_000_000).nullable().default(null),
  /**
   * Revenue is only ever populated where a licensed provider actually supplies
   * it. The worker leaves it null rather than inventing a band — a revenue
   * filter the data cannot support would silently drop good prospects.
   */
  revenueMinMinor: z.number().int().min(0).nullable().default(null),
  revenueMaxMinor: z.number().int().min(0).nullable().default(null),
  organizationTypes: z.array(z.enum(ORGANIZATION_TYPES)).max(5).default([]),
});
export type PlanCompany = z.infer<typeof planCompanySchema>;

export const planIntentSchema = z.object({
  categories: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  freshnessDays: z.number().int().min(1).max(365).default(90),
  /** When true, a prospect with no matching signal never reaches READY. */
  required: z.boolean().default(false),
});
export type PlanIntent = z.infer<typeof planIntentSchema>;

export const planExclusionsSchema = z.object({
  /** Not optional in practice — the UI cannot switch these off, and the worker
   *  enforces them regardless of what is stored. They are recorded so the plan
   *  the customer approved is a complete description of what was run. */
  existingCustomers: z.boolean().default(true),
  existingLeads: z.boolean().default(true),
  existingProspects: z.boolean().default(true),
  optedOut: z.literal(true).default(true),
  suppressed: z.literal(true).default(true),
  nonBusinessEmail: z.boolean().default(true),
  competitors: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
  blockedDomains: z.array(z.string().trim().min(1).max(253)).max(200).default([]),
  priorBadFit: z.boolean().default(true),
});
export type PlanExclusions = z.infer<typeof planExclusionsSchema>;

export const searchPlanSchema = z.object({
  version: z.literal(1).default(1),
  industries: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  locations: z.array(planLocationSchema).max(10).default([]),
  company: planCompanySchema.default(planCompanySchema.parse({})),
  decisionMakerRoles: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  intent: planIntentSchema.default(planIntentSchema.parse({})),
  exclusions: planExclusionsSchema.default(planExclusionsSchema.parse({})),
  minimumGrade: z.enum(GRADES).default("B"),
  targetVerifiedProspects: z.number().int().min(1).max(10_000).default(100),
  reviewMode: z.enum(REVIEW_MODES).default("HUMAN_REVIEW"),
  conversionGoal: z.enum(CONVERSION_GOAL_TYPES).default("BOOK_SITE_VISIT"),
  /**
   * The customer's own ceiling for this run, in pence. It is a *request*: the
   * budget engine returns the enforceable figure, which is never higher.
   */
  maxProviderCostMinor: z.number().int().min(0).max(1_000_000).default(5_000),
});

export type SearchPlan = z.infer<typeof searchPlanSchema>;

/** The plan a brand-new session starts from. */
export function emptyPlan(): SearchPlan {
  return searchPlanSchema.parse({});
}

/**
 * Parses persisted or model-supplied JSON into a plan.
 *
 * Returns `null` rather than throwing so callers can decide between "ask the
 * customer to clarify" and "fail the run" — spending provider money on a plan
 * that did not validate is the outcome this exists to prevent.
 */
export function parsePlan(value: unknown): SearchPlan | null {
  const result = searchPlanSchema.safeParse(value);
  return result.success ? result.data : null;
}

/**
 * One repair attempt for model output (V4 §10.7).
 *
 * A model that returns a plausible plan with one bad field should not cost the
 * customer a round trip, but repair is strictly *dropping* invalid values back
 * to their defaults — it never invents a value the model did not supply, and it
 * never widens a bound.
 */
export function repairPlan(value: unknown): SearchPlan | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const base = emptyPlan();

  const merged: Record<string, unknown> = { ...base };
  for (const key of Object.keys(base) as (keyof SearchPlan)[]) {
    if (!(key in source)) continue;
    const field = (searchPlanSchema.shape as Record<string, z.ZodTypeAny>)[key];
    const parsed = field.safeParse(source[key]);
    if (parsed.success) merged[key] = parsed.data;
  }

  return parsePlan(merged);
}

/**
 * Structural validity, distinct from schema validity: a plan can parse and
 * still be unrunnable. The Start button reads this, and so does the server
 * action — the browser's verdict is a courtesy, the server's is the gate.
 */
export type PlanReadiness = {
  ready: boolean;
  /** Machine codes the UI maps to sentences, so wording lives in one place. */
  problems: PlanProblem[];
};

export type PlanProblem =
  | "NO_INDUSTRY"
  | "NO_LOCATION"
  | "UNRESOLVED_LOCATION"
  | "NO_ROLES"
  | "NO_TARGET"
  | "INVALID_EMPLOYEE_RANGE"
  | "INTENT_REQUIRED_WITHOUT_CATEGORIES";

const PROBLEM_SENTENCES: Record<PlanProblem, string> = {
  NO_INDUSTRY: "Add at least one industry or category to search.",
  NO_LOCATION: "Add at least one location to search in.",
  UNRESOLVED_LOCATION: "One of the locations could not be found. Edit it and try again.",
  NO_ROLES: "Add at least one decision-maker role to look for.",
  NO_TARGET: "Set how many verified prospects you want.",
  INVALID_EMPLOYEE_RANGE: "The company size range is the wrong way round.",
  INTENT_REQUIRED_WITHOUT_CATEGORIES:
    "Intent is set to required, but no intent signals have been chosen.",
};

export function planProblemSentence(problem: PlanProblem): string {
  return PROBLEM_SENTENCES[problem] ?? "This plan needs more detail.";
}

export function checkPlanReadiness(plan: SearchPlan): PlanReadiness {
  const problems: PlanProblem[] = [];

  if (plan.industries.length === 0) problems.push("NO_INDUSTRY");
  if (plan.locations.length === 0) problems.push("NO_LOCATION");
  else if (plan.locations.some((l) => !l.resolved)) problems.push("UNRESOLVED_LOCATION");
  if (plan.decisionMakerRoles.length === 0) problems.push("NO_ROLES");
  if (plan.targetVerifiedProspects < 1) problems.push("NO_TARGET");

  const { minEmployees, maxEmployees } = plan.company;
  if (minEmployees !== null && maxEmployees !== null && minEmployees > maxEmployees) {
    problems.push("INVALID_EMPLOYEE_RANGE");
  }

  if (plan.intent.required && plan.intent.categories.length === 0) {
    problems.push("INTENT_REQUIRED_WITHOUT_CATEGORIES");
  }

  return { ready: problems.length === 0, problems };
}

/* -------------------------------------------------------- display helpers */

const KM_PER_MILE = 1.609344;

export function kmToMiles(km: number): number {
  return Math.round(km / KM_PER_MILE);
}

export function milesToKm(miles: number): number {
  return Math.round(miles * KM_PER_MILE);
}

export function locationLabel(location: PlanLocation): string {
  const place = location.city ?? location.region ?? location.country;
  if (location.radiusKm && location.radiusKm > 0) {
    return `${place} + ${kmToMiles(location.radiusKm)} mile radius`;
  }
  return place;
}

export function companyLabel(company: PlanCompany): string {
  const parts: string[] = [];
  const { minEmployees: min, maxEmployees: max } = company;

  if (min !== null && max !== null) parts.push(`${min}–${max} employees`);
  else if (min !== null) parts.push(`${min}+ employees`);
  else if (max !== null) parts.push(`Up to ${max} employees`);

  if (company.organizationTypes.length) {
    parts.push(
      company.organizationTypes
        .map((t) => ORGANIZATION_TYPE_LABELS[t])
        .join(" / "),
    );
  }

  return parts.join("\n") || "Any size";
}

export const ORGANIZATION_TYPE_LABELS: Record<OrganizationType, string> = {
  COMMERCIAL: "Commercial",
  RESIDENTIAL: "Residential",
  PUBLIC_SECTOR: "Public sector",
  NON_PROFIT: "Non-profit",
  MIXED: "Mixed",
};

export const REVIEW_MODE_LABELS: Record<ReviewMode, string> = {
  HUMAN_REVIEW: "Human review before outreach",
  AUTO_CONTACT: "Contact automatically",
};

export const CONVERSION_GOAL_LABELS: Record<ConversionGoalType, string> = {
  BOOK_APPOINTMENT: "Book an appointment",
  BOOK_SITE_VISIT: "Site visit and quotes",
  BOOK_DEMO: "Book a demo",
  REQUEST_QUOTE: "Request a quote",
  PHONE_CALL: "Phone call",
  DIRECT_SIGNUP: "Sign up",
  DIRECT_PURCHASE: "Purchase",
  HUMAN_HANDOVER: "Hand over to the team",
};

export function intentLabel(intent: PlanIntent): string {
  if (intent.categories.length === 0) return "No intent signals";
  return intent.categories.join(", ");
}

export function intentFreshnessLabel(days: number): string {
  if (days <= 7) return "Last 7 days";
  if (days <= 30) return "Last 30 days";
  if (days <= 90) return "Last 90 days";
  return `Last ${days} days`;
}

export function exclusionsLabel(exclusions: PlanExclusions): string {
  const parts: string[] = [];
  if (exclusions.existingCustomers) parts.push("Existing customers");
  if (exclusions.competitors.length) parts.push("Competitors");
  parts.push("Opt-outs");
  if (exclusions.priorBadFit) parts.push("Prior bad-fit cohorts");
  return parts.join(", ");
}

export function gradeLabel(grade: Grade): string {
  return grade;
}

/** Pence to a UK money string. Used everywhere a budget is shown. */
export function formatMinor(minor: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

/**
 * A one-sentence description of the plan, used in run titles and session
 * names. Kept here so the worker, the rail and the run header all say the
 * same thing.
 */
export function describePlan(plan: SearchPlan): string {
  const who = plan.industries[0] ?? "businesses";
  const where = plan.locations[0]?.city ?? plan.locations[0]?.region ?? null;
  return where ? `${capitalise(who)} in ${where}` : capitalise(who);
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
