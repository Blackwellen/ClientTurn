import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { QualificationResult } from "./engine";
import type {
  Operator,
  QualificationConfig,
  QualificationOption,
  QuestionRecord,
  ResponseType,
  RuleRecord,
  RuleResult,
} from "./types";

export * from "./types";

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (value === null || value === undefined || value === "") return [];
  return [String(value)];
}

export async function getQualificationConfig(
  businessId: string,
): Promise<QualificationConfig> {
  const supabase = await createClient();

  const [services, questions, options, rules, settings] = await Promise.all([
    supabase
      .from("services")
      .select("id, name, active")
      .eq("business_id", businessId)
      .order("position"),
    supabase
      .from("qualification_questions")
      .select(
        "id, question_text, help_text, response_type, required, position, active, service_id",
      )
      .eq("business_id", businessId)
      .order("position"),
    supabase
      .from("qualification_options")
      .select("id, question_id, label, value, position")
      .eq("business_id", businessId)
      .order("position"),
    supabase
      .from("qualification_rules")
      .select(
        "id, question_id, rule_type, operator, comparison_value, result, priority, active",
      )
      .eq("business_id", businessId)
      .order("priority"),
    supabase
      .from("business_settings")
      .select("allowed_postcode_prefixes, blocked_postcode_prefixes")
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);

  const optionsByQuestion = new Map<string, QualificationOption[]>();
  for (const option of options.data ?? []) {
    const list = optionsByQuestion.get(option.question_id) ?? [];
    list.push({
      id: option.id,
      label: option.label,
      value: option.value,
      position: option.position,
    });
    optionsByQuestion.set(option.question_id, list);
  }

  const questionRecords: QuestionRecord[] = (questions.data ?? []).map((row) => ({
    id: row.id,
    questionText: row.question_text,
    helpText: row.help_text,
    responseType: row.response_type as ResponseType,
    required: row.required,
    position: row.position,
    active: row.active,
    serviceId: row.service_id,
    options: optionsByQuestion.get(row.id) ?? [],
  }));

  const ruleRecords: RuleRecord[] = (rules.data ?? []).map((row) => ({
    id: row.id,
    questionId: row.question_id,
    ruleType: row.rule_type as RuleRecord["ruleType"],
    operator: row.operator as Operator,
    comparisonValue: toStringArray(row.comparison_value),
    result: row.result as RuleResult,
    priority: row.priority,
    active: row.active,
  }));

  return {
    services: (services.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      active: row.active,
    })),
    questions: questionRecords,
    rules: ruleRecords,
    serviceArea: {
      allowedPrefixes: settings.data?.allowed_postcode_prefixes ?? [],
      blockedPrefixes: settings.data?.blocked_postcode_prefixes ?? [],
    },
  };
}

/**
 * Live routing outcomes across the workspace's real leads. Test leads are
 * excluded so a synthetic run can never inflate the numbers on this card.
 */
export async function getQualificationStats(
  businessId: string,
): Promise<Record<QualificationResult, number>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("qualification_state")
    .eq("business_id", businessId)
    .eq("is_test", false)
    .limit(10000);

  const counts: Record<QualificationResult, number> = {
    PENDING: 0,
    QUALIFIED: 0,
    NOT_QUALIFIED: 0,
    REVIEW: 0,
  };

  for (const row of data ?? []) {
    const state = row.qualification_state as QualificationResult;
    if (state in counts) counts[state] += 1;
  }

  return counts;
}

function initialsFrom(
  firstName: string | null,
  lastName: string | null,
  email: string | null,
): string | null {
  const first = firstName?.trim()?.[0];
  const last = lastName?.trim()?.[0];
  if (first || last) return `${first ?? ""}${last ?? ""}`.toUpperCase();
  const fromEmail = email?.trim()?.[0];
  return fromEmail ? fromEmail.toUpperCase() : null;
}

/**
 * When the live qualification configuration last changed, and who by. The
 * timestamp doubles as the editor's optimistic-concurrency baseline, so a
 * stale editor cannot overwrite a colleague's publish.
 */
export async function getQualificationMeta(businessId: string): Promise<{
  savedAt: string | null;
  savedByInitials: string | null;
  savedByName: string | null;
}> {
  const supabase = await createClient();

  const [questions, rules, audit] = await Promise.all([
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
    supabase
      .from("audit_log")
      .select("created_at, actor_user_id")
      .eq("business_id", businessId)
      .eq("action", "qualification.published")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const stamps = [questions.data?.updated_at, rules.data?.updated_at].filter(
    (value): value is string => Boolean(value),
  );
  const savedAt = stamps.sort().at(-1) ?? null;

  if (!audit.data?.actor_user_id) {
    return { savedAt, savedByInitials: null, savedByName: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, email")
    .eq("id", audit.data.actor_user_id)
    .maybeSingle();

  return {
    savedAt,
    savedByInitials: profile
      ? initialsFrom(profile.first_name, profile.last_name, profile.email)
      : null,
    savedByName: profile
      ? [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() ||
        profile.email ||
        null
      : null,
  };
}
