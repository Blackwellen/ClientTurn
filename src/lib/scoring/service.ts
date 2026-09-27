import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { SALES_MOTIONS, SCORE_DIMENSIONS, type SalesMotion } from "@/lib/sales-library/types";
import { scoreLead as runScoreEngine, type LeadFact, type LeadScoreResult } from "./lead-score";
import { deriveTags, LEAD_TAGS, type DerivedTag, type TagLifecycle } from "./tags";
import {
  answerFeatures,
  conflictingScoreDimensions,
  factAnswers,
  needStatedFact,
  pricingRequestedFact,
  type ScoredAnswer,
} from "./answer-features";
import { inferDimension, type QuestionRecord } from "@/lib/qualification/next-question";
import type { IntentAssessment, QualificationFact } from "@/lib/qualification-intelligence/types";

/**
 * Lead scoring, server side (design doc 04 §2).
 *
 * Gathers structured facts about one lead, runs the pure engine
 * (lead-score.ts), derives tags (tags.ts), and writes both through
 * `record_lead_score()` (migration 0121), which flips the previous current
 * score, inserts the new one and reconciles tags in one transaction.
 *
 * Retry-safe (CLAUDE.md): every run re-reads current state, and the RPC is
 * idempotent on (lead, trigger event, scoring version), so a retried job
 * writes nothing twice.
 *
 * Facts, not personal data: the engine sees booleans, bands and counts. Names,
 * email addresses, phone numbers and message bodies never leave this file.
 *
 * Qualification intelligence (design 08 §B.14): when the lead.score job ran
 * the intent engine first (engine mode SHADOW or LIVE), it passes the
 * assessment and the lead's facts here. INTENT then comes from the intent
 * score (one fact, `intent_assessment`), a NEGATIVE / NOT_NOW state is the
 * refusal / deferral veto (instead of "the latest classification"), the fact
 * store's answers feed timing, budget, authority and need alongside the
 * configured answers, conflicting facts are reported per dimension, and the
 * completeness is carried on the score. Without it, scoring is exactly as
 * before.
 */

/** What the intent engine hands the score (qualification-intelligence/service.ts). */
export type ScoreIntelligence = {
  intent: IntentAssessment;
  facts: QualificationFact[];
  completeness: number;
};

/**
 * Tables and the RPC from migration 0121 post-date the last
 * `database.types.ts` generation. Cast at this one seam; every row read below
 * is narrowed explicitly.
 */
function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

function fail(operation: string, error: { message: string }): never {
  throw new Error(`scoreLead: ${operation} failed: ${error.message}`);
}

const weightOverrideSchema = z
  .object(Object.fromEntries(SCORE_DIMENSIONS.map((d) => [d, z.number().min(0).max(100).optional()])))
  .partial();

const DAY_MS = 86_400_000;

/** Reply classifications (canonical, 0115) that count as positive interest. */
const POSITIVE = new Set(["POSITIVE_INTEREST", "NEUTRAL_QUESTION", "BOOKING_INTENT"]);
const REFUSAL = new Set(["NOT_INTERESTED", "UNSUBSCRIBE"]);
/** How a lead arrived; either means they contacted the business themselves. */
const INBOUND_CREATED_VIA = new Set(["INBOUND", "API"]);
const INBOUND_RELATIONSHIPS = new Set(["THEY_CONTACTED_US", "REQUESTED_INFORMATION"]);
const OUT_OF_AREA_REASONS = new Set(["postcode_blocked", "postcode_outside_area"]);

type LeadRow = {
  id: string;
  business_id: string;
  status: string | null;
  qualification_state: string | null;
  qualification_reason: unknown;
  service_id: string | null;
  postcode: string | null;
  estimated_value: number | null;
  opted_out: boolean;
  human_takeover: boolean;
  created_via: string | null;
  relationship_type: string | null;
  promoted_from_prospect_id: string | null;
  created_at: string;
};

export type ScoreLeadOutcome = {
  result: LeadScoreResult;
  tags: DerivedTag[];
  scoreId: string;
  /** False when this (lead, trigger, version) was already scored. */
  inserted: boolean;
  previousGrade: string | null;
  gradeChanged: boolean;
};

function reasonCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (entry && typeof entry === "object" ? (entry as { code?: unknown }).code : null))
    .filter((code): code is string => typeof code === "string");
}

async function loadWeightOverride(
  client: SupabaseClient,
  businessId: string,
  archetypeKey: string | null,
) {
  const keys = archetypeKey ? [archetypeKey, "*"] : ["*"];
  const { data, error } = await client
    .from("workspace_sales_overrides")
    .select("key, payload")
    .eq("business_id", businessId)
    .eq("kind", "SCORING_WEIGHTS")
    .in("key", keys);
  if (error) fail("workspace_sales_overrides read", error);

  const rows = (data ?? []) as { key: string; payload: unknown }[];
  // The archetype-specific override beats the workspace-wide one.
  const row = rows.find((r) => r.key === archetypeKey) ?? rows.find((r) => r.key === "*");
  if (!row) return null;
  const parsed = weightOverrideSchema.safeParse(row.payload);
  // A malformed override is ignored rather than failing the score; the library
  // default is always a valid answer.
  return parsed.success ? (parsed.data as Partial<Record<(typeof SCORE_DIMENSIONS)[number], number>>) : null;
}

/** Facts from the prospect this lead was promoted from, if any. */
async function prospectFacts(client: SupabaseClient, businessId: string, prospectId: string) {
  const facts: LeadFact[] = [];

  const { data: prospect, error } = await client
    .from("prospects")
    .select("id, role_classification, company_id")
    .eq("business_id", businessId)
    .eq("id", prospectId)
    .maybeSingle();
  if (error) fail("prospect read", error);
  if (!prospect) return facts;

  const p = prospect as { id: string; role_classification: string | null; company_id: string | null };
  if (p.role_classification && p.role_classification !== "UNKNOWN") {
    facts.push({ feature: "role_authority", value: p.role_classification, source: "prospect.role", confidence: 0.8 });
  }

  const [score, company, intent] = await Promise.all([
    client
      .from("prospect_scores")
      .select("id, created_at")
      .eq("business_id", businessId)
      .eq("prospect_id", p.id)
      .eq("is_current", true)
      .maybeSingle(),
    p.company_id
      ? client
          .from("prospect_companies")
          .select("subscriber_type, website_url, domain")
          .eq("business_id", businessId)
          .eq("id", p.company_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    client
      .from("prospect_intent_matches")
      .select("score_impact")
      .eq("business_id", businessId)
      .eq("prospect_id", p.id)
      .gt("expires_at", new Date().toISOString()),
  ]);
  if (score.error) fail("prospect_scores read", score.error);
  if (company.error) fail("prospect_companies read", company.error);
  if (intent.error) fail("prospect_intent_matches read", intent.error);

  // The prospect scorer's own fit judgements, fed through the same dimensions
  // (design doc §2: prospects/scoring.ts is "fed through the same dimensions").
  if (score.data) {
    const s = score.data as { id: string; created_at: string };
    const { data: factors, error: factorError } = await client
      .from("prospect_score_factors")
      .select("factor, raw_value, confidence")
      .eq("business_id", businessId)
      .eq("prospect_score_id", s.id);
    if (factorError) fail("prospect_score_factors read", factorError);
    const map: Record<string, LeadFact["feature"]> = {
      ICP_FIT: "industry_match",
      GEOGRAPHY: "geography_match",
    };
    for (const row of (factors ?? []) as { factor: string; raw_value: number; confidence: number }[]) {
      const feature = map[row.factor];
      if (!feature) continue;
      facts.push({
        feature,
        value: Number(row.raw_value),
        source: "prospect_score",
        observedAt: s.created_at,
        confidence: Number(row.confidence),
      });
    }
  }

  if (company.data) {
    const c = company.data as { subscriber_type: string | null; website_url: string | null; domain: string | null };
    if (c.subscriber_type && c.subscriber_type !== "UNKNOWN") {
      facts.push({
        feature: "incorporated",
        value: c.subscriber_type === "CORPORATE",
        source: "prospect_company.subscriber_type",
        confidence: 0.9,
      });
    }
    facts.push({
      feature: "website_present",
      value: Boolean(c.website_url || c.domain),
      source: "prospect_company",
      confidence: 0.9,
    });
  }

  const impact = ((intent.data ?? []) as { score_impact: number }[]).reduce(
    (sum, row) => sum + Number(row.score_impact),
    0,
  );
  if (impact > 0) {
    // 25 is MAX_SCORE_IMPACT for one category (intent/types.ts): one maxed
    // category is a full-strength signal.
    facts.push({
      feature: "intent_signal_strength",
      value: Math.min(1, impact / 25),
      source: "prospect_intent_matches",
      confidence: 0.8,
    });
  }

  return facts;
}

/**
 * Scores one lead and records the result. `triggerEvent` names what caused the
 * re-score (e.g. `lead.processed`, `reply.classified:<messageId>`); together
 * with the scoring version it is the idempotency key.
 */
export async function scoreLead(
  businessId: string,
  leadId: string,
  triggerEvent: string,
  intelligence?: ScoreIntelligence | null,
): Promise<ScoreLeadOutcome | null> {
  const client = db();
  const now = new Date();

  const { data: leadData, error: leadError } = await client
    .from("leads")
    .select(
      "id, business_id, status, qualification_state, qualification_reason, service_id, postcode, estimated_value, opted_out, human_takeover, created_via, relationship_type, promoted_from_prospect_id, created_at",
    )
    .eq("business_id", businessId)
    .eq("id", leadId)
    .maybeSingle();
  if (leadError) fail("lead read", leadError);
  if (!leadData) return null;
  const lead = leadData as LeadRow;

  const [profile, answers, messages, bookings, questions] = await Promise.all([
    client
      .from("business_profiles")
      .select("archetype_key, sales_motions")
      .eq("business_id", businessId)
      .maybeSingle(),
    client
      .from("qualification_answers")
      .select("question_id, evaluation, answer_text, answer_value, answered_at, confidence")
      .eq("business_id", businessId)
      .eq("lead_id", leadId),
    client
      .from("messages")
      .select("direction, body, reply_classification, reply_confidence, created_at")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(200),
    client
      .from("bookings")
      .select("status, starts_at, created_at")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(20),
    client
      .from("qualification_questions")
      .select("id, question_text, response_type")
      .eq("business_id", businessId),
  ]);
  if (profile.error) fail("business_profiles read", profile.error);
  if (answers.error) fail("qualification_answers read", answers.error);
  if (messages.error) fail("messages read", messages.error);
  if (bookings.error) fail("bookings read", bookings.error);
  if (questions.error) fail("qualification_questions read", questions.error);

  const profileRow = (profile.data ?? null) as { archetype_key: string | null; sales_motions: string[] | null } | null;
  const archetypeKey = profileRow?.archetype_key ?? null;
  const motion = (profileRow?.sales_motions ?? []).find((m): m is SalesMotion =>
    (SALES_MOTIONS as readonly string[]).includes(m),
  ) ?? null;

  const facts: LeadFact[] = [];

  /* ---- lead row */
  const reasons = reasonCodes(lead.qualification_reason);
  if (lead.qualification_state && lead.qualification_state !== "PENDING") {
    facts.push({ feature: "qualification_state", value: lead.qualification_state, source: "lead.qualification" });
  }
  if (reasons.includes("service_inactive")) {
    facts.push({ feature: "service_match", value: 0, source: "lead.qualification" });
  } else if (lead.service_id) {
    facts.push({ feature: "service_match", value: 1, source: "lead.service" });
  }
  if (reasons.some((code) => OUT_OF_AREA_REASONS.has(code))) {
    facts.push({ feature: "geography_match", value: 0, source: "lead.qualification" });
  } else if (lead.postcode && lead.qualification_state && lead.qualification_state !== "PENDING") {
    facts.push({ feature: "geography_match", value: 1, source: "lead.qualification" });
  }
  if (typeof lead.estimated_value === "number" && lead.estimated_value > 0) {
    facts.push({ feature: "estimated_value_gbp", value: Number(lead.estimated_value), source: "lead.estimated_value" });
  }
  const inbound =
    INBOUND_CREATED_VIA.has(lead.created_via ?? "") || INBOUND_RELATIONSHIPS.has(lead.relationship_type ?? "");
  facts.push({ feature: "inbound_enquiry", value: inbound, source: "lead.origin", observedAt: lead.created_at });
  if (lead.opted_out) facts.push({ feature: "opted_out", value: true, source: "lead.opted_out" });

  /* ---- qualification answers */
  const answerRows = (answers.data ?? []) as {
    question_id: string;
    evaluation: string;
    answer_text: string | null;
    answer_value: string | null;
    answered_at: string;
    confidence: number | null;
  }[];
  if (answerRows.some((row) => (row.answer_text ?? row.answer_value ?? "").trim() !== "")) {
    const latest = answerRows.map((row) => row.answered_at).sort().at(-1) ?? null;
    facts.push({ feature: "need_stated", value: true, source: "qualification_answers", observedAt: latest });
  }
  const evaluated = answerRows.filter((row) => row.evaluation === "meets" || row.evaluation === "does_not_meet");
  if (evaluated.length > 0) {
    facts.push({
      feature: "answers_met_ratio",
      value: evaluated.filter((row) => row.evaluation === "meets").length / evaluated.length,
      source: "qualification_answers",
    });
  }

  // Timing, budget, authority and stakeholders, read from the answers through
  // the dimension each question asks about (scoring/answer-features.ts).
  const questionById = new Map(
    ((questions.data ?? []) as { id: string; question_text: string; response_type: string }[]).map((row) => [row.id, row]),
  );
  const factScored: ScoredAnswer[] = intelligence ? factAnswers(intelligence.facts, now) : [];
  facts.push(
    ...answerFeatures([
      ...factScored,
      ...answerRows.map((row) => {
        const question = questionById.get(row.question_id);
        return {
          dimension: question
            ? inferDimension({
                id: question.id,
                questionText: question.question_text,
                responseType: question.response_type as QuestionRecord["responseType"],
                required: false,
                serviceId: null,
                position: 0,
                options: [],
              })
            : null,
          value: row.answer_value ?? row.answer_text ?? "",
          answeredAt: row.answered_at,
          confidence: row.confidence,
        };
      }),
    ]),
  );
  if (intelligence) {
    const need = needStatedFact(intelligence.facts, now);
    if (need) facts.push(need);
  }

  /* ---- messages */
  const messageRows = (messages.data ?? []) as {
    direction: string;
    body: string | null;
    reply_classification: string | null;
    reply_confidence: number | null;
    created_at: string;
  }[];
  const inboundRows = messageRows.filter((row) => row.direction === "inbound");
  const lastInboundAt = inboundRows[0]?.created_at ?? null;
  const lastOutboundAt = messageRows.find((row) => row.direction === "outbound")?.created_at ?? null;
  const classified = inboundRows.filter((row) => row.reply_classification);
  const classifications = classified.map((row) => row.reply_classification as string);

  if (inboundRows.length > 0) {
    facts.push({ feature: "replied", value: true, source: "messages", observedAt: lastInboundAt });
    facts.push({ feature: "inbound_message_count", value: inboundRows.length, source: "messages" });
    if (lastInboundAt) {
      facts.push({
        feature: "days_since_last_inbound",
        value: Math.max(0, Math.floor((now.getTime() - Date.parse(lastInboundAt)) / DAY_MS)),
        source: "messages",
        observedAt: lastInboundAt,
      });
    }
  }
  const pricing = pricingRequestedFact(inboundRows);
  if (pricing) facts.push(pricing);
  const positive = classified.find((row) => POSITIVE.has(row.reply_classification as string));
  if (positive) {
    facts.push({
      feature: "positive_reply",
      value: true,
      source: "reply_classification",
      observedAt: positive.created_at,
      confidence: positive.reply_confidence ?? 0.8,
    });
  }
  const bookingIntent = classified.find((row) => row.reply_classification === "BOOKING_INTENT");
  if (bookingIntent) {
    facts.push({
      feature: "booking_intent",
      value: true,
      source: "reply_classification",
      observedAt: bookingIntent.created_at,
      confidence: bookingIntent.reply_confidence ?? 0.8,
    });
  }
  // Only the *latest* classification can veto: someone who said "not now" in
  // March and "let's book" in May is not a refusal. With the intent engine,
  // its state is the veto instead: it already applied that rule across every
  // signal, not only classifications (intent.ts precedence rules 1-3).
  const latest = intelligence ? undefined : classified[0];
  if (intelligence) {
    const { intent } = intelligence;
    facts.push({
      feature: "intent_assessment",
      value: intent.score / 100,
      source: "intent_assessment",
      observedAt: now.toISOString(),
      confidence: intent.confidence,
    });
    if (intent.state === "NEGATIVE") {
      facts.push({ feature: "not_interested", value: true, source: "intent_assessment", confidence: Math.max(0.8, intent.confidence) });
    }
    if (intent.state === "NOT_NOW") {
      facts.push({ feature: "not_now", value: true, source: "intent_assessment", confidence: Math.max(0.8, intent.confidence) });
    }
  }
  if (latest && REFUSAL.has(latest.reply_classification as string)) {
    facts.push({
      feature: "not_interested",
      value: true,
      source: "reply_classification",
      observedAt: latest.created_at,
      confidence: latest.reply_confidence ?? 0.8,
    });
  }
  if (latest?.reply_classification === "NOT_NOW") {
    facts.push({
      feature: "not_now",
      value: true,
      source: "reply_classification",
      observedAt: latest.created_at,
      confidence: latest.reply_confidence ?? 0.8,
    });
  }

  /* ---- bookings */
  const bookingRows = (bookings.data ?? []) as { status: string; starts_at: string | null; created_at: string }[];
  const latestBooking = bookingRows[0] ?? null;
  if (bookingRows.some((row) => row.status === "scheduled" || row.status === "completed")) {
    facts.push({ feature: "booking_made", value: true, source: "bookings" });
  }
  if (
    latestBooking?.status === "scheduled" &&
    (!latestBooking.starts_at || Date.parse(latestBooking.starts_at) >= now.getTime())
  ) {
    facts.push({ feature: "booking_scheduled", value: true, source: "bookings", observedAt: latestBooking.created_at });
  }
  if (latestBooking?.status === "no_show") {
    facts.push({ feature: "no_show", value: true, source: "bookings", observedAt: latestBooking.created_at });
  }

  /* ---- sourced prospect, if this lead came from one */
  if (lead.promoted_from_prospect_id) {
    facts.push(...(await prospectFacts(client, businessId, lead.promoted_from_prospect_id)));
  }

  /* ---- score, tag, record */
  const weightOverrides = await loadWeightOverride(client, businessId, archetypeKey);
  const result = runScoreEngine({
    facts,
    archetypeKey,
    motion,
    weightOverrides,
    conflictingDimensions: intelligence ? conflictingScoreDimensions(intelligence.facts) : null,
    completeness: intelligence ? intelligence.completeness : null,
  });

  const lifecycle: TagLifecycle = {
    status: lead.status,
    optedOut: lead.opted_out,
    humanTakeover: lead.human_takeover,
    latestBookingStatus: (latestBooking?.status ?? null) as TagLifecycle["latestBookingStatus"],
    latestBookingStartsAt: latestBooking?.starts_at ?? null,
    lastInboundAt,
    lastOutboundAt,
  };
  const tags = deriveTags({
    score: result,
    lifecycle,
    replyClassifications: classifications,
    now,
    intentState: intelligence ? intelligence.intent.state : null,
  });

  const { data: recorded, error: recordError } = await client.rpc("record_lead_score", {
    p_business_id: businessId,
    p_lead_id: leadId,
    p_score: {
      total: result.total,
      grade: result.grade,
      dimensions: result.dimensions,
      missing: result.missing,
      confidence: result.confidence,
      why: result.why,
      archetype_key: result.archetypeKey,
      motion: result.motion,
      scoring_version: result.scoringVersion,
      library_version: result.libraryVersion,
      trigger_event: triggerEvent,
    },
    p_tags: tags.map((tag) => ({
      tag: tag.tag,
      reason: tag.reason,
      confidence: tag.confidence,
      rule_version: tag.ruleVersion,
    })),
    p_managed_tags: [...LEAD_TAGS],
  });
  if (recordError) fail("record_lead_score", recordError);

  const out = (recorded ?? {}) as {
    score_id?: string;
    inserted?: boolean;
    previous_grade?: string | null;
  };
  const previousGrade = out.previous_grade ?? null;
  return {
    result,
    tags,
    scoreId: String(out.score_id ?? ""),
    inserted: out.inserted === true,
    previousGrade,
    gradeChanged: out.inserted === true && previousGrade !== null && previousGrade !== result.grade,
  };
}
