/**
 * Settings -> AI & selling (brief §74): the vocabulary, validation and pure
 * arithmetic behind the section.
 *
 * Pure: no `server-only`, no Supabase, relative `.ts` imports. The same
 * schemas validate the form in the browser, the server action, and the
 * service operation, so the three can never disagree about what is valid.
 *
 * Where each setting lives:
 *
 *   * Automation level / approval mode: `business_ai_settings.agent_mode`,
 *     through the existing `ai_settings.update` operation.
 *   * Classification and motions: `business_profiles` (0121).
 *   * Brand voice and forbidden phrases: `business_profiles.outreach_*`, the
 *     columns the offer card already reads (lib/agent/offer-card.ts). Forbidden
 *     phrases are `outreach_avoid`, one per line, which the offer card splits
 *     and lints.
 *   * Research depth, risk tolerance, qualification depth, preferred methods
 *     and example messages: one `workspace_sales_overrides` row, kind
 *     ARCHETYPE_SETTINGS, key '*' (the workspace-wide default).
 *   * Budgets: workspace rows in `ai_budgets` (0122).
 *   * LIAs: `legitimate_interest_assessments` (0123).
 */

import { z } from "zod";
import {
  SALES_METHODS,
  SALES_MOTIONS,
  SCORE_DIMENSIONS,
  type DimensionWeights,
  type SalesMethod,
  type SalesMotion,
  type ScoreDimension,
} from "../sales-library/types.ts";
import { archetypeFor, SCORING_PROFILES } from "../sales-library/archetypes.ts";
import { combineWeights } from "../sales-library/motions.ts";
import { normaliseSicCode } from "../sales-library/classify.ts";
import { splitList } from "../agent/offer-card.ts";

/* ------------------------------------------------------------ preferences */

export const RESEARCH_DEPTHS = ["LIGHT", "STANDARD", "DEEP"] as const;
export const RISK_TOLERANCES = ["CAUTIOUS", "BALANCED", "ASSERTIVE"] as const;
export const QUALIFICATION_DEPTHS = ["LIGHT", "STANDARD", "THOROUGH"] as const;

export type ResearchDepth = (typeof RESEARCH_DEPTHS)[number];
export type RiskTolerance = (typeof RISK_TOLERANCES)[number];
export type QualificationDepth = (typeof QUALIFICATION_DEPTHS)[number];

export const RESEARCH_DEPTH_COPY: Record<ResearchDepth, { label: string; description: string }> = {
  LIGHT: {
    label: "Light",
    description: "AI research (search planning, research summaries, reading company websites) runs on the cheapest AI tier allowed.",
  },
  STANDARD: { label: "Standard", description: "AI research runs on its usual AI tier." },
  DEEP: {
    label: "Deep",
    description: "AI research may use one AI tier higher, only when your AI budgets and the lead's value allow it.",
  },
};

export const RISK_TOLERANCE_COPY: Record<RiskTolerance, { label: string; description: string }> = {
  CAUTIOUS: {
    label: "Cautious",
    description: "Hand the conversation to a person whenever the assistant is not clearly confident it read the reply right.",
  },
  BALANCED: { label: "Balanced", description: "Hand over when the assistant's confidence is low, or on a sensitive topic." },
  ASSERTIVE: {
    label: "Assertive",
    description:
      "Same safety floor as Balanced: the assistant never acts below it, so low confidence and the hard rules still hand over.",
  },
};

export const QUALIFICATION_DEPTH_COPY: Record<QualificationDepth, { label: string; description: string }> = {
  LIGHT: {
    label: "Light",
    description: "Ask only the questions that unlock the next step for your sales motion, then stop. Required questions are always asked.",
  },
  STANDARD: {
    label: "Standard",
    description: "Ask the most useful questions and stop once enough is known for the next step. Required questions are always asked.",
  },
  THOROUGH: { label: "Thorough", description: "Ask every configured question that applies before the next step." },
};

export const MAX_EXAMPLES = 5;
export const MAX_EXAMPLE_CHARS = 1000;
export const MAX_FORBIDDEN_PHRASES = 40;
/** The offer card lints phrases of 3 to 60 characters; longer text is an instruction. */
export const FORBIDDEN_PHRASE_MIN = 3;
export const FORBIDDEN_PHRASE_MAX = 60;
export const BRAND_FIELD_MAX = 2000;

export type SellingPreferences = {
  researchDepth: ResearchDepth;
  riskTolerance: RiskTolerance;
  qualificationDepth: QualificationDepth;
  preferredMethods: SalesMethod[];
  goodExamples: string[];
  badExamples: string[];
};

export const DEFAULT_SELLING_PREFERENCES: SellingPreferences = {
  researchDepth: "STANDARD",
  riskTolerance: "BALANCED",
  qualificationDepth: "STANDARD",
  preferredMethods: [],
  goodExamples: [],
  badExamples: [],
};

const exampleList = z
  .array(z.string().trim().min(1, "An example cannot be empty.").max(MAX_EXAMPLE_CHARS))
  .max(MAX_EXAMPLES, `Keep it to ${MAX_EXAMPLES} examples.`);

function uniqueArray<T extends string>(values: readonly T[]) {
  return z
    .array(z.enum(values as unknown as [T, ...T[]]))
    .max(values.length)
    .refine((list) => new Set(list).size === list.length, "Each option can be chosen once.");
}

/** The ARCHETYPE_SETTINGS '*' payload, as stored. */
export const sellingPreferencesSchema = z.object({
  researchDepth: z.enum(RESEARCH_DEPTHS),
  riskTolerance: z.enum(RISK_TOLERANCES),
  qualificationDepth: z.enum(QUALIFICATION_DEPTHS),
  preferredMethods: uniqueArray(SALES_METHODS),
  goodExamples: exampleList,
  badExamples: exampleList,
});

/** Tolerates whatever the jsonb holds: unknown or malformed values fall back. */
export function parseSellingPreferences(raw: unknown): SellingPreferences {
  const base = { ...DEFAULT_SELLING_PREFERENCES };
  if (!raw || typeof raw !== "object") return base;
  const record = raw as Record<string, unknown>;
  const pick = <K extends keyof SellingPreferences>(key: K) => {
    const field = sellingPreferencesSchema.shape[key].safeParse(record[key]);
    if (field.success) (base as Record<string, unknown>)[key] = field.data;
  };
  (Object.keys(DEFAULT_SELLING_PREFERENCES) as (keyof SellingPreferences)[]).forEach(pick);
  return base;
}

/* ------------------------------------------------------------------ brand */

export type BrandVoice = {
  tone: string;
  valueProposition: string;
  keyMessages: string;
  proofPoints: string;
  callToAction: string;
  claimRestrictions: string;
  forbiddenPhrases: string[];
};

const brandText = z.string().trim().max(BRAND_FIELD_MAX, `Keep this under ${BRAND_FIELD_MAX} characters.`);

export const forbiddenPhrasesSchema = z
  .array(
    z
      .string()
      .trim()
      .min(FORBIDDEN_PHRASE_MIN, `A phrase needs at least ${FORBIDDEN_PHRASE_MIN} characters.`)
      .max(
        FORBIDDEN_PHRASE_MAX,
        `Keep each phrase under ${FORBIDDEN_PHRASE_MAX} characters. Longer guidance belongs in claim restrictions.`,
      )
      .refine((phrase) => !/[;\n\r•]/.test(phrase), "One phrase per line, without semicolons."),
  )
  .max(MAX_FORBIDDEN_PHRASES, `Keep it to ${MAX_FORBIDDEN_PHRASES} phrases.`);

export const brandVoiceSchema = z.object({
  tone: brandText,
  valueProposition: brandText,
  keyMessages: brandText,
  proofPoints: brandText,
  callToAction: brandText,
  claimRestrictions: brandText,
  forbiddenPhrases: forbiddenPhrasesSchema,
});

/** A textarea's lines as phrases: trimmed, blanks dropped, duplicates removed. */
export function phrasesFromText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const phrase = line.trim();
    const key = phrase.toLowerCase();
    if (!phrase || seen.has(key)) continue;
    seen.add(key);
    out.push(phrase);
  }
  return out;
}

/** How forbidden phrases are stored: `outreach_avoid`, one per line. */
export function avoidTextFromPhrases(phrases: string[]): string | null {
  const text = phrases.map((phrase) => phrase.trim()).filter(Boolean).join("\n");
  return text || null;
}

/** `outreach_avoid` read back as phrases, split the way the offer card splits it. */
export function phrasesFromAvoid(avoid: string | null | undefined): string[] {
  return splitList(avoid);
}

/* ---------------------------------------------------------- classification */

/**
 * A SIC 2026 code, dotted ("73.11", "62.12/1") or five-digit ("73110").
 * A refinement rather than a transform so the MCP gateway can describe it as
 * JSON Schema; the operation normalises with `normaliseSicCode` before use.
 */
export const sicCodeSchema = z
  .string()
  .trim()
  .max(12)
  .refine((value) => normaliseSicCode(value) !== null, "That is not a SIC code.");

export { normaliseSicCode };

export const archetypeKeySchema = z
  .string()
  .trim()
  .max(80)
  .refine((key) => archetypeFor(key) !== null, "That business type is not in the library.");

export const salesMotionsSchema = uniqueArray(SALES_MOTIONS);

/* ---------------------------------------------------------- the operation */

/**
 * `sales_settings.update`'s arguments. Every group is optional so each card
 * in the section saves only what it shows; a patch with nothing in it is a
 * caller mistake, not a no-op.
 */
export const salesSettingsUpdateSchema = z
  .object({
    classification: z
      .object({
        primaryIndustryCode: sicCodeSchema.nullable(),
        archetypeKey: archetypeKeySchema.nullable(),
      })
      .optional(),
    salesMotions: salesMotionsSchema.optional(),
    preferences: sellingPreferencesSchema.partial().optional(),
    brand: brandVoiceSchema.partial().optional(),
  })
  .refine(
    (value) =>
      Boolean(value.classification) ||
      Boolean(value.salesMotions) ||
      (value.preferences && Object.keys(value.preferences).length > 0) ||
      (value.brand && Object.keys(value.brand).length > 0),
    "Name at least one setting to change.",
  );

export type SalesSettingsUpdate = z.infer<typeof salesSettingsUpdateSchema>;

export type SalesSettingsView = {
  primaryIndustry: { system: string; code: string; title: string | null } | null;
  archetypeKey: string | null;
  classificationSource: string | null;
  salesMotions: SalesMotion[];
  preferences: SellingPreferences;
  brand: BrandVoice;
  libraryVersion: string | null;
};

/* ----------------------------------------------------------------- budgets */

export const EDITABLE_BUDGET_SCOPES = ["WORKSPACE_MONTH", "LEAD", "PRE_REPLY", "OPPORTUNITY"] as const;
export type EditableBudgetScope = (typeof EDITABLE_BUDGET_SCOPES)[number];

export const BUDGET_SCOPE_COPY: Record<EditableBudgetScope, { label: string; description: string }> = {
  WORKSPACE_MONTH: {
    label: "Workspace monthly ceiling",
    description: "The most AI may cost this workspace in a calendar month. Your plan's own ceiling still applies.",
  },
  LEAD: { label: "Per lead", description: "The most AI may cost on one lead over its lifetime." },
  PRE_REPLY: {
    label: "Before a reply",
    description: "The most AI may cost on a lead before it has replied. Kept low on purpose.",
  },
  OPPORTUNITY: {
    label: "Per opportunity",
    description: "The most AI may cost on a lead once it is an opportunity.",
  },
};

/** The largest amount any one budget field accepts: £100,000. */
export const MAX_BUDGET_MINOR = 10_000_000;

/**
 * "12.50" -> 1250 pence. Blank -> null (no workspace limit of its own).
 * Returns "invalid" for anything that is not a non-negative amount in pounds
 * with at most two decimal places.
 */
export function poundsToMinor(text: string): number | null | "invalid" {
  const value = text.trim().replace(/^£/, "").replace(/,/g, "");
  if (value === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return "invalid";
  const minor = Math.round(Number(value) * 100);
  return Number.isSafeInteger(minor) && minor <= MAX_BUDGET_MINOR ? minor : "invalid";
}

/** 1250 -> "£12.50". Null reads as "No limit". */
export function formatMinor(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "No limit";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);
}

/** Pence to the "12.50" a form field shows; null to blank. */
export function minorToPounds(minor: number | null | undefined): string {
  return minor === null || minor === undefined ? "" : (minor / 100).toFixed(2);
}

export type BudgetMinor = Record<EditableBudgetScope, number | null>;

export const budgetUpdateSchema = z
  .object({
    WORKSPACE_MONTH: z.number().int().min(0).max(MAX_BUDGET_MINOR).nullable(),
    LEAD: z.number().int().min(0).max(MAX_BUDGET_MINOR).nullable(),
    PRE_REPLY: z.number().int().min(0).max(MAX_BUDGET_MINOR).nullable(),
    OPPORTUNITY: z.number().int().min(0).max(MAX_BUDGET_MINOR).nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Name at least one budget to change.");

/**
 * Parses the budget form's pound strings into pence, with a message per bad
 * field. A blank field clears the workspace's own limit for that scope.
 */
export function parseBudgetForm(
  form: Record<EditableBudgetScope, string>,
): { ok: true; values: BudgetMinor } | { ok: false; errors: Partial<Record<EditableBudgetScope, string>> } {
  const values = {} as BudgetMinor;
  const errors: Partial<Record<EditableBudgetScope, string>> = {};
  for (const scope of EDITABLE_BUDGET_SCOPES) {
    const minor = poundsToMinor(form[scope] ?? "");
    if (minor === "invalid") errors[scope] = "Enter an amount in pounds, like 12.50.";
    else values[scope] = minor;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}

/**
 * Rules between the fields, checked against the platform defaults:
 *
 *   * A workspace may tighten a per-lead limit, never loosen it past the
 *     platform default -- the same principle as an agent never widening the
 *     limits it runs under. The monthly ceiling is the workspace's own extra
 *     cap and may be any amount; the plan ceiling and the platform's hard stop
 *     still apply on top of it.
 *   * Spend before a reply cannot exceed spend on the whole lead.
 */
export function budgetProblems(
  values: Partial<BudgetMinor>,
  platformDefaults: Partial<BudgetMinor>,
): Partial<Record<EditableBudgetScope, string>> {
  const problems: Partial<Record<EditableBudgetScope, string>> = {};
  for (const scope of ["LEAD", "PRE_REPLY", "OPPORTUNITY"] as const) {
    const value = values[scope];
    const ceiling = platformDefaults[scope];
    if (value !== null && value !== undefined && ceiling !== null && ceiling !== undefined && value > ceiling) {
      problems[scope] = `This can be at most the platform limit of ${formatMinor(ceiling)}.`;
    }
  }
  const effective = (scope: "LEAD" | "PRE_REPLY") =>
    values[scope] ?? platformDefaults[scope] ?? null;
  const preReply = effective("PRE_REPLY");
  const lead = effective("LEAD");
  if (!problems.PRE_REPLY && preReply !== null && lead !== null && preReply > lead) {
    problems.PRE_REPLY = "Spend before a reply cannot be more than the per-lead limit.";
  }
  return problems;
}

/* --------------------------------------------------------------------- LIA */

export const LIA_CHANNELS = ["EMAIL", "SMS", "WHATSAPP", "SOCIAL"] as const;
export const LIA_STATUSES = ["DRAFT", "ACTIVE", "WITHDRAWN"] as const;
export type LiaChannel = (typeof LIA_CHANNELS)[number];
export type LiaStatus = (typeof LIA_STATUSES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-03-31.");

/** Bounds mirror the table's check constraints (0123). */
export const liaSchema = z.object({
  id: z.uuid().optional(),
  purpose: z.string().trim().min(1, "State the purpose.").max(500),
  necessity: z.string().trim().min(1, "Explain why the processing is necessary.").max(4000),
  balancing: z.string().trim().min(1, "Record the balancing test.").max(4000),
  safeguards: z.string().trim().max(4000).optional(),
  channels: uniqueArray(LIA_CHANNELS).refine((list) => list.length > 0, "Choose at least one channel."),
  status: z.enum(LIA_STATUSES),
  nextReviewOn: isoDate.optional(),
});

export type LiaInput = z.infer<typeof liaSchema>;

/**
 * Rules that depend on today. An ACTIVE assessment is what lets a contact be
 * treated as LEGITIMATE_INTERESTS_REVIEWED, so it must name when it will next
 * be reviewed, and that date must still be ahead.
 */
export function liaProblems(input: Pick<LiaInput, "status" | "nextReviewOn">, now: Date = new Date()): string[] {
  const problems: string[] = [];
  if (input.status === "ACTIVE") {
    if (!input.nextReviewOn) {
      problems.push("An active assessment needs a next review date.");
    } else {
      const review = Date.parse(`${input.nextReviewOn}T00:00:00Z`);
      const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      if (!Number.isFinite(review)) problems.push("The next review date is not a real date.");
      else if (review <= today) problems.push("The next review date must be in the future.");
    }
  }
  return problems;
}

export type LiaRow = {
  id: string;
  purpose: string;
  necessity: string;
  balancing: string;
  safeguards: string | null;
  channels: string[];
  status: string;
  reviewedAt: string;
  nextReviewAt: string | null;
};

/** An ACTIVE assessment whose review date has passed needs attention. */
export function liaReviewOverdue(row: Pick<LiaRow, "status" | "nextReviewAt">, now: Date = new Date()): boolean {
  if (row.status !== "ACTIVE" || !row.nextReviewAt) return false;
  const review = Date.parse(row.nextReviewAt);
  return Number.isFinite(review) && review < now.getTime();
}

/* --------------------------------------------------------- scoring weights */

/**
 * Workspace scoring weights (brief §17): one `workspace_sales_overrides` row,
 * kind SCORING_WEIGHTS, key '*' — the row scoring/service.ts already reads.
 * Whole numbers per dimension summing to exactly 100. Resetting deletes the
 * row, so the library profile (archetype + motion) applies again.
 */
export const SCORE_DIMENSION_COPY: Record<ScoreDimension, string> = {
  FIT: "Fit",
  INTENT: "Intent",
  NEED: "Need",
  COMMERCIAL: "Commercial value",
  DECISION_ACCESS: "Decision access",
  TIMING: "Timing",
  ENGAGEMENT: "Engagement",
};

export const scoringWeightsSchema = z
  .object(
    Object.fromEntries(SCORE_DIMENSIONS.map((d) => [d, z.number().int().min(0).max(100)])) as Record<
      ScoreDimension,
      z.ZodNumber
    >,
  )
  .refine(
    (weights) => SCORE_DIMENSIONS.reduce((sum, d) => sum + (weights as Record<ScoreDimension, number>)[d], 0) === 100,
    "The weights must add up to 100.",
  );

/** The library default for this workspace: the archetype's profile, adjusted for the motion. */
export function defaultScoringWeights(archetypeKey: string | null, motion: SalesMotion | null): DimensionWeights {
  const archetype = archetypeFor(archetypeKey);
  const profile = archetype?.scoringProfile ?? SCORING_PROFILES.DEFAULT_B2B;
  return combineWeights(profile.weights, motion ?? archetype?.defaultMotions[0] ?? null, null);
}

/** Reads a stored override; anything malformed is null (the default applies). */
export function parseScoringWeights(raw: unknown): DimensionWeights | null {
  const parsed = scoringWeightsSchema.safeParse(raw);
  return parsed.success ? (parsed.data as DimensionWeights) : null;
}
