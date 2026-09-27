/**
 * The golden-conversation harness (design 08 §23, §C.4). Pure.
 *
 * Drives a multi-turn conversation through the real, pure engine exactly as
 * the orchestrator does at turn time (qi-runtime.ts + A1's service), minus the
 * database: interpret() the reply, merge its facts (facts.ts mergeFact) and
 * signals, re-assess intent, derive the dimension status, resolve the goal and
 * plan the NBA (nba.ts planNextBestAction). A canned candidate reply is then
 * put through the pre-send QA the orchestrator runs (qa.ts).
 *
 * Deterministic by default. EVAL_LIVE=1 (tests/evals/live-hook.ts) is the
 * hook for driving the same tables through a real model.
 */

import { interpret } from "../../src/lib/qualification-intelligence/interpret.ts";
import { assessIntent } from "../../src/lib/qualification-intelligence/intent.ts";
import {
  deriveDimensionStatuses,
  leadFieldFactWrite,
  mergeFact,
  normaliseFactValue,
  factValidUntil,
} from "../../src/lib/qualification-intelligence/facts.ts";
import { interpretedSignalToWrite, originSignals } from "../../src/lib/qualification-intelligence/signals.ts";
import { resolveOffer, thresholdStatus, type ResolvedOffer } from "../../src/lib/qualification-intelligence/offer-profile.ts";
import { deriveConversationStage, resolveGoal } from "../../src/lib/qualification-intelligence/goals.ts";
import { planNextBestAction } from "../../src/lib/qualification-intelligence/nba.ts";
import { serviceTermsFor } from "../../src/lib/qualification-intelligence/question-intents.ts";
import { runQuestionQa, type PriorAsk, type QaResult } from "../../src/lib/qualification-intelligence/qa.ts";
import { askedIntentFor, qaContextFromNba, withVerifiedAnswer } from "../../src/lib/agent/qi-turn.ts";
import { classifyDeterministic } from "../../src/lib/agent/classification.ts";
import type { AgentChannel } from "../../src/lib/agent/types.ts";
import type { SalesMotion } from "../../src/lib/sales-library/types.ts";
import type { ConversionGoalType } from "../../src/lib/business-profile/types.ts";
import type {
  DimensionStatusEntry,
  IntentAssessment,
  IntentSignal,
  IntentSignalWrite,
  Interpretation,
  NextBestAction,
  QiDimensionKey,
  QualificationFact,
  QualificationFactWrite,
  QualificationPolicy,
} from "../../src/lib/qualification-intelligence/types.ts";

/* ================================================================ shapes */

export type GoldenTurn = {
  lead: string;
  /**
   * A known engine gap this turn exposes, recorded rather than hidden: the
   * expectation stays as a person would judge it, and the turn is reported
   * as a TODO naming the gap until the engine closes it.
   */
  knownGap?: string;
  /** A canned reply a model might write for this turn, run through QA. */
  candidate?: {
    text: string;
    qaOk: boolean;
    codes?: string[];
    /** The human-style lint (human-style.ts via lintStyle): true = it reads like a person. */
    styleOk?: boolean;
    styleCodes?: string[];
  };
  expect: {
    /** Dimensions that must be known (CONFIRMED or INFERRED) after the turn. */
    known?: string[];
    intentStateIn?: string[];
    actionIn: string[];
    /** The planned question's dimension; null = no question. */
    questionDimension?: string | null;
    questionDimensionIn?: string[];
    /** Dimensions that must not be the question this turn. */
    notAsked?: string[];
    /** Manual booking (story H3): the plan this turn asks for a preferred day and time. */
    preferredTimeAsked?: boolean;
    /** Manual booking: this reply answers "which day and time?" and parses to a slot, or not. */
    preferredTime?: "slot" | "ambiguous";
  };
};

export type GoldenConversation = {
  id: string;
  archetype: string;
  motion: SalesMotion;
  channel: AgentChannel;
  story: string;
  /** Lead origin: INBOUND = they wrote in (INBOUND_ENQUIRY), OUTBOUND = reply to our outreach. */
  origin?: "INBOUND" | "OUTBOUND";
  conversionGoalType?: ConversionGoalType | null;
  leadFields?: Partial<Record<"LOCATION" | "SERVICE_NEEDED", string>>;
  /**
   * Where leadFields came from. "FORM": the lead typed them on a form they
   * submitted (service.ts leadFieldsFromLeadForm), so they are CONFIRMED.
   * Default: entered by someone else (LEAD_FIELD, INFERRED).
   */
  leadFieldsFrom?: "FORM" | "STAFF";
  serviceNames?: string[];
  policy?: QualificationPolicy;
  offerProfile?: Record<string, unknown>;
  directClose?: boolean;
  /** booking_mode 'handover' with no calendar and no link (story H3). */
  manualBooking?: boolean;
  turns: GoldenTurn[];
};

export type TurnRow = {
  turn: number;
  /** The turn's instant (the harness clock). */
  at: string;
  lead: string;
  known: string[];
  intent: string;
  intentScore: number;
  requiredUnknown: string[];
  candidates: string[];
  action: NextBestAction["next_action"];
  question: string | null;
  questionDimension: string | null;
  thresholdMet: boolean;
  nba: NextBestAction;
  interpretation: Interpretation;
  dimensions: DimensionStatusEntry[];
  resolved: ResolvedOffer;
  qa: QaResult | null;
  asksSoFar: Record<string, number>;
};

/* ================================================================ state */

const BASE = Date.parse("2026-09-24T09:00:00.000Z");
const iso = (hours: number) => new Date(BASE + hours * 3_600_000).toISOString();

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

function toSignal(write: IntentSignalWrite, id: string): IntentSignal {
  return {
    id,
    leadId: write.lead_id,
    serviceId: write.service_id,
    category: write.category,
    type: write.signal_type,
    polarity: write.polarity,
    strength: write.strength,
    confidence: write.confidence,
    source: write.source,
    sourceRef: write.source_ref,
    observedAt: write.observed_at,
    halfLifeHours: write.half_life_hours,
    flatUntil: write.flat_until,
    expiresAt: write.expires_at,
    resumeAt: write.resume_at,
    reason: write.reason,
    evidenceExcerpt: write.evidence_excerpt,
    ruleVersion: write.rule_version,
    retractedAt: null,
  };
}

function toFact(write: QualificationFactWrite, id: string, state: QualificationFact["state"]): QualificationFact {
  return {
    id,
    leadId: write.lead_id,
    serviceId: write.service_id,
    dimension: write.dimension,
    value: write.value,
    valueNormalised: write.value_normalised,
    state,
    source: write.source,
    sourceRef: write.source_ref,
    questionId: write.question_id,
    questionIntentKey: write.question_intent_key,
    confidence: write.confidence,
    observedAt: write.observed_at,
    validUntil: write.valid_until,
    verifiedAt: write.verified_at,
    setBy: write.set_by,
    supersededAt: null,
  };
}

/** Runs one conversation through the pure engine, one row per lead turn. */
export function runConversation(conversation: GoldenConversation): TurnRow[] {
  let seq = 1;
  const leadId = uuid(seq++);
  const resolved = resolveOffer({
    archetypeKey: conversation.archetype,
    workspaceMotion: conversation.motion,
    offerProfileRaw: conversation.offerProfile ?? {},
    workspacePolicy: conversation.policy ?? null,
  });
  const required = [...new Set<QiDimensionKey>([...resolved.threshold.allOf, ...resolved.threshold.anyOf.slice(0, 1), ...resolved.requiredDimensions])];
  const statusCtx = {
    planDimensions: resolved.plan,
    required,
    requiredDimensions: resolved.requiredDimensions,
    ruleDimensions: resolved.disqualifiers.map((d) => d.dimension),
  };

  let facts: QualificationFact[] = [];
  const signals: IntentSignal[] = [];
  const applyFact = (write: QualificationFactWrite, now: string) => {
    const decision = mergeFact(facts, write, now);
    if (decision.action !== "INSERT") return;
    facts = facts.map((f) =>
      decision.supersede.includes(f.id)
        ? { ...f, supersededAt: now }
        : decision.markConflicting.includes(f.id)
          ? { ...f, state: "CONFLICTING" as const }
          : f,
    );
    facts.push(toFact(write, uuid(seq++), decision.state));
  };

  for (const [dimension, value] of Object.entries(conversation.leadFields ?? {})) {
    const write = leadFieldFactWrite({
      leadId,
      serviceId: null,
      dimension: dimension as QiDimensionKey,
      value,
      observedAt: iso(0),
      submittedByLead: conversation.leadFieldsFrom === "FORM",
    });
    if (write) applyFact(write, iso(0));
  }
  for (const write of originSignals(
    {
      leadId,
      serviceId: null,
      createdAt: iso(0),
      createdVia: conversation.origin === "OUTBOUND" ? "SOURCING" : "INBOUND",
      relationshipType: conversation.origin === "OUTBOUND" ? "FOUND_BY_US" : "THEY_CONTACTED_US",
      conversionGoalType: conversation.conversionGoalType ?? null,
      optedOut: false,
      optedOutObservedAt: null,
    },
    [],
  )) {
    signals.push(toSignal(write, uuid(seq++)));
  }

  const asks = new Map<string, number>();
  const outbound: PriorAsk[] = [];
  let lastIntentKey: string | null = null;
  const rows: TurnRow[] = [];

  conversation.turns.forEach((turn, index) => {
    const now = iso(1 + index * 2);
    const messageId = uuid(seq++);
    const before = deriveDimensionStatuses(facts, now, statusCtx);
    const asked = askedIntentFor(lastIntentKey);
    const interpretation = withVerifiedAnswer(
      interpret(turn.lead, {
        messageId,
        now,
        currentIntent: asked,
        dimensions: before,
        context: { serviceNames: conversation.serviceNames ?? [], serviceTerms: serviceTermsFor(conversation.archetype), now },
      }),
      turn.lead,
      asked,
      facts,
    );

    for (const f of interpretation.facts) {
      applyFact(
        {
          lead_id: leadId,
          service_id: null,
          dimension: f.dimension,
          value: f.value,
          value_normalised: f.value_normalised ?? normaliseFactValue(f.dimension, f.value),
          state: f.state,
          source: f.source,
          source_ref: messageId,
          question_id: f.question_id,
          question_intent_key: f.question_intent_key,
          confidence: f.confidence,
          observed_at: now,
          valid_until: factValidUntil(f.dimension, now, { value: f.value }),
          verified_at: null,
          set_by: null,
        },
        now,
      );
    }
    for (const s of interpretation.signals) {
      signals.push(
        toSignal(
          interpretedSignalToWrite({ leadId, serviceId: null, messageId, observedAt: now, aiAssist: false, signal: s }),
          uuid(seq++),
        ),
      );
    }
    // The previous question's asks are "answered" once its dimension is known.
    const dimensions = deriveDimensionStatuses(facts, now, statusCtx);
    const knownNow = new Set(dimensions.filter((d) => d.status === "CONFIRMED" || d.status === "INFERRED").map((d) => d.dimension));
    for (const ask of outbound) ask.answered = ask.dimension ? knownNow.has(ask.dimension) : false;

    const suppressed = interpretation.signals.some((s) => s.signal_type === "UNSUBSCRIBE");
    const intent: IntentAssessment = assessIntent(signals, now, { suppressed });
    const threshold = thresholdStatus(resolved.threshold, dimensions);
    const goal = resolveGoal({
      motion: resolved.motion,
      lead: conversation.conversionGoalType ? { conversionGoalType: conversation.conversionGoalType, qualificationRequired: true } : null,
      offerGoal: (conversation.offerProfile?.goal as never) ?? null,
      policyGoal: conversation.policy?.goal ?? null,
      engineVerdict: "PENDING",
      intentState: intent.state,
    });
    const stage = deriveConversationStage({
      firstRepliedAt: now,
      answeredCount: facts.filter((f) => f.state === "CONFIRMED" && !f.supersededAt).length,
      lastReplyObjection: interpretation.objections.length > 0,
      thresholdMet: threshold.met,
    });
    const askHistory = [...asks.entries()].map(([key, asked]) => {
      const intentDef = askedIntentFor(key);
      return { key, asked, answered: intentDef ? knownNow.has(intentDef.dimension) : false };
    });
    const { nba, input } = planNextBestAction({
      now,
      channel: conversation.channel,
      stage,
      resolved,
      goal,
      intent,
      dimensions,
      facts,
      askHistory,
      engineVerdict: "PENDING",
      qualificationScore: 0,
      suppressed,
      interpretation,
      bindingVerdict: classifyDeterministic(turn.lead)?.intent ?? null,
      policy: conversation.policy ?? {},
      checkoutAllowed: conversation.directClose ?? false,
      bookingScheduled: false,
      dealValueGbp: null,
    });

    const q = nba.question_intent;
    const asksNow = nba.next_action === "ASK" || nba.next_action === "ANSWER_AND_ASK" || (nba.next_action === "CTA_BOOK" && q !== null);
    const qa = turn.candidate
      ? runQuestionQa(
          turn.candidate.text,
          qaContextFromNba({
            nba,
            channel: conversation.channel,
            stage,
            dimensions: input.dimensions,
            forbiddenIntents: resolved.forbiddenIntents,
            inbound: turn.lead,
            interpretation,
            recentOutbound: [...outbound].reverse(),
          }),
        )
      : null;

    rows.push({
      turn: index + 1,
      at: now,
      lead: turn.lead,
      known: [...knownNow].sort(),
      intent: intent.state,
      intentScore: intent.score,
      requiredUnknown: nba.unknown_required_dimensions,
      candidates: input.candidates.slice(0, 4).map((c) => c.key),
      action: nba.next_action,
      question: q?.key ?? null,
      questionDimension: q?.dimension ?? null,
      thresholdMet: threshold.met,
      nba,
      interpretation,
      dimensions: input.dimensions,
      resolved,
      qa,
      asksSoFar: Object.fromEntries(asks),
    });

    if (asksNow && q) {
      asks.set(q.key, (asks.get(q.key) ?? 0) + 1);
      lastIntentKey = q.key;
      outbound.push({ dimension: q.dimension, answered: false });
    } else {
      lastIntentKey = null;
    }
  });

  return rows;
}

/* ============================================ B9: never ask what was said */

export type AskedQuestion = { dimension: string; purpose: string; key?: string; rendering?: string; stale?: boolean };

/**
 * B9 (manual inspection §110, MI-2): the dimensions the lead's own messages
 * state, read by the same deterministic extractors interpret() uses, each
 * message on its own (no planned question, nothing known yet). A question on
 * one of these asks the lead for something they already told us.
 */
export function statedByLead(messages: readonly string[], archetype: string, serviceNames: readonly string[] = []): Map<string, string> {
  const stated = new Map<string, string>();
  messages.forEach((text, i) => {
    const at = iso(1 + i * 2);
    const reading = interpret(text, {
      messageId: uuid(900 + i),
      now: at,
      context: { serviceNames: [...serviceNames], serviceTerms: serviceTermsFor(archetype), now: at },
    });
    for (const fact of reading.facts) if (!stated.has(fact.dimension)) stated.set(fact.dimension, fact.value);
  });
  return stated;
}

/**
 * The B9 violation for one planned question, or null. Allowed: a CLARIFY
 * (two answers disagree) and a VERIFY of a stale fact. Everything else on a
 * dimension the lead stated, a VERIFY of what they just said included, is a
 * violation.
 */
export function restatedAsk(
  messages: readonly string[],
  question: AskedQuestion | null,
  archetype: string,
  serviceNames: readonly string[] = [],
): { dimension: string; value: string } | null {
  if (!question) return null;
  if (question.purpose === "CLARIFY") return null;
  if (question.purpose === "VERIFY" && question.stale) return null;
  const value = statedByLead(messages, archetype, serviceNames).get(question.dimension);
  return value === undefined ? null : { dimension: question.dimension, value };
}

/** The per-turn table (design 08 §23), for the report and a failing assertion. */
export function renderTable(conversation: GoldenConversation, rows: TurnRow[]): string {
  const header = "| Turn | Known | Intent | Required unknown | Candidate questions | Selected action | Expected |";
  const lines = rows.map((row) => {
    const expect = conversation.turns[row.turn - 1].expect;
    const expected = `${expect.actionIn.join("/")}${expect.questionDimension !== undefined ? ` ${expect.questionDimension ?? "no question"}` : ""}`;
    return `| ${row.turn} | ${row.known.join(", ") || "-"} | ${row.intent} (${row.intentScore}) | ${row.requiredUnknown.join(", ") || "-"} | ${row.candidates.join(", ") || "-"} | ${row.action}${row.question ? ` ${row.question}` : ""} | ${expected} |`;
  });
  return [`${conversation.id}: ${conversation.story}`, header, "|---|---|---|---|---|---|---|", ...lines].join("\n");
}
