"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  hasRole,
  requireRole,
  requireWorkspace,
  type ActiveWorkspace,
} from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { evaluateQualification, type Answer, type Question } from "./engine";
import { getQualificationConfig } from "./queries";
import {
  describeRule,
  previewInputSchema,
  questionInputSchema,
  ruleInputSchema,
  toEngineRule,
  type PreviewInput,
  type PreviewOutcome,
  type QuestionInput,
  type RuleInput,
} from "./types";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };
export type PreviewResult =
  | { ok: true; outcome: PreviewOutcome }
  | { ok: false; error: string };

function fail(error: string): ActionResult {
  return { ok: false, error };
}

function refresh() {
  revalidatePath("/app/follow-up");
  revalidatePath("/app/leads");
}

async function editor(): Promise<ActiveWorkspace | null> {
  try {
    return await requireRole("admin");
  } catch {
    return null;
  }
}

export async function saveQuestion(input: QuestionInput): Promise<ActionResult> {
  const parsed = questionInputSchema.safeParse(input);
  if (!parsed.success) return fail("Check the question and its options.");

  const workspace = await editor();
  if (!workspace) {
    return fail("You do not have permission to change qualification questions.");
  }

  const data = parsed.data;
  const supabase = createAdminClient();
  const serviceId = data.serviceId ? data.serviceId : null;

  if (serviceId) {
    const { data: service } = await supabase
      .from("services")
      .select("id")
      .eq("business_id", workspace.businessId)
      .eq("id", serviceId)
      .maybeSingle();
    if (!service) return fail("That service is not in this workspace.");
  }

  const usesOptions =
    data.responseType === "single_choice" || data.responseType === "timing";
  if (usesOptions && data.options.length < 2) {
    return fail("A choice question needs at least two options.");
  }

  let questionId = data.id ?? null;

  if (questionId) {
    const { error } = await supabase
      .from("qualification_questions")
      .update({
        question_text: data.questionText,
        help_text: data.helpText || null,
        response_type: data.responseType,
        required: data.required,
        active: data.active,
        service_id: serviceId,
      })
      .eq("id", questionId)
      .eq("business_id", workspace.businessId);
    if (error) return fail("Could not save the question.");
  } else {
    const { data: last } = await supabase
      .from("qualification_questions")
      .select("position")
      .eq("business_id", workspace.businessId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: created, error } = await supabase
      .from("qualification_questions")
      .insert({
        business_id: workspace.businessId,
        question_text: data.questionText,
        help_text: data.helpText || null,
        response_type: data.responseType,
        required: data.required,
        active: data.active,
        service_id: serviceId,
        position: (last?.position ?? 0) + 1,
      })
      .select("id")
      .single();
    if (error || !created) return fail("Could not create the question.");
    questionId = created.id;
  }

  await supabase
    .from("qualification_options")
    .delete()
    .eq("question_id", questionId)
    .eq("business_id", workspace.businessId);

  if (usesOptions && data.options.length > 0) {
    const { error } = await supabase.from("qualification_options").insert(
      data.options.map((option, index) => ({
        business_id: workspace.businessId,
        question_id: questionId,
        label: option.label,
        value: option.value,
        position: index + 1,
      })),
    );
    if (error) return fail("Could not save the options.");
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "qualification.question_saved",
    entityType: "qualification_question",
    entityId: questionId,
    metadata: { response_type: data.responseType, required: data.required },
  });

  refresh();
  return { ok: true, id: questionId };
}

export async function deleteQuestion(input: {
  questionId: string;
}): Promise<ActionResult> {
  const parsed = z.object({ questionId: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Question not found.");

  const workspace = await editor();
  if (!workspace) {
    return fail("You do not have permission to change qualification questions.");
  }

  const supabase = createAdminClient();
  const { count } = await supabase
    .from("qualification_answers")
    .select("id", { count: "exact", head: true })
    .eq("business_id", workspace.businessId)
    .eq("question_id", parsed.data.questionId);

  if ((count ?? 0) > 0) {
    return fail(
      "Leads have already answered this question. Switch it off instead so their answers stay readable.",
    );
  }

  const { error } = await supabase
    .from("qualification_questions")
    .delete()
    .eq("id", parsed.data.questionId)
    .eq("business_id", workspace.businessId);

  if (error) return fail("Could not delete the question.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "qualification.question_deleted",
    entityType: "qualification_question",
    entityId: parsed.data.questionId,
  });

  refresh();
  return { ok: true };
}

export async function moveQuestion(input: {
  questionId: string;
  direction: "up" | "down";
}): Promise<ActionResult> {
  const parsed = z
    .object({ questionId: z.uuid(), direction: z.enum(["up", "down"]) })
    .safeParse(input);
  if (!parsed.success) return fail("That request is not valid.");

  const workspace = await editor();
  if (!workspace) {
    return fail("You do not have permission to reorder questions.");
  }

  const supabase = createAdminClient();
  const { data: questions } = await supabase
    .from("qualification_questions")
    .select("id, position")
    .eq("business_id", workspace.businessId)
    .order("position");

  const rows = questions ?? [];
  const index = rows.findIndex((row) => row.id === parsed.data.questionId);
  if (index < 0) return fail("Question not found.");

  const target = parsed.data.direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= rows.length) return { ok: true };

  const reordered = [...rows];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

  for (const [position, row] of reordered.entries()) {
    await supabase
      .from("qualification_questions")
      .update({ position: position + 1 })
      .eq("id", row.id)
      .eq("business_id", workspace.businessId);
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "qualification.question_reordered",
    entityType: "qualification_question",
    entityId: parsed.data.questionId,
  });

  refresh();
  return { ok: true };
}

export async function saveRule(input: RuleInput): Promise<ActionResult> {
  const parsed = ruleInputSchema.safeParse(input);
  if (!parsed.success) return fail("Check the rule before saving it.");

  const workspace = await editor();
  if (!workspace) {
    return fail("You do not have permission to change qualification rules.");
  }

  const data = parsed.data;
  const supabase = createAdminClient();

  const { data: question } = await supabase
    .from("qualification_questions")
    .select("id")
    .eq("business_id", workspace.businessId)
    .eq("id", data.questionId)
    .maybeSingle();
  if (!question) return fail("That question is not in this workspace.");

  if (data.operator !== "is_present" && data.comparisonValue.length === 0) {
    return fail("This operator needs at least one value to compare against.");
  }

  const payload = {
    business_id: workspace.businessId,
    question_id: data.questionId,
    rule_type: "answer" as const,
    operator: data.operator,
    comparison_value: data.comparisonValue,
    result: data.result,
    priority: data.priority,
    active: data.active,
  };

  if (data.id) {
    const { error } = await supabase
      .from("qualification_rules")
      .update(payload)
      .eq("id", data.id)
      .eq("business_id", workspace.businessId);
    if (error) return fail("Could not save the rule.");
  } else {
    const { error } = await supabase.from("qualification_rules").insert(payload);
    if (error) return fail("Could not create the rule.");
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "qualification.rule_saved",
    entityType: "qualification_rule",
    entityId: data.id,
    metadata: {
      question_id: data.questionId,
      operator: data.operator,
      result: data.result,
    },
  });

  refresh();
  return { ok: true };
}

export async function deleteRule(input: {
  ruleId: string;
}): Promise<ActionResult> {
  const parsed = z.object({ ruleId: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Rule not found.");

  const workspace = await editor();
  if (!workspace) {
    return fail("You do not have permission to change qualification rules.");
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("qualification_rules")
    .delete()
    .eq("id", parsed.data.ruleId)
    .eq("business_id", workspace.businessId);

  if (error) return fail("Could not delete the rule.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "qualification.rule_deleted",
    entityType: "qualification_rule",
    entityId: parsed.data.ruleId,
  });

  refresh();
  return { ok: true };
}

/**
 * Runs the real engine on sample answers so the preview cannot drift from what
 * the worker actually does. The engine is the only thing that decides.
 */
export async function previewQualification(
  input: PreviewInput,
): Promise<PreviewResult> {
  const parsed = previewInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That sample is not valid." };

  const workspace = await requireWorkspace();
  if (!hasRole(workspace.role, "viewer")) {
    return { ok: false, error: "You do not have access to qualification." };
  }

  const config = await getQualificationConfig(workspace.businessId);
  const serviceId = parsed.data.serviceId ? parsed.data.serviceId : null;
  const service = config.services.find((row) => row.id === serviceId) ?? null;

  const questions: Question[] = config.questions
    .filter((question) => question.active)
    .map((question) => ({
      id: question.id,
      responseType: question.responseType,
      required: question.required,
      serviceId: question.serviceId,
      options: question.options.map((option) => ({ value: option.value })),
    }));

  const questionById = new Map(config.questions.map((row) => [row.id, row]));

  const answers: Answer[] = parsed.data.answers
    .filter((answer) => answer.value !== "")
    .map((answer) => {
      const question = questionById.get(answer.questionId);
      const configured = question ? matchesConfiguredValue(question.responseType, question.options.map((option) => option.value), answer.value) : null;
      return {
        questionId: answer.questionId,
        answerValue: configured,
        answerText: answer.value,
      };
    });

  const activeRules = config.rules.filter((rule) => rule.active);

  const outcome = evaluateQualification({
    questions,
    answers,
    rules: activeRules.map(toEngineRule),
    serviceId,
    serviceIsActive: service?.active ?? false,
    postcode: parsed.data.postcode ? parsed.data.postcode : null,
    allowedPostcodePrefixes: config.serviceArea.allowedPrefixes,
    blockedPostcodePrefixes: config.serviceArea.blockedPrefixes,
  });

  const answerByQuestion = new Map(
    answers.map((answer) => [answer.questionId, answer]),
  );

  const firedRules: PreviewOutcome["firedRules"] = [...activeRules]
    .sort((a, b) => a.priority - b.priority)
    .filter((rule) => rule.ruleType === "answer" && rule.questionId)
    .map((rule) => {
      const question = questionById.get(rule.questionId as string);
      const answer = answerByQuestion.get(rule.questionId as string);
      const evaluation = outcome.answerEvaluations[rule.questionId as string];

      const status: PreviewOutcome["firedRules"][number]["outcome"] = !answer
        ? "no_answer"
        : evaluation === "meets"
          ? "held"
          : evaluation === "does_not_meet"
            ? "did_not_hold"
            : evaluation === "review"
              ? "not_evaluable"
              : "no_answer";

      return {
        ruleId: rule.id,
        questionText: question?.questionText ?? "Unknown question",
        description: describeRule(rule, question?.questionText ?? "Answer"),
        outcome: status,
        result: rule.result,
      };
    });

  return { ok: true, outcome: { ...outcome, firedRules } };
}

/**
 * Mirrors how an inbound reply is matched: exact or simple match against a
 * configured option only. Anything else stays unmatched so the engine can send
 * it to review rather than guessing.
 */
function matchesConfiguredValue(
  responseType: string,
  optionValues: string[],
  raw: string,
): string | null {
  const value = raw.trim();
  if (!value) return null;

  if (responseType === "yes_no") {
    const lower = value.toLowerCase();
    if (["yes", "y", "yeah", "yep"].includes(lower)) return "yes";
    if (["no", "n", "nope"].includes(lower)) return "no";
    return null;
  }

  if (responseType === "single_choice" || responseType === "timing") {
    const match = optionValues.find(
      (option) => option.toLowerCase() === value.toLowerCase(),
    );
    return match ?? null;
  }

  return value;
}
