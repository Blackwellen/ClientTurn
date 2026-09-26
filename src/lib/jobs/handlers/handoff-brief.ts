import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWrite, logWriteError } from "@/lib/supabase/write-result";
import { PermanentJobError } from "@/lib/jobs/registry";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { recordAudit } from "@/lib/audit";
import { runTask } from "@/lib/ai/model-router";
import type { HandoffBriefResult } from "@/lib/ai/schemas";
import { archetypeFor } from "@/lib/sales-library/archetypes";
import { latestLeadOpportunity, loadWorkspaceMotion } from "@/lib/opportunities/service";
import { getCrmPushAdapter, isCrmProvider } from "@/lib/integrations/providers/crm-registry";
import {
  buildLeadBrief,
  chooseQuickBrief,
  renderBriefForModel,
  renderBriefNote,
  type BriefAnswer,
  type BriefInput,
  type BriefMessage,
  type BriefTouch,
} from "@/lib/handoff/brief";
import { parsePayload } from "./parse";

/**
 * `handoff.brief` (Phase 3.4): builds the Lead Brief for one handoff, asks for
 * the 30-second brief once, validates it, stores both on
 * `agent_handoffs.summary_json`, and pushes a note to each connected CRM
 * whose adapter supports notes.
 *
 * Enqueued by `requestHumanHandover`, off the conversation's critical path:
 * the handover itself (ownership, Slack, the acknowledgement) never waits for
 * a model call. Retry-safe: the brief is rebuilt from current state, the model
 * call is keyed `handoff:<id>` so a retry is not charged twice, and CRM notes
 * already pushed for this handoff are recorded and never pushed again.
 */

export const handoffBriefPayload = z.object({ handoffId: z.uuid() });

// Several tables read here (lead_touches, lead_scores, lead_tags,
// opportunities) post-date the generated database types.
function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

/** Postgres "undefined_table": lead_touches may not exist on every database yet. */
const UNDEFINED_TABLE = "42P01";

async function loadTouches(businessId: string, leadId: string): Promise<BriefTouch[]> {
  const { data, error } = await db()
    .from("lead_touches")
    .select("occurred_at, source_type, provider, campaign_name, form_name")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .order("occurred_at", { ascending: true })
    .limit(20);
  if (error) {
    if (error.code !== UNDEFINED_TABLE && error.code !== "PGRST205") {
      logWriteError({ error }, "handoff brief: read touches", { businessId, leadId });
    }
    return [];
  }
  return ((data ?? []) as {
    occurred_at: string;
    source_type: string;
    provider: string;
    campaign_name: string | null;
    form_name: string | null;
  }[]).map((row) => ({
    occurredAt: row.occurred_at,
    sourceType: row.source_type,
    provider: row.provider,
    campaign: row.campaign_name,
    form: row.form_name,
  }));
}

async function loadBriefInput(handoff: HandoffRow): Promise<BriefInput | null> {
  const { business_id: businessId, lead_id: leadId } = handoff;

  const { data: lead } = await db()
    .from("leads")
    .select("id, first_name, last_name, company_name, status, qualification_state, created_at, services(name)")
    .eq("id", leadId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!lead) return null;
  const leadRow = lead as unknown as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    company_name: string | null;
    status: string;
    qualification_state: string;
    created_at: string;
    services: { name: string | null } | null;
  };

  const [touches, score, tags, answers, questions, messages, booking, opportunity, motion, profile] =
    await Promise.all([
      loadTouches(businessId, leadId),
      db()
        .from("lead_scores")
        .select("total, grade, why, confidence")
        .eq("business_id", businessId)
        .eq("lead_id", leadId)
        .eq("is_current", true)
        .maybeSingle(),
      db()
        .from("lead_tags")
        .select("tag, reason")
        .eq("business_id", businessId)
        .eq("lead_id", leadId)
        .is("cleared_at", null),
      db()
        .from("qualification_answers")
        .select("answer_text, answer_value, source, qualification_questions(question_text)")
        .eq("business_id", businessId)
        .eq("lead_id", leadId),
      db()
        .from("qualification_questions")
        .select("question_text")
        .eq("business_id", businessId)
        .eq("active", true)
        .order("position", { ascending: true })
        .limit(20),
      db()
        .from("messages")
        .select("direction, body, created_at, channel")
        .eq("business_id", businessId)
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(30),
      db()
        .from("bookings")
        .select("starts_at, status, provider, location")
        .eq("business_id", businessId)
        .eq("lead_id", leadId)
        .in("status", ["pending", "scheduled"])
        .order("starts_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      latestLeadOpportunity(businessId, leadId),
      loadWorkspaceMotion(businessId),
      db().from("business_profiles").select("archetype_key").eq("business_id", businessId).maybeSingle(),
    ]);

  // Scores and tags (0121) are optional context: an unreadable table leaves
  // the brief without them rather than failing the handoff's brief entirely.
  logWriteError({ error: score.error }, "handoff brief: read score", { businessId, leadId });
  logWriteError({ error: tags.error }, "handoff brief: read tags", { businessId, leadId });

  const answerRows = (answers.data ?? []) as unknown as {
    answer_text: string | null;
    answer_value: string | null;
    source: string;
    qualification_questions: { question_text: string } | null;
  }[];

  const briefAnswers: BriefAnswer[] = answerRows
    .filter((row) => row.qualification_questions?.question_text)
    .map((row) => ({
      question: row.qualification_questions!.question_text,
      value: (row.answer_value ?? row.answer_text ?? "").slice(0, 200),
      source: row.source,
      // recordInferredAnswers (qualify.ts) writes inferred answers with
      // source form/ai_assist and an "Inferred from" answer_text.
      inferred: (row.answer_text ?? "").startsWith("Inferred from"),
    }))
    .filter((answer) => answer.value);

  const archetypeKey = (profile.data as { archetype_key?: string | null } | null)?.archetype_key ?? null;
  const scoreRow = score.data as { total: number; grade: string; why: string; confidence: number } | null;
  const bookingRow = booking.data as {
    starts_at: string | null;
    status: string;
    provider: string;
    location: string | null;
  } | null;

  const briefMessages: BriefMessage[] = ((messages.data ?? []) as {
    direction: string;
    body: string;
    created_at: string;
    channel: string;
  }[])
    .reverse()
    .map((row) => ({
      direction: row.direction === "inbound" ? "inbound" : "outbound",
      body: row.body ?? "",
      at: row.created_at,
      channel: row.channel,
    }));

  const summary = (handoff.summary_json ?? {}) as { unresolvedIssue?: unknown };

  return {
    lead: {
      id: leadRow.id,
      firstName: leadRow.first_name,
      lastName: leadRow.last_name,
      company: leadRow.company_name,
      status: leadRow.status,
      qualificationState: leadRow.qualification_state,
      service: leadRow.services?.name ?? null,
      createdAt: leadRow.created_at,
    },
    touches,
    score: scoreRow
      ? {
          total: Number(scoreRow.total),
          grade: scoreRow.grade,
          why: scoreRow.why,
          confidence: Number(scoreRow.confidence),
        }
      : null,
    tags: ((tags.data ?? []) as { tag: string; reason: string }[]).map((t) => ({ tag: t.tag, reason: t.reason })),
    answers: briefAnswers,
    questions: ((questions.data ?? []) as { question_text: string }[]).map((q) => q.question_text),
    messages: briefMessages,
    meeting: bookingRow
      ? {
          startsAt: bookingRow.starts_at,
          status: bookingRow.status,
          provider: bookingRow.provider,
          location: bookingRow.location,
        }
      : null,
    opportunity: opportunity
      ? {
          stage: opportunity.stage,
          outcome: opportunity.outcome,
          value: opportunity.value,
          currency: opportunity.currency,
        }
      : null,
    sales: {
      motion,
      archetypeKey,
      dealSizeBand: archetypeFor(archetypeKey)?.dealSizeBand ?? null,
      hasApprovedInsight: false,
    },
    handover: {
      reason: handoff.reason,
      detail: typeof summary.unresolvedIssue === "string" ? summary.unresolvedIssue : null,
      channel: briefMessages.at(-1)?.channel ?? null,
    },
  };
}

type HandoffRow = {
  id: string;
  business_id: string;
  lead_id: string;
  reason: string;
  status: string;
  summary_json: Record<string, unknown> | null;
};

export async function handleHandoffBrief(job: ClaimedJob): Promise<void> {
  const payload = parsePayload(handoffBriefPayload, job.payload);

  const { data: row, error } = await db()
    .from("agent_handoffs")
    .select("id, business_id, lead_id, reason, status, summary_json")
    .eq("id", payload.handoffId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new PermanentJobError(`Handoff ${payload.handoffId} no longer exists.`);
  const handoff = row as HandoffRow;

  // A handoff already closed needs no brief: nobody is about to pick it up.
  if (handoff.status === "RESOLVED" || handoff.status === "CANCELLED") return;

  const input = await loadBriefInput(handoff);
  if (!input) throw new PermanentJobError(`Lead ${handoff.lead_id} no longer exists.`);

  const brief = buildLeadBrief(input);

  // ONE model call, over the structured brief only. Degrades to the
  // deterministic summary when AI is off, over budget, or out of tokens.
  const result = await runTask<HandoffBriefResult>({
    taskType: "handoff_brief",
    businessId: handoff.business_id,
    leadId: handoff.lead_id,
    context: renderBriefForModel(brief),
    maxOutputTokens: 200,
    correlationId: `handoff:${handoff.id}`,
  }).catch(() => null);

  const quick = chooseQuickBrief(result?.data?.brief ?? null, brief);

  // Re-read just before writing: the handover may have been refreshed (a new
  // reason) while the brief was being built. Its own keys are kept.
  const { data: fresh } = await db()
    .from("agent_handoffs")
    .select("summary_json")
    .eq("id", handoff.id)
    .maybeSingle();
  const current = ((fresh as { summary_json?: Record<string, unknown> } | null)?.summary_json ??
    handoff.summary_json ??
    {}) as Record<string, unknown>;

  const crmNotes = { ...((current.crmNotes as Record<string, string> | undefined) ?? {}) };
  const noteBody = renderBriefNote(brief, quick.text);
  await pushCrmNotes(handoff, noteBody, crmNotes);

  assertWrite(
    await db()
      .from("agent_handoffs")
      .update({
        summary_json: {
          ...current,
          leadBrief: brief,
          quickBrief: {
            text: quick.text,
            source: quick.source,
            generatedAt: new Date().toISOString(),
            // Kept so a rejected model brief can be audited, never shown.
            rejectedFor: quick.violations.slice(0, 10),
          },
          crmNotes,
        },
      })
      .eq("id", handoff.id)
      .eq("business_id", handoff.business_id),
    "handoff brief: store",
    { businessId: handoff.business_id, handoffId: handoff.id },
  );

  await recordAudit({
    businessId: handoff.business_id,
    actorType: "system",
    action: "handoff.brief_generated",
    entityType: "agent_handoff",
    entityId: handoff.id,
    metadata: { source: quick.source, violations: quick.violations.length },
  });
}

/**
 * One note per connected CRM whose adapter supports notes and which already
 * holds this lead (a `crm_push_records` row with its record id). `crmNotes`
 * records what was pushed for this handoff, so a retry does not push twice.
 */
async function pushCrmNotes(
  handoff: HandoffRow,
  body: string,
  crmNotes: Record<string, string>,
): Promise<void> {
  const { data: records } = await db()
    .from("crm_push_records")
    .select("provider_type, external_contact_id")
    .eq("business_id", handoff.business_id)
    .eq("lead_id", handoff.lead_id)
    .not("external_contact_id", "is", null);

  for (const record of (records ?? []) as { provider_type: string; external_contact_id: string }[]) {
    const provider = record.provider_type;
    if (crmNotes[provider] || !isCrmProvider(provider)) continue;
    const adapter = getCrmPushAdapter(provider);
    if (!adapter.pushNote) continue;

    const { data: integration } = await db()
      .from("integrations")
      .select("id, status")
      .eq("business_id", handoff.business_id)
      .eq("provider_type", provider)
      .maybeSingle();
    const live = integration as { id: string; status: string } | null;
    if (!live || live.status === "DISCONNECTED") continue;

    try {
      const note = await adapter.pushNote({
        integrationId: live.id,
        businessId: handoff.business_id,
        leadId: handoff.lead_id,
        externalContactId: record.external_contact_id,
        body,
      });
      crmNotes[provider] = note.externalNoteId;
      await recordAudit({
        businessId: handoff.business_id,
        actorType: "system",
        action: "crm.note_pushed",
        entityType: "agent_handoff",
        entityId: handoff.id,
        metadata: { provider },
      });
    } catch (error) {
      // A note is a courtesy copy; the brief in ClientTurn is the record.
      console.error("[handoff brief] CRM note failed", {
        businessId: handoff.business_id,
        handoffId: handoff.id,
        provider,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
