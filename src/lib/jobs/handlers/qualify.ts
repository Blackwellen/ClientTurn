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
  matchAnswer,
  selectNextQuestion,
  type KnownQuestion,
  type LeadFieldValues,
  type NextQuestionResult,
  type QuestionRecord,
} from "@/lib/qualification/next-question";
import { SALES_MOTIONS, type SalesMotion } from "@/lib/sales-library/types";
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

/**
 * Loads everything the adaptive selector needs for one lead and runs it.
 * Lead fields that answer a dimension: postcode (LOCATION) and the service
 * the lead chose (SERVICE_NEEDED).
 */
export async function loadAdaptiveSelection(input: {
  businessId: string;
  lead: LeadRecord;
  questions: QuestionRecord[];
  salesProfile?: SalesProfile;
  serviceName?: string | null;
  currentQuestionId?: string | null;
}): Promise<NextQuestionResult> {
  const admin = createAdminClient();
  const [answers, salesProfile, serviceName] = await Promise.all([
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
  ]);
  if (answers.error) throw new Error(`qualification_answers read failed: ${answers.error.message}`);

  const leadFields: LeadFieldValues = {
    LOCATION: input.lead.postcode,
    SERVICE_NEEDED: serviceName,
  };

  return selectNextQuestion({
    questions: input.questions,
    answers: (answers.data ?? []).map((row) => ({
      questionId: row.question_id,
      answerValue: row.answer_value,
    })),
    serviceId: input.lead.service_id,
    leadFields,
    // No lead-level fact store exists beyond what accepted extractions already
    // wrote onto the lead row (covered by leadFields). Opportunity memory
    // (0131) was considered and deliberately not fed in: everything it knows
    // comes from these same answers, except role mentions ("my director"),
    // which are too weak to mark a question answered. The selector accepts
    // facts so an enrichment store can feed it without a signature change.
    facts: [],
    motion: salesProfile.motion,
    archetypeKey: salesProfile.archetypeKey,
    stage: input.lead.first_replied_at ? "QUALIFYING" : "NEW",
    currentQuestionId: input.currentQuestionId ?? null,
    depth: salesProfile.preferences?.qualificationDepth ?? null,
  });
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
  const rows = inferred.map((entry) => ({
    business_id: businessId,
    lead_id: leadId,
    question_id: entry.questionId,
    answer_value: entry.value,
    answer_text: `Inferred from ${entry.source === "LEAD_FIELD" ? "the lead's details" : "a remembered fact"}: ${entry.value}`,
    source: entry.source === "LEAD_FIELD" ? "form" : "ai_assist",
    confidence: entry.confidence,
    answered_at: now,
  }));
  assertWrite(
    await admin
      .from("qualification_answers")
      .upsert(rows, { onConflict: "lead_id,question_id", ignoreDuplicates: true }),
    "qualification: record inferred answers",
    { businessId, leadId, count: rows.length },
  );
  return rows.length;
}

export async function loadQuestions(
  businessId: string,
): Promise<QuestionRecord[]> {
  const admin = createAdminClient();

  const [questions, options] = await Promise.all([
    admin
      .from("qualification_questions")
      .select(
        "id, question_text, response_type, required, service_id, position",
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
): Promise<{ value: string | null; text: string } | null> {
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
    ? { value: revalidated.value, text: reply.trim() }
    : null;
}
