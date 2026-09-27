import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import {
  evaluateQualification,
  type EngineInput,
  type EngineOutput,
  type Question,
  type Rule,
} from "@/lib/qualification/engine";
import { enqueueCrmPushes } from "@/lib/integrations/providers/crm-trigger";
import { advanceLeadOpportunitySafely } from "@/lib/opportunities/service";
import { emitAutomationEvent } from "@/lib/automation/events";
import { createHash } from "node:crypto";
import { runTask } from "@/lib/ai/model-router";
import { wrapUntrustedContent } from "@/lib/ai/safety";
import type { QualificationExtraction } from "@/lib/ai/schemas";
import type { BusinessContext, LeadRecord } from "./shared";
import { assertWrite, logWriteError } from "@/lib/supabase/write-result";
import {
  inferDimension,
  matchAnswer,
  selectNextQuestion,
  type KnownQuestion,
  type LeadFieldValues,
  type MemoryFact,
  type NextQuestionResult,
  type QuestionRecord,
} from "@/lib/qualification/next-question";
import { SALES_MOTIONS, type SalesMotion } from "@/lib/sales-library/types";
import type { ConversationStage } from "@/lib/sales-library/method-router";
import { deriveConversationStage } from "@/lib/qualification-intelligence/goals";
import { formAnswersToFacts, type FormAnswerFact } from "@/lib/qualification-intelligence/interpret";
import { parseSalesOverrides, type ParsedSalesOverrides } from "@/lib/qualification-intelligence/offer-profile";
import type { ConfiguredQuestion } from "@/lib/qualification-intelligence/question-intents";
import {
  ALWAYS_MATERIAL_DIMENSIONS,
  QI_DIMENSION_KEYS,
  customIntentKey,
  type FactDimension,
  type FactSource,
  type FactState,
  type QualificationFact,
} from "@/lib/qualification-intelligence/types";
import { loadSellingPreferencesOrDefault } from "@/lib/settings/ai-selling-queries";
import type { SellingPreferences } from "@/lib/settings/ai-selling";

// Moved to lib/qualification/next-question.ts (pure, adaptive). Re-exported
// here so every existing import of these names keeps working.
export {
  matchAnswer,
  nextQuestion,
  questionPrompt,
  type QuestionRecord,
} from "@/lib/qualification/next-question";

export type SalesProfile = {
  archetypeKey: string | null;
  /** The workspace's primary motion; null when none is configured. */
  motion: SalesMotion | null;
  /**
   * Settings -> AI & selling (ARCHETYPE_SETTINGS '*'). Absent = defaults; a
   * failed read also falls back to defaults (logged).
   */
  preferences?: SellingPreferences;
};

/** First valid motion in the stored list, or null. */
export function primaryMotion(stored: unknown): SalesMotion | null {
  if (!Array.isArray(stored)) return null;
  return (
    stored.find((value): value is SalesMotion =>
      (SALES_MOTIONS as readonly string[]).includes(String(value)),
    ) ?? null
  );
}

/**
 * The workspace's archetype and primary motion (migration 0121). Missing
 * columns, a missing row or a failed read all mean "not classified yet", which
 * every consumer treats as null and falls back to defaults.
 */
export async function loadSalesProfile(businessId: string): Promise<SalesProfile> {
  const admin = createAdminClient();
  // archetype_key / sales_motions post-date the generated types.
  const [result, preferences] = await Promise.all([
    admin
      .from("business_profiles")
      .select("archetype_key, sales_motions" as "business_id")
      .eq("business_id", businessId)
      .maybeSingle() as unknown as Promise<{
      data: { archetype_key: string | null; sales_motions: unknown } | null;
      error: { message: string; code?: string | null } | null;
    }>,
    loadSellingPreferencesOrDefault(businessId),
  ]);
  logWriteError(result, "business_profiles.sales_profile read", { businessId });
  return {
    archetypeKey: result.data?.archetype_key ?? null,
    motion: primaryMotion(result.data?.sales_motions),
    preferences,
  };
}

/** The override kinds qualification reads (defect F9: two of them had no reader). */
const QUALIFICATION_OVERRIDE_KINDS = ["QUALIFICATION_QUESTION", "DISQUALIFIER", "QUALIFICATION_POLICY"] as const;

/** Where a stored fact may feed the legacy selector (and so the engine): never the AI assist. */
const SELECTOR_FACT_SOURCES: readonly FactSource[] = ["ANSWER", "FORM", "LEAD_FIELD", "ENRICHMENT", "REPLY", "CRM", "MANUAL"];

export type QualificationContext = {
  /** Form answers from lead_touches, newest touch first (defect F3). */
  formFacts: FormAnswerFact[];
  /** Live lead_qualification_facts rows (not superseded). */
  storedFacts: QualificationFact[];
  /** workspace_sales_overrides of the three qualification kinds, validated (F9). */
  overrides: ParsedSalesOverrides;
  /** Outbound asks per question intent key (messages.features.questionIntent). */
  askCounts: Record<string, number>;
};

const EMPTY_OVERRIDES: ParsedSalesOverrides = {
  intentOverrides: {},
  disqualifiers: [],
  workspacePolicy: null,
  servicePolicies: {},
  rejected: [],
};

function toQualificationFact(row: {
  id: string;
  lead_id: string;
  service_id: string | null;
  dimension: string;
  value: string;
  value_normalised: string | null;
  state: string;
  source: string;
  source_ref: string | null;
  question_id: string | null;
  question_intent_key: string | null;
  confidence: number;
  observed_at: string;
  valid_until: string | null;
  verified_at: string | null;
  set_by: string | null;
  superseded_at: string | null;
}): QualificationFact {
  return {
    id: row.id,
    leadId: row.lead_id,
    serviceId: row.service_id,
    dimension: row.dimension as FactDimension,
    value: row.value,
    valueNormalised: row.value_normalised,
    state: row.state as FactState,
    source: row.source as FactSource,
    sourceRef: row.source_ref,
    questionId: row.question_id,
    questionIntentKey: row.question_intent_key,
    confidence: Number(row.confidence),
    observedAt: row.observed_at,
    validUntil: row.valid_until,
    verifiedAt: row.verified_at,
    setBy: row.set_by,
    supersededAt: row.superseded_at,
  };
}

/**
 * Everything qualification knows about a lead beyond its answer rows: form
 * answers (F3), stored dimension facts (0134), the workspace's qualification
 * overrides (F9) and how often each question was asked. Every read degrades
 * to "nothing known" on failure (logged): a missing context can only make the
 * agent ask more, never decide more.
 */
export async function loadQualificationContext(input: {
  businessId: string;
  leadId: string;
  questions: readonly (QuestionRecord & { dimensionKey?: string | null })[];
}): Promise<QualificationContext> {
  const admin = createAdminClient();
  const [touches, facts, overrides, outbound] = await Promise.all([
    admin
      .from("lead_touches")
      .select("answers, occurred_at")
      .eq("business_id", input.businessId)
      .eq("lead_id", input.leadId)
      .order("occurred_at", { ascending: false })
      .limit(10),
    admin
      .from("lead_qualification_facts")
      .select(
        "id, lead_id, service_id, dimension, value, value_normalised, state, source, source_ref, question_id, question_intent_key, confidence, observed_at, valid_until, verified_at, set_by, superseded_at",
      )
      .eq("business_id", input.businessId)
      .eq("lead_id", input.leadId)
      .is("superseded_at", null)
      .limit(200),
    admin
      .from("workspace_sales_overrides")
      .select("kind, key, payload")
      .eq("business_id", input.businessId)
      .in("kind", [...QUALIFICATION_OVERRIDE_KINDS]),
    admin
      .from("messages")
      .select("features")
      .eq("business_id", input.businessId)
      .eq("lead_id", input.leadId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  logWriteError(touches, "lead_touches.answers read", { businessId: input.businessId, leadId: input.leadId });
  logWriteError(facts, "lead_qualification_facts read", { businessId: input.businessId, leadId: input.leadId });
  logWriteError(overrides, "workspace_sales_overrides read", { businessId: input.businessId });
  logWriteError(outbound, "messages.features read", { businessId: input.businessId, leadId: input.leadId });

  const inferLabel = (label: string) =>
    inferDimension({ id: "form-label", questionText: label, position: 0, responseType: "text", required: false, serviceId: null, options: [] });
  const formFacts = formAnswersToFacts(
    (touches.data ?? []).map((row) => ({ answers: (row.answers ?? {}) as Record<string, unknown> })),
    input.questions,
    inferLabel,
  );

  const askCounts: Record<string, number> = {};
  for (const row of outbound.data ?? []) {
    const features = row.features as { questionIntent?: unknown } | null;
    const key = typeof features?.questionIntent === "string" ? features.questionIntent : null;
    if (key) askCounts[key] = (askCounts[key] ?? 0) + 1;
  }

  const parsed = overrides.data ? parseSalesOverrides(overrides.data) : EMPTY_OVERRIDES;
  if (parsed.rejected.length > 0) {
    console.warn("[qualify] invalid qualification overrides ignored", { businessId: input.businessId, rejected: parsed.rejected });
  }

  return {
    formFacts,
    storedFacts: (facts.data ?? []).map(toQualificationFact),
    overrides: parsed,
    askCounts,
  };
}

/**
 * The facts the legacy selector may treat as known. Never AI_ASSIST (the
 * engine verdict never reads AI facts, CLAUDE.md resolved conflict 1), never
 * an expired fact, and never an INFERRED material one (BUDGET, AUTHORITY):
 * those must be verified by asking before anything gates on them (08 §B.12).
 */
export function selectorFacts(context: QualificationContext, now: Date = new Date()): MemoryFact[] {
  const facts: MemoryFact[] = context.formFacts.map((fact) => ({
    dimension: fact.dimension,
    questionId: fact.questionId,
    value: fact.value,
    confidence: fact.confidence,
    source: "FORM",
  }));
  for (const fact of context.storedFacts) {
    if (fact.supersededAt) continue;
    if (fact.state !== "CONFIRMED" && fact.state !== "INFERRED") continue;
    if (!SELECTOR_FACT_SOURCES.includes(fact.source)) continue;
    if (fact.validUntil && Date.parse(fact.validUntil) <= now.getTime()) continue;
    const dimension = (QI_DIMENSION_KEYS as readonly string[]).includes(fact.dimension) ? (fact.dimension as MemoryFact["dimension"]) : null;
    if (fact.state === "INFERRED" && dimension && (ALWAYS_MATERIAL_DIMENSIONS as readonly string[]).includes(dimension)) continue;
    facts.push({
      dimension,
      questionId: fact.questionId,
      value: fact.value,
      confidence: fact.state === "CONFIRMED" ? 1 : fact.confidence,
      source: fact.source,
    });
  }
  return facts;
}

/**
 * Applies the QUALIFICATION_QUESTION overrides to configured questions: FORBID
 * drops an optional question (a required one stays, because the engine cannot
 * reach a verdict without it), REQUIRE makes it required for selection, and
 * REWORD replaces its wording. An override scoped to other services is ignored.
 */
export function applyQuestionOverrides<Q extends QuestionRecord & { intentKey?: string | null }>(
  questions: readonly Q[],
  overrides: ParsedSalesOverrides,
  serviceId: string | null,
): Q[] {
  const out: Q[] = [];
  for (const question of questions) {
    const override = overrides.intentOverrides[question.intentKey ?? ""] ?? overrides.intentOverrides[customIntentKey(question.id)];
    const applies = override && (!override.serviceIds || (serviceId !== null && override.serviceIds.includes(serviceId)));
    if (!applies) {
      out.push(question);
      continue;
    }
    if (override.action === "FORBID" && !question.required) continue;
    if (override.action === "REQUIRE") {
      out.push({ ...question, required: true, ...(override.renderings ? { questionText: override.renderings.default } : {}) });
      continue;
    }
    if (override.action === "REWORD" && override.renderings) {
      out.push({ ...question, questionText: override.renderings.default });
      continue;
    }
    out.push(question);
  }
  return out;
}

/**
 * Loads everything the adaptive selector needs for one lead and runs it.
 * Known before asking: the answer rows; lead fields (postcode -> LOCATION,
 * the chosen service -> SERVICE_NEEDED); ad-form and web-form answers from
 * lead_touches (F3); stored dimension facts (0134, never AI_ASSIST). The
 * question -> dimension map comes from qualification_questions.dimension_key,
 * the workspace's question overrides apply (F9), the stage is the real one
 * (F2), and a question asked twice without an answer is not asked again.
 */
export async function loadAdaptiveSelection(input: {
  businessId: string;
  lead: LeadRecord;
  questions: QuestionRecord[];
  salesProfile?: SalesProfile;
  serviceName?: string | null;
  currentQuestionId?: string | null;
  /** The agent's stage for this turn (strategy.ts stageForMode); derived from the lead otherwise. */
  stage?: ConversationStage | null;
  /** Pre-loaded context (the agent loads it once per turn). */
  context?: QualificationContext;
}): Promise<NextQuestionResult> {
  const admin = createAdminClient();
  const [answers, salesProfile, serviceName, context] = await Promise.all([
    admin
      .from("qualification_answers")
      .select("question_id, answer_value")
      .eq("business_id", input.businessId)
      .eq("lead_id", input.lead.id),
    input.salesProfile ? Promise.resolve(input.salesProfile) : loadSalesProfile(input.businessId),
    input.serviceName !== undefined
      ? Promise.resolve(input.serviceName)
      : input.lead.service_id
        ? admin
            .from("services")
            .select("name")
            .eq("business_id", input.businessId)
            .eq("id", input.lead.service_id)
            .maybeSingle()
            .then((row) => row.data?.name ?? null)
        : Promise.resolve(null),
    input.context
      ? Promise.resolve(input.context)
      : loadQualificationContext({ businessId: input.businessId, leadId: input.lead.id, questions: input.questions }),
  ]);
  if (answers.error) throw new Error(`qualification_answers read failed: ${answers.error.message}`);

  const leadFields: LeadFieldValues = {
    LOCATION: input.lead.postcode,
    SERVICE_NEEDED: serviceName,
  };

  const answerRows = (answers.data ?? []).map((row) => ({
    questionId: row.question_id,
    answerValue: row.answer_value,
  }));
  const answered = new Set(answerRows.filter((row) => row.answerValue !== null && row.answerValue !== "").map((row) => row.questionId));

  const questions = applyQuestionOverrides(
    input.questions as (QuestionRecord & { dimensionKey?: string | null; intentKey?: string | null })[],
    context.overrides,
    input.lead.service_id,
  );
  const dimensionMap: Record<string, NonNullable<MemoryFact["dimension"]>> = {};
  for (const question of questions) {
    if (question.dimensionKey && (QI_DIMENSION_KEYS as readonly string[]).includes(question.dimensionKey)) {
      dimensionMap[question.id] = question.dimensionKey as NonNullable<MemoryFact["dimension"]>;
    }
  }
  const askHistory = questions.map((question) => ({
    questionId: question.id,
    asked: (context.askCounts[customIntentKey(question.id)] ?? 0) + (question.intentKey ? (context.askCounts[question.intentKey] ?? 0) : 0),
    answered: answered.has(question.id),
  }));

  return selectNextQuestion({
    questions,
    answers: answerRows,
    serviceId: input.lead.service_id,
    leadFields,
    facts: selectorFacts(context),
    dimensionMap,
    motion: salesProfile.motion,
    archetypeKey: salesProfile.archetypeKey,
    stage: deriveConversationStage({
      explicit: input.stage ?? null,
      leadStatus: input.lead.status,
      firstRepliedAt: input.lead.first_replied_at,
      answeredCount: answered.size,
    }),
    currentQuestionId: input.currentQuestionId ?? null,
    depth: salesProfile.preferences?.qualificationDepth ?? null,
    askHistory,
    leadHasReplied: Boolean(input.lead.first_replied_at),
  });
}

/** qualification_answers.source for an inferred answer, by where the value came from. */
export function inferredAnswerSource(entry: KnownQuestion): "form" | "manual" | "reply" | "ai_assist" {
  if (entry.source === "LEAD_FIELD") return "form";
  switch (entry.factSource) {
    case "FORM":
    case "LEAD_FIELD":
      return "form";
    case "MANUAL":
      return "manual";
    case "ANSWER":
    case "REPLY":
      return "reply";
    default:
      return "ai_assist";
  }
}

/**
 * Writes inferred answers so the engine can judge them like any other answer.
 * Never overwrites a row that exists (a real reply always wins), and the
 * provenance says where each value came from: `form` for a lead field, and
 * `ai_assist` (with its confidence) for a remembered fact.
 */
export async function recordInferredAnswers(
  businessId: string,
  leadId: string,
  inferred: KnownQuestion[],
): Promise<number> {
  if (inferred.length === 0) return 0;
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const rows = inferred.map((entry) => {
    const source = inferredAnswerSource(entry);
    const origin =
      entry.source === "LEAD_FIELD"
        ? "the lead's details"
        : source === "form"
          ? "the lead's form answers"
          : source === "manual"
            ? "a fact set by the team"
            : source === "reply"
              ? "something the lead said"
              : "a remembered fact";
    return {
      business_id: businessId,
      lead_id: leadId,
      question_id: entry.questionId,
      answer_value: entry.value,
      answer_text: `Inferred from ${origin}: ${entry.value}`,
      source,
      confidence: entry.confidence,
      answered_at: now,
    };
  });
  assertWrite(
    await admin
      .from("qualification_answers")
      .upsert(rows, { onConflict: "lead_id,question_id", ignoreDuplicates: true }),
    "qualification: record inferred answers",
    { businessId, leadId, count: rows.length },
  );
  return rows.length;
}

/**
 * The workspace's active configured questions. Each carries its explicit
 * library dimension and question intent (0134 dimension_key /
 * question_intent_key) when set, so nothing downstream has to guess them.
 */
export async function loadQuestions(
  businessId: string,
): Promise<ConfiguredQuestion[]> {
  const admin = createAdminClient();

  const [questions, options] = await Promise.all([
    admin
      .from("qualification_questions")
      .select(
        "id, question_text, response_type, required, service_id, position, dimension_key, question_intent_key",
      )
      .eq("business_id", businessId)
      .eq("active", true)
      .order("position", { ascending: true }),
    admin
      .from("qualification_options")
      .select("question_id, label, value, position")
      .eq("business_id", businessId)
      .order("position", { ascending: true }),
  ]);

  return (questions.data ?? []).map((row) => ({
    id: row.id,
    questionText: row.question_text,
    responseType: row.response_type as Question["responseType"],
    required: row.required,
    serviceId: row.service_id,
    position: row.position,
    options: (options.data ?? [])
      .filter((option) => option.question_id === row.id)
      .map((option) => ({ value: option.value, label: option.label })),
    dimensionKey: row.dimension_key ?? null,
    intentKey: row.question_intent_key ?? null,
  }));
}

export async function buildEngineInput(
  business: BusinessContext,
  lead: LeadRecord,
): Promise<{ input: EngineInput; questions: QuestionRecord[] }> {
  const admin = createAdminClient();

  const [questions, rules, answers, service] = await Promise.all([
    loadQuestions(business.businessId),
    admin
      .from("qualification_rules")
      .select(
        "id, question_id, rule_type, operator, comparison_value, result, priority",
      )
      .eq("business_id", business.businessId)
      .eq("active", true)
      .order("priority", { ascending: true }),
    admin
      .from("qualification_answers")
      .select("question_id, answer_value, answer_text")
      .eq("business_id", business.businessId)
      .eq("lead_id", lead.id),
    lead.service_id
      ? admin
          .from("services")
          .select("id, active")
          .eq("id", lead.service_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const input: EngineInput = {
    questions: questions.map((question) => ({
      id: question.id,
      responseType: question.responseType,
      required: question.required,
      serviceId: question.serviceId,
      options: question.options.map((option) => ({ value: option.value })),
    })),
    answers: (answers.data ?? []).map((row) => ({
      questionId: row.question_id,
      answerValue: row.answer_value,
      answerText: row.answer_text,
    })),
    rules: (rules.data ?? []).map((row) => ({
      id: row.id,
      questionId: row.question_id,
      ruleType: row.rule_type as Rule["ruleType"],
      operator: row.operator as Rule["operator"],
      comparisonValue: row.comparison_value,
      result: row.result as Rule["result"],
      priority: row.priority,
    })),
    serviceId: lead.service_id,
    serviceIsActive: service.data ? service.data.active : false,
    postcode: lead.postcode,
    allowedPostcodePrefixes: business.allowedPostcodePrefixes,
    blockedPostcodePrefixes: business.blockedPostcodePrefixes,
  };

  return { input, questions };
}

/**
 * Re-evaluates the deterministic engine against current answers and writes the
 * result back. The engine is the system of record for qualification.
 */
export async function applyQualification(
  business: BusinessContext,
  lead: LeadRecord,
): Promise<{ output: EngineOutput; questions: QuestionRecord[] }> {
  const admin = createAdminClient();
  const { input, questions } = await buildEngineInput(business, lead);
  const output = evaluateQualification(input);

  const now = new Date().toISOString();
  const status =
    output.result === "QUALIFIED" && lead.status !== "BOOKED"
      ? "QUALIFIED"
      : lead.status;

  const leadWrite = await admin
    .from("leads")
    .update({
      qualification_state: output.result,
      qualification_reason: output.reasons as never,
      qualified_at: output.result === "QUALIFIED" ? now : null,
      status,
    })
    .eq("id", lead.id)
    .eq("business_id", business.businessId);
  // The qualification verdict drives routing, CRM push and follow-up; a lost
  // write would leave the lead on its old verdict while the rest proceeds.
  assertWrite(leadWrite, "leads.qualification", { businessId: business.businessId, leadId: lead.id });

  for (const [questionId, evaluation] of Object.entries(
    output.answerEvaluations,
  )) {
    const evaluationWrite = await admin
      .from("qualification_answers")
      .update({ evaluation })
      .eq("business_id", business.businessId)
      .eq("lead_id", lead.id)
      .eq("question_id", questionId);
    logWriteError(evaluationWrite, "qualification_answers.evaluation", {
      businessId: business.businessId,
      leadId: lead.id,
      questionId,
    });
  }

  if (output.result === "QUALIFIED") {
    // Qualification opens (or advances) the lead's opportunity (decision Q3).
    // Forward only, so a re-qualification after a booking changes nothing.
    await advanceLeadOpportunitySafely({
      businessId: business.businessId,
      leadId: lead.id,
      event: "QUALIFIED",
    });
    await enqueueCrmPushes(business.businessId, lead.id);
  }

  if (output.result === "QUALIFIED" || output.result === "NOT_QUALIFIED" || output.result === "REVIEW") {
    await emitAutomationEvent({
      businessId: business.businessId,
      leadId: lead.id,
      eventType:
        output.result === "QUALIFIED"
          ? "qualification.qualified"
          : output.result === "NOT_QUALIFIED"
            ? "qualification.not_qualified"
            : "qualification.review",
    });
  }

  // Told to the customer's own systems as well as to ours. The event carries
  // the outcome and the reasons, so a CRM can act on the decision without
  // having to call back and ask what it was.
  await emitWebhookEvent({
    businessId: business.businessId,
    type: "lead.qualified",
    data: {
      lead_id: lead.id,
      result: output.result,
      status,
      reasons: output.reasons,
      qualified_at: output.result === "QUALIFIED" ? now : null,
    },
  });

  return { output, questions };
}

/**
 * Nano-tier fallback for a reply matchAnswer() could not parse. The model
 * only proposes a normalized value, which is re-validated through
 * matchAnswer() itself — so an AI candidate can never produce a value
 * outside the question's configured options/format, and a low-confidence
 * or schema-invalid response always falls through to REVIEW untouched.
 */
export async function matchAnswerWithAi(
  question: QuestionRecord,
  reply: string,
  ctx: {
    businessId: string;
    leadId: string;
    conversationId: string | null;
    /** The inbound message being interpreted; the most stable billing key. */
    messageId?: string | null;
  },
): Promise<{ value: string | null; text: string; confidence: number } | null> {
  const context =
    `Question (${question.responseType}): ${question.questionText}\n` +
    (question.options.length
      ? `Options: ${question.options.map((option) => option.label).join(", ")}\n`
      : "") +
    `Reply: ${wrapUntrustedContent(reply)}`;

  const result = await runTask<QualificationExtraction>({
    taskType: "answer_extraction",
    businessId: ctx.businessId,
    leadId: ctx.leadId,
    // The lead has replied: answer extraction happens mid-conversation.
    stage: "ENGAGED",
    conversationId: ctx.conversationId,
    context,
    maxOutputTokens: 120,
    // One extraction per inbound message per question, so a retried inbound
    // job is charged once. Without the message id, the reply text stands in
    // for it: the same reply to the same question is the same call.
    correlationId: `answer:${ctx.leadId}:${question.id}:${
      ctx.messageId ?? createHash("sha256").update(reply).digest("hex").slice(0, 32)
    }`,
  }).catch(() => null);

  if (!result?.data || result.requiresReview || !result.data.normalized_value) {
    return null;
  }

  const revalidated = matchAnswer(question, result.data.normalized_value);
  return revalidated.value
    ? // Q-D1: the model's own confidence travels with the value, so the caller
      // records it as ai_assist rather than as something the lead typed.
      { value: revalidated.value, text: reply.trim(), confidence: result.data.confidence }
    : null;
}
