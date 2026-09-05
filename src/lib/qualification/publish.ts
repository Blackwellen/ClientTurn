"use server";

/**
 * Publishing the qualification draft.
 *
 * The editor batches every change — added, edited, reordered and removed
 * questions, their options and their routing rules — and commits them in one
 * action. That is what makes "Discard changes" meaningful: until this runs,
 * live intake is untouched.
 *
 * Three things are non-negotiable here and are all re-derived server-side,
 * never trusted from the client:
 *   1. workspace scoping — every write is filtered by `business_id`;
 *   2. authorisation — admin or owner only;
 *   3. optimistic concurrency — a stale editor is refused, not merged.
 */

import { revalidatePath } from "next/cache";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import {
  publishDraftSchema,
  usesOptions,
  type PublishDraftInput,
} from "./draft";
import { operatorsFor, OPERATOR_META } from "./types";

export type PublishResult = { ok: true; savedAt: string } | { ok: false; error: string };

function fail(error: string): PublishResult {
  return { ok: false, error };
}

async function editor(): Promise<ActiveWorkspace | null> {
  try {
    return await requireRole("admin");
  } catch {
    return null;
  }
}

/** The newest `updated_at` across the live configuration. */
async function currentBaseline(businessId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const [questions, rules] = await Promise.all([
    supabase
      .from("qualification_questions")
      .select("updated_at")
      .eq("business_id", businessId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("qualification_rules")
      .select("updated_at")
      .eq("business_id", businessId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const stamps = [questions.data?.updated_at, rules.data?.updated_at].filter(
    (value): value is string => Boolean(value),
  );
  return stamps.sort().at(-1) ?? null;
}

export async function publishQualification(
  input: PublishDraftInput,
): Promise<PublishResult> {
  const parsed = publishDraftSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ??
        "Some questions are not valid. Fix the highlighted rows and try again.",
    );
  }

  const workspace = await editor();
  if (!workspace) {
    return fail("You do not have permission to publish qualification.");
  }

  const { questions, baseline } = parsed.data;
  const supabase = createAdminClient();

  // --- optimistic concurrency -------------------------------------------
  const stored = await currentBaseline(workspace.businessId);
  if (baseline !== null && stored !== null && stored > baseline) {
    return fail(
      "Someone else changed qualification while you were editing. Reload the page to see their version before publishing.",
    );
  }

  // --- tenancy: every referenced row must belong to this workspace -------
  const [{ data: ownedServices }, { data: ownedQuestions }] = await Promise.all([
    supabase.from("services").select("id").eq("business_id", workspace.businessId),
    supabase
      .from("qualification_questions")
      .select("id")
      .eq("business_id", workspace.businessId),
  ]);

  const serviceIds = new Set((ownedServices ?? []).map((row) => row.id));
  const existingIds = new Set((ownedQuestions ?? []).map((row) => row.id));

  for (const question of questions) {
    if (question.serviceId && !serviceIds.has(question.serviceId)) {
      return fail("A question is scoped to a service that is not in this workspace.");
    }
    if (question.id && !existingIds.has(question.id)) {
      return fail("A question in this draft does not belong to this workspace.");
    }
  }

  // --- server-side re-validation of the same rules the editor enforces ---
  for (const [index, question] of questions.entries()) {
    const label = `Question ${index + 1}`;
    if (usesOptions(question.responseType)) {
      if (question.options.length < 2) {
        return fail(`${label} needs at least two options.`);
      }
      const values = question.options.map((option) => option.value.toLowerCase());
      if (new Set(values).size !== values.length) {
        return fail(`${label} has two options with the same value.`);
      }
    }
    const allowed = operatorsFor(question.responseType);
    for (const rule of question.rules) {
      if (!allowed.includes(rule.operator)) {
        return fail(`${label} has a rule that does not apply to its answer type.`);
      }
      if (
        OPERATOR_META[rule.operator].values !== "none" &&
        rule.comparisonValue.length === 0
      ) {
        return fail(`${label} has a rule with no value to compare against.`);
      }
    }
  }

  // --- removals ----------------------------------------------------------
  const keptIds = new Set(
    questions.map((question) => question.id).filter((id): id is string => Boolean(id)),
  );
  const removedIds = [...existingIds].filter((id) => !keptIds.has(id));

  if (removedIds.length > 0) {
    // A question real leads have answered is never deleted: their recorded
    // answers would stop making sense. Switching it off is the safe path.
    const { data: answered } = await supabase
      .from("qualification_answers")
      .select("question_id")
      .eq("business_id", workspace.businessId)
      .in("question_id", removedIds)
      .limit(1);

    if (answered && answered.length > 0) {
      return fail(
        "Leads have already answered one of the questions you removed. Switch it off instead so their answers stay readable.",
      );
    }

    const { error } = await supabase
      .from("qualification_questions")
      .delete()
      .eq("business_id", workspace.businessId)
      .in("id", removedIds);
    if (error) return fail("Could not remove a deleted question.");
  }

  // --- upserts, in draft order ------------------------------------------
  let created = 0;
  let updated = 0;

  for (const [index, question] of questions.entries()) {
    const payload = {
      business_id: workspace.businessId,
      question_text: question.questionText,
      help_text: question.helpText || null,
      response_type: question.responseType,
      required: question.required,
      active: question.active,
      service_id: question.serviceId || null,
      position: index + 1,
    };

    let questionId = question.id ?? null;

    if (questionId) {
      const { error } = await supabase
        .from("qualification_questions")
        .update(payload)
        .eq("id", questionId)
        .eq("business_id", workspace.businessId);
      if (error) return fail("Could not save one of the questions.");
      updated += 1;
    } else {
      const { data, error } = await supabase
        .from("qualification_questions")
        .insert(payload)
        .select("id")
        .single();
      if (error || !data) return fail("Could not create one of the questions.");
      questionId = data.id;
      created += 1;
    }

    // Options and answer rules are replaced wholesale: the draft is the whole
    // truth for a question, so a partial merge could leave an orphan rule
    // pointing at an option that no longer exists.
    await supabase
      .from("qualification_options")
      .delete()
      .eq("business_id", workspace.businessId)
      .eq("question_id", questionId);

    if (usesOptions(question.responseType) && question.options.length > 0) {
      const { error } = await supabase.from("qualification_options").insert(
        question.options.map((option, position) => ({
          business_id: workspace.businessId,
          question_id: questionId,
          label: option.label,
          value: option.value,
          position: position + 1,
        })),
      );
      if (error) return fail("Could not save the options for a question.");
    }

    await supabase
      .from("qualification_rules")
      .delete()
      .eq("business_id", workspace.businessId)
      .eq("question_id", questionId)
      .eq("rule_type", "answer");

    if (question.rules.length > 0) {
      const { error } = await supabase.from("qualification_rules").insert(
        question.rules.map((rule, priority) => ({
          business_id: workspace.businessId,
          question_id: questionId,
          rule_type: "answer" as const,
          operator: rule.operator,
          comparison_value: rule.comparisonValue,
          result: rule.result,
          // Priority follows question order first, then rule order within the
          // question, so "read top to bottom" matches what the engine does.
          priority: index * 10 + priority,
          active: rule.active,
        })),
      );
      if (error) return fail("Could not save the routing rules for a question.");
    }
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "qualification.published",
    entityType: "business",
    entityId: workspace.businessId,
    metadata: {
      questions: questions.length,
      created,
      updated,
      removed: removedIds.length,
    },
  });

  revalidatePath("/app/follow-up");
  revalidatePath("/app/leads");

  return { ok: true, savedAt: (await currentBaseline(workspace.businessId)) ?? new Date().toISOString() };
}
