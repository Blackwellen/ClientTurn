import "server-only";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { PermanentJobError } from "@/lib/jobs/registry";
import { scoreLead } from "@/lib/scoring/service";
import { emitDomainEvent } from "@/lib/events/outbox";
import { parsePayload } from "./parse";
import { leadScorePayload } from "./payloads";

/**
 * `lead.score`: re-score one lead after something about it changed.
 *
 * Retry-safe by construction: `scoreLead` re-reads every fact from the
 * database, and `record_lead_score()` is idempotent on (lead, trigger event,
 * scoring version), so a retried job writes nothing twice.
 *
 * Emits `lead.scored` for every new score and `score.changed` when the grade
 * moved (design 03 §4). Both are keyed by the score row, so a retry that
 * finds the score already written emits nothing new. Neither re-triggers
 * scoring (events/types.ts RESCORE_ON), which is what keeps this from looping.
 */
export async function handleLeadScore(job: ClaimedJob) {
  const payload = parsePayload(leadScorePayload, job.payload);
  if (!job.business_id) {
    throw new PermanentJobError("lead.score requires a business id on the job.");
  }

  const outcome = await scoreLead(job.business_id, payload.leadId, payload.triggerEvent);
  if (!outcome) {
    // Deleted (or never in this workspace). Nothing to score, and retrying
    // cannot bring it back.
    throw new PermanentJobError(`Lead ${payload.leadId} no longer exists.`);
  }

  if (!outcome.inserted || !outcome.scoreId) return;

  const causation = {
    id: payload.causationId ?? null,
    depth: payload.causationDepth ?? 0,
  };
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
    businessId: job.business_id,
    type: "lead.scored",
    subject: { type: "lead", id: payload.leadId },
    payload: data,
    dedupeKey: `lead.scored:${outcome.scoreId}`,
    causation,
  });

  if (outcome.gradeChanged) {
    await emitDomainEvent({
      businessId: job.business_id,
      type: "score.changed",
      subject: { type: "lead", id: payload.leadId },
      payload: data,
      dedupeKey: `score.changed:${outcome.scoreId}`,
      causation,
    });
  }
}
