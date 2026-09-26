/**
 * Score features from qualification answers and the lead's own words (brief
 * §§16-19). Pure: no Supabase, no `server-only`; tests import it with `.ts`.
 *
 * The scoring engine already expects these features; nothing produced them.
 * Each answer is mapped through the library dimension its question asks about
 * (next-question.ts `inferDimension`), and only unambiguous wording counts.
 * An answer that cannot be read confidently produces no fact, so the feature
 * stays "missing" (and the adaptive qualifier asks about it) rather than being
 * guessed.
 *
 *   TIMING       -> timeline_days, urgent
 *   BUDGET       -> budget_confirmed
 *   AUTHORITY    -> authority_confirmed
 *   STAKEHOLDERS / DECISION_PROCESS -> stakeholder_count (only a stated number)
 *   inbound text asking about price -> pricing_requested
 *
 * Not mapped, deliberately: TEAM_SIZE / COMPANY_SIZE to company_size_match.
 * A "match" needs the workspace's target size range, which no configuration
 * holds yet; a size alone is not fit.
 */

import type { LeadFact } from "./lead-score.ts";
import type { QualificationDimensionKey } from "../sales-library/types.ts";

export type ScoredAnswer = {
  dimension: QualificationDimensionKey | null;
  value: string;
  answeredAt: string | null;
  /** qualification_answers.confidence; null = stated by the lead (1). */
  confidence: number | null;
};

const YES = /^(yes|y|yeah|yep|correct|i do|me|myself|that's me|that is me|i decide|i'm the decision ?maker)\b/i;
const NO = /^(no|n|nope|not me|not yet|someone else|my (boss|manager|director|partner))\b/i;
const MONEY = /[£$€]\s?\d|\b\d[\d,.]*\s?(k|grand|pounds|per month|a month|pcm)\b/i;
const NO_BUDGET = /\b(no budget|not sure|don't know|dont know|haven't (set|decided)|no idea|tbc|to be confirmed)\b/i;
const PRICE_ASK = /\b(price|pricing|cost|costs|quote|how much|rates?)\b/i;

const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };

/** Days until the lead wants to start, or null when the wording is unclear. */
export function timelineDays(value: string): number | null {
  const text = value.trim().toLowerCase();
  if (!text) return null;
  if (/\b(asap|as soon as possible|immediately|right away|urgent|urgently|now|today|this week)\b/.test(text)) return 7;
  const numeric = /\b(\d{1,3})\s*(day|week|month|year)s?\b/.exec(text);
  if (numeric) return Number(numeric[1]) * UNIT_DAYS[numeric[2]];
  if (/\b(next week|within (a|one) month|this month|next few weeks|couple of weeks)\b/.test(text)) return 30;
  if (/\b(next month|this quarter|within (three|3) months|1-3 months)\b/.test(text)) return 90;
  if (/\b(next quarter|3-6 months|this year|later this year|in the new year)\b/.test(text)) return 180;
  if (/\b(next year|6-12 months|no rush|just looking|not sure when|someday)\b/.test(text)) return 365;
  return null;
}

export function answerFeatures(answers: ScoredAnswer[]): LeadFact[] {
  const facts: LeadFact[] = [];
  const seen = new Set<string>();
  const push = (fact: LeadFact) => {
    if (seen.has(fact.feature)) return;
    seen.add(fact.feature);
    facts.push(fact);
  };

  // Latest answers first: a later answer wins over an earlier one.
  const ordered = answers
    .filter((answer) => answer.value.trim() !== "")
    .slice()
    .sort((a, b) => (b.answeredAt ?? "").localeCompare(a.answeredAt ?? ""));

  for (const answer of ordered) {
    const value = answer.value.trim();
    const base = {
      source: "qualification_answers",
      observedAt: answer.answeredAt,
      confidence: answer.confidence ?? 1,
    };
    switch (answer.dimension) {
      case "TIMING": {
        const days = timelineDays(value);
        if (days === null) break;
        push({ ...base, feature: "timeline_days", value: days });
        if (days <= 14) push({ ...base, feature: "urgent", value: true });
        break;
      }
      case "BUDGET":
        if (NO_BUDGET.test(value) || /^(no|n|nope)\b/i.test(value)) push({ ...base, feature: "budget_confirmed", value: false });
        else if (MONEY.test(value) || /^(yes|y|yeah|yep)\b/i.test(value)) push({ ...base, feature: "budget_confirmed", value: true });
        break;
      case "AUTHORITY":
        if (YES.test(value)) push({ ...base, feature: "authority_confirmed", value: true });
        else if (NO.test(value)) push({ ...base, feature: "authority_confirmed", value: false });
        break;
      case "STAKEHOLDERS":
      case "DECISION_PROCESS": {
        const n = /\b(\d{1,2})\b/.exec(value);
        if (n) push({ ...base, feature: "stakeholder_count", value: Number(n[1]) });
        else if (/^(just me|only me|me)\b/i.test(value)) push({ ...base, feature: "stakeholder_count", value: 1 });
        break;
      }
      default:
        break;
    }
  }
  return facts;
}

/** The lead asked about price in one of their own messages. */
export function pricingRequestedFact(inbound: { body: string | null; created_at: string }[]): LeadFact | null {
  const hit = inbound.find((message) => PRICE_ASK.test(message.body ?? ""));
  return hit
    ? { feature: "pricing_requested", value: true, source: "messages", observedAt: hit.created_at, confidence: 0.9 }
    : null;
}
