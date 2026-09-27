/**
 * Several interests per lead (08 §B.20, docs/AGENT_RUNTIME.md "Several
 * interests"). Pure: relative `.ts` imports, no server-only, no Supabase.
 *
 * A lead who wants a subscription (a direct sale) and a website rebuild (a
 * meeting) has two interests. Each is its own opportunity with its own
 * resolved goal, motion, stage, close target and qualification state. This
 * module holds every rule about them that does not need the database:
 *
 *   detection     which configured services a lead is interested in: the
 *                 service they came in on, services their own messages name,
 *                 services a form they submitted selected, and interests a
 *                 person added (opportunities / MANUAL facts);
 *   fact scope    facts every interest shares (company size, the decision
 *                 maker, timing ...) are asked once and read by all; facts
 *                 about one offer (its budget, scope, use case ...) belong to
 *                 that interest only;
 *   planning      one NBA per interest (the unchanged single-offer pipeline,
 *                 nba.ts `planNextBestAction`, over that interest's scoped
 *                 facts, offer and goal);
 *   coordination  ONE primary move per turn: the interest closest to its
 *                 close, then the one the lead just spoke about, then value.
 *                 A checkout may carry one light touch on another interest
 *                 (one question or a call suggestion) when that keeps the
 *                 reply to one clear call to action; otherwise the others
 *                 wait for a later turn;
 *   closing       each interest closes on its own; follow-up continues while
 *                 any interest is open.
 *
 * The model still decides nothing: it words the one move chosen here.
 */

import { GOAL_LABEL, CTA_ACTIONS, MOTION_DEFAULT_GOAL, nextBestActionSchema, UNMAPPED_DIMENSION } from "./types.ts";
import type {
  DimensionStatusEntry,
  FactDimension,
  GoalKey,
  IntentAssessment,
  Interpretation,
  NbaAction,
  NbaQuestionIntent,
  NextBestAction,
  OfferDisqualifier,
  QiDimensionKey,
  QualificationFact,
  QualificationFactWrite,
  QualificationPolicy,
  QuestionIntentOverride,
  ResolvedGoal,
} from "./types.ts";
import { deriveDimensionStatuses, factValidUntil, normaliseFactValue } from "./facts.ts";
import { completenessFor, resolveOffer, thresholdStatus, type ResolvedOffer } from "./offer-profile.ts";
import { deriveConversationStage, goalForConversionType, resolveGoal } from "./goals.ts";
import { planNextBestAction, type NbaDecisionInput } from "./nba.ts";
import { evaluatePredicate, factValues, type ConfiguredQuestion } from "./question-intents.ts";
import type { ConversionGoalType } from "../business-profile/types.ts";
import type { AgentChannel } from "../agent/types.ts";
import type { ConversationStage } from "../sales-library/method-router.ts";
import type { SalesMotion } from "../sales-library/types.ts";
import type { QualificationResult } from "../qualification/engine.ts";
import type { QuestionRecord } from "../qualification/next-question.ts";

export const INTEREST_VERSION = "interests-1" as const;

/* ============================================================ vocabulary */

/** Where an interest came from (opportunities.interest_source, 0144). */
export const INTEREST_SOURCES = ["LEAD_SERVICE", "MESSAGE", "FORM", "MANUAL", "OPPORTUNITY"] as const;
export type InterestSource = (typeof INTEREST_SOURCES)[number];

export const INTEREST_SOURCE_LABEL: Record<InterestSource, string> = {
  LEAD_SERVICE: "Came in on this service",
  MESSAGE: "Mentioned in a message",
  FORM: "Selected on a form",
  MANUAL: "Added by a person",
  OPPORTUNITY: "Existing opportunity",
};

/**
 * Facts about the buyer, not the offer: asked once, read by every interest.
 * Everything else (budget, scope, use case, the problem, the current
 * solution, volume ...) is about one offer and is kept per interest.
 */
export const SHARED_DIMENSIONS: readonly QiDimensionKey[] = [
  "COMPANY_SIZE",
  "TEAM_SIZE",
  "AUTHORITY",
  "STAKEHOLDERS",
  "DECISION_PROCESS",
  "TIMING",
  "LOCATION",
  "AVAILABILITY",
  "COMPLIANCE_REQUIREMENTS",
];

export function isSharedDimension(dimension: FactDimension): boolean {
  return dimension !== UNMAPPED_DIMENSION && (SHARED_DIMENSIONS as readonly string[]).includes(dimension);
}

/* ============================================================= detection */

export type InterestService = {
  id: string;
  name: string;
  /** services.offer_profile, raw. */
  offerProfile?: unknown;
  averageValue?: number | null;
};

export type DetectedInterest = {
  serviceId: string;
  source: InterestSource;
  /** The words that named it, when it came from the lead's own words. */
  evidence: string | null;
  /** The message or touch it came from. */
  sourceRef: string | null;
  observedAt: string;
};

const STOPWORDS = new Set([
  "the", "and", "for", "our", "your", "with", "from", "into", "service", "services", "package",
  "plan", "plans", "option", "options", "new", "full", "basic", "standard", "premium", "pro", "one",
]);

const NEGATION = /\b(?:no|not|don'?t|do not|doesn'?t|does not|never|without|no longer|already (?:have|got|use|using)|isn'?t|aren'?t|won'?t)\b[^.!?;,]{0,40}$/i;

function stem(token: string): string {
  return token.replace(/(?:ies)$/, "y").replace(/(?:es|s)$/, "");
}

function tokensOf(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9+&]+/g, " ")
    .split(" ")
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A word in the text, allowing the plural / singular. Returns its index or -1. */
function findWord(text: string, token: string): number {
  const base = escapeRegExp(stem(token));
  const match = new RegExp(`\\b${base}(?:s|es|ies|y)?\\b`, "i").exec(text);
  return match ? match.index : -1;
}

function negatedBefore(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 60), index);
  const clause = before.split(/[.!?;\n]|,\s*but\b|\bbut\b/i).pop() ?? "";
  return NEGATION.test(clause);
}

/**
 * The configured services a piece of the lead's own text names. A service
 * matches on its full name, on all of its significant words in any order
 * ("rebuild our website" names "Website rebuild"), or on its head noun (the
 * last significant word, "subscription" in "Growth subscription") when no
 * other service shares that word. A negated mention ("we don't need a new
 * website") names nothing. Deterministic; the order is the text order.
 */
export function servicesMentioned(
  text: string,
  services: readonly Pick<InterestService, "id" | "name">[],
): { serviceId: string; evidence: string; index: number }[] {
  const input = (text ?? "").slice(0, 4000);
  if (!input.trim()) return [];
  const tokenSets = services.map((s) => ({ service: s, tokens: tokensOf(s.name) }));
  const out: { serviceId: string; evidence: string; index: number }[] = [];
  for (const { service, tokens } of tokenSets) {
    const name = service.name.trim();
    if (name.length < 3) continue;
    let index = -1;
    let evidence = "";
    const phrase = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").exec(input);
    if (phrase) {
      index = phrase.index;
      evidence = phrase[0];
    } else if (tokens.length >= 2) {
      const positions = tokens.map((t) => findWord(input, t));
      if (positions.every((p) => p >= 0)) {
        index = Math.min(...positions);
        evidence = tokens.join(" ");
      }
    }
    if (index < 0 && tokens.length >= 1) {
      const head = tokens[tokens.length - 1];
      const shared = tokenSets.some((other) => other.service.id !== service.id && other.tokens.some((t) => stem(t) === stem(head)));
      if (!shared && head.length >= 4) {
        const at = findWord(input, head);
        if (at >= 0) {
          index = at;
          evidence = head;
        }
      }
    }
    if (index < 0 || negatedBefore(input, index)) continue;
    out.push({ serviceId: service.id, evidence, index });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** A form label that asks which service, product or plan the person wants. */
const SERVICE_CHOICE_LABEL = /\b(?:service|services|interest|interested|product|products|package|plan|help with|looking for|need|needs|requirement|enquir)/i;

function answerText(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const parts = value.filter((v): v is string | number => typeof v === "string" || typeof v === "number").map(String);
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

export type InterestDetectionInput = {
  /** leads.service_id: the service the lead came in on. */
  leadServiceId: string | null;
  leadCreatedAt: string;
  /** The workspace's active services. Anything else is never an interest. */
  services: readonly InterestService[];
  /** The lead's own inbound messages. */
  inbound: readonly { id: string; body: string | null; createdAt: string }[];
  /** Form touches the lead submitted (lead_touches.answers). */
  touches: readonly { id: string; answers: Record<string, unknown> | null; occurredAt: string }[];
  /** Opportunities already recorded for the lead (0144 service_id). */
  opportunities: readonly { serviceId: string | null; createdAt: string; interestSource?: string | null }[];
  /** Live facts: a MANUAL / ANSWER / FORM SERVICE_NEEDED fact with a service is an interest a person or an earlier turn recorded. */
  facts: readonly QualificationFact[];
};

/**
 * Every interest the lead has, one per service, first seen first. The lead's
 * own service is always first when it has one. Pure and total.
 */
export function detectInterests(input: InterestDetectionInput): DetectedInterest[] {
  const active = new Map(input.services.map((s) => [s.id, s]));
  const found = new Map<string, DetectedInterest>();
  const add = (interest: DetectedInterest) => {
    if (!active.has(interest.serviceId)) return;
    const existing = found.get(interest.serviceId);
    if (!existing || Date.parse(interest.observedAt) < Date.parse(existing.observedAt)) {
      // Keep the lead's own service labelled as such whatever else named it.
      if (existing?.source === "LEAD_SERVICE") return;
      found.set(interest.serviceId, interest);
    }
  };
  if (input.leadServiceId) {
    add({ serviceId: input.leadServiceId, source: "LEAD_SERVICE", evidence: null, sourceRef: null, observedAt: input.leadCreatedAt });
  }
  for (const opp of input.opportunities) {
    if (!opp.serviceId) continue;
    const source = (INTEREST_SOURCES as readonly string[]).includes(opp.interestSource ?? "") ? (opp.interestSource as InterestSource) : "OPPORTUNITY";
    add({ serviceId: opp.serviceId, source, evidence: null, sourceRef: null, observedAt: opp.createdAt });
  }
  for (const fact of input.facts) {
    if (fact.dimension !== "SERVICE_NEEDED" || !fact.serviceId || fact.supersededAt || fact.state === "REJECTED") continue;
    // Only a fact recorded as an interest; a plain SERVICE_NEEDED answer on the
    // lead's own service is that service.
    if (!(fact.sourceRef ?? "").includes("#interest")) continue;
    const source: InterestSource = fact.source === "MANUAL" ? "MANUAL" : fact.source === "FORM" ? "FORM" : "MESSAGE";
    add({ serviceId: fact.serviceId, source, evidence: fact.value, sourceRef: fact.sourceRef, observedAt: fact.observedAt });
  }
  for (const touch of input.touches) {
    for (const [label, raw] of Object.entries(touch.answers ?? {})) {
      const value = answerText(raw);
      if (!value) continue;
      const labelled = SERVICE_CHOICE_LABEL.test(label);
      for (const hit of servicesMentioned(value, input.services)) {
        // Outside a service-choice question only an exact name counts.
        if (!labelled && hit.evidence.toLowerCase() !== (active.get(hit.serviceId)?.name ?? "").toLowerCase()) continue;
        add({ serviceId: hit.serviceId, source: "FORM", evidence: hit.evidence, sourceRef: `touch:${touch.id}`, observedAt: touch.occurredAt });
      }
    }
  }
  for (const message of input.inbound) {
    for (const hit of servicesMentioned(message.body ?? "", input.services)) {
      add({ serviceId: hit.serviceId, source: "MESSAGE", evidence: hit.evidence, sourceRef: message.id, observedAt: message.createdAt });
    }
  }
  const list = [...found.values()];
  return list.sort((a, b) => {
    if (a.serviceId === input.leadServiceId) return -1;
    if (b.serviceId === input.leadServiceId) return 1;
    return Date.parse(a.observedAt) - Date.parse(b.observedAt) || a.serviceId.localeCompare(b.serviceId);
  });
}

/**
 * The SERVICE_NEEDED fact that records a detected interest, so it survives
 * without the 0144 opportunity columns and the interest's own SERVICE_NEEDED
 * is known (never asked). The source ref is unique per (event, service).
 */
export function interestFactWrite(input: {
  leadId: string;
  interest: DetectedInterest;
  serviceName: string;
  setBy?: string | null;
}): QualificationFactWrite | null {
  const { interest } = input;
  if (interest.source === "LEAD_SERVICE" || interest.source === "OPPORTUNITY") return null;
  const value = input.serviceName.trim().slice(0, 500);
  if (!value) return null;
  const source = interest.source === "MANUAL" ? "MANUAL" : interest.source === "FORM" ? "FORM" : "ANSWER";
  const ref = `${interest.sourceRef ?? interest.source.toLowerCase()}#interest:${interest.serviceId}`.slice(0, 200);
  return {
    lead_id: input.leadId,
    service_id: interest.serviceId,
    dimension: "SERVICE_NEEDED",
    value,
    value_normalised: normaliseFactValue("SERVICE_NEEDED", value),
    state: "CONFIRMED",
    source,
    source_ref: ref,
    question_id: null,
    question_intent_key: null,
    confidence: interest.source === "MANUAL" ? 1 : 0.95,
    observed_at: interest.observedAt,
    valid_until: factValidUntil("SERVICE_NEEDED", interest.observedAt, { value }),
    verified_at: interest.source === "MANUAL" ? interest.observedAt : null,
    set_by: input.setBy ?? null,
  };
}

/* =========================================================== fact scope */

export type InterestScope = {
  /** The lead's own service (a fact with no service belongs to it). */
  primaryServiceId: string | null;
  /** Every interest's service. Fewer than two: nothing is scoped. */
  interestServiceIds: readonly string[];
};

function ownerOf(serviceId: string | null, scope: InterestScope): string | null {
  if (serviceId && scope.interestServiceIds.includes(serviceId)) return serviceId;
  return scope.primaryServiceId ?? scope.interestServiceIds[0] ?? null;
}

/**
 * The facts one interest reads: every shared dimension, and its own
 * per-offer facts. A per-offer fact with no service (a person's confirm, an
 * old row) or with a service that is no longer an interest belongs to the
 * lead's own service. With fewer than two interests nothing changes.
 */
export function factsForInterest<F extends Pick<QualificationFact, "dimension" | "serviceId">>(
  facts: readonly F[],
  serviceId: string,
  scope: InterestScope,
): F[] {
  if (scope.interestServiceIds.length < 2) return [...facts];
  return facts.filter((f) => isSharedDimension(f.dimension) || ownerOf(f.serviceId, scope) === serviceId);
}

/**
 * The live facts a new fact is merged against (facts.ts mergeFact): all of
 * them for a shared dimension, only the same interest's for a per-offer one,
 * so the website's budget never conflicts with the subscription's.
 */
export function factsInMergeScope<F extends Pick<QualificationFact, "dimension" | "serviceId">>(
  existing: readonly F[],
  write: Pick<QualificationFactWrite, "dimension" | "service_id">,
  scope: InterestScope,
): F[] {
  if (scope.interestServiceIds.length < 2 || isSharedDimension(write.dimension)) return [...existing];
  const target = ownerOf(write.service_id, scope);
  return existing.filter((f) => ownerOf(f.serviceId, scope) === target);
}

/**
 * The interest a reply's per-offer facts belong to: the one interest it
 * names; otherwise the interest the last message was about (the focus);
 * otherwise the lead's own service.
 */
export function attributeReply(input: {
  text: string | null;
  services: readonly Pick<InterestService, "id" | "name">[];
  interestServiceIds: readonly string[];
  focusServiceId: string | null;
  primaryServiceId: string | null;
}): string | null {
  const interestServices = input.services.filter((s) => input.interestServiceIds.includes(s.id));
  const named = [...new Set(servicesMentioned(input.text ?? "", interestServices).map((m) => m.serviceId))];
  if (named.length === 1) return named[0];
  if (input.focusServiceId && input.interestServiceIds.includes(input.focusServiceId)) return input.focusServiceId;
  return input.primaryServiceId ?? input.interestServiceIds[0] ?? null;
}

/* ============================================================ planning */

/** Everything every interest's plan shares (the lead, the turn, the workspace). */
export type SharedInterestContext = {
  now: string;
  channel: AgentChannel | null;
  leadId: string;
  /** leads.service_id */
  primaryServiceId: string | null;
  interestServiceIds: string[];
  intent: IntentAssessment;
  /** Every live fact of the lead (scoped per interest here). */
  facts: readonly QualificationFact[];
  archetypeKey: string | null;
  workspaceMotion: SalesMotion | null;
  workspacePolicy: QualificationPolicy | null;
  /** The lead's own conversion goal: it applies to the service the lead came in on. */
  leadConversionGoal: { type: ConversionGoalType; qualificationRequired: boolean | null } | null;
  workspaceDefaultGoal: { type: ConversionGoalType; qualificationRequired: boolean } | null;
  engineVerdict: QualificationResult;
  configuredQuestions: readonly ConfiguredQuestion[];
  answeredQuestionIds: readonly string[];
  intentOverrides: Readonly<Record<string, QuestionIntentOverride>>;
  askHistory: readonly { key: string; asked: number; answered: boolean }[];
  qualificationScore: number;
  suppressed: boolean;
  interpretation: Interpretation | null;
  bindingVerdict: string | null;
  /** A planned re-engagement check-in is due this turn (nba.ts checkInDue). */
  checkInDue?: boolean;
  /** A booking is scheduled for the lead. */
  leadBookingScheduled: boolean;
  leadStatus: string | null;
  firstRepliedAt: string | null;
  answeredCount: number;
  lastReplyObjection: boolean;
  /** An explicit turn stage (an objection) overrides the derived one. */
  explicitStage: ConversationStage | null;
  leadEstimatedValue: number | null;
  /** Dimensions a hard_fail rule names, and whether a postcode rule exists. */
  ruleDimensions: readonly QiDimensionKey[];
  serviceAreaRule: boolean;
  inferDimension?: (question: QuestionRecord) => QiDimensionKey | null;
  /** The last message's focus interest (decision_json.interests.primary). */
  focusServiceId: string | null;
};

/** One interest's own inputs. */
export type InterestSpec = {
  serviceId: string;
  serviceName: string;
  source: InterestSource;
  offerProfileRaw: unknown;
  averageValue: number | null;
  servicePolicy: QualificationPolicy | null;
  overrideDisqualifiers: readonly OfferDisqualifier[];
  opportunity: { id: string; stage: string; outcome: string; value: number | null } | null;
  /** The direct-close gate for THIS offer (its motion, its link). */
  checkoutAllowed: boolean;
  checkoutLinkId: string | null;
};

export type InterestPlan = {
  serviceId: string;
  serviceName: string;
  source: InterestSource;
  isLeadService: boolean;
  resolved: ResolvedOffer;
  goal: ResolvedGoal;
  motion: SalesMotion;
  stage: ConversationStage;
  dimensions: DimensionStatusEntry[];
  completeness: number;
  thresholdMet: boolean;
  dealValueGbp: number | null;
  bookingScheduled: boolean;
  opportunity: InterestSpec["opportunity"];
  checkoutLinkId: string | null;
  checkoutAllowed: boolean;
  /** The lead's latest message names this interest. */
  mentioned: boolean;
  nba: NextBestAction;
  input: NbaDecisionInput;
};

const MEETING_GOALS: readonly GoalKey[] = ["B_BOOK_MEETING", "E_HUMAN_CLOSER"];
const MEETING_STAGE_RANK = 4; // opportunity_stage_rank('MEETING_BOOKED')
const OPP_STAGE_ORDER = ["OPEN", "QUALIFYING", "QUALIFIED", "MEETING_BOOKED", "PROPOSAL", "CHECKOUT_SENT", "NEGOTIATION"];

export function opportunityStageRank(stage: string | null | undefined): number {
  return OPP_STAGE_ORDER.indexOf(stage ?? "") + 1;
}

/**
 * Plans every interest: resolve its offer and goal, scope its facts, derive
 * its dimensions, and run the unchanged single-offer NBA. Pure.
 */
export function planInterests(
  shared: SharedInterestContext,
  specs: readonly InterestSpec[],
  latestMessage: string | null,
  services: readonly Pick<InterestService, "id" | "name">[],
): InterestPlan[] {
  const scope: InterestScope = { primaryServiceId: shared.primaryServiceId, interestServiceIds: shared.interestServiceIds };
  const mentioned = new Set(servicesMentioned(latestMessage ?? "", services.filter((s) => shared.interestServiceIds.includes(s.id))).map((m) => m.serviceId));

  // Goals first: which interests close with a meeting decides who owns the lead's booking.
  const staged = specs.map((spec) => {
    const isLeadService = spec.serviceId === shared.primaryServiceId || (!shared.primaryServiceId && spec === specs[0]);
    const resolved = resolveOffer({
      archetypeKey: shared.archetypeKey,
      workspaceMotion: shared.workspaceMotion,
      offerProfileRaw: spec.offerProfileRaw ?? {},
      averageValue: spec.averageValue,
      workspacePolicy: shared.workspacePolicy,
      servicePolicy: spec.servicePolicy,
      overrideDisqualifiers: [...spec.overrideDisqualifiers],
    });
    const facts = factsForInterest(shared.facts, spec.serviceId, scope);
    const confirmedValues = factValues(facts, shared.now, { includeAi: false, confirmedOnly: true });
    const confirmedDisqualifier = resolved.disqualifiers.some((d) =>
      evaluatePredicate(d.when, { values: confirmedValues, intentState: shared.intent.state }),
    );
    const dealValueGbp =
      isLeadService && typeof shared.leadEstimatedValue === "number" && shared.leadEstimatedValue > 0
        ? shared.leadEstimatedValue
        : typeof spec.opportunity?.value === "number" && spec.opportunity.value > 0
          ? spec.opportunity.value
          : (resolved.offer.averageDealValue ?? null);
    const policy: QualificationPolicy = { ...(shared.workspacePolicy ?? {}), ...(spec.servicePolicy ?? {}) };
    const goal = resolveGoal({
      motion: resolved.motion,
      // The lead's conversion goal came with the service they enquired about.
      lead: isLeadService && shared.leadConversionGoal
        ? { conversionGoalType: shared.leadConversionGoal.type, qualificationRequired: shared.leadConversionGoal.qualificationRequired }
        : null,
      offerGoal: offerGoalFor(spec, resolved),
      policyGoal: spec.servicePolicy?.goal ?? shared.workspacePolicy?.goal ?? null,
      workspaceDefaultGoal: isLeadService ? shared.workspaceDefaultGoal : null,
      engineVerdict: shared.engineVerdict,
      confirmedDisqualifier,
      intentState: shared.intent.state,
      dealValueGbp,
      humanCloserAboveValue: policy.humanCloserAboveValue ?? null,
    });
    return { spec, isLeadService, resolved, facts, dealValueGbp, policy, goal };
  });
  const meetingInterests = staged.filter((s) => MEETING_GOALS.includes(s.goal.goal)).length;

  return staged.map(({ spec, isLeadService, resolved, facts, dealValueGbp, policy, goal }) => {
    const required = [...new Set<QiDimensionKey>([...resolved.threshold.allOf, ...resolved.threshold.anyOf, ...resolved.requiredDimensions])];
    const dimensions = deriveDimensionStatuses(facts, shared.now, {
      planDimensions: resolved.plan,
      required,
      requiredDimensions: resolved.requiredDimensions,
      ruleDimensions: [...shared.ruleDimensions, ...resolved.disqualifiers.map((d) => d.dimension)],
      serviceAreaRule: shared.serviceAreaRule,
    });
    const completeness = completenessFor(resolved, dimensions);
    const threshold = thresholdStatus(resolved.threshold, dimensions);
    const bookingScheduled =
      opportunityStageRank(spec.opportunity?.stage) >= MEETING_STAGE_RANK && spec.opportunity?.stage !== "CHECKOUT_SENT"
        ? true
        : shared.leadBookingScheduled && (isLeadService || meetingInterests <= 1) && MEETING_GOALS.includes(goal.goal);
    const stage = deriveConversationStage({
      leadStatus: shared.leadStatus === "BOOKED" && !bookingScheduled ? null : shared.leadStatus,
      firstRepliedAt: shared.firstRepliedAt,
      answeredCount: shared.answeredCount,
      bookingScheduled,
      lastReplyObjection: shared.lastReplyObjection,
      thresholdMet: threshold.met,
      explicit: shared.explicitStage,
    });
    const planned = planNextBestAction({
      now: shared.now,
      channel: shared.channel,
      stage,
      resolved,
      goal,
      intent: shared.intent,
      dimensions,
      facts,
      configuredQuestions: shared.configuredQuestions,
      serviceId: spec.serviceId,
      answeredQuestionIds: shared.answeredQuestionIds,
      intentOverrides: shared.intentOverrides,
      askHistory: shared.askHistory,
      engineVerdict: shared.engineVerdict,
      qualificationScore: shared.qualificationScore,
      completeness,
      suppressed: shared.suppressed,
      interpretation: shared.interpretation,
      bindingVerdict: shared.bindingVerdict,
      checkInDue: shared.checkInDue === true,
      policy,
      checkoutAllowed: spec.checkoutAllowed,
      bookingScheduled,
      dealValueGbp,
      inferDimension: shared.inferDimension,
    });
    return {
      serviceId: spec.serviceId,
      serviceName: spec.serviceName,
      source: spec.source,
      isLeadService,
      resolved,
      goal,
      motion: goal.motion,
      stage,
      dimensions: planned.input.dimensions,
      completeness,
      thresholdMet: threshold.met,
      dealValueGbp,
      bookingScheduled,
      opportunity: spec.opportunity,
      checkoutLinkId: spec.checkoutLinkId,
      checkoutAllowed: spec.checkoutAllowed,
      mentioned: mentioned.has(spec.serviceId),
      nba: planned.nba,
      input: planned.input,
    };
  });
}

/**
 * An offer's own goal: the one its profile or its service policy states;
 * else, when the offer sets its own motion, that motion's default goal. A
 * subscription sold self-serve closes with a sign-up even in a workspace
 * whose general goal is a meeting.
 */
function offerGoalFor(spec: InterestSpec, resolved: ResolvedOffer): GoalKey | null {
  const stated = storedOfferGoal(spec.offerProfileRaw) ?? spec.servicePolicy?.goal ?? null;
  if (stated) return stated;
  if (resolved.motionSource === "OFFER_PROFILE" || resolved.motionSource === "SERVICE_POLICY") return MOTION_DEFAULT_GOAL[resolved.motion];
  return null;
}

/** The goal stored on the offer profile itself (never a default). */
function storedOfferGoal(raw: unknown): GoalKey | null {
  if (!raw || typeof raw !== "object") return null;
  const goal = (raw as { goal?: unknown }).goal;
  return typeof goal === "string" && goal in GOAL_LABEL ? (goal as GoalKey) : null;
}

/** Re-exported for callers that map a lead conversion goal themselves. */
export { goalForConversionType };

/* ========================================================= coordination */

export const COORDINATOR_RULES = [
  "SINGLE_INTEREST",
  "LEAD_LEVEL",
  "CLOSEST_TO_CLOSE",
  "ALL_WAITING",
  "ALL_DISQUALIFIED",
  "ALL_CLOSED",
] as const;
export type CoordinatorRule = (typeof COORDINATOR_RULES)[number];

export const COMPANION_KINDS = ["ASK", "PROPOSE_CALL", "ANSWER"] as const;
export type CompanionKind = (typeof COMPANION_KINDS)[number];

export type Companion = {
  serviceId: string;
  serviceName: string;
  kind: CompanionKind;
  /** ASK: the one question, as the other interest's NBA planned it. */
  question: NbaQuestionIntent | null;
};

export type Coordination = {
  rule: CoordinatorRule;
  primary: InterestPlan;
  /** The move for the turn: the primary interest's NBA (a lead-level override when every interest is closed). */
  nba: NextBestAction;
  companion: Companion | null;
  /** Open interests picked up in a later turn. */
  waiting: { serviceId: string; serviceName: string; action: NbaAction }[];
  reason: string;
};

const SILENT: readonly NbaAction[] = ["WAIT", "NO_ACTION", "DISQUALIFY"];
const ACTIVE: readonly NbaAction[] = ["ASK", "ANSWER_AND_ASK", "ANSWER", "INFORM", "NURTURE", "CTA_BOOK", "CTA_CHECKOUT", "CTA_SIGNUP"];

/** How near an interest is to its close: the tier of its move, then its stage and completeness. */
export function closeness(plan: Pick<InterestPlan, "nba" | "opportunity" | "completeness" | "thresholdMet">): number {
  const action = plan.nba.next_action;
  let tier = 0;
  if ((CTA_ACTIONS as readonly string[]).includes(action)) tier = 3;
  else if (plan.thresholdMet && (action === "INFORM" || action === "ANSWER")) tier = 2;
  else if (action === "ASK" || action === "ANSWER_AND_ASK" || action === "ANSWER" || action === "INFORM") tier = 1;
  else if (action === "NURTURE") tier = 0.5;
  return tier * 100 + opportunityStageRank(plan.opportunity?.stage) * 10 + Math.round(plan.completeness * 9);
}

function isOpen(plan: InterestPlan): boolean {
  return !plan.opportunity || plan.opportunity.outcome === "OPEN";
}

/** Primary ordering: closest to close, then the one the lead just named, then value, then the lead's own service. */
export function rankPlans(plans: readonly InterestPlan[]): InterestPlan[] {
  return [...plans].sort(
    (a, b) =>
      closeness(b) - closeness(a) ||
      Number(b.mentioned) - Number(a.mentioned) ||
      (b.dealValueGbp ?? 0) - (a.dealValueGbp ?? 0) ||
      Number(b.isLeadService) - Number(a.isLeadService) ||
      a.serviceId.localeCompare(b.serviceId),
  );
}

/**
 * Picks ONE primary move for the turn (one question per turn still holds).
 *
 *   1. Lead-level rules bind every interest: a binding verdict, an opt-out or
 *      negative intent (R1/R2), and a hand-over (ESCALATE, a last resort)
 *      win outright.
 *   2. Closed interests (WON / LOST) are done; a disqualified or waiting one
 *      is not pursued this turn.
 *   3. Among the rest: closest to its close, then the interest the lead just
 *      named, then deal value.
 *   4. A checkout / sign-up link may carry one light touch on the next
 *      interest (one planned question, or "would a quick call about X
 *      help?", no times named), and the lead's question about another
 *      interest is always answered; everything else waits for a later turn.
 */
export function coordinateInterests(
  plans: readonly InterestPlan[],
  options: { channel: AgentChannel | null; leadAskedQuestion?: boolean } = { channel: null },
): Coordination {
  if (plans.length === 0) throw new Error("coordinateInterests: no interests");
  if (plans.length === 1) {
    return { rule: "SINGLE_INTEREST", primary: plans[0], nba: plans[0].nba, companion: null, waiting: [], reason: "One interest." };
  }
  const leadLevel = plans.find(
    (p) => p.nba.rule === "R1_BINDING_VERDICT" || p.nba.rule === "R2_NEGATIVE_OR_SUPPRESSED" || p.nba.next_action === "ESCALATE",
  );
  if (leadLevel) {
    return {
      rule: "LEAD_LEVEL",
      primary: leadLevel,
      nba: leadLevel.nba,
      companion: null,
      waiting: [],
      reason: `A lead-level rule (${leadLevel.nba.rule}) decides for every interest.`,
    };
  }
  const open = plans.filter(isOpen);
  if (open.length === 0) {
    const last = rankPlans(plans)[0];
    return { rule: "ALL_CLOSED", primary: last, nba: silence(last.nba, "Every interest is closed: nothing to pursue."), companion: null, waiting: [], reason: "Every interest is closed." };
  }
  const active = open.filter((p) => ACTIVE.includes(p.nba.next_action) && !(p.nba.next_action === "NO_ACTION"));
  if (active.length === 0) {
    const waiting = open.filter((p) => p.nba.next_action === "WAIT").sort((a, b) => (a.nba.resume_at ?? "").localeCompare(b.nba.resume_at ?? ""));
    if (waiting.length > 0) {
      return { rule: "ALL_WAITING", primary: waiting[0], nba: waiting[0].nba, companion: null, waiting: [], reason: "Every open interest is waiting; resume at the earliest." };
    }
    const disqualified = open.filter((p) => p.nba.next_action === "DISQUALIFY");
    if (disqualified.length === open.length) {
      const suppressing = disqualified.find((p) => p.nba.suppress) ?? disqualified[0];
      return { rule: "ALL_DISQUALIFIED", primary: suppressing, nba: suppressing.nba, companion: null, waiting: [], reason: "Every open interest is disqualified." };
    }
    const done = rankPlans(open)[0];
    return { rule: "ALL_CLOSED", primary: done, nba: done.nba, companion: null, waiting: [], reason: "Nothing to do on any open interest this turn." };
  }

  const ranked = rankPlans(active);
  const primary = ranked[0];
  const others = ranked.slice(1);
  const companion = companionFor(primary, others, options);
  const waiting = open
    .filter((p) => p.serviceId !== primary.serviceId && p.serviceId !== companion?.serviceId)
    .map((p) => ({ serviceId: p.serviceId, serviceName: p.serviceName, action: p.nba.next_action }));
  const why = primary.mentioned && ranked.length > 1 && closeness(ranked[1]) === closeness(primary)
    ? `${primary.serviceName} is as close to its close as any, and the lead just named it.`
    : `${primary.serviceName} is closest to its close (${primary.nba.next_action}).`;
  return {
    rule: "CLOSEST_TO_CLOSE",
    primary,
    nba: primary.nba,
    companion,
    waiting,
    reason: `${why}${companion ? ` With a light touch on ${companion.serviceName}.` : waiting.length ? ` ${waiting.map((w) => w.serviceName).join(", ")} next.` : ""}`.slice(0, 300),
  };
}

/** A lead-level silent NBA from a plan (every interest closed). */
function silence(nba: NextBestAction, reason: string): NextBestAction {
  const parsed = nextBestActionSchema.safeParse({
    ...nba,
    next_action: "NO_ACTION",
    question_intent: null,
    question_value: null,
    handover_reason: null,
    assist_reason: null,
    resume_at: null,
    suppress: false,
    model_call_required: false,
    expected_information_gain: 0,
    reason,
  });
  return parsed.success ? parsed.data : nba;
}

/**
 * One light touch on another interest, or none. Allowed only where the reply
 * stays one clear call to action with at most one question:
 *   - the lead asked about another interest: answer it (no extra question);
 *   - after a checkout / sign-up link (which asks nothing): the next
 *     interest's one planned question, or, when that interest is ready to
 *     book, "would a quick call about it help?" with no day or time named.
 * On SMS only the call suggestion and an answer are allowed (length).
 */
export function companionFor(
  primary: InterestPlan,
  others: readonly InterestPlan[],
  options: { channel: AgentChannel | null; leadAskedQuestion?: boolean },
): Companion | null {
  if (primary.nba.assist_reason === "QUALIFICATION_REVIEW") return null;
  const eligible = others.filter(
    (p) => isOpen(p) && !SILENT.includes(p.nba.next_action) && p.nba.next_action !== "ESCALATE" && p.nba.assist_reason !== "QUALIFICATION_REVIEW",
  );
  // The lead asked about another interest this turn: it is answered.
  const asked = options.leadAskedQuestion
    ? eligible.find((p) => p.mentioned && (p.nba.next_action === "ANSWER" || p.nba.next_action === "ANSWER_AND_ASK"))
    : null;
  if (asked && !primary.mentioned) return { serviceId: asked.serviceId, serviceName: asked.serviceName, kind: "ANSWER", question: null };

  const closesByLink = primary.nba.next_action === "CTA_CHECKOUT" || primary.nba.next_action === "CTA_SIGNUP";
  if (!closesByLink || primary.nba.question_intent) return null;
  const sms = options.channel === "sms" || options.channel === "whatsapp";
  for (const p of eligible) {
    if (p.nba.next_action === "CTA_BOOK" && !p.nba.question_intent && !p.bookingScheduled) {
      return { serviceId: p.serviceId, serviceName: p.serviceName, kind: "PROPOSE_CALL", question: null };
    }
    if (!sms && p.nba.next_action === "ASK" && p.nba.question_intent && p.nba.question_intent.purpose === "DISCOVER") {
      return { serviceId: p.serviceId, serviceName: p.serviceName, kind: "ASK", question: p.nba.question_intent };
    }
  }
  return null;
}

/* ====================================================== the turn's words */

/**
 * The lines the NBA strategy block adds for a lead with several interests:
 * which offer this turn is about, the approved link for it, the one light
 * touch, and what is left for later. Never the plan for the others.
 */
export function interestStrategyLines(coordination: Coordination): string[] {
  if (coordination.rule === "SINGLE_INTEREST") return [];
  const { primary, companion, nba } = coordination;
  const lines = [`This turn is about ${primary.serviceName} (${GOAL_LABEL[primary.goal.goal].toLowerCase()}).`];
  if ((nba.next_action === "CTA_CHECKOUT" || nba.next_action === "CTA_SIGNUP") && primary.checkoutLinkId) {
    lines.push(`For ${primary.serviceName} use checkout_link_id ${primary.checkoutLinkId}.`);
  }
  if (companion?.kind === "ASK" && companion.question) {
    lines.push(`After the link, one short sentence on ${companion.serviceName}: ask only this: ${companion.question.rendering}`);
  } else if (companion?.kind === "PROPOSE_CALL") {
    lines.push(`After the link, one short sentence on ${companion.serviceName}: ask whether a quick call about it would help. Name no day or time.`);
  } else if (companion?.kind === "ANSWER") {
    lines.push(`They also asked about ${companion.serviceName}: answer that briefly from the offer card. Ask nothing more about it.`);
  }
  if (coordination.waiting.length > 0) {
    lines.push(`Do not raise ${coordination.waiting.map((w) => w.serviceName).join(" or ")} in this message; it comes later.`);
  }
  return lines;
}

/** decision_json.interests on the agent run: what was coordinated. */
export type InterestTurnRecord = {
  version: typeof INTEREST_VERSION;
  rule: CoordinatorRule;
  primary: { serviceId: string; serviceName: string; goal: GoalKey; action: NbaAction };
  companion: { serviceId: string; kind: CompanionKind; questionIntent: string | null } | null;
  interests: { serviceId: string; goal: GoalKey; action: NbaAction; rule: string; outcome: string; mentioned: boolean }[];
  reason: string;
};

export function interestTurnRecord(coordination: Coordination, plans: readonly InterestPlan[]): InterestTurnRecord {
  return {
    version: INTEREST_VERSION,
    rule: coordination.rule,
    primary: {
      serviceId: coordination.primary.serviceId,
      serviceName: coordination.primary.serviceName.slice(0, 120),
      goal: coordination.primary.goal.goal,
      action: coordination.nba.next_action,
    },
    companion: coordination.companion
      ? { serviceId: coordination.companion.serviceId, kind: coordination.companion.kind, questionIntent: coordination.companion.question?.key ?? null }
      : null,
    interests: plans.slice(0, 10).map((p) => ({
      serviceId: p.serviceId,
      goal: p.goal.goal,
      action: p.nba.next_action,
      rule: p.nba.rule,
      outcome: p.opportunity?.outcome ?? "OPEN",
      mentioned: p.mentioned,
    })),
    reason: coordination.reason.slice(0, 300),
  };
}

/** The last run's focus interest, read back from decision_json.interests. */
export function focusFromRecord(decision: unknown): string | null {
  const record = (decision as { interests?: { primary?: { serviceId?: unknown } } } | null)?.interests;
  const id = record?.primary?.serviceId;
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/** opportunities.nba (0144): a small summary of an interest's plan. */
export function interestNbaSummary(plan: InterestPlan): {
  action: NbaAction;
  rule: string;
  reason: string;
  question: string | null;
  goal: GoalKey;
  version: typeof INTEREST_VERSION;
} {
  return {
    action: plan.nba.next_action,
    rule: plan.nba.rule,
    reason: plan.nba.reason.slice(0, 300),
    question: plan.nba.question_intent?.rendering.slice(0, 300) ?? null,
    goal: plan.goal.goal,
    version: INTEREST_VERSION,
  };
}

/** The interest's own qualification state from its plan and the lead's rules. */
export function interestQualificationState(plan: InterestPlan, engineVerdict: QualificationResult): "PENDING" | "QUALIFIED" | "NOT_QUALIFIED" | "REVIEW" {
  if (plan.nba.next_action === "DISQUALIFY" || plan.goal.goal === "G_DISQUALIFY" || engineVerdict === "NOT_QUALIFIED") return "NOT_QUALIFIED";
  if (engineVerdict === "REVIEW" || plan.nba.assist_reason === "QUALIFICATION_REVIEW") return "REVIEW";
  if (plan.thresholdMet && engineVerdict !== "PENDING") return "QUALIFIED";
  if (plan.thresholdMet && (CTA_ACTIONS as readonly string[]).includes(plan.nba.next_action)) return "QUALIFIED";
  return "PENDING";
}

/* ================================================================ closing */

/**
 * Follow-up carries on while any interest is open and the lead has not
 * opted out: winning the subscription does not stop the website rebuild.
 */
export function followUpContinues(
  interests: readonly { outcome: string }[],
  lead: { optedOut: boolean },
): boolean {
  if (lead.optedOut) return false;
  return interests.some((i) => i.outcome === "OPEN");
}

/** The lead's status once an interest closes (mirrors close_opportunity, 0144). */
export function leadStatusAfterClose(
  interests: readonly { outcome: string }[],
  current: string | null,
): string | null {
  if (interests.some((i) => i.outcome === "OPEN")) return current === "WON" || current === "LOST" ? null : current;
  return interests.some((i) => i.outcome === "WON") ? "WON" : "LOST";
}

export type OpenInterestOpportunity = {
  id: string;
  serviceId: string | null;
  stage: string;
  closeTarget: string;
  goal: string | null;
  createdAt: string;
};

/**
 * Which open opportunity a funnel event belongs to when a lead has several:
 * the named service's; for a checkout, the service the link sells; for a
 * booking, a meeting-goal interest; otherwise the lead's own service. Null
 * means "the legacy one-per-lead rule" (no or one open opportunity).
 */
export function pickInterestForEvent(
  open: readonly OpenInterestOpportunity[],
  event: "QUALIFIED" | "MEETING_BOOKED" | "CHECKOUT_SENT",
  hint: { serviceId?: string | null; leadServiceId?: string | null },
): OpenInterestOpportunity | null {
  const withService = open.filter((o) => o.serviceId);
  if (withService.length < 2) return null;
  if (hint.serviceId) {
    const named = withService.find((o) => o.serviceId === hint.serviceId);
    if (named) return named;
  }
  const meeting = (o: OpenInterestOpportunity) =>
    o.goal ? MEETING_GOALS.includes(o.goal as GoalKey) : ["BOOK", "QUOTE", "NEXT_STAGE", "PROPOSAL"].includes(o.closeTarget);
  const direct = (o: OpenInterestOpportunity) =>
    o.goal ? o.goal === "C_DIRECT_SALE" || o.goal === "D_SIGNUP_TRIAL" : ["BUY", "TRIAL"].includes(o.closeTarget);
  const own = withService.find((o) => o.serviceId === hint.leadServiceId) ?? null;
  if (event === "MEETING_BOOKED") {
    const candidates = withService.filter(meeting).filter((o) => opportunityStageRank(o.stage) < MEETING_STAGE_RANK);
    if (own && candidates.includes(own)) return own;
    return candidates[0] ?? own;
  }
  if (event === "CHECKOUT_SENT") {
    const candidates = withService.filter(direct);
    if (own && candidates.includes(own)) return own;
    return candidates[0] ?? own;
  }
  return own ?? withService[0];
}

/**
 * The interest (service) a funnel event advances, or null for the legacy
 * one-per-lead path. A service named by the event (the turn's focused
 * interest) or by the approved checkout link it sends wins; a named service
 * that is not the lead's own and has no open opportunity yet is a NEW
 * interest and gets its own row, rather than moving the lead's own one (story
 * S1: the subscription's checkout used to advance the website opportunity,
 * because the subscription's row is only created later by the assessment).
 */
export function interestServiceForEvent(
  open: readonly OpenInterestOpportunity[],
  event: "QUALIFIED" | "MEETING_BOOKED" | "CHECKOUT_SENT",
  hint: { serviceId?: string | null; linkServiceId?: string | null; leadServiceId?: string | null },
): { serviceId: string | null; picked: OpenInterestOpportunity | null } {
  const named = hint.serviceId ?? (event === "CHECKOUT_SENT" ? hint.linkServiceId ?? null : null);
  const picked = pickInterestForEvent(open, event, { serviceId: named, leadServiceId: hint.leadServiceId ?? null });
  if (picked?.serviceId) return { serviceId: picked.serviceId, picked };
  if (named && named !== (hint.leadServiceId ?? null) && !open.some((o) => o.serviceId === named)) return { serviceId: named, picked: null };
  return { serviceId: null, picked: null };
}

/* ================================================================ checkout */

export type CheckoutLinkLike = { id: string; label: string; product: string };

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The approved checkout link for one offer: the one its offer profile names
 * (`checkoutLinkId`), else the link whose product or label names the
 * service, else none (never another offer's link). A workspace with one
 * interest keeps the old rule (the first link) in the caller.
 */
export function checkoutLinkForService(
  links: readonly CheckoutLinkLike[],
  service: Pick<InterestService, "id" | "name" | "offerProfile">,
): CheckoutLinkLike | null {
  const configured = (service.offerProfile as { checkoutLinkId?: unknown } | null | undefined)?.checkoutLinkId;
  if (typeof configured === "string") {
    const hit = links.find((l) => l.id === configured);
    if (hit) return hit;
  }
  const name = norm(service.name);
  if (!name) return null;
  const exact = links.find((l) => norm(l.product) === name || norm(l.label) === name);
  if (exact) return exact;
  const mentions = links.filter((l) => servicesMentioned(`${l.product} ${l.label}`, [{ id: service.id, name: service.name }]).length > 0);
  return mentions.length === 1 ? mentions[0] : null;
}

/** The service a checkout link sells, among the lead's interests. */
export function serviceForCheckoutLink(
  links: readonly CheckoutLinkLike[],
  services: readonly Pick<InterestService, "id" | "name" | "offerProfile">[],
  linkId: string | null | undefined,
): string | null {
  if (!linkId) return null;
  const hits = services.filter((s) => checkoutLinkForService(links, s)?.id === linkId);
  return hits.length === 1 ? hits[0].id : null;
}

/* ================================================================ the UI */

export type InterestCard = {
  serviceId: string | null;
  opportunityId: string | null;
  offer: string;
  goal: GoalKey | null;
  goalLabel: string;
  stage: string;
  outcome: string;
  nextAction: string | null;
  nextActionReason: string | null;
  value: number | null;
  currency: string;
  source: InterestSource | null;
  qualificationState: string | null;
};

const ACTION_WORDS: Partial<Record<NbaAction, string>> = {
  ASK: "Ask a question",
  ANSWER_AND_ASK: "Answer, then ask",
  ANSWER: "Answer their question",
  INFORM: "Share one useful point",
  NURTURE: "Keep in touch",
  CTA_BOOK: "Book the meeting",
  CTA_CHECKOUT: "Send the checkout link",
  CTA_SIGNUP: "Send the sign-up link",
  WAIT: "Wait",
  NO_ACTION: "Nothing to do",
  DISQUALIFY: "Not a fit",
  ESCALATE: "A person takes over",
};

export function actionWords(action: string | null | undefined): string | null {
  if (!action) return null;
  return ACTION_WORDS[action as NbaAction] ?? action;
}

/** One plain sentence about the lead across its interests, for the lead page. */
export function summariseInterests(cards: readonly Pick<InterestCard, "offer" | "outcome" | "stage">[]): string {
  if (cards.length === 0) return "No interest recorded yet.";
  const won = cards.filter((c) => c.outcome === "WON");
  const lost = cards.filter((c) => c.outcome === "LOST");
  const open = cards.filter((c) => c.outcome === "OPEN");
  const parts: string[] = [];
  if (open.length) parts.push(`${open.length} open (${open.map((c) => c.offer).join(", ")})`);
  if (won.length) parts.push(`${won.length} won`);
  if (lost.length) parts.push(`${lost.length} lost`);
  const head = cards.length === 1 ? "1 interest" : `${cards.length} interests`;
  const tail = open.length === 0 ? " Follow-up has stopped: every interest is closed." : won.length ? " Follow-up continues for the open interest." : "";
  return `${head}: ${parts.join(", ")}.${tail}`;
}

/* ================================================================ the CRM */

/**
 * Which opportunity is the CRM's existing deal, and which interests get a
 * deal of their own (crm-push, 0144). A lead with one interest keeps the
 * legacy rule (the latest opportunity is the one deal). With several, the
 * deal already recorded stays attached to its own opportunity (never
 * repointed at another interest), and every other interest is its own deal.
 */
export function crmDealPlan(
  opportunities: readonly { id: string; serviceId: string | null; createdAt: string; updatedAt: string }[],
  recorded: { dealOpportunityId: string | null; hasDeal: boolean },
): { primaryId: string | null; extraIds: string[] } {
  if (opportunities.length === 0) return { primaryId: null, extraIds: [] };
  const interests = opportunities.filter((o) => o.serviceId);
  const latest = [...opportunities].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (interests.length < 2) return { primaryId: latest.id, extraIds: [] };
  const recordedRow = recorded.dealOpportunityId ? opportunities.find((o) => o.id === recorded.dealOpportunityId) : null;
  const oldest = [...opportunities].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const primary = recordedRow ?? (recorded.hasDeal ? oldest : latest);
  const extraIds = interests.filter((o) => o.id !== primary.id).map((o) => o.id);
  return { primaryId: primary.id, extraIds };
}

/**
 * The assessment fields that must agree with the NBA it stores
 * (leadAssessmentWriteSchema: goal, and the completeness and dimensions the
 * move was planned on). With several interests the move is for one interest,
 * whose goal may differ from the lead's own service's; storing the lead's
 * goal beside it failed the contract and cost the turn its plan.
 */
export function assessmentFieldsFor(
  nba: NextBestAction,
  dimensions: readonly DimensionStatusEntry[],
): { goal: GoalKey; qualification_completeness: number; dimension_status: DimensionStatusEntry[] } {
  return { goal: nba.current_goal, qualification_completeness: nba.qualification_completeness, dimension_status: dimensions.slice(0, 30) };
}
