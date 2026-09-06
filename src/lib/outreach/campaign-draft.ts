import { z } from "zod";
// Relative, not aliased: this module is unit-tested directly by the node test
// runner, which does not resolve `@/`. The same reason `outreach/templates.ts`
// keeps its imports relative.
import { fieldsForSurface, unknownTokens } from "../messaging/merge-fields.ts";

/**
 * The acquisition campaign draft (V4 section 16-17).
 *
 * Pure by design — no `server-only`, no Supabase — because the same object is
 * edited in the browser, validated by the autosave action, and re-validated by
 * the launch gate. A wizard whose client and server disagree about what
 * "valid" means is a wizard that lets someone reach step 6 and then fail.
 *
 * Nothing in this module decides anything. Grades come from the deterministic
 * scoring engine, contactability from the policy service, caps from
 * entitlements. What lives here is the *shape* of the configuration and the
 * bounds a value must fall inside before a server will look at it.
 */

/* --------------------------------------------------------------- vocabulary */

export const WIZARD_STEPS = [
  { key: "goal", label: "Goal", description: "Set your campaign objective" },
  { key: "audience", label: "Audience", description: "Define your target prospects" },
  { key: "intent", label: "Intent & Score", description: "Refine with intent signals" },
  { key: "outreach", label: "Outreach", description: "Craft your messaging" },
  { key: "budget", label: "Budget & Limits", description: "Set spend and constraints" },
  { key: "review", label: "Review & Launch", description: "Check and activate" },
] as const;

export type WizardStepKey = (typeof WIZARD_STEPS)[number]["key"];

export const WIZARD_STEP_KEYS = WIZARD_STEPS.map((s) => s.key) as WizardStepKey[];

export function stepIndex(key: string): number {
  const found = WIZARD_STEP_KEYS.indexOf(key as WizardStepKey);
  return found === -1 ? 0 : found;
}

/**
 * Conversion goals. Matches the `conversion_goals.type` check constraint, so a
 * campaign goal can always be reconciled against the workspace's own goal
 * records rather than being a parallel vocabulary.
 */
export const CONVERSION_GOALS = [
  {
    value: "BOOK_APPOINTMENT",
    label: "Book appointment",
    description:
      "Get prospects to book an appointment directly. Best when your calendar is the next step.",
    successEvents: ["APPOINTMENT_BOOKED", "CUSTOM"],
  },
  {
    value: "BOOK_SITE_VISIT",
    label: "Book a site visit",
    description:
      "Arrange an on-site survey or inspection. Suited to work that has to be quoted in person.",
    successEvents: ["SITE_VISIT_BOOKED", "APPOINTMENT_BOOKED", "CUSTOM"],
  },
  {
    value: "BOOK_DEMO",
    label: "Book a demo",
    description: "Arrange a walkthrough of what you do before any commitment.",
    successEvents: ["DEMO_BOOKED", "APPOINTMENT_BOOKED", "CUSTOM"],
  },
  {
    value: "REQUEST_QUOTE",
    label: "Request a quote",
    description:
      "Encourage prospects to request a quote for your services. Ideal for service-based businesses.",
    successEvents: ["QUOTE_REQUESTED", "SITE_VISIT_BOOKED", "CUSTOM"],
  },
  {
    value: "PHONE_CALL",
    label: "Phone call",
    description: "Get a call booked with someone who can make the decision.",
    successEvents: ["CALL_BOOKED", "APPOINTMENT_BOOKED", "CUSTOM"],
  },
  {
    value: "DIRECT_SIGNUP",
    label: "Direct signup",
    description: "Drive sign-ups to a self-serve product or trial.",
    successEvents: ["SIGNUP_COMPLETED", "CUSTOM"],
  },
  {
    value: "DIRECT_PURCHASE",
    label: "Direct purchase",
    description: "Drive a purchase without an intermediate conversation.",
    successEvents: ["PURCHASE_COMPLETED", "CUSTOM"],
  },
  {
    value: "HUMAN_HANDOVER",
    label: "Human handover",
    description: "Hand an interested prospect to a person on your team to take over.",
    successEvents: ["HUMAN_HANDOVER_CREATED", "CUSTOM"],
  },
  {
    value: "CUSTOM",
    label: "Custom",
    description: "Track your own outcome when none of the standard goals fit.",
    successEvents: ["CUSTOM"],
  },
] as const;

export type ConversionGoal = (typeof CONVERSION_GOALS)[number]["value"];

export const CONVERSION_GOAL_VALUES = CONVERSION_GOALS.map((g) => g.value) as [
  ConversionGoal,
  ...ConversionGoal[],
];

export function conversionGoalMeta(value: string) {
  return CONVERSION_GOALS.find((goal) => goal.value === value) ?? null;
}

export const SUCCESS_EVENTS = [
  { value: "APPOINTMENT_BOOKED", label: "Appointment booked" },
  { value: "SITE_VISIT_BOOKED", label: "Site visit booked" },
  { value: "DEMO_BOOKED", label: "Demo booked" },
  { value: "QUOTE_REQUESTED", label: "Quote requested" },
  { value: "CALL_BOOKED", label: "Call booked" },
  { value: "SIGNUP_COMPLETED", label: "Signup completed" },
  { value: "PURCHASE_COMPLETED", label: "Purchase completed" },
  { value: "HUMAN_HANDOVER_CREATED", label: "Handover created" },
  { value: "CUSTOM", label: "Custom event" },
] as const;

export type SuccessEvent = (typeof SUCCESS_EVENTS)[number]["value"];

export const SUCCESS_EVENT_VALUES = SUCCESS_EVENTS.map((e) => e.value) as [
  SuccessEvent,
  ...SuccessEvent[],
];

export function successEventLabel(value: string): string {
  return SUCCESS_EVENTS.find((e) => e.value === value)?.label ?? value;
}

/** The success events a goal may legitimately be measured by. */
export function successEventsFor(goal: ConversionGoal): readonly SuccessEvent[] {
  return (conversionGoalMeta(goal)?.successEvents ?? ["CUSTOM"]) as readonly SuccessEvent[];
}

export function defaultSuccessEvent(goal: ConversionGoal): SuccessEvent {
  return successEventsFor(goal)[0] ?? "CUSTOM";
}

/**
 * Whether a goal and a success event can be measured together.
 *
 * Not a hard block in the wizard — the customer is warned and may proceed with
 * CUSTOM — but the launch gate refuses a pairing outside this map, because an
 * optimiser reading an event the goal never produces would optimise for noise.
 */
export function successEventCompatible(goal: ConversionGoal, event: SuccessEvent): boolean {
  return successEventsFor(goal).includes(event);
}

export const GRADES = ["D", "C", "B", "A", "A+"] as const;
export type Grade = (typeof GRADES)[number];

/** The bands the deterministic scorer produces. Display only — `scoring.ts`
 *  owns the arithmetic and this must never diverge from it. */
export const GRADE_BANDS: { grade: Grade; min: number; max: number }[] = [
  { grade: "A+", min: 95, max: 100 },
  { grade: "A", min: 85, max: 94 },
  { grade: "B", min: 70, max: 84 },
  { grade: "C", min: 55, max: 69 },
  { grade: "D", min: 0, max: 54 },
];

export function gradeBandLabel(grade: Grade): string {
  const band = GRADE_BANDS.find((b) => b.grade === grade);
  return band ? `${band.min}-${band.max}` : "";
}

/** Grades at or above `minimum`, ordered strongest first. */
export function gradesAtOrAbove(minimum: Grade): Grade[] {
  const order: Grade[] = ["A+", "A", "B", "C", "D"];
  const cut = order.indexOf(minimum);
  return cut === -1 ? order : order.slice(0, cut + 1);
}

export const PROSPECT_SOURCES = [
  {
    value: "BOTH",
    label: "Both existing prospects and new sourcing",
    description:
      "Use your existing prospect pool and add new prospects from connected providers.",
  },
  {
    value: "EXISTING_ONLY",
    label: "Existing prospects only",
    description: "Use only prospects you already have (no new sourcing).",
  },
  {
    value: "NEW_ONLY",
    label: "New sourcing only",
    description: "Find and add new prospects from connected providers.",
  },
] as const;

export type ProspectSource = (typeof PROSPECT_SOURCES)[number]["value"];

export const INTENT_AGE_OPTIONS = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 60, label: "Last 60 days" },
  { value: 90, label: "Last 90 days" },
] as const;

/**
 * Reply classifications the campaign reacts to, mapped onto the
 * `messages.reply_classification` vocabulary from 0029 so campaign handling and
 * the unified inbox agree about what a reply was.
 */
export const REPLY_RULES = [
  {
    key: "POSITIVE",
    label: "Positive reply",
    hint: "Mark as interested and notify team",
    classifications: ["POSITIVE_INTEREST"],
    actions: ["NOTIFY_AND_FOLLOW_UP", "NOTIFY_ONLY", "CREATE_TASK"],
    defaultAction: "NOTIFY_AND_FOLLOW_UP",
  },
  {
    key: "QUESTION",
    label: "Question / neutral",
    hint: "Mark as needs review",
    classifications: ["NEUTRAL_QUESTION"],
    actions: ["CREATE_TASK", "NOTIFY_ONLY"],
    defaultAction: "CREATE_TASK",
  },
  {
    key: "NOT_INTERESTED",
    label: "Not interested",
    hint: "Move to suppression list",
    classifications: ["OBJECTION", "NOT_NOW"],
    actions: ["AUTO_SUPPRESS", "STOP_SEQUENCE"],
    defaultAction: "AUTO_SUPPRESS",
  },
  {
    key: "UNSUBSCRIBE",
    label: "Unsubscribe",
    hint: "Move to global suppression",
    classifications: ["UNSUBSCRIBE", "COMPLAINT"],
    // Deliberately a single-option list. An unsubscribe is not a preference.
    actions: ["AUTO_SUPPRESS"],
    defaultAction: "AUTO_SUPPRESS",
  },
  {
    key: "HUMAN_REQUEST",
    label: "Human request",
    hint: "Create task and notify team",
    classifications: ["HUMAN_REQUEST", "REFERRAL_TO_OTHER_PERSON", "WRONG_PERSON"],
    actions: ["CREATE_TASK", "NOTIFY_ONLY"],
    defaultAction: "CREATE_TASK",
  },
] as const;

export type ReplyRuleKey = (typeof REPLY_RULES)[number]["key"];
export type ReplyAction =
  | "NOTIFY_AND_FOLLOW_UP"
  | "NOTIFY_ONLY"
  | "CREATE_TASK"
  | "AUTO_SUPPRESS"
  | "STOP_SEQUENCE";

export const REPLY_ACTION_LABELS: Record<ReplyAction, string> = {
  NOTIFY_AND_FOLLOW_UP: "Notify and add to Follow-Up",
  NOTIFY_ONLY: "Notify team only",
  CREATE_TASK: "Create task for review",
  AUTO_SUPPRESS: "Auto-suppress",
  STOP_SEQUENCE: "Stop this sequence",
};

/** The action a classification maps to, clamped to what that rule permits. */
export function replyActionFor(
  key: ReplyRuleKey,
  configured: Record<string, string> | null | undefined,
): ReplyAction {
  const rule = REPLY_RULES.find((r) => r.key === key);
  if (!rule) return "CREATE_TASK";
  const wanted = configured?.[key];
  return (rule.actions as readonly string[]).includes(wanted ?? "")
    ? (wanted as ReplyAction)
    : (rule.defaultAction as ReplyAction);
}

export const PROMOTION_RULES = [
  {
    value: "MANUAL",
    label: "Manual promotion only",
    description: "Team reviews and promotes prospects to leads.",
  },
  {
    value: "POSITIVE_REPLY",
    label: "Auto-promote on positive reply",
    description:
      "Automatically create a lead when a prospect shows clear interest (e.g. positive reply or meeting request).",
  },
  {
    value: "BOOKED_EVENT",
    label: "Auto-promote on booked event",
    description: "Promote when a meeting or site visit is booked.",
  },
  {
    value: "CUSTOM",
    label: "Custom rules",
    description: "Set specific conditions for automatic promotion.",
  },
] as const;

export type PromotionRule = (typeof PROMOTION_RULES)[number]["value"];

export const START_MODES = [
  {
    value: "MANUAL_REVIEW",
    label: "Start after manual review",
    description:
      "Campaign will be created in READY state for review. You can activate it once you are happy.",
  },
  {
    value: "IMMEDIATE",
    label: "Start automatically",
    description: "Campaign will be activated as soon as it passes all checks.",
  },
] as const;

export type StartMode = (typeof START_MODES)[number]["value"];

/* ------------------------------------------------------------- sequencing */

/** Cold sequences are bounded on purpose. This is not a workflow builder. */
export const MIN_SEQUENCE_STEPS = 1;
export const MAX_SEQUENCE_STEPS = 5;
export const MAX_STEP_DELAY_DAYS = 30;
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 5000;
export const MIN_BODY_LENGTH = 20;

/**
 * Merge fields for cold outreach, taken from the canonical registry in
 * `lib/messaging/merge-fields`. Templates are data, never code: anything not
 * in the registry is flagged rather than resolved.
 */
export const MERGE_FIELDS = fieldsForSurface("cold-outreach").map((f) => f.key);

export type MergeField = string;

/** Merge fields used in a template that we cannot fill. */
export function unknownMergeFields(template: string): string[] {
  return unknownTokens(template, "cold-outreach");
}

/**
 * The default cold cadence (V4 §20.3): Day 0, Day 3, Day 7, Day 14 — four
 * emails. Every one defaults to EMAIL; SMS and WhatsApp are not available for
 * cold prospecting and are refused by ChannelPolicyService regardless of what
 * is configured here.
 */
export const DEFAULT_STEP_DELAYS_DAYS = [0, 3, 7, 14];

export function stepTitle(position: number): string {
  return position === 1 ? "Initial email" : `Follow up ${position - 1}`;
}

export function stepTiming(delayDays: number): string {
  if (delayDays <= 0) return "Send immediately";
  return `After ${delayDays} day${delayDays === 1 ? "" : "s"}`;
}

/* ---------------------------------------------------------------- schema */

const trimmed = (max: number) => z.string().trim().max(max);

export const goalSchema = z.object({
  campaignName: trimmed(120),
  conversionGoal: z.enum(CONVERSION_GOAL_VALUES).nullable(),
  primaryServiceId: z.uuid().nullable(),
  successEvent: z.enum(SUCCESS_EVENT_VALUES).nullable(),
});

export const audienceSchema = z.object({
  savedSearchId: z.uuid().nullable(),
  icpProfileId: z.uuid().nullable(),
  locations: z.array(trimmed(120)).max(20),
  /** Miles around the first named location. Stored so the server geocodes
   *  once rather than the browser guessing a bounding box. */
  radiusMiles: z.number().int().min(0).max(250).nullable(),
  industries: z.array(trimmed(120)).max(20),
  companySizes: z.array(trimmed(40)).max(10),
  roles: z.array(trimmed(120)).max(20),
  source: z.enum(["BOTH", "EXISTING_ONLY", "NEW_ONLY"]),
  exclusions: z.object({
    // Literals, not booleans: a stored draft claiming the global suppression
    // list is off does not parse, so no code path can honour it.
    globalSuppression: z.literal(true),
    existingCustomers: z.boolean(),
    existingLeads: z.boolean(),
    companies: z.array(trimmed(200)).max(500),
  }),
  namedCompanies: z.array(trimmed(200)).max(500),
});

export const intentScoreSchema = z.object({
  minimumGrade: z.enum(GRADES),
  intentCategoryIds: z.array(z.uuid()).max(12),
  intentRequired: z.boolean(),
  maxIntentAgeDays: z.number().int().min(1).max(365),
  reviewThreshold: z.number().int().min(0).max(100),
});

export const sequenceStepSchema = z.object({
  position: z.number().int().min(1).max(MAX_SEQUENCE_STEPS),
  delayDays: z.number().int().min(0).max(MAX_STEP_DELAY_DAYS),
  subject: trimmed(MAX_SUBJECT_LENGTH),
  body: trimmed(MAX_BODY_LENGTH),
  enabled: z.boolean(),
});

export type SequenceStep = z.infer<typeof sequenceStepSchema>;

/**
 * When a cold sequence may send (V4 §20.7).
 *
 * These are the customer's preferences, and they can only ever narrow what is
 * permitted. The dispatcher still applies the compliance pack's quiet hours,
 * the sending identity's daily cap and mailbox health on top, so a window set
 * here is a floor on restraint rather than a licence.
 */
export const SEND_WINDOWS = [
  { value: "", label: "Any time policy permits" },
  { value: "08:00-18:00", label: "8:00 AM – 6:00 PM" },
  { value: "09:00-17:00", label: "9:00 AM – 5:00 PM" },
  { value: "09:00-12:00", label: "9:00 AM – 12:00 PM" },
  { value: "13:00-17:00", label: "1:00 PM – 5:00 PM" },
] as const;

export const RECOMMENDED_SEND_WINDOW = "8:00 AM – 6:00 PM";

export const MIN_GAP_OPTIONS = [1, 2, 3, 5, 7] as const;

const sendWindowValues = SEND_WINDOWS.map((w) => w.value) as [string, ...string[]];

export const outreachSchema = z.object({
  senderIdentityId: z.uuid().nullable(),
  /** IANA zone the send window is read in. */
  timezone: z.string().trim().min(1).max(64).default("Europe/London"),
  /** "HH:MM-HH:MM", or empty for "any time policy permits". */
  sendWindow: z.enum(sendWindowValues).default(""),
  minGapDays: z.number().int().min(0).max(30).default(2),
  steps: z.array(sequenceStepSchema).min(1).max(MAX_SEQUENCE_STEPS),
  variantsEnabled: z.boolean(),
  variantsPerStep: z.number().int().min(1).max(4),
  replyRules: z.record(z.string(), z.string()),
  promotionRule: z.enum(["MANUAL", "POSITIVE_REPLY", "BOOKED_EVENT", "CUSTOM"]),
  startMode: z.enum(["MANUAL_REVIEW", "IMMEDIATE"]),
});

export const budgetSchema = z.object({
  prospectsPerRun: z.number().int().min(1).max(100000),
  dailyContacts: z.number().int().min(1).max(2000),
  monthlyContacts: z.number().int().min(1).max(200000),
  /** In pence. Never rendered as a provider unit price. */
  providerCostCeilingMinor: z.number().int().min(0).max(100_000_00),
  communicationAllowance: z.number().int().min(0).max(1_000_000),
  autoOverage: z.boolean(),
  autoOptimize: z.boolean(),
});

export const campaignDraftSchema = z.object({
  goal: goalSchema,
  audience: audienceSchema,
  intentScore: intentScoreSchema,
  outreach: outreachSchema,
  budget: budgetSchema,
});

export type CampaignDraft = z.infer<typeof campaignDraftSchema>;
export type GoalDraft = z.infer<typeof goalSchema>;
export type AudienceDraft = z.infer<typeof audienceSchema>;
export type IntentScoreDraft = z.infer<typeof intentScoreSchema>;
export type OutreachDraft = z.infer<typeof outreachSchema>;
export type BudgetDraft = z.infer<typeof budgetSchema>;

/** A blank draft. Every safety default is on; every spending default is off. */
export function emptyDraft(): CampaignDraft {
  return {
    goal: {
      campaignName: "",
      conversionGoal: null,
      primaryServiceId: null,
      successEvent: null,
    },
    audience: {
      savedSearchId: null,
      icpProfileId: null,
      locations: [],
      radiusMiles: null,
      industries: [],
      companySizes: [],
      roles: [],
      source: "BOTH",
      exclusions: {
        globalSuppression: true,
        existingCustomers: true,
        existingLeads: true,
        companies: [],
      },
      namedCompanies: [],
    },
    intentScore: {
      minimumGrade: "B",
      intentCategoryIds: [],
      intentRequired: false,
      maxIntentAgeDays: 30,
      reviewThreshold: 70,
    },
    outreach: {
      senderIdentityId: null,
      timezone: "Europe/London",
      sendWindow: "09:00-17:00",
      minGapDays: 2,
      steps: DEFAULT_STEP_DELAYS_DAYS.map((delayDays, index) => ({
        position: index + 1,
        delayDays,
        subject: "",
        body: "",
        enabled: true,
      })),
      variantsEnabled: false,
      variantsPerStep: 1,
      replyRules: Object.fromEntries(
        REPLY_RULES.map((rule) => [rule.key, rule.defaultAction]),
      ),
      promotionRule: "MANUAL",
      startMode: "MANUAL_REVIEW",
    },
    budget: {
      prospectsPerRun: 100,
      dailyContacts: 50,
      monthlyContacts: 1000,
      providerCostCeilingMinor: 0,
      communicationAllowance: 1000,
      // Both off by default, and both remain off unless the account permits.
      autoOverage: false,
      autoOptimize: false,
    },
  };
}

/**
 * Parses whatever was stored, repairing rather than rejecting.
 *
 * A draft written by an older version of the wizard must still open. Fields
 * that no longer parse fall back to the blank default for that field alone,
 * because losing an entire configuration to one stale key would be the worst
 * possible outcome for someone halfway through step 4.
 */
export function parseDraft(value: unknown): CampaignDraft {
  const blank = emptyDraft();
  const whole = campaignDraftSchema.safeParse(value);
  if (whole.success) return whole.data;

  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const section = <T>(schema: z.ZodType<T>, key: string, fallback: T): T => {
    const parsed = schema.safeParse(source[key]);
    return parsed.success ? parsed.data : fallback;
  };

  return {
    goal: section(goalSchema, "goal", blank.goal),
    audience: section(audienceSchema, "audience", blank.audience),
    intentScore: section(intentScoreSchema, "intentScore", blank.intentScore),
    outreach: section(outreachSchema, "outreach", blank.outreach),
    budget: section(budgetSchema, "budget", blank.budget),
  };
}

/* ------------------------------------------------------- step validation */

export type FieldErrors = Record<string, string>;

export function validateGoal(draft: CampaignDraft): FieldErrors {
  const errors: FieldErrors = {};
  const { goal } = draft;

  if (goal.campaignName.trim().length === 0) {
    errors.campaignName = "Give this campaign a name.";
  } else if (goal.campaignName.trim().length > 120) {
    errors.campaignName = "Keep the name under 120 characters.";
  }
  if (!goal.conversionGoal) errors.conversionGoal = "Choose what this campaign should achieve.";
  if (!goal.primaryServiceId) {
    errors.primaryServiceId = "Choose the service or product this campaign promotes.";
  }
  if (!goal.successEvent) {
    errors.successEvent = "Choose the event that counts as success.";
  } else if (
    goal.conversionGoal &&
    !successEventCompatible(goal.conversionGoal, goal.successEvent)
  ) {
    errors.successEvent = "That event cannot be produced by this goal. Pick a compatible one.";
  }

  return errors;
}

export function validateAudience(draft: CampaignDraft): FieldErrors {
  const errors: FieldErrors = {};
  const { audience } = draft;

  const hasBasis =
    Boolean(audience.savedSearchId) ||
    Boolean(audience.icpProfileId) ||
    audience.locations.length > 0 ||
    audience.industries.length > 0 ||
    audience.roles.length > 0 ||
    audience.namedCompanies.length > 0;

  if (!hasBasis) {
    errors.basis =
      "Choose a saved search or ICP, or set at least one location, industry or role.";
  }
  if (audience.radiusMiles !== null && audience.locations.length === 0) {
    errors.locations = "A radius needs a location to measure from.";
  }
  if (audience.exclusions.globalSuppression !== true) {
    errors.exclusions = "The global suppression list cannot be turned off.";
  }

  return errors;
}

export function validateIntentScore(draft: CampaignDraft): FieldErrors {
  const errors: FieldErrors = {};
  const { intentScore } = draft;

  if (!GRADES.includes(intentScore.minimumGrade)) {
    errors.minimumGrade = "Choose a minimum grade.";
  }
  if (intentScore.intentRequired && intentScore.intentCategoryIds.length === 0) {
    errors.intentCategoryIds =
      "Intent is required, so choose at least one intent category — or make intent optional.";
  }
  if (intentScore.maxIntentAgeDays < 1 || intentScore.maxIntentAgeDays > 365) {
    errors.maxIntentAgeDays = "Choose how recent an intent signal must be.";
  }
  if (intentScore.reviewThreshold < 0 || intentScore.reviewThreshold > 100) {
    errors.reviewThreshold = "The review threshold is a score between 0 and 100.";
  }

  return errors;
}

export function validateOutreach(draft: CampaignDraft): FieldErrors {
  const errors: FieldErrors = {};
  const { outreach } = draft;

  if (!outreach.senderIdentityId) {
    errors.senderIdentityId = "Choose the connected account this campaign sends from.";
  }

  const enabled = outreach.steps.filter((step) => step.enabled);
  if (enabled.length === 0) {
    errors.steps = "A campaign needs at least one email step.";
  }
  if (outreach.steps.length > MAX_SEQUENCE_STEPS) {
    errors.steps = `A cold sequence is limited to ${MAX_SEQUENCE_STEPS} steps.`;
  }

  for (const step of enabled) {
    if (step.subject.trim().length === 0) {
      errors[`step-${step.position}-subject`] = "Every email needs a subject.";
    }
    if (step.body.trim().length < MIN_BODY_LENGTH) {
      errors[`step-${step.position}-body`] = "Write the message for this step.";
    }
    const unknown = [
      ...unknownMergeFields(step.subject),
      ...unknownMergeFields(step.body),
    ];
    if (unknown.length > 0) {
      errors[`step-${step.position}-body`] = `Unknown merge field: ${unknown
        .map((field) => `{{${field}}}`)
        .join(", ")}`;
    }
  }

  // Delays must not go backwards, or the scheduler would send step 3 before
  // step 2 for anyone enrolled today.
  const ordered = [...enabled].sort((a, b) => a.position - b.position);
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i].delayDays <= ordered[i - 1].delayDays) {
      errors[`step-${ordered[i].position}-delay`] =
        "Each follow-up must be later than the step before it.";
    }
  }

  if (outreach.variantsEnabled && outreach.variantsPerStep < 2) {
    errors.variantsPerStep = "Testing variants needs at least two per step.";
  }

  return errors;
}

export type BudgetCeilings = {
  /** Prospects left in the plan period. */
  prospectsRemaining: number;
  prospectsLimit: number;
  /** The most this campaign may contact in a day, after sender health. */
  dailyContactMax: number;
  monthlyContactsRemaining: number;
  monthlyContactsLimit: number;
  /** min(plan budget remaining, admin ceiling), in pence. */
  providerCeilingMinor: number;
  communicationRemaining: number;
  communicationLimit: number;
  /** True only when the *account* has switched overage on with a cap. */
  overageAvailable: boolean;
};

export function validateBudget(draft: CampaignDraft, ceilings: BudgetCeilings): FieldErrors {
  const errors: FieldErrors = {};
  const { budget } = draft;

  if (budget.prospectsPerRun > ceilings.prospectsRemaining && !budget.autoOverage) {
    errors.prospectsPerRun = `You have ${ceilings.prospectsRemaining.toLocaleString("en-GB")} prospects remaining this month.`;
  }
  if (budget.dailyContacts > ceilings.dailyContactMax) {
    errors.dailyContacts = `Your mailbox and plan allow up to ${ceilings.dailyContactMax} contacts a day.`;
  }
  if (budget.monthlyContacts > ceilings.monthlyContactsRemaining && !budget.autoOverage) {
    errors.monthlyContacts = `You have ${ceilings.monthlyContactsRemaining.toLocaleString("en-GB")} contacts remaining this month.`;
  }
  if (budget.monthlyContacts < budget.dailyContacts) {
    errors.monthlyContacts = "The monthly cap cannot be lower than the daily cap.";
  }
  if (budget.providerCostCeilingMinor > ceilings.providerCeilingMinor) {
    errors.providerCostCeilingMinor = "That is above the ceiling your plan allows.";
  }
  if (budget.communicationAllowance > ceilings.communicationRemaining && !budget.autoOverage) {
    errors.communicationAllowance = `You have ${ceilings.communicationRemaining.toLocaleString("en-GB")} messages remaining this month.`;
  }
  // A campaign switch must never enable account-wide billing overage.
  if (budget.autoOverage && !ceilings.overageAvailable) {
    errors.autoOverage =
      "Additional usage is switched off for this account. Turn it on in Settings, Billing & Usage first.";
  }

  return errors;
}

/** Every step's errors, keyed by step. The stepper and the launch gate both
 *  read this so they can never disagree about which step is incomplete. */
export function validateAll(
  draft: CampaignDraft,
  ceilings: BudgetCeilings,
): Record<WizardStepKey, FieldErrors> {
  return {
    goal: validateGoal(draft),
    audience: validateAudience(draft),
    intent: validateIntentScore(draft),
    outreach: validateOutreach(draft),
    budget: validateBudget(draft, ceilings),
    review: {},
  };
}

/** The furthest step a draft has earned the right to reach. */
export function furthestValidStep(
  errors: Record<WizardStepKey, FieldErrors>,
): WizardStepKey {
  for (const key of WIZARD_STEP_KEYS) {
    if (Object.keys(errors[key] ?? {}).length > 0) return key;
  }
  return "review";
}

export function stepIsComplete(errors: FieldErrors): boolean {
  return Object.keys(errors).length === 0;
}

/* ------------------------------------------------------------- estimates */

/**
 * Reference estimates for the review card.
 *
 * Presented as ranges, never as a single number, because a point forecast
 * reads as a promise. The bands are the wide, honest ones the design labels
 * (replies 15-25%, qualified 5-10%, conversion 3-7%) and the card says
 * plainly that they are estimates.
 */
export const ESTIMATE_BANDS = {
  reply: [0.15, 0.25],
  qualified: [0.05, 0.1],
  conversion: [0.03, 0.07],
} as const;

export type EstimateRange = { low: number; high: number };

export type EstimatedResults = {
  prospectsToContact: number;
  replies: EstimateRange;
  qualified: EstimateRange;
  conversions: EstimateRange;
};

export function estimateResults(contacts: number): EstimatedResults {
  const band = (range: readonly [number, number]): EstimateRange => ({
    low: Math.round(contacts * range[0]),
    high: Math.round(contacts * range[1]),
  });

  return {
    prospectsToContact: contacts,
    replies: band(ESTIMATE_BANDS.reply),
    qualified: band(ESTIMATE_BANDS.qualified),
    conversions: band(ESTIMATE_BANDS.conversion),
  };
}

/* ------------------------------------------------- auto-optimise bounds */

/**
 * What bounded optimisation may touch (V4 section 18.24).
 *
 * The list is exhaustive and closed. Anything not named here is refused by
 * `optimizationAllowed` before it can reach the campaign, which is what makes
 * "the optimiser cannot raise your spend" a property of the code rather than a
 * promise in the copy.
 */
export const OPTIMIZATION_DIMENSIONS = [
  { key: "SEND_TIME", label: "Send-time windows" },
  { key: "VARIANT_ALLOCATION", label: "Variant allocation" },
  { key: "SUBJECT_VARIANT", label: "Subject line testing" },
  { key: "GRADE_THRESHOLD", label: "Grade threshold (within bounds)" },
  { key: "FOLLOW_UP_SPACING", label: "Follow-up spacing" },
  { key: "ROLE_PRIORITY", label: "Role priority" },
  { key: "CAMPAIGN_PRIORITY", label: "Campaign priority" },
  { key: "PROSPECT_ORDERING", label: "Prospect ordering" },
] as const;

export type OptimizationDimension = (typeof OPTIMIZATION_DIMENSIONS)[number]["key"];

export const OPTIMIZATION_DIMENSION_KEYS = OPTIMIZATION_DIMENSIONS.map(
  (d) => d.key,
) as OptimizationDimension[];

/** Things the optimiser is never permitted to do, whatever it proposes. */
export const OPTIMIZATION_FORBIDDEN = [
  "Cannot increase spend beyond your budget",
  "Cannot enable additional usage charges",
  "Cannot weaken suppression or contactability rules",
  "Cannot send through an unhealthy mailbox",
  "Cannot add a channel your policy does not permit",
  "Cannot promote prospects to leads on its own",
] as const;

export const optimizationConfigSchema = z.object({
  enabled: z.boolean(),
  dimensions: z.array(z.enum(OPTIMIZATION_DIMENSION_KEYS as [string, ...string[]])),
  minGradeFloor: z.enum(GRADES),
  maxGradeCeiling: z.enum(GRADES),
  sendWindowStartHour: z.number().int().min(0).max(23),
  sendWindowEndHour: z.number().int().min(1).max(24),
  followUpSpacingMinDays: z.number().int().min(1).max(30),
  followUpSpacingMaxDays: z.number().int().min(1).max(30),
  priorityFloor: z.number().int().min(1).max(500),
  priorityCeiling: z.number().int().min(1).max(500),
  /** Not configurable. Present so a stored config that claims otherwise fails
   *  to parse rather than being honoured. */
  budgetImmutable: z.literal(true),
});

export type OptimizationConfig = z.infer<typeof optimizationConfigSchema>;

export function defaultOptimizationConfig(minimumGrade: Grade): OptimizationConfig {
  return {
    enabled: false,
    dimensions: [...OPTIMIZATION_DIMENSION_KEYS],
    minGradeFloor: minimumGrade,
    maxGradeCeiling: "A+",
    sendWindowStartHour: 9,
    sendWindowEndHour: 17,
    followUpSpacingMinDays: 2,
    followUpSpacingMaxDays: 10,
    priorityFloor: 25,
    priorityCeiling: 200,
    budgetImmutable: true,
  };
}

export type OptimizationProposal = {
  dimension: string;
  before: unknown;
  after: unknown;
};

/**
 * Whether a proposed optimisation is inside the configured bounds.
 *
 * Returns a reason when it is not, so the refusal is explainable in the
 * activity log rather than a silent no-op.
 */
export function optimizationAllowed(
  config: OptimizationConfig,
  proposal: OptimizationProposal,
): { allowed: boolean; reason?: string } {
  if (!config.enabled) return { allowed: false, reason: "Auto optimise is off." };

  if (!(OPTIMIZATION_DIMENSION_KEYS as string[]).includes(proposal.dimension)) {
    return { allowed: false, reason: `${proposal.dimension} is not an optimisable dimension.` };
  }
  if (!config.dimensions.includes(proposal.dimension)) {
    return { allowed: false, reason: `${proposal.dimension} is not enabled for this campaign.` };
  }

  if (proposal.dimension === "GRADE_THRESHOLD") {
    const after = proposal.after;
    if (typeof after !== "string" || !GRADES.includes(after as Grade)) {
      return { allowed: false, reason: "Not a grade." };
    }
    const order: Grade[] = ["D", "C", "B", "A", "A+"];
    const at = order.indexOf(after as Grade);
    if (at < order.indexOf(config.minGradeFloor) || at > order.indexOf(config.maxGradeCeiling)) {
      return { allowed: false, reason: "Outside the permitted grade bounds." };
    }
  }

  if (proposal.dimension === "SEND_TIME") {
    const after = proposal.after as { startHour?: number; endHour?: number } | null;
    const start = after?.startHour;
    const end = after?.endHour;
    if (typeof start !== "number" || typeof end !== "number" || start >= end) {
      return { allowed: false, reason: "Not a valid send window." };
    }
    if (start < config.sendWindowStartHour || end > config.sendWindowEndHour) {
      return { allowed: false, reason: "Outside the permitted send window." };
    }
  }

  if (proposal.dimension === "FOLLOW_UP_SPACING") {
    const days = proposal.after;
    if (typeof days !== "number") return { allowed: false, reason: "Not a spacing." };
    if (days < config.followUpSpacingMinDays || days > config.followUpSpacingMaxDays) {
      return { allowed: false, reason: "Outside the permitted follow-up spacing." };
    }
  }

  if (proposal.dimension === "CAMPAIGN_PRIORITY") {
    const priority = proposal.after;
    if (typeof priority !== "number") return { allowed: false, reason: "Not a priority." };
    if (priority < config.priorityFloor || priority > config.priorityCeiling) {
      return { allowed: false, reason: "Outside the permitted priority band." };
    }
  }

  if (proposal.dimension === "VARIANT_ALLOCATION" || proposal.dimension === "SUBJECT_VARIANT") {
    const allocation = proposal.after;
    if (typeof allocation !== "number" || allocation < 0 || allocation > 100) {
      return { allowed: false, reason: "Allocation must be a percentage." };
    }
  }

  return { allowed: true };
}

/* ------------------------------------------------------------ formatting */

export function formatMoneyMinor(minor: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-GB");
}
