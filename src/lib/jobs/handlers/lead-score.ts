import "server-only";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { PermanentJobError } from "@/lib/jobs/registry";
import { scoreLead } from "@/lib/scoring/service";
import { emitDomainEvent } from "@/lib/events/outbox";
import {
  loadEngineMode,
  prepareLeadIntelligence,
  recordLeadAssessment,
  type LeadIntelligence,
} from "@/lib/qualification-intelligence/service";
import { parsePayload } from "./parse";
import { leadScorePayload } from "./payloads";

/**
 * `lead.score`: re-score and re-assess one lead after something about it
 * changed (events/types.ts RESCORE_ON, the intent sweep, a stated timeframe
 * or NOT_NOW falling due, or a person's re-score).
 *
 * One path (design 08 §B.5): signals -> intent -> score -> tags -> NBA -> one
 * lead_assessments row. With the workspace's engine OFF only the score runs,
 * exactly as before. In SHADOW and LIVE the qualification intelligence is
 * prepared first (its signals and facts written), the score reads the intent
 * assessment and the facts, and the assessment is recorded after it.
 *
 * Retry-safe by construction: every step re-reads its facts from the
 * database; signals and facts are written idempotently; `record_lead_score()`
 * and `record_lead_assessment()` are each idempotent on (lead, trigger event,
 * version). The assessment is recorded whether or not this run inserted the
 * score, so a retry after a failed assessment completes it.
 *
 * Emits `lead.scored` for every new score, `score.changed` when the grade
 * moved (design 03 §4), and `lead.intent_changed` when the intent state
 * changed. Each is keyed by its own row, so a retry emits nothing new, and
 * none of them re-triggers scoring (RESCORE_ON), which keeps this from looping.
 */
export async function handleLeadScore(job: ClaimedJob) {
  const payload = parsePayload(leadScorePayload, job.payload);
  if (!job.business_id) {
    throw new PermanentJobError("lead.score requires a business id on the job.");
  }
  const businessId = job.business_id;

  // The intelligence is prepared before scoring because the score reads it.
  // A failure here must not stop the lead being scored: the score is the
  // established path. It is logged, the score runs on its own, and the error
  // is re-thrown after it so the job retries and the assessment is completed
  // (the score's idempotency makes that retry a no-op for the score).
  const mode = await loadEngineMode(businessId);
  let intel: LeadIntelligence | null = null;
  let intelError: unknown = null;
  if (mode !== "OFF") {
    try {
      intel = await prepareLeadIntelligence(businessId, payload.leadId, { mode });
    } catch (error) {
      intelError = error;
      console.error("[lead.score] qualification intelligence failed; scoring without it", {
        businessId,
        leadId: payload.leadId,
        triggerEvent: payload.triggerEvent,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const outcome = await scoreLead(
    businessId,
    payload.leadId,
    payload.triggerEvent,
    intel ? { intent: intel.intent, facts: intel.facts, completeness: intel.completeness } : null,
  );
  if (!outcome) {
    // Deleted (or never in this workspace). Nothing to score, and retrying
    // cannot bring it back.
    throw new PermanentJobError(`Lead ${payload.leadId} no longer exists.`);
  }

  const causation = {
    id: payload.causationId ?? null,
    depth: payload.causationDepth ?? 0,
  };

  if (outcome.inserted && outcome.scoreId) {
    const data = {
      lead_id: payload.leadId,
      score_id: outcome.scoreId,
      total: outcome.result.total,
      grade: outcome.result.grade,
      previous_grade: outcome.previousGrade,
      confidence: outcome.result.confidence,
      trigger_event: payload.triggerEvent,
      scoring_version: outcome.result.scoringVersion,
    };

    await emitDomainEvent({
      businessId,
      type: "lead.scored",
      subject: { type: "lead", id: payload.leadId },
      payload: data,
      dedupeKey: `lead.scored:${outcome.scoreId}`,
      causation,
    });

    if (outcome.gradeChanged) {
      await emitDomainEvent({
        businessId,
        type: "score.changed",
        subject: { type: "lead", id: payload.leadId },
        payload: data,
        dedupeKey: `score.changed:${outcome.scoreId}`,
        causation,
      });
    }
  }

  if (intel) {
    const recorded = await recordLeadAssessment(intel, {
      triggerEvent: payload.triggerEvent,
      qualificationScore: outcome.result.total,
    });
    if (recorded.stateChanged) {
      await emitDomainEvent({
        businessId,
        type: "lead.intent_changed",
        subject: { type: "lead", id: payload.leadId },
        payload: {
          lead_id: payload.leadId,
          assessment_id: recorded.assessmentId,
          intent_state: recorded.write.intent_state,
          previous_intent_state: recorded.previousState,
          intent_score: recorded.write.intent_score,
          next_action: recorded.nba.next_action,
          qualification_completeness: recorded.write.qualification_completeness,
          engine_mode: recorded.write.engine_mode,
          engine_version: recorded.write.engine_version,
          trigger_event: payload.triggerEvent,
        },
        dedupeKey: `lead.intent_changed:${recorded.assessmentId}`,
        causation,
      });
    }
  }

  if (intelError) throw intelError;
}
