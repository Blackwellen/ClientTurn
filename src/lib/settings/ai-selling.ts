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
import {
  POLICY_KEY_PATTERN,
  WORKSPACE_POLICY_KEY,
  policyChangeOnlyNarrows,
  qualificationPolicySchema,
  type EscalationCondition,
  type OfferDisqualifier,
  type PolicyAutonomy,
  type Predicate,
  type QiDimensionKey,
  type QualificationPolicy,
} from "../qualification-intelligence/types.ts";

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
    description: "Ask the lead to clarify whenever the assistant is not clearly confident it read the reply right.",
  },
  BALANCED: {
    label: "Balanced",
    description:
      "Recommended. Ask the lead to clarify when a reply is unclear, and pass the conversation to a person only as a last resort.",
  },
  ASSERTIVE: {
    label: "Assertive",
    description:
      "Same safety floor as Balanced: the assistant never acts on a reply it could not read, and the hard rules still hand over.",
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

/* ----------------------------------------------------- qualification policy */

/**
 * The Qualification policy card (design §B.18 / §20): one
 * `workspace_sales_overrides` row per scope, kind QUALIFICATION_POLICY, key
 * '*' (the workspace) or 'service:<uuid>' (one offer). The payload is the
 * frozen contract's `qualificationPolicySchema`; this file adds only the
 * update envelope and the rules about who may change what.
 *
 *   * Widening is the Settings page's alone. Every other caller (Copilot, an
 *     MCP client, the API) may only narrow: `policyChangeOnlyNarrows` (CD-18).
 *   * `engineMode` (CD-9) belongs on '*' only, is shown to owners and admins
 *     only, and is changed only from the app.
 */
export const policyScopeSchema = z
  .string()
  .regex(POLICY_KEY_PATTERN, "The scope is '*' for the workspace or 'service:<id>' for one offer.");

export const POLICY_UPDATE_MODES = ["merge", "replace"] as const;

export const qualificationPolicyUpdateSchema = z.object({
  scope: policyScopeSchema,
  policy: qualificationPolicySchema,
  /**
   * merge: the keys given replace the stored ones, the rest are kept.
   * replace: the payload becomes exactly what is given (the Settings form).
   */
  mode: z.enum(POLICY_UPDATE_MODES).default("merge"),
});

export type QualificationPolicyUpdate = z.infer<typeof qualificationPolicyUpdateSchema>;

/** Reads a stored payload; anything malformed reads as the empty policy (defaults apply). */
export function parseQualificationPolicy(raw: unknown): QualificationPolicy {
  const parsed = qualificationPolicySchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

export function mergeQualificationPolicy(
  before: QualificationPolicy,
  patch: QualificationPolicy,
  mode: (typeof POLICY_UPDATE_MODES)[number],
): QualificationPolicy {
  const next = mode === "replace" ? { ...patch } : { ...before, ...patch };
  // Empty lists are stored as absent, so "nothing forbidden" has one shape.
  for (const key of Object.keys(next) as (keyof QualificationPolicy)[]) {
    const value = next[key];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) delete next[key];
  }
  return next;
}

export type PolicyCaller = "UI" | "COPILOT" | "AGENT" | "MCP" | "API" | "SYSTEM";

/**
 * Why a policy change is refused for this caller, or null. The narrow-only
 * rule itself is the contract's pure function; this adds the scope and caller
 * rules around it.
 */
export function policyChangeProblem(input: {
  scope: string;
  before: QualificationPolicy;
  after: QualificationPolicy;
  caller: PolicyCaller;
}): { code: "INVALID_INPUT" | "FORBIDDEN_SCOPE"; message: string } | null {
  const { scope, before, after, caller } = input;
  if (scope !== WORKSPACE_POLICY_KEY && after.engineMode !== undefined) {
    return { code: "INVALID_INPUT", message: "The engine mode is set for the whole workspace, not for one offer." };
  }
  if (caller !== "UI" && (before.engineMode ?? null) !== (after.engineMode ?? null)) {
    return { code: "FORBIDDEN_SCOPE", message: "The engine mode can only be changed in Settings, by an owner or admin." };
  }
  if (caller !== "UI" && !policyChangeOnlyNarrows(before, after)) {
    return {
      code: "FORBIDDEN_SCOPE",
      message:
        "From here the qualification policy can only be made stricter: forbid a question, require a dimension, add an escalation condition or a disqualifier, or lower the autonomy cap. Make any other change in Settings, AI & selling.",
    };
  }
  return null;
}

/** Owners and admins see (and set) the engine mode; everyone else sees the effect only. */
export function canSeeEngineMode(role: string): boolean {
  return role === "owner" || role === "admin";
}

/** A policy as a reader outside the admin roles may see it. */
export function policyForRole(policy: QualificationPolicy, role: string): QualificationPolicy {
  if (canSeeEngineMode(role)) return policy;
  const rest = { ...policy };
  delete rest.engineMode;
  return rest;
}

export const POLICY_AUTONOMY_COPY: Record<PolicyAutonomy, string> = {
  OFF: "Off: the assistant does not reply",
  SUGGEST_ONLY: "Suggest only: drafts for a person to send",
  AUTO_REPLY: "Auto-reply: replies on its own",
};

export const ESCALATION_CONDITION_COPY: Record<EscalationCondition, string> = {
  HIGH_VALUE: "The deal is above the human-closer value",
  LOW_CONFIDENCE: "The assistant is not confident it read the reply right",
  CONFLICTING_MATERIAL_FACT: "Two answers disagree on something that matters",
  INFERRED_DISQUALIFIER: "A disqualifier looks likely but is only inferred",
  READY_TO_BUY_NOT_ALLOWED: "The lead is ready to buy but a direct close is not allowed",
  REPEATED_DEFLECTION: "The lead keeps deflecting the same question",
};

/** The settings form's disqualifier rows, turned into the contract's shape. */
export const DISQUALIFIER_OPS = ["equals", "in", "lt", "gt"] as const;
export type DisqualifierOp = (typeof DISQUALIFIER_OPS)[number];

export const DISQUALIFIER_OP_COPY: Record<DisqualifierOp, string> = {
  equals: "is",
  in: "is one of",
  lt: "is less than",
  gt: "is more than",
};

export type DisqualifierDraft = {
  dimension: QiDimensionKey;
  op: DisqualifierOp;
  value: string;
  reason: string;
  reviewInstead: boolean;
  suppress: boolean;
};

export function disqualifierFromDraft(draft: DisqualifierDraft): OfferDisqualifier | string {
  const value = draft.value.trim();
  if (!value) return "Give the value that disqualifies.";
  let when: Predicate;
  if (draft.op === "lt" || draft.op === "gt") {
    const n = Number(value.replace(/[,£]/g, ""));
    if (!Number.isFinite(n)) return "A 'less than' or 'more than' rule needs a number.";
    when = { op: draft.op, dimension: draft.dimension, value: n };
  } else if (draft.op === "in") {
    const values = value.split(",").map((v) => v.trim()).filter(Boolean);
    if (values.length === 0) return "List the values, separated by commas.";
    when = { op: "in", dimension: draft.dimension, values };
  } else {
    when = { op: "equals", dimension: draft.dimension, value };
  }
  return {
    dimension: draft.dimension,
    when,
    reason: draft.reason.trim(),
    reviewInstead: draft.reviewInstead,
    suppress: draft.suppress,
  };
}

/** A stored disqualifier, back into the form's row (unsupported shapes are kept read-only). */
export function draftFromDisqualifier(d: OfferDisqualifier): DisqualifierDraft | null {
  const w = d.when;
  const base = { dimension: d.dimension, reason: d.reason, reviewInstead: d.reviewInstead, suppress: d.suppress };
  if (w.op === "equals") return { ...base, op: "equals", value: w.value };
  if (w.op === "in") return { ...base, op: "in", value: w.values.join(", ") };
  if (w.op === "lt" || w.op === "gt") return { ...base, op: w.op, value: String(w.value) };
  return null;
}

/** A plain-language line for one disqualifier. */
export function describeDisqualifier(d: OfferDisqualifier, label: (dimension: string) => string): string {
  const w = d.when;
  const subject = label(d.dimension);
  const clause =
    w.op === "equals"
      ? `is "${w.value}"`
      : w.op === "in"
        ? `is one of ${w.values.map((v) => `"${v}"`).join(", ")}`
        : w.op === "lt" || w.op === "lte" || w.op === "gt" || w.op === "gte"
          ? `${w.op.startsWith("l") ? "is less than" : "is more than"} ${w.value}`
          : "matches a custom rule";
  const effect = d.reviewInstead ? "send for review" : d.suppress ? "disqualify and stop contact" : "disqualify";
  return `${subject} ${clause}: ${effect}. ${d.reason}`;
}
