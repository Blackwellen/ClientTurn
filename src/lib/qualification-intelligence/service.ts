import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue } from "@/lib/jobs/queue";
import { inferDimension, selectNextQuestion, type QuestionRecord } from "@/lib/qualification/next-question";
import { SALES_MOTIONS, type SalesMotion } from "@/lib/sales-library/types";
import type { AgentChannel } from "@/lib/agent/types";
import type { ConversationStage } from "@/lib/sales-library/method-router";
import type { ConversionGoalType } from "@/lib/business-profile/types";
import type { QualificationResult } from "@/lib/qualification/engine";
import {
  QIE_ENGINE_VERSION,
  QI_CHANNELS,
  QI_DIMENSION_KEYS,
  QUALIFICATION_POLICY_KIND,
  UNMAPPED_DIMENSION,
  interpretationSchema,
  intentSignalWriteSchema,
  leadAssessmentWriteSchema,
  parseOfferProfile,
  qualificationFactWriteSchema,
  resolveEngineMode,
  type DimensionStatusEntry,
  type FactDimension,
  type IntentAssessment,
  type IntentSignal,
  type IntentSignalWrite,
  type Interpretation,
  type LeadAssessmentWrite,
  type NextBestAction,
  type QiDimensionKey,
  type QiEngineMode,
  type QualificationFact,
  type QualificationFactWrite,
  type QualificationPolicy,
  type QuestionIntentOverride,
  type ResolvedGoal,
} from "./types";
import { extractLeadSignals, interpretedSignalToWrite, signalFromRow, type LeadSignalInput } from "./signals";
import { assessIntent } from "./intent";
import {
  answerFactWrite,
  deriveDimensionStatuses,
  factFromRow,
  factValidUntil,
  leadFieldFactWrite,
  leadFieldsFromLeadForm,
  LEAD_FORM_TOUCH_SOURCES,
  mergeFact,
  normaliseFactValue,
  type FactMergeDecision,
} from "./facts";
import {
  completenessFor,
  disqualifiersForService,
  parseSalesOverrides,
  resolveOffer,
  thresholdStatus,
  type ResolvedOffer,
} from "./offer-profile";
import { deriveConversationStage, resolveGoal } from "./goals";
import { formValueCorroborates } from "./interpret";
import { evaluatePredicate, factValues, type ConfiguredQuestion } from "./question-intents";
import { planNextBestAction, type NbaDecisionInput, type PlanTurnInput } from "./nba";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { parseIntentDedupeKey } from "@/lib/find-leads/intent-evidence";
import {
  assessmentFieldsFor,
  attributeReply,
  coordinateInterests,
  detectInterests,
  factsForInterest,
  factsInMergeScope,
  focusFromRecord,
  interestFactWrite,
  interestNbaSummary,
  interestQualificationState,
  planInterests,
  servicesMentioned,
  type Coordination,
  type DetectedInterest,
  type InterestPlan,
  type InterestScope,
  type InterestService,
  type InterestSpec,
} from "./interests";

/**
 * Qualification intelligence: the storage and I/O layer (design 08 §§B.2-B.5,
 * B.12, B.14; contract decisions CD-9 to CD-15, CD-20).
 *
 * The pure engine (signals.ts, decay.ts, intent.ts, facts.ts, and A2's offer,
 * goal, question and NBA modules) decides everything. This file only:
 *
 *   * reads what the system already holds about one lead;
 *   * writes the signals and facts that reading produced, idempotently
 *     (lead_intent_signals is unique on dedupe_key; a fact is merged by
 *     facts.ts `mergeFact`, and the same source event is a no-op);
 *   * computes one assessment (intent, dimension status, completeness, goal,
 *     next best action) and records it through `record_lead_assessment()`,
 *     the single writer of lead_assessments and leads.intent_* (CD-11);
 *   * schedules the re-assessment a stated timeframe or NOT_NOW asks for.
 *
 * It runs inside the lead.score job (jobs/handlers/lead-score.ts): signals ->
 * intent -> score -> tags -> NBA -> one lead_assessments row, in both SHADOW
 * and LIVE (CD-9, CD-10). OFF writes nothing. The mode governs only whether
 * the agent acts on the NBA; the assessment is always shown.
 *
 * Retry-safe (CLAUDE.md): every run re-reads current state, every write is
 * idempotent, and the assessment is keyed on (lead, trigger, engine version).
 * An anonymised lead is skipped (and the 0134 triggers refuse the rows anyway).
 *
 * Personal data: evidence excerpts and fact values are the lead's own words.
 * They are stored for the lead's own workspace, exported with a DSAR
 * (data-rights/export.ts) and removed on anonymisation (0134 §8).
 */

/** 0134 tables and RPC: cast at this one seam; every row read is narrowed below. */
function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

function fail(operation: string, error: { message: string }): never {
  throw new Error(`qualification intelligence: ${operation} failed: ${error.message}`);
}

/* ================================================================ mode */

/**
 * The workspace's engine mode (CD-9): QUALIFICATION_POLICY '*' payload
 * engineMode, else `defaultEngineMode()` (SHADOW until the release gates pass).
 * A malformed stored policy is ignored (the default applies), never thrown.
 */
export async function loadEngineMode(businessId: string): Promise<QiEngineMode> {
  const { data, error } = await db()
    .from("workspace_sales_overrides")
    .select("key, kind, payload")
    .eq("business_id", businessId)
    .eq("kind", QUALIFICATION_POLICY_KIND)
    .eq("key", "*")
    .maybeSingle();
  if (error) fail("engine mode read", error);
  const parsed = parseSalesOverrides(data ? [data as { key: string; kind: string; payload: unknown }] : []);
  return resolveEngineMode(parsed.workspacePolicy?.engineMode ?? null);
}

/* ============================================================ row shapes */

type LeadRow = {
  id: string;
  business_id: string;
  status: string | null;
  qualification_state: string | null;
  service_id: string | null;
  postcode: string | null;
  estimated_value: number | null;
  opted_out: boolean;
  created_via: string | null;
  relationship_type: string | null;
  conversion_goal_type: string | null;
  conversion_goal_id: string | null;
  promoted_from_prospect_id: string | null;
  first_replied_at: string | null;
  anonymised_at: string | null;
  created_at: string;
  updated_at: string;
};

const LEAD_COLUMNS =
  "id, business_id, status, qualification_state, service_id, postcode, estimated_value, opted_out, created_via, relationship_type, conversion_goal_type, conversion_goal_id, promoted_from_prospect_id, first_replied_at, anonymised_at, created_at, updated_at";

type MessageRow = {
  id: string;
  direction: string;
  channel: string | null;
  body: string | null;
  reply_classification: string | null;
  reply_confidence: number | null;
  features: unknown;
  created_at: string;
};

type QuestionRow = {
  id: string;
  question_text: string;
  response_type: string;
  required: boolean;
  service_id: string | null;
  position: number;
  dimension_key: string | null;
  question_intent_key: string | null;
};

type AnswerRow = {
  question_id: string;
  answer_text: string | null;
  answer_value: string | null;
  source: string;
  confidence: number | null;
  answered_at: string;
};

type RuleRow = { question_id: string | null; rule_type: string; result: string };

const SIGNAL_COLUMNS =
  "id, lead_id, service_id, category, signal_type, polarity, strength, confidence, source, source_ref, observed_at, half_life_hours, flat_until, expires_at, resume_at, reason, evidence_excerpt, rule_version, retracted_at";

const FACT_COLUMNS =
  "id, lead_id, service_id, dimension, value, value_normalised, state, source, source_ref, question_id, question_intent_key, confidence, observed_at, valid_until, verified_at, set_by, superseded_at";

/* ============================================================== signals */

/**
 * Writes signal rows idempotently (unique on business_id + dedupe_key) and
 * returns the rows actually inserted. Every write is validated against the
 * contract schema first; an invalid one is a bug and throws.
 */
export async function writeIntentSignals(
  businessId: string,
  writes: readonly IntentSignalWrite[],
): Promise<IntentSignal[]> {
  if (writes.length === 0) return [];
  const rows = writes.map((w) => ({ ...intentSignalWriteSchema.parse(w), business_id: businessId }));
  const { data, error } = await db()
    .from("lead_intent_signals")
    .upsert(rows, { onConflict: "business_id,dedupe_key", ignoreDuplicates: true })
    .select(SIGNAL_COLUMNS);
  if (error) fail("lead_intent_signals write", error);
  return ((data ?? []) as Parameters<typeof signalFromRow>[0][]).map(signalFromRow);
}

/** Retracts one signal (a person's correction). Scoped to the lead. */
export async function retractIntentSignal(businessId: string, leadId: string, signalId: string): Promise<boolean> {
  const { data, error } = await db()
    .from("lead_intent_signals")
    .update({ retracted_at: new Date().toISOString() })
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .eq("id", signalId)
    .is("retracted_at", null)
    .select("id");
  if (error) fail("lead_intent_signals retract", error);
  return (data ?? []).length > 0;
}

async function readSignals(client: SupabaseClient, businessId: string, leadId: string): Promise<IntentSignal[]> {
  const { data, error } = await client
    .from("lead_intent_signals")
    .select(SIGNAL_COLUMNS)
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .is("retracted_at", null)
    .order("observed_at", { ascending: false })
    .limit(500);
  if (error) fail("lead_intent_signals read", error);
  return ((data ?? []) as Parameters<typeof signalFromRow>[0][]).map(signalFromRow);
}

/**
 * A stated timeframe or a NOT_NOW asks to be revisited at a date: queue the
 * re-assessment for then (§B.5). Keyed per lead and day, so several signals
 * pointing at one date queue one job. The sweep catches it too; this makes it
 * punctual.
 */
async function scheduleResumes(businessId: string, leadId: string, inserted: readonly IntentSignal[]): Promise<void> {
  for (const signal of inserted) {
    if (signal.type !== "NOT_NOW" && signal.type !== "TIMEFRAME") continue;
    const at = signal.flatUntil ?? signal.resumeAt;
    const ms = at ? Date.parse(at) : NaN;
    if (!Number.isFinite(ms) || ms <= Date.now()) continue;
    const day = new Date(ms).toISOString().slice(0, 10);
    await enqueue(
      "lead.score",
      { leadId, triggerEvent: `intent.decay_due:${signal.id}` },
      { businessId, runAt: new Date(ms), priority: 80, idempotencyKey: `intent.resume:${leadId}:${day}` },
    );
  }
}

/* ================================================================ facts */

async function readFacts(client: SupabaseClient, businessId: string, leadId: string): Promise<QualificationFact[]> {
  // Live facts plus REJECTED ones (so a rejected inference is not re-made).
  const { data, error } = await client
    .from("lead_qualification_facts")
    .select(FACT_COLUMNS)
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .is("superseded_at", null)
    .order("observed_at", { ascending: false })
    .limit(500);
  if (error) fail("lead_qualification_facts read", error);
  return ((data ?? []) as Parameters<typeof factFromRow>[0][]).map(factFromRow);
}

export type FactWriteOutcome = { decision: FactMergeDecision; factId: string | null };

/**
 * Applies one merge decision: supersede, mark conflicting, insert. A unique
 * violation (a concurrent job wrote the same source event) is the desired
 * outcome, not an error.
 */
async function applyFactDecision(
  client: SupabaseClient,
  businessId: string,
  write: QualificationFactWrite,
  decision: FactMergeDecision,
): Promise<string | null> {
  if (decision.action === "SKIP") return null;
  const nowIso = new Date().toISOString();
  if (decision.supersede.length > 0) {
    const { error } = await client
      .from("lead_qualification_facts")
      .update({ superseded_at: nowIso })
      .eq("business_id", businessId)
      .eq("lead_id", write.lead_id)
      .in("id", decision.supersede)
      .is("superseded_at", null);
    if (error) fail("lead_qualification_facts supersede", error);
  }
  if (decision.markConflicting.length > 0) {
    const { error } = await client
      .from("lead_qualification_facts")
      .update({ state: "CONFLICTING" })
      .eq("business_id", businessId)
      .eq("lead_id", write.lead_id)
      .in("id", decision.markConflicting)
      .is("superseded_at", null);
    if (error) fail("lead_qualification_facts mark conflicting", error);
  }
  const row = {
    ...write,
    state: decision.state,
    value_normalised: write.value_normalised ?? normaliseFactValue(write.dimension, write.value),
    business_id: businessId,
  };
  const { data, error } = await client.from("lead_qualification_facts").insert(row).select("id").maybeSingle();
  if (error && error.code === "23505") return null;
  if (error) fail("lead_qualification_facts insert", error);
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Writes one fact through the merge rules (§B.12): the one path by which a
 * fact enters the store, for the lead.score job, the orchestrator's
 * interpretation write-back (A3) and a person's override (A4).
 * The write is validated against the contract (an AI_ASSIST fact is INFERRED
 * at most, CD-8).
 */
export async function writeQualificationFact(businessId: string, input: QualificationFactWrite): Promise<FactWriteOutcome> {
  const write = qualificationFactWriteSchema.parse(input);
  const client = db();
  const { data, error } = await client
    .from("lead_qualification_facts")
    .select(FACT_COLUMNS)
    .eq("business_id", businessId)
    .eq("lead_id", write.lead_id)
    .eq("dimension", write.dimension)
    .is("superseded_at", null);
  if (error) fail("lead_qualification_facts read", error);
  const existing = ((data ?? []) as Parameters<typeof factFromRow>[0][]).map(factFromRow);
  const scope = await loadInterestScope(client, businessId, write.lead_id);
  const decision = mergeFact(factsInMergeScope(existing, write, scope), write, new Date());
  const factId = await applyFactDecision(client, businessId, write, decision);
  return { decision, factId };
}

/** Applies a batch against an in-memory copy of the lead's facts, updating it as it goes. */
async function mergeFacts(
  client: SupabaseClient,
  businessId: string,
  facts: QualificationFact[],
  writes: readonly QualificationFactWrite[],
  now: Date,
  scope: InterestScope = { primaryServiceId: null, interestServiceIds: [] },
): Promise<QualificationFact[]> {
  let current = facts;
  for (const raw of writes) {
    const parsed = qualificationFactWriteSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("[qualification-intelligence] fact write rejected by the contract", {
        businessId,
        dimension: raw.dimension,
        source: raw.source,
        issue: parsed.error.issues[0]?.message,
      });
      continue;
    }
    const write = parsed.data;
    // Several interests: a per-offer fact merges only against its own interest's facts.
    const decision = mergeFact(factsInMergeScope(current, write, scope), write, now);
    if (decision.action === "SKIP") continue;
    const id = await applyFactDecision(client, businessId, write, decision);
    const nowIso = now.toISOString();
    current = current.map((f) =>
      decision.supersede.includes(f.id)
        ? { ...f, supersededAt: nowIso }
        : decision.markConflicting.includes(f.id)
          ? { ...f, state: "CONFLICTING" }
          : f,
    );
    if (id) {
      current = [
        ...current,
        {
          id,
          leadId: write.lead_id,
          serviceId: write.service_id,
          dimension: write.dimension,
          value: write.value,
          valueNormalised: write.value_normalised ?? normaliseFactValue(write.dimension, write.value),
          state: decision.state,
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
        },
      ];
    }
  }
  return current.filter((f) => f.supersededAt === null);
}

/** A person rejects an inference: stored REJECTED, so it is not re-made (CD-5). */
export async function rejectQualificationFact(
  businessId: string,
  leadId: string,
  factId: string,
  userId: string | null,
): Promise<boolean> {
  const { data, error } = await db()
    .from("lead_qualification_facts")
    .update({ state: "REJECTED", set_by: userId, verified_at: new Date().toISOString() })
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .eq("id", factId)
    .is("superseded_at", null)
    .neq("source", "MANUAL")
    .select("id");
  if (error) fail("lead_qualification_facts reject", error);
  return (data ?? []).length > 0;
}

/**
 * A person confirms a fact (optionally correcting its value): a MANUAL
 * CONFIRMED fact that supersedes every live fact of the dimension, which is
 * also how a conflict is resolved.
 */
export async function confirmQualificationFact(input: {
  businessId: string;
  leadId: string;
  dimension: FactDimension;
  value: string;
  userId: string | null;
  questionIntentKey?: string | null;
  correlationId: string;
}): Promise<FactWriteOutcome> {
  const now = new Date().toISOString();
  return writeQualificationFact(input.businessId, {
    lead_id: input.leadId,
    service_id: null,
    dimension: input.dimension,
    value: input.value.trim().slice(0, 500),
    value_normalised: normaliseFactValue(input.dimension, input.value),
    state: "CONFIRMED",
    source: "MANUAL",
    source_ref: `manual:${input.correlationId}`.slice(0, 200),
    question_id: null,
    question_intent_key: input.questionIntentKey ?? null,
    confidence: 1,
    observed_at: now,
    valid_until: factValidUntil(input.dimension, now, { value: input.value }),
    verified_at: now,
    set_by: input.userId,
  });
}

/* ======================================================= interpretation */

/**
 * The orchestrator's write-back after every inbound reply (CD-15): the
 * interpretation's facts to lead_qualification_facts and its signals to
 * lead_intent_signals, both with source_ref = the inbound message id.
 * Validated against the contract; AI-assist facts are INFERRED at most and
 * AI-assist signals carry source AI_ASSIST.
 */
export async function writeInterpretation(input: {
  businessId: string;
  leadId: string;
  serviceId: string | null;
  interpretation: Interpretation;
  /** The inbound message's time. */
  observedAt: string;
  /**
   * Several interests (interests.ts): the reply's text, so the services it
   * names are recorded as interests and its per-offer facts go to the one
   * interest it is about (else the last turn's focus, else the lead's own).
   */
  attribution?: { text: string; focusServiceId: string | null };
}): Promise<{ factsWritten: number; signalsWritten: number; signals: IntentSignal[]; serviceId: string | null }> {
  const interpretation = interpretationSchema.parse(input.interpretation);
  const client = db();
  const now = new Date();

  let scope: InterestScope = { primaryServiceId: input.serviceId, interestServiceIds: [] };
  let factServiceId = input.serviceId;
  const interestWrites: QualificationFactWrite[] = [];
  if (input.attribution) {
    const known = await loadInterestScope(client, input.businessId, input.leadId);
    const services = await activeServices(client, input.businessId);
    const named = servicesMentioned(input.attribution.text, services);
    for (const hit of named) {
      const service = services.find((x) => x.id === hit.serviceId);
      if (!service || hit.serviceId === known.primaryServiceId) continue;
      const write = interestFactWrite({
        leadId: input.leadId,
        interest: { serviceId: hit.serviceId, source: "MESSAGE", evidence: hit.evidence, sourceRef: interpretation.message_id, observedAt: input.observedAt },
        serviceName: service.name,
      });
      if (write) interestWrites.push(write);
    }
    scope = {
      primaryServiceId: known.primaryServiceId ?? input.serviceId,
      interestServiceIds: [...new Set([...known.interestServiceIds, ...named.map((n) => n.serviceId)])],
    };
    if (scope.interestServiceIds.length >= 2) {
      factServiceId = attributeReply({
        text: input.attribution.text,
        services,
        interestServiceIds: scope.interestServiceIds,
        focusServiceId: input.attribution.focusServiceId,
        primaryServiceId: scope.primaryServiceId,
      });
    }
  }

  const multi = scope.interestServiceIds.length >= 2;
  const factWrites: QualificationFactWrite[] = [...interestWrites, ...interpretation.facts
    // A lead with several interests: SERVICE_NEEDED is recorded per interest above.
    .filter((f) => !(multi && f.dimension === "SERVICE_NEEDED"))
    .map((f) => ({
    lead_id: input.leadId,
    service_id: factServiceId,
    dimension: f.dimension,
    value: f.value,
    value_normalised: f.value_normalised ?? normaliseFactValue(f.dimension, f.value),
    state: f.state,
    source: f.source,
    source_ref: interpretation.message_id,
    question_id: f.question_id,
    question_intent_key: f.question_intent_key,
    confidence: f.confidence,
    observed_at: input.observedAt,
    valid_until: factValidUntil(f.dimension, input.observedAt, { value: f.value }),
    verified_at: null,
    set_by: null,
  }))];
  const before = await readFacts(client, input.businessId, input.leadId);
  const after = await mergeFacts(client, input.businessId, before, factWrites, now, scope);
  const factsWritten = after.filter((f) => !before.some((b) => b.id === f.id)).length;

  const signalWrites = interpretation.signals.map((s) =>
    interpretedSignalToWrite({
      leadId: input.leadId,
      serviceId: input.serviceId,
      messageId: interpretation.message_id,
      observedAt: input.observedAt,
      // interpret() derives signals deterministically (§B.11 step 4); the AI
      // assist only proposes facts, which carry their own AI_ASSIST source.
      aiAssist: false,
      signal: s,
    }),
  );
  const inserted = await writeIntentSignals(input.businessId, signalWrites);
  await scheduleResumes(input.businessId, input.leadId, inserted);
  return { factsWritten, signalsWritten: inserted.length, signals: inserted, serviceId: factServiceId };
}

/* ============================================================ interests */

type OpportunityInterestRow = {
  id: string;
  service_id: string | null;
  stage: string;
  outcome: string;
  value: number | null;
  close_target: string | null;
  goal: string | null;
  interest_source: string | null;
  created_at: string;
};

async function activeServices(client: SupabaseClient, businessId: string): Promise<InterestService[]> {
  const { data, error } = await client
    .from("services")
    .select("id, name, average_value, offer_profile")
    .eq("business_id", businessId)
    .eq("active", true)
    .limit(100);
  if (error) fail("services read", error);
  return ((data ?? []) as { id: string; name: string | null; average_value: number | null; offer_profile: unknown }[])
    .filter((row) => (row.name ?? "").trim().length > 0)
    .map((row) => ({ id: row.id, name: row.name!, averageValue: row.average_value, offerProfile: row.offer_profile ?? {} }));
}

/**
 * The lead's opportunities with their interest columns (0144). Before 0144
 * is applied the columns do not exist: the rows are read without them and no
 * opportunity carries a service (the interests then come from facts).
 */
export async function readInterestOpportunities(
  client: SupabaseClient,
  businessId: string,
  leadId: string,
): Promise<OpportunityInterestRow[]> {
  const full = await client
    .from("opportunities")
    .select("id, service_id, stage, outcome, value, close_target, goal, interest_source, created_at")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true })
    .limit(20);
  if (!full.error) return (full.data ?? []) as OpportunityInterestRow[];
  if (!isSchemaLag(full.error)) fail("opportunities read", full.error);
  const legacy = await client
    .from("opportunities")
    .select("id, stage, outcome, value, close_target, created_at")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true })
    .limit(20);
  if (legacy.error) fail("opportunities read", legacy.error);
  return ((legacy.data ?? []) as Omit<OpportunityInterestRow, "service_id" | "goal" | "interest_source">[]).map((row) => ({
    ...row,
    service_id: null,
    goal: null,
    interest_source: null,
  }));
}

/** Which services the lead is interested in: its own service, its opportunities and its interest facts. */
async function loadInterestScope(client: SupabaseClient, businessId: string, leadId: string): Promise<InterestScope> {
  const [{ data: lead }, facts, opportunities] = await Promise.all([
    client.from("leads").select("service_id").eq("business_id", businessId).eq("id", leadId).maybeSingle(),
    client
      .from("lead_qualification_facts")
      .select("service_id, source_ref")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .eq("dimension", "SERVICE_NEEDED")
      .is("superseded_at", null)
      .limit(50),
    readInterestOpportunities(client, businessId, leadId).catch(() => [] as OpportunityInterestRow[]),
  ]);
  const primary = (lead as { service_id: string | null } | null)?.service_id ?? null;
  const ids = new Set<string>(primary ? [primary] : []);
  for (const f of (facts.data ?? []) as { service_id: string | null; source_ref: string | null }[]) {
    if (f.service_id && (f.source_ref ?? "").includes("#interest")) ids.add(f.service_id);
  }
  for (const o of opportunities) if (o.service_id) ids.add(o.service_id);
  return { primaryServiceId: primary, interestServiceIds: [...ids] };
}

/** The interest the last agent turn was about (decision_json.interests), for attributing the reply. */
export async function lastInterestFocus(businessId: string, leadId: string): Promise<string | null> {
  const { data } = await db()
    .from("conversation_agent_runs")
    .select("decision_json, created_at")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return focusFromRecord((data as { decision_json?: unknown } | null)?.decision_json ?? null);
}

/**
 * A person adds an interest on the lead page (registry `lead.add_interest`):
 * a MANUAL SERVICE_NEEDED fact for the service (so the engine plans it with
 * or without 0144) and, with 0144, its own OPEN opportunity.
 */
export async function addLeadInterest(input: {
  businessId: string;
  leadId: string;
  serviceId: string;
  userId: string | null;
  correlationId: string;
}): Promise<{ added: boolean; opportunityId: string | null; serviceName: string }> {
  const client = db();
  const services = await activeServices(client, input.businessId);
  const service = services.find((s) => s.id === input.serviceId);
  if (!service) throw new Error("That service is not active in this workspace.");
  const now = new Date().toISOString();
  const write = interestFactWrite({
    leadId: input.leadId,
    interest: { serviceId: service.id, source: "MANUAL", evidence: null, sourceRef: `manual:${input.correlationId}`, observedAt: now },
    serviceName: service.name,
    setBy: input.userId,
  });
  const outcome = write ? await writeQualificationFact(input.businessId, write) : null;
  const opportunityId = await ensureInterestOpportunity(client, {
    businessId: input.businessId,
    leadId: input.leadId,
    service,
    source: "MANUAL",
    goal: null,
    motion: null,
    closeTarget: "BOOK",
  });
  return { added: Boolean(outcome?.factId) || opportunityId !== null, opportunityId, serviceName: service.name };
}

async function ensureInterestOpportunity(
  client: SupabaseClient,
  input: {
    businessId: string;
    leadId: string;
    service: InterestService;
    source: string;
    goal: string | null;
    motion: string | null;
    closeTarget: string;
  },
): Promise<string | null> {
  const { data: lead } = await client
    .from("leads")
    .select("first_name, last_name")
    .eq("id", input.leadId)
    .eq("business_id", input.businessId)
    .maybeSingle();
  const row = lead as { first_name: string | null; last_name: string | null } | null;
  const person = [row?.first_name, row?.last_name].filter(Boolean).join(" ") || "New lead";
  const { data, error } = await client.rpc("ensure_interest_opportunity", {
    p_business_id: input.businessId,
    p_lead_id: input.leadId,
    p_service_id: input.service.id,
    p_stage: "OPEN",
    p_close_target: input.closeTarget,
    p_motion: input.motion,
    p_name: `${person} - ${input.service.name}`.slice(0, 200),
    p_value: typeof input.service.averageValue === "number" ? input.service.averageValue : null,
    p_currency: "GBP",
    p_goal: input.goal,
    p_source: input.source,
  });
  if (error) {
    if (!isSchemaLag(error)) {
      console.error("[interests] ensure_interest_opportunity failed", { leadId: input.leadId, code: error.code, message: error.message });
    }
    return null;
  }
  const result = data as { id: string; created: boolean } | null;
  if (result?.created) await enqueueCrmPushesSafely(input.businessId, input.leadId);
  return result?.id ?? null;
}

async function enqueueCrmPushesSafely(businessId: string, leadId: string): Promise<void> {
  try {
    const { enqueueCrmPushes } = await import("@/lib/integrations/providers/crm-trigger");
    await enqueueCrmPushes(businessId, leadId);
  } catch (error) {
    console.error("[interests] CRM push not queued", { businessId, leadId, error: error instanceof Error ? error.message : String(error) });
  }
}

const CLOSE_TARGET_FOR_GOAL: Record<string, string> = {
  A_QUALIFY_ONLY: "NEXT_STAGE",
  B_BOOK_MEETING: "BOOK",
  C_DIRECT_SALE: "BUY",
  D_SIGNUP_TRIAL: "TRIAL",
  E_HUMAN_CLOSER: "NEXT_STAGE",
  F_NURTURE: "NEXT_STAGE",
  G_DISQUALIFY: "NEXT_STAGE",
};

/**
 * After an assessment of a lead with several interests: each interest has
 * its own OPEN opportunity (created on first sight), carrying its goal,
 * qualification state and next best action, and moves to QUALIFIED when its
 * own threshold is met. Best-effort and schema-lag tolerant: before 0144 it
 * does nothing, and it never fails the assessment.
 */
async function syncInterestOpportunities(intel: LeadIntelligence, plans: readonly InterestPlan[]): Promise<void> {
  if (plans.length < 2) return;
  const client = db();
  try {
    for (const plan of plans) {
      if (plan.opportunity && plan.opportunity.outcome !== "OPEN") continue;
      const service = intel.services.find((s) => s.id === plan.serviceId);
      if (!service) continue;
      let opportunityId = plan.opportunity?.id ?? null;
      if (!opportunityId) {
        opportunityId = await ensureInterestOpportunity(client, {
          businessId: intel.businessId,
          leadId: intel.leadId,
          service,
          source: plan.source,
          goal: plan.goal.goal,
          motion: plan.motion,
          closeTarget: CLOSE_TARGET_FOR_GOAL[plan.goal.goal] ?? "BOOK",
        });
        if (!opportunityId) return; // 0144 not applied: nothing more to write.
      }
      const state = interestQualificationState(plan, intel.engineVerdict);
      const { error } = await client
        .from("opportunities")
        .update({
          goal: plan.goal.goal,
          motion: plan.motion,
          close_target: CLOSE_TARGET_FOR_GOAL[plan.goal.goal] ?? "BOOK",
          qualification_state: state,
          nba: interestNbaSummary(plan),
          assessed_at: intel.now.toISOString(),
        })
        .eq("id", opportunityId)
        .eq("business_id", intel.businessId)
        .eq("outcome", "OPEN");
      if (error) {
        if (isSchemaLag(error)) return;
        console.error("[interests] opportunity update failed", { leadId: intel.leadId, code: error.code, message: error.message });
      }
      if (state === "QUALIFIED" && (plan.opportunity?.stage ?? "OPEN") === "OPEN") {
        const { advanceLeadOpportunitySafely } = await import("@/lib/opportunities/service");
        await advanceLeadOpportunitySafely({ businessId: intel.businessId, leadId: intel.leadId, event: "QUALIFIED", serviceId: plan.serviceId });
      }
    }
  } catch (error) {
    console.error("[interests] sync failed", { leadId: intel.leadId, error: error instanceof Error ? error.message : String(error) });
  }
}


/* ======================================================= the assessment */

/** Everything one assessment is computed from. Returned so the orchestrator and the job share it. */
export type LeadIntelligence = {
  businessId: string;
  leadId: string;
  mode: Exclude<QiEngineMode, "OFF">;
  now: Date;
  serviceId: string | null;
  signals: IntentSignal[];
  /** Live facts (not superseded), REJECTED included. */
  facts: QualificationFact[];
  intent: IntentAssessment;
  resolved: ResolvedOffer;
  goal: ResolvedGoal;
  dimensions: DimensionStatusEntry[];
  completeness: number;
  thresholdMet: boolean;
  stage: ConversationStage;
  channel: AgentChannel | null;
  /** The configured questions as the question library reads them. */
  configuredQuestions: ConfiguredQuestion[];
  answeredQuestionIds: string[];
  /** QUALIFICATION_QUESTION overrides, keyed by intent key (F9). */
  intentOverrides: Record<string, QuestionIntentOverride>;
  askHistory: { key: string; asked: number; answered: boolean }[];
  engineVerdict: QualificationResult;
  suppressed: boolean;
  bookingScheduled: boolean;
  dealValueGbp: number | null;
  policy: QualificationPolicy;
  /** What the legacy selector would ask next (SHADOW diff). */
  legacyNextQuestionId: string | null;
  agentMode: string | null;
  /* ---- several interests (interests.ts, 08 §B.20) ---- */
  /** The workspace's active services (the offers an interest can be in). */
  services: InterestService[];
  /** The lead's interests, the lead's own service first. One = the single-offer engine, unchanged. */
  interests: DetectedInterest[];
  /** The lead's opportunities with their 0144 interest columns (null service before 0144). */
  interestOpportunities: { id: string; serviceId: string | null; stage: string; outcome: string; value: number | null }[];
  /** What planInterests shares across the interests. */
  interestContext: {
    archetypeKey: string | null;
    workspaceMotion: SalesMotion | null;
    workspacePolicy: QualificationPolicy | null;
    servicePolicies: Record<string, QualificationPolicy>;
    overrides: ReturnType<typeof parseSalesOverrides>;
    leadConversionGoal: { type: ConversionGoalType; qualificationRequired: boolean | null } | null;
    workspaceDefaultGoal: { type: ConversionGoalType; qualificationRequired: boolean } | null;
    ruleDimensions: QiDimensionKey[];
    serviceAreaRule: boolean;
    leadStatus: string | null;
    firstRepliedAt: string | null;
    answeredCount: number;
    lastReplyObjection: boolean;
    leadEstimatedValue: number | null;
    latestInbound: string | null;
  };
};

const ENGINE_VERDICTS = new Set(["PENDING", "QUALIFIED", "NOT_QUALIFIED", "REVIEW"]);

function asChannel(value: string | null | undefined): AgentChannel | null {
  return value && (QI_CHANNELS as readonly string[]).includes(value) ? (value as AgentChannel) : null;
}

function asQiDimension(value: string | null | undefined): QiDimensionKey | null {
  return value && (QI_DIMENSION_KEYS as readonly string[]).includes(value) ? (value as QiDimensionKey) : null;
}

function questionRecord(row: QuestionRow): QuestionRecord {
  return {
    id: row.id,
    questionText: row.question_text,
    responseType: row.response_type as QuestionRecord["responseType"],
    required: row.required,
    serviceId: row.service_id,
    position: row.position,
    options: [],
  };
}

function dimensionOf(row: QuestionRow): QiDimensionKey | null {
  return asQiDimension(row.dimension_key) ?? inferDimension(questionRecord(row));
}

/** One text for a form answer label, for matching it against configured questions. */
function labelKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Loads everything about one lead, writes the signals and facts it implies,
 * and computes the assessment's pure parts. Returns null for a lead that no
 * longer exists or is anonymised. Does not write the assessment: the caller
 * scores first (the NBA carries the qualification score), then calls
 * `recordLeadAssessment`.
 */
export async function prepareLeadIntelligence(
  businessId: string,
  leadId: string,
  options: { mode: Exclude<QiEngineMode, "OFF">; now?: Date },
): Promise<LeadIntelligence | null> {
  const client = db();
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();

  const { data: leadData, error: leadError } = await client
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("business_id", businessId)
    .eq("id", leadId)
    .maybeSingle();
  if (leadError) fail("lead read", leadError);
  if (!leadData) return null;
  const lead = leadData as LeadRow;
  if (lead.anonymised_at) return null;

  const [touches, messages, bookings, opportunities, questions, answers, rules, profile, service, overrides, goals, aiSettings] =
    await Promise.all([
      client
        .from("lead_touches")
        .select("id, occurred_at, source_type, landing_url, answers, ingest_outcome")
        .eq("business_id", businessId)
        .eq("lead_id", leadId)
        .order("occurred_at", { ascending: true })
        .limit(50),
      client
        .from("messages")
        .select("id, direction, channel, body, reply_classification, reply_confidence, features, created_at")
        .eq("business_id", businessId)
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(200),
      client
        .from("bookings")
        .select("id, status, starts_at, created_at")
        .eq("business_id", businessId)
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(20),
      client
        .from("opportunities")
        .select("id, outcome, closed_at, updated_at, outcome_reason")
        .eq("business_id", businessId)
        .eq("lead_id", leadId)
        .limit(20),
      client
        .from("qualification_questions")
        .select("id, question_text, response_type, required, service_id, position, dimension_key, question_intent_key")
        .eq("business_id", businessId)
        .eq("active", true),
      client
        .from("qualification_answers")
        .select("question_id, answer_text, answer_value, source, confidence, answered_at")
        .eq("business_id", businessId)
        .eq("lead_id", leadId),
      client
        .from("qualification_rules")
        .select("question_id, rule_type, result")
        .eq("business_id", businessId)
        .eq("active", true),
      client.from("business_profiles").select("archetype_key, sales_motions").eq("business_id", businessId).maybeSingle(),
      lead.service_id
        ? client.from("services").select("id, name, average_value, offer_profile").eq("business_id", businessId).eq("id", lead.service_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      client
        .from("workspace_sales_overrides")
        .select("kind, key, payload")
        .eq("business_id", businessId)
        .in("kind", ["QUALIFICATION_POLICY", "QUALIFICATION_QUESTION", "DISQUALIFIER"]),
      client
        .from("conversion_goals")
        .select("id, type, is_default, qualification_required, active")
        .eq("business_id", businessId)
        .eq("active", true),
      client.from("business_ai_settings").select("agent_mode").eq("business_id", businessId).maybeSingle(),
    ]);
  for (const [name, result] of [
    ["lead_touches", touches],
    ["messages", messages],
    ["bookings", bookings],
    ["opportunities", opportunities],
    ["qualification_questions", questions],
    ["qualification_answers", answers],
    ["qualification_rules", rules],
    ["business_profiles", profile],
    ["services", service],
    ["workspace_sales_overrides", overrides],
    ["conversion_goals", goals],
    ["business_ai_settings", aiSettings],
  ] as const) {
    if (result.error) fail(`${name} read`, result.error);
  }

  const [allServices, interestOpps] = await Promise.all([
    activeServices(client, businessId),
    readInterestOpportunities(client, businessId, leadId),
  ]);
  const messageRows = (messages.data ?? []) as MessageRow[];
  const questionRows = (questions.data ?? []) as QuestionRow[];
  const answerRows = (answers.data ?? []) as AnswerRow[];
  const touchRows = (touches.data ?? []) as {
    id: string;
    occurred_at: string;
    source_type: string;
    landing_url: string | null;
    answers: Record<string, unknown> | null;
    ingest_outcome: string | null;
  }[];
  const bookingRows = (bookings.data ?? []) as { id: string; status: string; starts_at: string | null; created_at: string }[];
  const serviceRow = (service.data ?? null) as { id: string; name: string | null; average_value: number | null; offer_profile: unknown } | null;

  /* ---- Find Leads context, read-only (§D9): events for this lead or the prospect it came from */
  const contextEvents: LeadSignalInput["contextEvents"] = [];
  {
    const ors = [`lead_id.eq.${leadId}`];
    if (lead.promoted_from_prospect_id) ors.push(`prospect_id.eq.${lead.promoted_from_prospect_id}`);
    const { data, error } = await client
      .from("intent_events")
      .select("id, signal_type, observed_at, expires_at, confidence, score_impact, evidence_summary, dedupe_key, intent_categories(name, freshness_days)")
      .eq("business_id", businessId)
      .or(ors.join(","))
      .gt("expires_at", nowIso)
      .order("observed_at", { ascending: false })
      .limit(50);
    if (error) fail("intent_events read", error);
    for (const row of (data ?? []) as unknown as {
      id: string;
      signal_type: string;
      observed_at: string;
      expires_at: string;
      confidence: number | string;
      score_impact: number | string;
      evidence_summary: string | null;
      dedupe_key: string | null;
      intent_categories: { name: string | null; freshness_days: number | null } | null;
    }[]) {
      contextEvents.push({
        id: row.id,
        sourceKey: row.signal_type,
        observedAt: row.observed_at,
        expiresAt: row.expires_at,
        confidence: Number(row.confidence),
        scoreImpact: Number(row.score_impact),
        evidenceSummary: row.evidence_summary,
        categoryName: row.intent_categories?.name ?? null,
        freshnessDays: row.intent_categories?.freshness_days ?? null,
        // The catalogue type the source evidenced (carried into lead context).
        intentType: row.dedupe_key ? parseIntentDedupeKey(row.dedupe_key).intentType : null,
      });
    }
  }

  /* ---- 1. signals: extract, write (idempotent), retract a lifted opt-out mirror */
  const chronological = [...messageRows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  let lastOutboundAt: string | null = null;
  const inbound: LeadSignalInput["inbound"] = [];
  for (const m of chronological) {
    if (m.direction === "outbound") {
      lastOutboundAt = m.created_at;
      continue;
    }
    if (m.direction !== "inbound") continue;
    inbound.push({
      id: m.id,
      body: m.body,
      createdAt: m.created_at,
      replyClassification: m.reply_classification,
      replyConfidence: m.reply_confidence === null ? null : Number(m.reply_confidence),
      previousOutboundAt: lastOutboundAt,
    });
  }
  const extracted = extractLeadSignals(
    {
      origin: {
        leadId,
        serviceId: lead.service_id,
        createdAt: lead.created_at,
        createdVia: lead.created_via,
        relationshipType: lead.relationship_type,
        conversionGoalType: lead.conversion_goal_type,
        optedOut: lead.opted_out,
        optedOutObservedAt: lead.updated_at,
      },
      touches: touchRows.map((t) => ({
        id: t.id,
        occurredAt: t.occurred_at,
        sourceType: t.source_type,
        landingUrl: t.landing_url,
        answers: t.answers,
        ingestOutcome: t.ingest_outcome,
      })),
      inbound,
      bookings: bookingRows.map((b) => ({ id: b.id, status: b.status, createdAt: b.created_at, startsAt: b.starts_at })),
      opportunities: ((opportunities.data ?? []) as { id: string; outcome: string; closed_at: string | null; updated_at: string; outcome_reason: string | null }[]).map(
        (o) => ({ id: o.id, outcome: o.outcome, closedAt: o.closed_at, updatedAt: o.updated_at, outcomeReason: o.outcome_reason }),
      ),
      contextEvents,
    },
    now,
  );
  const existingSignals = await readSignals(client, businessId, leadId);
  const known = new Set(existingSignals.map((s) => `${s.source}:${s.sourceRef ?? "-"}:${s.type}`));
  const fresh = extracted.filter((w) => !known.has(`${w.source}:${w.source_ref ?? "-"}:${w.signal_type}`));
  const inserted = await writeIntentSignals(businessId, fresh);
  await scheduleResumes(businessId, leadId, inserted);

  let signals = [...existingSignals, ...inserted];
  if (!lead.opted_out) {
    // The lead-state mirror follows leads.opted_out (the system of record). An
    // opt-out the lead *wrote* stays until they write again (intent rule 1).
    const mirror = signals.filter((s) => s.type === "UNSUBSCRIBE" && s.sourceRef === `lead-optout:${leadId}`);
    for (const s of mirror) await retractIntentSignal(businessId, leadId, s.id);
    signals = signals.filter((s) => !mirror.includes(s));
  }

  /* ---- 2. facts: mirror answers, lead fields and form answers (idempotent merge) */
  const questionById = new Map(questionRows.map((q) => [q.id, q]));
  const factWrites: QualificationFactWrite[] = [];
  for (const a of answerRows) {
    const q = questionById.get(a.question_id);
    if (!q) continue;
    const intentKey = q.question_intent_key && /^[A-Z][A-Z_]{1,39}\.[A-Z][A-Z0-9_]{1,39}$/.test(q.question_intent_key) ? q.question_intent_key : null;
    const w = answerFactWrite({
      leadId,
      serviceId: lead.service_id,
      questionId: q.id,
      dimension: dimensionOf(q),
      questionIntentKey: intentKey,
      value: a.answer_value ?? a.answer_text ?? "",
      answerSource: a.source,
      confidence: a.confidence === null ? null : Number(a.confidence),
      answeredAt: a.answered_at,
    });
    if (w) factWrites.push(w);
  }
  // A form the lead submitted: its postcode and service are the lead's own
  // statement (FORM, CONFIRMED), so booking is not held up by a VERIFY turn.
  const submittedByLead = leadFieldsFromLeadForm(lead, touchRows);
  const postcode = leadFieldFactWrite({ leadId, serviceId: lead.service_id, dimension: "LOCATION", value: lead.postcode, observedAt: lead.created_at, submittedByLead });
  if (postcode) factWrites.push(postcode);
  const serviceName = leadFieldFactWrite({ leadId, serviceId: lead.service_id, dimension: "SERVICE_NEEDED", value: serviceRow?.name ?? null, observedAt: lead.created_at, submittedByLead });
  if (serviceName) factWrites.push(serviceName);
  // Form answers (defect F3): the lead's own words on the form. An exact label
  // match to a configured question is CONFIRMED; a label whose dimension can
  // only be inferred is INFERRED.
  const questionByLabel = new Map(questionRows.map((q) => [labelKey(q.question_text), q]));
  for (const touch of touchRows) {
    const seenDims = new Set<string>();
    for (const [label, rawValue] of Object.entries(touch.answers ?? {})) {
      if (typeof rawValue !== "string" && typeof rawValue !== "number") continue;
      const value = String(rawValue).trim().slice(0, 500);
      if (!value) continue;
      const exact = questionByLabel.get(labelKey(label)) ?? null;
      const dimension: FactDimension | null = exact
        ? (dimensionOf(exact) ?? UNMAPPED_DIMENSION)
        : inferDimension({ id: touch.id, questionText: label, responseType: "text", required: false, serviceId: null, position: 0, options: [] });
      if (!dimension || seenDims.has(dimension)) continue;
      seenDims.add(dimension);
      // The lead's own entry. Exact label: CONFIRMED. Label mapped by
      // inference: CONFIRMED only when the value corroborates the dimension
      // (a postcode that parses as one), else INFERRED.
      const corroborated = !exact && formValueCorroborates(dimension, value, { serviceNames: serviceRow?.name ? [serviceRow.name] : [] });
      factWrites.push({
        lead_id: leadId,
        service_id: lead.service_id,
        dimension,
        value,
        value_normalised: normaliseFactValue(dimension, value),
        state: exact || corroborated ? "CONFIRMED" : "INFERRED",
        source: "FORM",
        source_ref: `touch:${touch.id}`,
        question_id: exact?.id ?? null,
        question_intent_key: dimension === UNMAPPED_DIMENSION && exact ? `custom:${exact.id}` : null,
        confidence: exact ? 1 : corroborated ? 0.95 : 0.8,
        observed_at: new Date(Date.parse(touch.occurred_at) || now.getTime()).toISOString(),
        valid_until: factValidUntil(dimension, touch.occurred_at, { value }),
        verified_at: null,
        set_by: null,
      });
    }
  }
  // Several interests (08 §B.20): the services the lead named in its own
  // messages or chose on a form, the ones a person added, the opportunities.
  const storedFacts = await readFacts(client, businessId, leadId);
  const interests = detectInterests({
    leadServiceId: lead.service_id,
    leadCreatedAt: lead.created_at,
    services: allServices,
    inbound: inbound.map((m) => ({ id: m.id, body: m.body, createdAt: m.createdAt })),
    touches: touchRows
      .filter((t) => (LEAD_FORM_TOUCH_SOURCES as readonly string[]).includes(t.source_type))
      .map((t) => ({ id: t.id, answers: t.answers, occurredAt: t.occurred_at })),
    opportunities: interestOpps.map((o) => ({ serviceId: o.service_id, createdAt: o.created_at, interestSource: o.interest_source })),
    facts: storedFacts,
  });
  for (const interest of interests) {
    const name = allServices.find((x) => x.id === interest.serviceId)?.name;
    const write = name ? interestFactWrite({ leadId, interest, serviceName: name }) : null;
    if (write) factWrites.push(write);
  }
  const interestScope: InterestScope = { primaryServiceId: lead.service_id, interestServiceIds: interests.map((i) => i.serviceId) };
  const facts = await mergeFacts(client, businessId, storedFacts, factWrites, now, interestScope);
  // The lead's own service reads its own and the shared facts (all of them with one interest).
  const primaryFacts = lead.service_id ? factsForInterest(facts, lead.service_id, interestScope) : facts;

  /* ---- 3. offer, policy, goal */
  const parsedOverrides = parseSalesOverrides(
    ((overrides.data ?? []) as { kind: string; key: string; payload: unknown }[]).map((r) => ({ kind: r.kind, key: r.key, payload: r.payload })),
  );
  const servicePolicy = lead.service_id ? (parsedOverrides.servicePolicies[lead.service_id.toLowerCase()] ?? null) : null;
  const workspacePolicy = parsedOverrides.workspacePolicy;
  const profileRow = (profile.data ?? null) as { archetype_key: string | null; sales_motions: string[] | null } | null;
  const workspaceMotion =
    (profileRow?.sales_motions ?? []).find((m): m is SalesMotion => (SALES_MOTIONS as readonly string[]).includes(m)) ?? null;
  const resolved = resolveOffer({
    archetypeKey: profileRow?.archetype_key ?? null,
    workspaceMotion,
    offerProfileRaw: serviceRow?.offer_profile ?? {},
    averageValue: serviceRow?.average_value ?? null,
    workspacePolicy,
    servicePolicy,
    overrideDisqualifiers: disqualifiersForService(parsedOverrides, lead.service_id),
  });
  const policy: QualificationPolicy = { ...(workspacePolicy ?? {}), ...(servicePolicy ?? {}) };

  /* ---- 4. intent */
  const latestBooking = bookingRows[0] ?? null;
  const bookingScheduled =
    latestBooking?.status === "scheduled" && (!latestBooking.starts_at || Date.parse(latestBooking.starts_at) >= now.getTime());
  const suppressed = lead.opted_out;
  const intent = assessIntent(signals, now, { suppressed, bookingScheduled });

  /* ---- 5. dimensions, completeness, threshold */
  const ruleDimensions = ((rules.data ?? []) as RuleRow[])
    .filter((r) => r.result === "hard_fail" && r.question_id)
    .map((r) => {
      const q = questionById.get(r.question_id!);
      return q ? dimensionOf(q) : null;
    })
    .filter((d): d is QiDimensionKey => d !== null);
  const serviceAreaRule = ((rules.data ?? []) as RuleRow[]).some((r) => r.rule_type === "postcode_area");
  // Required = the goal threshold (allOf, plus the anyOf group) and the
  // offer's requiredDimensions; completeness counts an anyOf group once.
  const required = [...new Set<QiDimensionKey>([...resolved.threshold.allOf, ...resolved.threshold.anyOf, ...resolved.requiredDimensions])];
  const dimensions = deriveDimensionStatuses(primaryFacts, now, {
    planDimensions: resolved.plan,
    required,
    requiredDimensions: resolved.requiredDimensions,
    ruleDimensions: [...ruleDimensions, ...resolved.disqualifiers.map((d) => d.dimension)],
    serviceAreaRule,
  });
  const completeness = completenessFor(resolved, dimensions);
  const threshold = thresholdStatus(resolved.threshold, dimensions);

  /* ---- 6. goal */
  const engineVerdict = (ENGINE_VERDICTS.has(lead.qualification_state ?? "") ? lead.qualification_state : "PENDING") as QualificationResult;
  const confirmedValues = factValues(primaryFacts, nowIso, { includeAi: false, confirmedOnly: true });
  const confirmedDisqualifier = resolved.disqualifiers.some((d) =>
    evaluatePredicate(d.when, { values: confirmedValues, intentState: intent.state }),
  );
  const goalRows = (goals.data ?? []) as { id: string; type: string; is_default: boolean; qualification_required: boolean }[];
  const leadGoal = goalRows.find((g) => g.id === lead.conversion_goal_id) ?? null;
  const defaultGoal = goalRows.find((g) => g.is_default) ?? null;
  const dealValueGbp =
    typeof lead.estimated_value === "number" && lead.estimated_value > 0
      ? Number(lead.estimated_value)
      : (resolved.offer.averageDealValue ?? null);
  const goal = resolveGoal({
    motion: resolved.motion,
    lead: lead.conversion_goal_type
      ? { conversionGoalType: lead.conversion_goal_type as ConversionGoalType, qualificationRequired: leadGoal?.qualification_required ?? null }
      : null,
    offerGoal: parseOfferProfile(serviceRow?.offer_profile ?? {}).profile.goal ?? null,
    policyGoal: servicePolicy?.goal ?? workspacePolicy?.goal ?? null,
    workspaceDefaultGoal: defaultGoal
      ? { type: defaultGoal.type as ConversionGoalType, qualificationRequired: defaultGoal.qualification_required }
      : null,
    engineVerdict,
    confirmedDisqualifier,
    intentState: intent.state,
    dealValueGbp,
    humanCloserAboveValue: policy.humanCloserAboveValue ?? null,
  });

  /* ---- 7. stage, channel, ask history, candidates */
  const lastInbound = messageRows.find((m) => m.direction === "inbound") ?? null;
  const channel = asChannel(lastInbound?.channel ?? messageRows[0]?.channel ?? null);
  const stage = deriveConversationStage({
    leadStatus: lead.status,
    firstRepliedAt: lead.first_replied_at ?? lastInbound?.created_at ?? null,
    answeredCount: answerRows.length,
    bookingScheduled,
    lastReplyObjection: lastInbound?.reply_classification === "OBJECTION",
    thresholdMet: threshold.met,
  });
  const knownNow = new Set(dimensions.filter((d) => d.status === "CONFIRMED" || d.status === "INFERRED").map((d) => d.dimension));
  const asked = new Map<string, { asked: number; dimension: string | null }>();
  for (const m of messageRows) {
    if (m.direction !== "outbound" || !m.features || typeof m.features !== "object") continue;
    const f = m.features as { questionIntent?: unknown; dimension?: unknown };
    if (typeof f.questionIntent !== "string") continue;
    const entry = asked.get(f.questionIntent) ?? { asked: 0, dimension: typeof f.dimension === "string" ? f.dimension : null };
    entry.asked += 1;
    asked.set(f.questionIntent, entry);
  }
  const askHistory = [...asked.entries()].map(([key, v]) => ({
    key,
    asked: v.asked,
    answered: v.dimension ? knownNow.has(v.dimension as FactDimension) : false,
  }));
  const configuredQuestions: ConfiguredQuestion[] = questionRows.map((q) => ({
    ...questionRecord(q),
    dimensionKey: q.dimension_key,
    intentKey: q.question_intent_key,
  }));
  const answeredQuestionIds = answerRows
    .filter((a) => (a.answer_value ?? a.answer_text ?? "").trim() !== "")
    .map((a) => a.question_id);

  /* ---- 8. what the legacy selector would ask (SHADOW diff only) */
  let legacyNextQuestionId: string | null = null;
  if (options.mode === "SHADOW") {
    try {
      const legacy = selectNextQuestion({
        questions: questionRows.map(questionRecord),
        answers: answerRows.map((a) => ({ questionId: a.question_id, answerValue: a.answer_value ?? a.answer_text })),
        serviceId: lead.service_id,
        leadFields: { LOCATION: lead.postcode, SERVICE_NEEDED: serviceRow?.name ?? null },
        motion: workspaceMotion,
        archetypeKey: profileRow?.archetype_key ?? null,
      });
      legacyNextQuestionId = legacy.question?.id ?? null;
    } catch (error) {
      console.error("[qualification-intelligence] legacy selector failed (shadow diff skipped)", { businessId, leadId, error });
    }
  }

  return {
    businessId,
    leadId,
    mode: options.mode,
    now,
    serviceId: lead.service_id,
    signals,
    facts,
    intent,
    resolved,
    goal,
    dimensions,
    completeness,
    thresholdMet: threshold.met,
    stage,
    channel,
    configuredQuestions,
    answeredQuestionIds,
    intentOverrides: parsedOverrides.intentOverrides,
    askHistory,
    engineVerdict,
    suppressed,
    bookingScheduled,
    dealValueGbp,
    policy,
    legacyNextQuestionId,
    agentMode: ((aiSettings.data ?? null) as { agent_mode: string | null } | null)?.agent_mode ?? null,
    services: allServices,
    interests,
    interestOpportunities: interestOpps.map((o) => ({ id: o.id, serviceId: o.service_id, stage: o.stage, outcome: o.outcome, value: o.value === null ? null : Number(o.value) })),
    interestContext: {
      archetypeKey: profileRow?.archetype_key ?? null,
      workspaceMotion,
      workspacePolicy,
      servicePolicies: parsedOverrides.servicePolicies,
      overrides: parsedOverrides,
      leadConversionGoal: lead.conversion_goal_type
        ? { type: lead.conversion_goal_type as ConversionGoalType, qualificationRequired: leadGoal?.qualification_required ?? null }
        : null,
      workspaceDefaultGoal: defaultGoal
        ? { type: defaultGoal.type as ConversionGoalType, qualificationRequired: defaultGoal.qualification_required }
        : null,
      ruleDimensions: [...ruleDimensions],
      serviceAreaRule,
      leadStatus: lead.status,
      firstRepliedAt: lead.first_replied_at ?? lastInbound?.created_at ?? null,
      answeredCount: answerRows.length,
      lastReplyObjection: lastInbound?.reply_classification === "OBJECTION",
      leadEstimatedValue: typeof lead.estimated_value === "number" && lead.estimated_value > 0 ? Number(lead.estimated_value) : null,
      latestInbound: lastInbound?.body ?? null,
    },
  };
}

/** Turn-time inputs the lead.score job does not have. */
export type TurnContext = {
  /** interpret() output for the inbound reply this turn answers. */
  interpretation?: Interpretation | null;
  /** classifyDeterministic's binding verdict, when one fired. */
  bindingVerdict?: string | null;
  channel?: AgentChannel | null;
  stage?: ConversationStage | null;
  /** The real checkoutGate result (commercial_authority); false in the job. */
  checkoutAllowed?: boolean;
  /**
   * Several interests: the direct-close gate for one offer (its motion, its
   * approved link, its value). Absent: no interest may close by checkout.
   */
  checkoutFor?: (offer: { serviceId: string; motion: SalesMotion; linkId: string | null; valueGbp: number | null }) => boolean;
  /** The approved checkout link for one offer (interests.ts checkoutLinkForService). */
  checkoutLinkFor?: (service: InterestService) => string | null;
  /** The interest the last turn was about. */
  focusServiceId?: string | null;
  /** The reply this turn answers, for "which interest did they name?". */
  latestMessage?: string | null;
  /** A planned re-engagement check-in is due this turn (nba.ts checkInDue). */
  checkInDue?: boolean;
};

/**
 * The pure pipeline's input from prepared intelligence (nba.ts
 * `planNextBestAction`: candidates -> threshold -> NBA). The lead.score job
 * passes no turn context: no turn is in progress, so nothing is binding and
 * no checkout is offered (an R8 purchase-ready lead escalates READY_TO_BUY
 * rather than being sent a link nobody authorised).
 */
export function planInput(intel: LeadIntelligence, qualificationScore: number, turn: TurnContext = {}): PlanTurnInput {
  return {
    now: intel.now.toISOString(),
    channel: turn.channel ?? intel.channel,
    stage: turn.stage ?? intel.stage,
    resolved: intel.resolved,
    goal: intel.goal,
    intent: intel.intent,
    dimensions: intel.dimensions,
    facts: intel.facts,
    configuredQuestions: intel.configuredQuestions,
    serviceId: intel.serviceId,
    answeredQuestionIds: intel.answeredQuestionIds,
    intentOverrides: intel.intentOverrides,
    askHistory: intel.askHistory,
    engineVerdict: intel.engineVerdict,
    qualificationScore: Math.max(0, Math.min(100, qualificationScore)),
    completeness: intel.completeness,
    suppressed: intel.suppressed,
    interpretation: turn.interpretation ?? null,
    bindingVerdict: turn.bindingVerdict ?? null,
    policy: intel.policy,
    checkoutAllowed: turn.checkoutAllowed ?? false,
    bookingScheduled: intel.bookingScheduled,
    dealValueGbp: intel.dealValueGbp,
    inferDimension: (q) => inferDimension(q),
    checkInDue: turn.checkInDue === true,
  };
}

/**
 * Decides the NBA for prepared intelligence without recording anything. The
 * orchestrator's turn-time entry point: after `writeInterpretation` and a
 * fresh `prepareLeadIntelligence`, it plans with the turn context and then
 * records with `recordLeadAssessment(intel, { ..., nba })`.
 */
export function planLeadTurn(
  intel: LeadIntelligence,
  qualificationScore: number,
  turn: TurnContext = {},
): {
  nba: NextBestAction;
  input: NbaDecisionInput;
  excluded: { key: string; reason: string }[];
  /** Set when the lead has several interests: every plan and the one move chosen. */
  interests?: { plans: InterestPlan[]; coordination: Coordination };
} {
  const single = planNextBestAction(planInput(intel, qualificationScore, turn));
  if ((intel.interests?.length ?? 0) < 2) return single;
  const interests = planLeadInterests(intel, qualificationScore, turn);
  return { nba: interests.coordination.nba, input: interests.coordination.primary.input, excluded: single.excluded, interests };
}

/** Plans every interest of a lead and coordinates them (interests.ts). Pure over prepared intelligence. */
export function planLeadInterests(
  intel: LeadIntelligence,
  qualificationScore: number,
  turn: TurnContext = {},
): { plans: InterestPlan[]; coordination: Coordination } {
  const ctx = intel.interestContext;
  const specs: InterestSpec[] = intel.interests.map((interest) => {
    const service = intel.services.find((x) => x.id === interest.serviceId)!;
    const opp =
      intel.interestOpportunities.find((o) => o.serviceId === interest.serviceId && o.outcome === "OPEN") ??
      [...intel.interestOpportunities].reverse().find((o) => o.serviceId === interest.serviceId) ??
      null;
    const servicePolicy = ctx.servicePolicies[interest.serviceId.toLowerCase()] ?? null;
    const resolvedMotion = resolveOffer({
      archetypeKey: ctx.archetypeKey,
      workspaceMotion: ctx.workspaceMotion,
      offerProfileRaw: service.offerProfile ?? {},
      averageValue: service.averageValue ?? null,
      workspacePolicy: ctx.workspacePolicy,
      servicePolicy,
    }).motion;
    const linkId = turn.checkoutLinkFor ? turn.checkoutLinkFor(service) : null;
    return {
      serviceId: service.id,
      serviceName: service.name,
      source: interest.source,
      offerProfileRaw: service.offerProfile ?? {},
      averageValue: service.averageValue ?? null,
      servicePolicy,
      overrideDisqualifiers: disqualifiersForService(ctx.overrides, service.id),
      opportunity: opp ? { id: opp.id, stage: opp.stage, outcome: opp.outcome, value: opp.value } : null,
      checkoutAllowed: Boolean(
        turn.checkoutFor && linkId && turn.checkoutFor({ serviceId: service.id, motion: resolvedMotion, linkId, valueGbp: opp?.value ?? service.averageValue ?? null }),
      ),
      checkoutLinkId: linkId,
    };
  });
  const latest = turn.latestMessage ?? (turn.interpretation ? ctx.latestInbound : null);
  const plans = planInterests(
    {
      now: intel.now.toISOString(),
      channel: turn.channel ?? intel.channel,
      leadId: intel.leadId,
      primaryServiceId: intel.serviceId,
      interestServiceIds: intel.interests.map((i) => i.serviceId),
      intent: intel.intent,
      facts: intel.facts,
      archetypeKey: ctx.archetypeKey,
      workspaceMotion: ctx.workspaceMotion,
      workspacePolicy: ctx.workspacePolicy,
      leadConversionGoal: ctx.leadConversionGoal,
      workspaceDefaultGoal: ctx.workspaceDefaultGoal,
      engineVerdict: intel.engineVerdict,
      configuredQuestions: intel.configuredQuestions,
      answeredQuestionIds: intel.answeredQuestionIds,
      intentOverrides: intel.intentOverrides,
      askHistory: intel.askHistory,
      qualificationScore: Math.max(0, Math.min(100, qualificationScore)),
      suppressed: intel.suppressed,
      interpretation: turn.interpretation ?? null,
      bindingVerdict: turn.bindingVerdict ?? null,
      checkInDue: turn.checkInDue === true,
      leadBookingScheduled: intel.bookingScheduled,
      leadStatus: ctx.leadStatus,
      firstRepliedAt: ctx.firstRepliedAt,
      answeredCount: ctx.answeredCount,
      lastReplyObjection: ctx.lastReplyObjection,
      explicitStage: turn.stage ?? null,
      leadEstimatedValue: ctx.leadEstimatedValue,
      ruleDimensions: ctx.ruleDimensions,
      serviceAreaRule: ctx.serviceAreaRule,
      inferDimension: (q) => inferDimension(q),
      focusServiceId: turn.focusServiceId ?? null,
    },
    specs,
    latest,
    intel.services,
  );
  const coordination = coordinateInterests(plans, {
    channel: turn.channel ?? intel.channel,
    leadAskedQuestion: turn.interpretation?.lead_asked_question ?? false,
  });
  return { plans, coordination };
}

/** The assessment row for prepared intelligence and a decided NBA. Pure; validated by the caller. */
export function assessmentWrite(
  intel: LeadIntelligence,
  nba: NextBestAction,
  triggerEvent: string,
  /** Several interests: the dimensions of the interest the NBA is for (its goal and completeness are on the NBA). */
  interestDimensions?: DimensionStatusEntry[] | null,
): LeadAssessmentWrite {
  const legacy =
    intel.mode === "SHADOW"
      ? {
          next_question_id: intel.legacyNextQuestionId,
          agent_mode: intel.agentMode ? intel.agentMode.slice(0, 40) : null,
          differs:
            (nba.question_intent?.question_id ?? null) !== intel.legacyNextQuestionId ||
            (intel.legacyNextQuestionId !== null && nba.next_action !== "ASK" && nba.next_action !== "ANSWER_AND_ASK"),
          note: "Legacy selection recomputed in lead.score; turn-level differences are recorded on the agent run.",
        }
      : null;
  return {
    intent_state: intel.intent.state,
    intent_score: intel.intent.score,
    intent_categories: intel.intent.categories,
    intent_evidence: intel.intent.evidence.slice(0, 40),
    intent_contradictions: intel.intent.contradictions.slice(0, 20),
    intent_confidence: intel.intent.confidence,
    valid_until: intel.intent.validUntil,
    // The NBA's own goal and completeness: with several interests the move is
    // for one interest, whose goal may differ from the lead's own service's.
    ...assessmentFieldsFor(nba, interestDimensions ?? intel.dimensions),
    nba,
    engine_version: QIE_ENGINE_VERSION,
    engine_mode: intel.mode,
    legacy_decision: legacy,
    trigger_event: triggerEvent.slice(0, 200),
  };
}

export type RecordedAssessment = {
  assessmentId: string | null;
  inserted: boolean;
  previousState: string | null;
  stateChanged: boolean;
  nba: NextBestAction;
  write: LeadAssessmentWrite;
};

/**
 * Decides the NBA and records the assessment through record_lead_assessment()
 * (CD-11: serialised per lead, idempotent on (lead, trigger, engine version),
 * refuses anonymised leads, writes leads.intent_* in both modes).
 */
export async function recordLeadAssessment(
  intel: LeadIntelligence,
  input: TurnContext & {
    triggerEvent: string;
    qualificationScore: number;
    /** An NBA already decided this turn (planLeadTurn); otherwise decided here. */
    nba?: NextBestAction;
    /** The interest plans decided with it (planLeadTurn), synced to the interests' opportunities. */
    interestPlans?: InterestPlan[] | null;
  },
): Promise<RecordedAssessment> {
  const planned = input.nba && !input.interestPlans ? null : planLeadTurn(intel, input.qualificationScore, input);
  const nba = input.nba ?? planned!.nba;
  const interestPlans = input.interestPlans ?? planned?.interests?.plans ?? null;
  const chosen = interestPlans?.find((p) => p.nba === nba) ?? null;
  const write = leadAssessmentWriteSchema.parse(assessmentWrite(intel, nba, input.triggerEvent, chosen?.dimensions ?? null));
  const { data, error } = await db().rpc("record_lead_assessment", {
    p_business_id: intel.businessId,
    p_lead_id: intel.leadId,
    p_assessment: write,
  });
  if (error) fail("record_lead_assessment", error);
  const out = (data ?? {}) as { assessment_id?: string | null; inserted?: boolean; previous_state?: string | null };
  const inserted = out.inserted === true;
  const previousState = out.previous_state ?? null;
  if (interestPlans && interestPlans.length >= 2) await syncInterestOpportunities(intel, interestPlans);
  return {
    assessmentId: out.assessment_id ?? null,
    inserted,
    previousState,
    stateChanged: inserted && previousState !== write.intent_state,
    nba,
    write,
  };
}

/**
 * Queue a re-assessment (lead.score) now or at `runAt`. The trigger event is
 * the idempotency key of the assessment it produces.
 */
export async function enqueueReassessment(
  businessId: string,
  leadId: string,
  triggerEvent: string,
  runAt?: Date,
): Promise<void> {
  await enqueue(
    "lead.score",
    { leadId, triggerEvent },
    { businessId, runAt, priority: 60, idempotencyKey: `lead.score:${leadId}:${triggerEvent}` },
  );
}
