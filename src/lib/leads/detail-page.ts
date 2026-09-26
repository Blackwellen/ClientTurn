/**
 * The lead detail page (`/app/leads/[id]`, design doc 05 Phase 5): its tab
 * vocabulary, URL state, which actions a role may take, and the won/lost
 * reason rule.
 *
 * Pure: no `server-only`, no Supabase, relative `.ts` imports, so every rule
 * here is asserted by tests/phase5b.test.ts and the same module drives both
 * the server page and the client action bar.
 *
 * Action availability is derived from the service registry rather than kept
 * as a second list: each action names the operation it runs, and a role may
 * take it exactly when the registry's minimum role says so. The UI hides or
 * disables what the server would refuse; it never decides it.
 */

import { z } from "zod";
import { serviceOperation, type ServiceOperationName } from "../services/registry.ts";
import { roleMeets, type BusinessRoleName } from "../services/types.ts";
import { FEATURE_ALLOW_LIST } from "../scoring/lead-score.ts";
import { handBackUnavailableReason } from "./resume-rule.ts";

/* -------------------------------------------------------------------- tabs */

export const LEAD_PAGE_TABS = [
  { value: "conversation", label: "Conversation" },
  { value: "qualification", label: "Qualification" },
  { value: "scores", label: "Score history" },
  { value: "attribution", label: "Attribution" },
  { value: "activity", label: "Activity & audit" },
  { value: "ai", label: "AI" },
  { value: "data-rights", label: "Data rights" },
] as const;

export type LeadPageTab = (typeof LEAD_PAGE_TABS)[number]["value"];

const TAB_VALUES = LEAD_PAGE_TABS.map((tab) => tab.value) as string[];

/** Never trust the query string: anything unrecognised is the conversation. */
export function parseLeadPageTab(value: unknown): LeadPageTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && TAB_VALUES.includes(raw)
    ? (raw as LeadPageTab)
    : "conversation";
}

/**
 * The canonical URL of a lead page and tab. The default tab has no query, so
 * the plain link and the Conversation tab are the same address.
 */
export function leadPageHref(leadId: string, tab?: LeadPageTab): string {
  const base = `/app/leads/${encodeURIComponent(leadId)}`;
  return !tab || tab === "conversation" ? base : `${base}?tab=${tab}`;
}

/** A lead id from the route. Anything that is not a uuid is simply not found. */
export function isLeadId(value: unknown): value is string {
  return z.uuid().safeParse(value).success;
}

/* ----------------------------------------------------------------- actions */

export const LEAD_PAGE_ACTIONS = [
  "message",
  "book",
  "assign",
  "change_stage",
  "close",
  "note",
  "rescore",
  "takeover",
  "resume",
  "suppress",
  "unsubscribe",
  "archive",
  "restore",
  "anonymise",
  "delete",
  "export",
] as const;

export type LeadPageAction = (typeof LEAD_PAGE_ACTIONS)[number];

/** The service operation each action runs. Its minimum role is the gate. */
export const ACTION_OPERATION: Record<LeadPageAction, ServiceOperationName> = {
  message: "message.send",
  book: "message.send",
  assign: "lead.assign",
  change_stage: "opportunity.set_stage",
  close: "opportunity.close",
  note: "lead.add_note",
  rescore: "lead.rescore",
  takeover: "lead.takeover",
  resume: "lead.resume_follow_up",
  suppress: "lead.suppress",
  unsubscribe: "lead.suppress",
  archive: "lead.archive",
  restore: "lead.restore",
  anonymise: "lead.anonymise",
  delete: "lead.delete",
  export: "lead.export",
};

export type LeadActionState = {
  status: string;
  archived: boolean;
  anonymised: boolean;
  optedOut: boolean;
  humanTakeover: boolean;
  /** The lead's latest opportunity outcome, or null when it has none. */
  opportunityOutcome: "OPEN" | "WON" | "LOST" | string | null;
};

export type ActionAvailability = { allowed: boolean; reason: string | null };

/** Actions that remain meaningful on an archived lead. */
const ARCHIVE_SAFE = new Set<LeadPageAction>(["restore", "export", "anonymise", "delete", "suppress", "unsubscribe"]);

function roleReason(role: BusinessRoleName | string, minimum: BusinessRoleName): string {
  if (minimum === "admin" || minimum === "owner") {
    return "Only owners and admins can do this.";
  }
  return role === "viewer"
    ? "Your role can view this lead but not act on it."
    : "You do not have permission to do this.";
}

function stateReason(action: LeadPageAction, state: LeadActionState): string | null {
  const closed = state.status === "WON" || state.status === "LOST";

  if (state.anonymised && action !== "export" && action !== "delete") {
    return "This lead has been anonymised.";
  }
  if (state.archived && !ARCHIVE_SAFE.has(action)) {
    return "This lead is archived. Restore it first.";
  }

  switch (action) {
    case "message":
    case "book":
      return state.optedOut ? "This lead opted out and cannot be messaged." : null;
    case "change_stage":
      if (!state.opportunityOutcome) return "This lead has no opportunity yet. It opens when the lead qualifies.";
      return state.opportunityOutcome === "OPEN"
        ? null
        : `The opportunity is already ${String(state.opportunityOutcome).toLowerCase()}.`;
    case "takeover":
      if (state.humanTakeover) return "You have already taken this conversation over.";
      return closed ? "This lead is closed. Follow-up has already stopped." : null;
    case "resume":
      // The same rule lead.resume_follow_up enforces (resume-rule.ts).
      return handBackUnavailableReason({
        status: state.status,
        optedOut: state.optedOut,
        archived: state.archived,
        humanTakeover: state.humanTakeover,
      });
    case "archive":
      return state.archived ? "This lead is already archived." : null;
    case "restore":
      return state.archived ? null : "This lead is not archived.";
    case "unsubscribe":
      return state.optedOut ? "This lead has already opted out." : null;
    default:
      return null;
  }
}

/**
 * Whether each action is available to this role on this lead, and if not,
 * why. The role check comes first: a viewer is told about their role, not
 * about the lead's state.
 */
export function leadActionAvailability(
  role: BusinessRoleName | string,
  state: LeadActionState,
): Record<LeadPageAction, ActionAvailability> {
  const out = {} as Record<LeadPageAction, ActionAvailability>;
  for (const action of LEAD_PAGE_ACTIONS) {
    const minimum = serviceOperation(ACTION_OPERATION[action])?.minimumRole ?? "owner";
    if (!roleMeets(role, minimum)) {
      out[action] = { allowed: false, reason: roleReason(role, minimum) };
      continue;
    }
    const reason = stateReason(action, state);
    out[action] = { allowed: reason === null, reason };
  }
  return out;
}

/** True when the role can take no write action on a lead at all. */
export function isReadOnlyRole(role: BusinessRoleName | string): boolean {
  return !roleMeets(role, "member");
}

/* ------------------------------------------------------------- won / lost */

/**
 * The reason a lead is closed won or lost. Required, because it feeds every
 * won/lost report and is pushed to the connected CRM (decision Q3). Mirrors
 * the bounds `opportunity.close` validates.
 */
export const closeReasonSchema = z
  .string()
  .trim()
  .min(3, "Say briefly why, in at least three characters.")
  .max(500, "Keep the reason under 500 characters.");

export const closeOutcomeSchema = z.object({
  leadId: z.uuid(),
  outcome: z.enum(["WON", "LOST"]),
  reason: closeReasonSchema,
});

export type CloseOutcomeInput = z.infer<typeof closeOutcomeSchema>;

/** The first problem with a typed reason, or null when it can be submitted. */
export function closeReasonProblem(reason: string): string | null {
  const parsed = closeReasonSchema.safeParse(reason);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Give a reason.");
}

/** Whether a status change needs a reason before it can be made. */
export function statusNeedsReason(status: string): status is "WON" | "LOST" {
  return status === "WON" || status === "LOST";
}

/* ---------------------------------------------------------- re-score key */

/**
 * The trigger event for a person-requested re-score: `manual:<userId>:<ts>`.
 * Distinct per request, so `record_lead_score`'s idempotency on (lead,
 * trigger, version) never swallows a deliberate re-score, while a retried job
 * for the same request still scores once.
 */
export function manualRescoreTrigger(userId: string | null, now: Date = new Date()): string {
  const who = (userId ?? "system").replace(/[^A-Za-z0-9_-]/g, "");
  return `manual:${who || "system"}:${now.getTime()}`;
}

/* ------------------------------------------------------------ score view */

export type EvidenceView = { label: string; value: string; source: string; confidence: number | null };

export type DimensionView = {
  dimension: string;
  label: string;
  score: number;
  max: number;
  confidence: number | null;
  evidence: EvidenceView[];
  missing: string[];
};

const DIMENSION_LABELS: Record<string, string> = {
  FIT: "Fit",
  INTENT: "Intent",
  NEED: "Need",
  COMMERCIAL: "Commercial",
  DECISION_ACCESS: "Decision access",
  TIMING: "Timing",
  ENGAGEMENT: "Engagement",
};

/** A scorer feature key in words ("booking_intent" -> "asked to book"). */
export function featureLabel(feature: string): string {
  const spec = (FEATURE_ALLOW_LIST as Record<string, { label: string }>)[feature];
  return spec?.label ?? feature.replace(/_/g, " ");
}

export function dimensionLabel(dimension: string): string {
  return DIMENSION_LABELS[dimension] ?? dimension.replace(/_/g, " ").toLowerCase();
}

function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * The jsonb `lead_scores.dimensions` as the page shows it. Tolerant: an entry
 * that is not the scorer's shape is dropped rather than rendered as zero, and
 * a value is shown as text exactly as the scorer recorded it.
 */
export function parseScoreDimensions(raw: unknown): DimensionView[] {
  if (!Array.isArray(raw)) return [];
  const out: DimensionView[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.dimension !== "string") continue;
    const score = num(row.score);
    const max = num(row.max);
    if (score === null || max === null) continue;
    const evidence = Array.isArray(row.evidence)
      ? row.evidence.flatMap((item): EvidenceView[] => {
          if (!item || typeof item !== "object") return [];
          const e = item as Record<string, unknown>;
          const label =
            typeof e.label === "string"
              ? e.label
              : typeof e.feature === "string"
                ? featureLabel(e.feature)
                : null;
          if (!label) return [];
          return [
            {
              label,
              value: e.value === undefined || e.value === null ? "" : String(e.value),
              source: typeof e.source === "string" ? e.source : "unknown",
              confidence: num(e.confidence),
            },
          ];
        })
      : [];
    const missing = Array.isArray(row.missing)
      ? row.missing.filter((m): m is string => typeof m === "string").map(featureLabel)
      : [];
    out.push({
      dimension: row.dimension,
      label: dimensionLabel(row.dimension),
      score,
      max,
      confidence: num(row.confidence),
      evidence,
      missing,
    });
  }
  return out;
}

/** The jsonb `lead_scores.missing` ([{ dimension, feature }]) as readable lines. */
export function parseScoreMissing(raw: unknown): { dimension: string; label: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as { dimension?: unknown; feature?: unknown };
    if (typeof row.feature !== "string") return [];
    return [
      {
        dimension: typeof row.dimension === "string" ? dimensionLabel(row.dimension) : "",
        label: featureLabel(row.feature),
      },
    ];
  });
}

/* --------------------------------------------------------- qualification */

const ANSWER_SOURCE_LABELS: Record<string, string> = {
  reply: "From their reply",
  form: "From the lead form",
  lead_form: "From the lead form",
  manual: "Entered by a person",
  import: "From an import",
  ai_assist: "AI-extracted, checked by rules",
  extracted: "AI-extracted",
  agent: "From the assistant's conversation",
};

/** Where an answer came from, in words. */
export function answerSourceLabel(source: string | null | undefined): string {
  if (!source) return "Source not recorded";
  return ANSWER_SOURCE_LABELS[source] ?? source.replace(/_/g, " ");
}

/** Sources that are inferences rather than something the lead or a person said. */
const INFERRED_SOURCES = new Set(["ai_assist", "extracted", "agent", "inferred", "fact"]);

export type QualificationQuestionIn = {
  id: string;
  question: string;
  required: boolean;
  active: boolean;
};

export type QualificationAnswerIn = {
  questionId: string;
  value: string | null;
  evaluation: string;
  source: string | null;
  confidence: number | null;
  answeredAt: string | null;
};

export type ExtractionIn = {
  field: string;
  value: unknown;
  confidence: number | null;
  createdAt: string;
};

export type QualificationItem = {
  key: string;
  question: string;
  value: string;
  sourceLabel: string;
  evaluation: string | null;
  confidence: number | null;
  at: string | null;
};

export type QualificationBuckets = {
  known: QualificationItem[];
  inferred: QualificationItem[];
  missing: { questionId: string; question: string; required: boolean }[];
};

function extractionText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object" && "value" in (value as object)) {
    return extractionText((value as { value: unknown }).value);
  }
  return "";
}

/**
 * Splits what is known about a lead's qualification into three honest lists:
 *
 *   * **known**: the lead said it (a reply, a form) or a person entered it;
 *   * **inferred**: AI extracted it or it was read from elsewhere, shown with
 *     its source and confidence so nobody mistakes it for a statement;
 *   * **missing**: an active question with no answer at all.
 *
 * An accepted extraction whose field names a question already listed is not
 * listed twice.
 */
export function qualificationBuckets(
  questions: QualificationQuestionIn[],
  answers: QualificationAnswerIn[],
  extractions: ExtractionIn[] = [],
): QualificationBuckets {
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  const known: QualificationItem[] = [];
  const inferred: QualificationItem[] = [];
  const missing: QualificationBuckets["missing"] = [];

  for (const question of questions) {
    const answer = byQuestion.get(question.id);
    const value = (answer?.value ?? "").trim();
    if (!answer || !value) {
      if (question.active) {
        missing.push({ questionId: question.id, question: question.question, required: question.required });
      }
      continue;
    }
    const item: QualificationItem = {
      key: question.id,
      question: question.question,
      value,
      sourceLabel: answerSourceLabel(answer.source),
      evaluation: answer.evaluation,
      confidence: answer.confidence,
      at: answer.answeredAt,
    };
    if (answer.source && INFERRED_SOURCES.has(answer.source)) inferred.push(item);
    else known.push(item);
  }

  const questionTexts = new Set(questions.map((q) => q.question.toLowerCase()));
  for (const extraction of extractions) {
    const value = extractionText(extraction.value).trim();
    if (!value) continue;
    const label = extraction.field.replace(/_/g, " ");
    if (questionTexts.has(label.toLowerCase())) continue;
    inferred.push({
      key: `extraction:${extraction.field}:${extraction.createdAt}`,
      question: label.charAt(0).toUpperCase() + label.slice(1),
      value,
      sourceLabel: "AI-extracted from the conversation",
      evaluation: null,
      confidence: extraction.confidence,
      at: extraction.createdAt,
    });
  }

  return { known, inferred, missing };
}

/* ------------------------------------------------------------ attribution */

/** First and last touch by when the person arrived, not when it was recorded. */
export function firstAndLastTouch<T extends { occurredAt: string; receivedAt: string }>(
  touches: T[],
): { first: T | null; last: T | null } {
  if (touches.length === 0) return { first: null, last: null };
  const sorted = [...touches].sort(
    (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.receivedAt.localeCompare(b.receivedAt),
  );
  return { first: sorted[0], last: sorted[sorted.length - 1] };
}
