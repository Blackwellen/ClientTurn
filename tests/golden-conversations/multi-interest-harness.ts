/**
 * The multi-interest golden-conversation harness (08 §B.20). Pure.
 *
 * Drives a conversation through the real pure engine the way qi-runtime.ts
 * does for a lead with several interests: interpret() the reply, attribute
 * its per-offer facts to one interest (interests.ts attributeReply), merge
 * every fact in its interest's scope (factsInMergeScope), record the
 * interests the lead named, re-assess intent, plan every interest
 * (planInterests) and pick the one move (coordinateInterests). Closing an
 * interest (a checkout completed, a meeting booked) is a scripted event.
 */

import { interpret } from "../../src/lib/qualification-intelligence/interpret.ts";
import { assessIntent } from "../../src/lib/qualification-intelligence/intent.ts";
import { factValidUntil, leadFieldFactWrite, mergeFact, normaliseFactValue } from "../../src/lib/qualification-intelligence/facts.ts";
import { interpretedSignalToWrite, originSignals } from "../../src/lib/qualification-intelligence/signals.ts";
import { serviceTermsFor } from "../../src/lib/qualification-intelligence/question-intents.ts";
import {
  attributeReply,
  coordinateInterests,
  detectInterests,
  factsInMergeScope,
  interestFactWrite,
  planInterests,
  type Coordination,
  type InterestPlan,
  type InterestService,
  type InterestSpec,
} from "../../src/lib/qualification-intelligence/interests.ts";
import { askedIntentFor } from "../../src/lib/agent/qi-turn.ts";
import { classifyDeterministic } from "../../src/lib/agent/classification.ts";
import type { AgentChannel } from "../../src/lib/agent/types.ts";
import type { SalesMotion } from "../../src/lib/sales-library/types.ts";
import type {
  IntentSignal,
  IntentSignalWrite,
  QualificationFact,
  QualificationFactWrite,
} from "../../src/lib/qualification-intelligence/types.ts";

export type MultiTurn = {
  lead: string;
  /** Scripted events before the lead's message: an interest closed or booked. */
  events?: { serviceName: string; event: "WON" | "LOST" | "MEETING_BOOKED" | "CHECKOUT_SENT" }[];
  expect: {
    primaryService?: string;
    actionIn?: string[];
    companion?: { service: string; kind: string } | null;
    /** Dimensions that must not be asked (planned) this turn, on any interest. */
    notAsked?: string[];
    /** Services that must be open interests after the turn. */
    interests?: string[];
    silent?: boolean;
  };
};

export type MultiConversation = {
  id: string;
  story: string;
  archetype: string;
  motion: SalesMotion;
  channel: AgentChannel;
  /** The service the lead came in on first. */
  services: { name: string; offerProfile?: Record<string, unknown>; averageValue?: number }[];
  leadService: string;
  directClose: boolean;
  turns: MultiTurn[];
};

export type MultiRow = {
  turn: number;
  lead: string;
  coordination: Coordination;
  plans: InterestPlan[];
  interests: string[];
  askedDimension: string | null;
  intent: ReturnType<typeof assessIntent>;
};

const BASE = Date.parse("2026-09-24T09:00:00.000Z");
const iso = (hours: number) => new Date(BASE + hours * 3_600_000).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

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

export function runMultiConversation(conversation: MultiConversation): MultiRow[] {
  let seq = 1;
  const leadId = uuid(seq++);
  const services: InterestService[] = conversation.services.map((s, i) => ({
    id: uuid(500 + i),
    name: s.name,
    offerProfile: s.offerProfile ?? {},
    averageValue: s.averageValue ?? null,
  }));
  const idOf = (name: string) => services.find((s) => s.name === name)!.id;
  const nameOf = (id: string) => services.find((s) => s.id === id)?.name ?? id;
  const leadServiceId = idOf(conversation.leadService);
  const opportunities = new Map<string, { id: string; stage: string; outcome: string; value: number | null; createdAt: string }>();
  let facts: QualificationFact[] = [];
  const signals: IntentSignal[] = [];
  const inbound: { id: string; body: string; createdAt: string }[] = [];
  let interestIds: string[] = [leadServiceId];

  const applyFact = (write: QualificationFactWrite, now: string) => {
    const scope = { primaryServiceId: leadServiceId, interestServiceIds: interestIds };
    const decision = mergeFact(factsInMergeScope(facts, write, scope), write, now);
    if (decision.action !== "INSERT") return;
    facts = facts.map((f) =>
      decision.supersede.includes(f.id) ? { ...f, supersededAt: now } : decision.markConflicting.includes(f.id) ? { ...f, state: "CONFLICTING" as const } : f,
    );
    facts.push(toFact(write, uuid(seq++), decision.state));
  };

  const serviceFact = leadFieldFactWrite({ leadId, serviceId: leadServiceId, dimension: "SERVICE_NEEDED", value: conversation.leadService, observedAt: iso(0), submittedByLead: true });
  if (serviceFact) applyFact(serviceFact, iso(0));
  for (const write of originSignals(
    { leadId, serviceId: leadServiceId, createdAt: iso(0), createdVia: "INBOUND", relationshipType: "THEY_CONTACTED_US", conversionGoalType: null, optedOut: false, optedOutObservedAt: null },
    [],
  )) signals.push(toSignal(write, uuid(seq++)));

  const asks = new Map<string, number>();
  let lastIntentKey: string | null = null;
  let focus: string | null = null;
  let bookingScheduled = false;
  const rows: MultiRow[] = [];

  conversation.turns.forEach((turn, index) => {
    const now = iso(1 + index * 2);
    for (const e of turn.events ?? []) {
      const id = idOf(e.serviceName);
      const opp = opportunities.get(id);
      if (!opp) continue;
      if (e.event === "WON" || e.event === "LOST") opportunities.set(id, { ...opp, outcome: e.event, stage: "CLOSED" });
      else opportunities.set(id, { ...opp, stage: e.event });
      if (e.event === "MEETING_BOOKED") bookingScheduled = true;
    }
    const messageId = uuid(seq++);
    // An empty message is a FOLLOW_UP_DUE turn: nothing new from the lead.
    const followUp = turn.lead.trim() === "";
    if (!followUp) inbound.push({ id: messageId, body: turn.lead, createdAt: now });

    // Interests the lead named (before the reply's facts, so they are scoped).
    const detected = detectInterests({
      leadServiceId,
      leadCreatedAt: iso(0),
      services,
      inbound,
      touches: [],
      opportunities: [...opportunities.entries()].map(([serviceId, o]) => ({ serviceId, createdAt: o.createdAt, interestSource: null })),
      facts,
    });
    interestIds = detected.map((d) => d.serviceId);
    for (const d of detected) {
      const w = interestFactWrite({ leadId, interest: d, serviceName: nameOf(d.serviceId) });
      if (w) applyFact(w, now);
      if (!opportunities.has(d.serviceId)) opportunities.set(d.serviceId, { id: uuid(seq++), stage: "OPEN", outcome: "OPEN", value: null, createdAt: d.observedAt });
    }

    const asked = askedIntentFor(lastIntentKey);
    const interpretation = followUp ? null : interpret(turn.lead, {
      messageId,
      now,
      currentIntent: asked,
      dimensions: [],
      context: { serviceNames: services.map((s) => s.name), serviceTerms: serviceTermsFor(conversation.archetype), now },
    });
    const owner = attributeReply({ text: turn.lead, services, interestServiceIds: interestIds, focusServiceId: focus, primaryServiceId: leadServiceId });
    for (const f of interpretation?.facts ?? []) {
      // SERVICE_NEEDED is recorded per interest above.
      if (f.dimension === "SERVICE_NEEDED") continue;
      applyFact(
        {
          lead_id: leadId,
          service_id: owner,
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
    for (const s of interpretation?.signals ?? []) {
      signals.push(toSignal(interpretedSignalToWrite({ leadId, serviceId: owner, messageId, observedAt: now, aiAssist: false, signal: s }), uuid(seq++)));
    }
    const suppressed = (interpretation?.signals ?? []).some((s) => s.signal_type === "UNSUBSCRIBE");
    const intent = assessIntent(signals, now, { suppressed, bookingScheduled });

    const specs: InterestSpec[] = detected.map((d) => {
      const service = services.find((s) => s.id === d.serviceId)!;
      const opp = opportunities.get(d.serviceId) ?? null;
      return {
        serviceId: d.serviceId,
        serviceName: service.name,
        source: d.source,
        offerProfileRaw: service.offerProfile,
        averageValue: service.averageValue ?? null,
        servicePolicy: null,
        overrideDisqualifiers: [],
        opportunity: opp ? { id: opp.id, stage: opp.stage, outcome: opp.outcome, value: opp.value } : null,
        checkoutAllowed: conversation.directClose,
        checkoutLinkId: conversation.directClose ? `link-${services.indexOf(service)}` : null,
      };
    });
    const askHistory = [...asks.entries()].map(([key, count]) => ({ key, asked: count, answered: false }));
    const plans = planInterests(
      {
        now,
        channel: conversation.channel,
        leadId,
        primaryServiceId: leadServiceId,
        interestServiceIds: interestIds,
        intent,
        facts,
        archetypeKey: conversation.archetype,
        workspaceMotion: conversation.motion,
        workspacePolicy: null,
        leadConversionGoal: null,
        workspaceDefaultGoal: null,
        engineVerdict: "PENDING",
        configuredQuestions: [],
        answeredQuestionIds: [],
        intentOverrides: {},
        askHistory,
        qualificationScore: 0,
        suppressed,
        interpretation,
        bindingVerdict: followUp ? null : (classifyDeterministic(turn.lead)?.intent ?? null),
        leadBookingScheduled: bookingScheduled,
        leadStatus: null,
        firstRepliedAt: now,
        answeredCount: facts.filter((f) => f.state === "CONFIRMED" && !f.supersededAt).length,
        lastReplyObjection: (interpretation?.objections.length ?? 0) > 0,
        explicitStage: null,
        leadEstimatedValue: null,
        ruleDimensions: [],
        serviceAreaRule: false,
        focusServiceId: focus,
      },
      specs,
      turn.lead,
      services,
    );
    const coordination = coordinateInterests(plans, { channel: conversation.channel, leadAskedQuestion: interpretation?.lead_asked_question ?? false });
    const q = coordination.nba.question_intent ?? coordination.companion?.question ?? null;
    if (q) {
      asks.set(q.key, (asks.get(q.key) ?? 0) + 1);
      lastIntentKey = q.key;
    } else lastIntentKey = null;
    focus = coordination.primary.serviceId;
    // The close the coordinator chose happens (the story's scripted provider):
    // a checkout link sent, a meeting offered.
    const primaryOpp = opportunities.get(coordination.primary.serviceId);
    if (primaryOpp && (coordination.nba.next_action === "CTA_CHECKOUT" || coordination.nba.next_action === "CTA_SIGNUP")) {
      opportunities.set(coordination.primary.serviceId, { ...primaryOpp, stage: "CHECKOUT_SENT" });
    }
    rows.push({
      turn: index + 1,
      lead: turn.lead,
      coordination,
      plans,
      interests: [...opportunities.entries()].filter(([, o]) => o.outcome === "OPEN").map(([id]) => nameOf(id)),
      askedDimension: q?.dimension ?? null,
      intent,
    });
  });
  return rows;
}

export function renderMultiTable(conversation: MultiConversation, rows: MultiRow[]): string {
  const lines = rows.map((r) => {
    const per = r.plans.map((p) => `${p.serviceName}:${p.goal.goal.slice(0, 1)}:${p.nba.next_action}${p.nba.question_intent ? `(${p.nba.question_intent.dimension})` : ""}`).join(" ; ");
    const c = r.coordination;
    return `| ${r.turn} | ${per} | ${c.primary.serviceName} ${c.nba.next_action}${c.companion ? ` + ${c.companion.kind} ${c.companion.serviceName}` : ""} | ${c.rule} |`;
  });
  return [`${conversation.id}: ${conversation.story}`, "| Turn | Per interest | Chosen | Rule |", "|---|---|---|---|", ...lines].join("\n");
}
