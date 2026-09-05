/**
 * Per-answer routing, expressed on top of the existing rule rows.
 *
 * People think about qualification one answer at a time — "No means they're
 * not a fit", "Researching only should go to a person". The stored model is a
 * list of conditions, which is what the engine evaluates. This module is the
 * translation between the two, and it is the only place that translation
 * exists.
 *
 * The mapping, for a choice-style question:
 *
 *   every option routed to NOT_QUALIFIED  ->  one rule:
 *       operator "not_in", comparisonValue [those options], result "hard_fail"
 *   every option routed to REVIEW         ->  one rule:
 *       operator "not_in", comparisonValue [those options], result "review"
 *
 * Read that as the engine does: "the answer must not be one of these; if it
 * is, the rule did not hold, so apply its result." An option with no rule
 * simply continues, which is why "continue" needs no row at all.
 *
 * Client-safe: no `server-only`, no Supabase.
 */

import { newDraftKey, type DraftQuestion, type DraftRule } from "./draft.ts";
import type { RuleResult } from "./types.ts";

export const ROUTE_DESTINATIONS = [
  "continue",
  "review",
  "not_qualified",
] as const;

export type RouteDestination = (typeof ROUTE_DESTINATIONS)[number];

export const ROUTE_META: Record<
  RouteDestination,
  { label: string; tone: "neutral" | "warning" | "danger" }
> = {
  continue: { label: "continue", tone: "neutral" },
  review: { label: "review", tone: "warning" },
  not_qualified: { label: "not qualified", tone: "danger" },
};

const RESULT_FOR: Record<
  Exclude<RouteDestination, "continue">,
  RuleResult
> = {
  review: "review",
  not_qualified: "hard_fail",
};

/** The answer values a question can produce, in display order. */
export function answerValues(
  question: DraftQuestion,
): { value: string; label: string }[] {
  if (question.responseType === "yes_no") {
    return [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ];
  }
  return question.options.map((option) => ({
    value: option.value,
    label: option.label,
  }));
}

/** Reads the current destination of each answer out of the question's rules. */
export function readRouting(
  question: DraftQuestion,
): Record<string, RouteDestination> {
  const routing: Record<string, RouteDestination> = {};
  for (const { value } of answerValues(question)) routing[value] = "continue";

  for (const rule of question.rules) {
    if (rule.operator !== "not_in" && rule.operator !== "not_equals") continue;
    const destination: RouteDestination =
      rule.result === "hard_fail"
        ? "not_qualified"
        : rule.result === "review"
          ? "review"
          : "continue";
    if (destination === "continue") continue;
    for (const value of rule.comparisonValue) {
      if (value in routing) routing[value] = destination;
    }
  }

  return routing;
}

/**
 * Rebuilds the question's answer rules from a routing map, preserving any rule
 * this editor does not model (a number range, a postcode prefix list) so
 * switching a dropdown cannot silently drop a condition someone set up.
 */
export function writeRouting(
  question: DraftQuestion,
  routing: Record<string, RouteDestination>,
): DraftRule[] {
  const preserved = question.rules.filter(
    (rule) => rule.operator !== "not_in" && rule.operator !== "not_equals",
  );

  const grouped: Record<Exclude<RouteDestination, "continue">, string[]> = {
    not_qualified: [],
    review: [],
  };

  for (const { value } of answerValues(question)) {
    const destination = routing[value] ?? "continue";
    if (destination === "continue") continue;
    grouped[destination].push(value);
  }

  const rebuilt: DraftRule[] = [];
  // Rejection is read before review, matching the engine's precedence:
  // NOT_QUALIFIED ends evaluation, REVIEW is remembered until the end.
  for (const destination of ["not_qualified", "review"] as const) {
    const values = grouped[destination];
    if (values.length === 0) continue;
    const existing = question.rules.find(
      (rule) =>
        rule.operator === "not_in" && rule.result === RESULT_FOR[destination],
    );
    rebuilt.push({
      key: existing?.key ?? newDraftKey("r"),
      id: existing?.id ?? null,
      operator: "not_in",
      comparisonValue: values,
      result: RESULT_FOR[destination],
      priority: rebuilt.length,
      active: true,
    });
  }

  return [...rebuilt, ...preserved].map((rule, index) => ({
    ...rule,
    priority: index,
  }));
}

/* --------------------------------------------------- postcode prefix rules */

export function readAllowedPrefixes(question: DraftQuestion): string[] {
  const rule = question.rules.find((item) => item.operator === "prefix_in");
  return rule?.comparisonValue ?? [];
}

export function writeAllowedPrefixes(
  question: DraftQuestion,
  prefixes: string[],
): DraftRule[] {
  const cleaned = [
    ...new Set(
      prefixes
        .map((prefix) => prefix.trim().toUpperCase().replace(/\s+/g, ""))
        .filter((prefix) => prefix !== ""),
    ),
  ];
  const others = question.rules.filter((rule) => rule.operator !== "prefix_in");
  if (cleaned.length === 0) {
    return others.map((rule, index) => ({ ...rule, priority: index }));
  }

  const existing = question.rules.find((rule) => rule.operator === "prefix_in");
  return [
    {
      key: existing?.key ?? newDraftKey("r"),
      id: existing?.id ?? null,
      operator: "prefix_in" as const,
      comparisonValue: cleaned,
      // A postcode outside the service area is a decisive no, not a maybe.
      result: "hard_fail" as RuleResult,
      priority: 0,
      active: true,
    },
    ...others,
  ].map((rule, index) => ({ ...rule, priority: index }));
}

/* ------------------------------------------------------------ number range */

export function readNumberRange(question: DraftQuestion): {
  min: string;
  max: string;
} {
  const min = question.rules.find((rule) => rule.operator === "gte");
  const max = question.rules.find((rule) => rule.operator === "lte");
  return {
    min: min?.comparisonValue[0] ?? "",
    max: max?.comparisonValue[0] ?? "",
  };
}

export function writeNumberRange(
  question: DraftQuestion,
  range: { min: string; max: string },
): DraftRule[] {
  const others = question.rules.filter(
    (rule) => rule.operator !== "gte" && rule.operator !== "lte",
  );
  const rules: DraftRule[] = [];

  for (const [operator, raw] of [
    ["gte", range.min],
    ["lte", range.max],
  ] as const) {
    const value = raw.trim();
    if (value === "" || !Number.isFinite(Number(value))) continue;
    const existing = question.rules.find((rule) => rule.operator === operator);
    rules.push({
      key: existing?.key ?? newDraftKey("r"),
      id: existing?.id ?? null,
      operator,
      comparisonValue: [value],
      result: "hard_fail",
      priority: 0,
      active: true,
    });
  }

  return [...rules, ...others].map((rule, index) => ({ ...rule, priority: index }));
}

/** The one-line summary shown under a question row. */
export function describeRouting(question: DraftQuestion): {
  kind: "routing" | "validation" | "options" | "none";
  parts: string[];
} {
  if (question.responseType === "postcode") {
    const prefixes = readAllowedPrefixes(question);
    return prefixes.length > 0
      ? { kind: "validation", parts: [`Allowed prefixes: ${prefixes.join(", ")}`] }
      : { kind: "validation", parts: ["Any postcode is accepted"] };
  }

  if (question.responseType === "number") {
    const { min, max } = readNumberRange(question);
    if (min === "" && max === "") {
      return { kind: "validation", parts: ["Any number is accepted"] };
    }
    const parts: string[] = [];
    if (min !== "") parts.push(`At least ${min}`);
    if (max !== "") parts.push(`At most ${max}`);
    return { kind: "validation", parts };
  }

  const values = answerValues(question);
  if (values.length === 0) return { kind: "none", parts: [] };

  const routing = readRouting(question);
  const routed = values.filter((entry) => routing[entry.value] !== "continue");

  if (routed.length === 0) {
    return {
      kind: "options",
      parts: values.map((entry) => entry.label),
    };
  }

  return {
    kind: "routing",
    parts: values.map(
      (entry) => `${entry.label} → ${ROUTE_META[routing[entry.value]].label}`,
    ),
  };
}
