/**
 * The question plan for a qualification call (live-call fix, 2026-09-28). Pure.
 *
 * The owner's first real call (docs/VOICE.md §16.16) asked no qualifying
 * question at all: the brief carried ONE move from the lead's next-best-action
 * (that day an INFORM, "share one useful point"), and never the workspace's
 * configured qualification questions, which the call loader did not even
 * read. A qualification call now always carries a concrete, ordered plan:
 *
 *   1. the next-best-action's own question, when it has one;
 *   2. the workspace's configured questions that apply to the lead's service
 *      (service-specific or for every service), in the owner's order;
 *   3. only when the workspace has configured none for this lead: a default
 *      from the qualification catalogue (need or scope for the named service,
 *      timeline, budget range, decision-maker, and the postcode when the
 *      business works to service areas).
 *
 * Anything already known (answered, or a lead field) is skipped, never asked
 * again. The plan is words for the model to ask in its own voice; the
 * deterministic engine still decides what an answer means (resolved conflict
 * 1): `record_fact` only writes what the lead said.
 */

import { QUALIFICATION_CATALOGUE } from "../sales-library/qualification-dimensions.ts";
import type { QualificationDimensionKey } from "../sales-library/types.ts";

/** The most questions a plan carries (a qualification call is about four minutes). */
export const MAX_PLAN_QUESTIONS = 5;
/** With no question marked required, this many from the top of the plan are. */
export const MIN_REQUIRED_QUESTIONS = 3;
/** At most this many must be asked before a close; any more are asked if the call has time. */
export const MAX_REQUIRED_QUESTIONS = 4;

export type PlanQuestion = {
  /** What record_fact is called with: a dimension key, or `Q.<question id>` for a configured question with none. */
  key: string;
  text: string;
  required: boolean;
  source: "NBA" | "CONFIGURED" | "DEFAULT";
};

/** A configured question as the loader reads it (jobs/handlers/qualify.ts loadQuestions). */
export type ConfiguredQuestionLite = {
  id: string;
  questionText: string;
  required: boolean;
  serviceId: string | null;
  position: number;
  dimensionKey?: string | null;
  /** The question's intent key (question_intent_key), for de-duplication. */
  intentKey?: string | null;
};

export type QuestionPlanInput = {
  configured: readonly ConfiguredQuestionLite[];
  leadServiceId: string | null;
  serviceName: string | null;
  /** Question ids already answered or inferred for this lead. */
  knownQuestionIds: readonly string[];
  /** Dimension keys already known for this lead. */
  knownDimensions: readonly string[];
  /** The business works to configured service areas (postcode prefixes). */
  usesServiceAreas: boolean;
  /** The next-best-action's question, asked first when present. */
  nbaQuestion?: { dimension: string | null; text: string } | null;
};

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function asQuestion(text: string): string {
  const t = clean(text);
  return /[?]$/.test(t) ? t : `${t.replace(/[.!]+$/, "")}?`;
}

/** The default questions, from the catalogue, worded for the named service. */
export function defaultPlanQuestions(serviceName: string | null, usesServiceAreas: boolean): PlanQuestion[] {
  const service = serviceName ? clean(serviceName).toLowerCase() : null;
  const need: PlanQuestion = service
    ? { key: "PROJECT_SCOPE", text: `What does the ${service} involve, roughly?`, required: true, source: "DEFAULT" }
    : { key: "PROBLEM", text: "What are you looking for help with?", required: true, source: "DEFAULT" };
  const out: PlanQuestion[] = [
    need,
    { key: "TIMING", text: "When are you hoping to get this done?", required: true, source: "DEFAULT" },
    { key: "BUDGET", text: "Do you have a rough budget range in mind?", required: true, source: "DEFAULT" },
    { key: "AUTHORITY", text: QUALIFICATION_CATALOGUE.AUTHORITY.question, required: true, source: "DEFAULT" },
  ];
  if (usesServiceAreas) out.push({ key: "LOCATION", text: QUALIFICATION_CATALOGUE.LOCATION.question, required: true, source: "DEFAULT" });
  return out;
}

/** The need, however it is keyed: knowing any one of these means "what do you need" is answered. */
const NEED_KEYS = new Set(["PROBLEM", "PROJECT_SCOPE", "SERVICE_NEEDED", "USE_CASE", "SUITABILITY"]);

function isKnown(key: string, known: ReadonlySet<string>): boolean {
  if (known.has(key)) return true;
  return NEED_KEYS.has(key) && [...NEED_KEYS].some((k) => known.has(k) && k !== "SERVICE_NEEDED");
}

export function buildQuestionPlan(input: QuestionPlanInput): PlanQuestion[] {
  const knownDims = new Set(input.knownDimensions.map((d) => d.toUpperCase()));
  const knownIds = new Set(input.knownQuestionIds);
  const plan: PlanQuestion[] = [];
  const seen = new Set<string>();
  const push = (q: PlanQuestion) => {
    if (seen.has(q.key) || plan.length >= MAX_PLAN_QUESTIONS) return;
    seen.add(q.key);
    plan.push(q);
  };

  const nba = input.nbaQuestion;
  if (nba?.text && !(nba.dimension && knownDims.has(nba.dimension.toUpperCase()))) {
    push({ key: nba.dimension?.toUpperCase() || "PROBLEM", text: asQuestion(nba.text), required: true, source: "NBA" });
  }

  // The owner's own questions for this lead's service (or for every service), in order.
  // The lead's service's own questions first, then the workspace-wide ones
  // (service_id null: they apply to every service), each in position order.
  // One question per dimension or intent: a workspace-wide question that a
  // service question already covers is not asked twice.
  const withText = input.configured.filter((q) => clean(q.questionText).length > 0);
  const byPosition = (a: ConfiguredQuestionLite, b: ConfiguredQuestionLite) => a.position - b.position;
  const applicable = [
    ...withText.filter((q) => input.leadServiceId !== null && q.serviceId === input.leadServiceId).sort(byPosition),
    ...withText.filter((q) => q.serviceId === null).sort(byPosition),
  ];
  if (applicable.length) {
    const covered = new Set<string>();
    for (const q of applicable) {
      if (knownIds.has(q.id)) continue;
      const dim = q.dimensionKey?.toUpperCase() ?? null;
      if (dim && isKnown(dim, knownDims)) continue;
      const intent = q.intentKey ? `I:${q.intentKey}` : null;
      if ((dim && covered.has(dim)) || (intent && covered.has(intent))) continue;
      if (dim) covered.add(dim);
      if (intent) covered.add(intent);
      push({ key: dim && dim in QUALIFICATION_CATALOGUE ? dim : `Q.${q.id}`, text: asQuestion(q.questionText), required: q.required, source: "CONFIGURED" });
    }
  } else {
    for (const q of defaultPlanQuestions(input.serviceName, input.usesServiceAreas)) {
      if (isKnown(q.key, knownDims)) continue;
      push(q);
    }
  }

  return boundPlan(plan);
}

/**
 * The bounds every plan keeps, however it was built: at most five questions;
 * a floor of required ones (with nothing marked required, the top three);
 * a ceiling of four required (a qualification call is about four minutes).
 */
export function boundPlan(input: readonly PlanQuestion[]): PlanQuestion[] {
  const plan = input.slice(0, MAX_PLAN_QUESTIONS).map((q) => ({ ...q }));
  if (!plan.some((q) => q.required)) {
    plan.forEach((q, i) => {
      if (i < MIN_REQUIRED_QUESTIONS) q.required = true;
    });
  }
  let required = 0;
  for (const q of plan) {
    if (!q.required) continue;
    required += 1;
    if (required > MAX_REQUIRED_QUESTIONS) q.required = false;
  }
  return plan;
}

/** The known dimension keys from the brief's "Label: value" known list (catalogue labels). */
export function knownDimensionsFromLabels(known: readonly string[]): string[] {
  const byLabel = new Map<string, string>(
    (Object.keys(QUALIFICATION_CATALOGUE) as QualificationDimensionKey[]).map((k) => [QUALIFICATION_CATALOGUE[k].label.toLowerCase(), k]),
  );
  const out: string[] = [];
  for (const item of known) {
    const label = item.split(":")[0]?.trim().toLowerCase();
    const key = label ? byLabel.get(label) : undefined;
    if (key) out.push(key);
  }
  return out;
}
