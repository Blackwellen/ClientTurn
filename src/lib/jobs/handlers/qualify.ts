import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  evaluateQualification,
  type EngineInput,
  type EngineOutput,
  type Question,
  type Rule,
} from "@/lib/qualification/engine";
import { enqueueCrmPushes } from "@/lib/integrations/providers/crm-trigger";
import { emitAutomationEvent } from "@/lib/automation/events";
import { runTask } from "@/lib/ai/model-router";
import { wrapUntrustedContent } from "@/lib/ai/safety";
import type { QualificationExtraction } from "@/lib/ai/schemas";
import type { BusinessContext, LeadRecord } from "./shared";

export type QuestionRecord = Omit<Question, "options"> & {
  questionText: string;
  position: number;
  options: { value: string; label: string }[];
};

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

  await admin
    .from("leads")
    .update({
      qualification_state: output.result,
      qualification_reason: output.reasons as never,
      qualified_at: output.result === "QUALIFIED" ? now : null,
      status,
    })
    .eq("id", lead.id)
    .eq("business_id", business.businessId);

  for (const [questionId, evaluation] of Object.entries(
    output.answerEvaluations,
  )) {
    await admin
      .from("qualification_answers")
      .update({ evaluation })
      .eq("business_id", business.businessId)
      .eq("lead_id", lead.id)
      .eq("question_id", questionId);
  }

  if (output.result === "QUALIFIED") {
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

  return { output, questions };
}

/** The next required question the lead has not answered, in configured order. */
export function nextQuestion(
  questions: QuestionRecord[],
  answeredIds: Set<string>,
  serviceId: string | null,
): QuestionRecord | null {
  return (
    questions
      .filter(
        (question) =>
          question.serviceId === null || question.serviceId === serviceId,
      )
      .filter((question) => !answeredIds.has(question.id))
      .sort((a, b) => a.position - b.position)[0] ?? null
  );
}

/**
 * Deterministic answer matching. Nothing is guessed: a reply that does not
 * match a configured option is stored as raw text, which the engine turns into
 * REVIEW rather than a decision.
 */
export function matchAnswer(
  question: QuestionRecord,
  reply: string,
): { value: string | null; text: string } {
  const text = reply.trim();
  const normalised = text.toLowerCase().replace(/[.!?]+$/, "").trim();

  if (question.responseType === "yes_no") {
    if (["yes", "y", "yeah", "yep", "correct", "1"].includes(normalised)) {
      return { value: "yes", text };
    }
    if (["no", "n", "nope", "nah", "0"].includes(normalised)) {
      return { value: "no", text };
    }
    return { value: null, text };
  }

  if (question.responseType === "number") {
    const digits = normalised.replace(/[^\d.]/g, "");
    return {
      value: digits && Number.isFinite(Number(digits)) ? digits : null,
      text,
    };
  }

  if (question.responseType === "postcode") {
    const match = text
      .toUpperCase()
      .match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/);
    return { value: match ? match[0].replace(/\s+/g, " ") : null, text };
  }

  if (question.responseType === "text") {
    return { value: text || null, text };
  }

  // single_choice and timing: exact value, exact label, or a numbered pick.
  const exact = question.options.find(
    (option) =>
      option.value.toLowerCase() === normalised ||
      option.label.toLowerCase() === normalised,
  );
  if (exact) return { value: exact.value, text };

  const index = Number(normalised);
  if (
    Number.isInteger(index) &&
    index >= 1 &&
    index <= question.options.length
  ) {
    return { value: question.options[index - 1].value, text };
  }

  return { value: null, text };
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
  ctx: { businessId: string; leadId: string; conversationId: string | null },
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
    conversationId: ctx.conversationId,
    context,
    maxOutputTokens: 120,
  }).catch(() => null);

  if (!result?.data || result.requiresReview || !result.data.normalized_value) {
    return null;
  }

  const revalidated = matchAnswer(question, result.data.normalized_value);
  return revalidated.value
    ? { value: revalidated.value, text: reply.trim() }
    : null;
}

export function questionPrompt(question: QuestionRecord): string {
  if (question.options.length === 0) return question.questionText;
  const choices = question.options
    .map((option, index) => `${index + 1}. ${option.label}`)
    .join("\n");
  return `${question.questionText}\n${choices}`;
}
