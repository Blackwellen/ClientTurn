import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWriteError } from "@/lib/supabase/write-result";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { inferDimension } from "@/lib/qualification/next-question";
import { loadQuestions } from "@/lib/jobs/handlers/qualify";
import type { BriefMessage } from "@/lib/handoff/brief";
import { deriveOpportunityMemory, parseMemory, type OpportunityMemory } from "./memory";

/**
 * Reads and refreshes `opportunities.memory` (0131, brief §48). The derivation
 * is pure (memory.ts); this file only loads its inputs and stores the result.
 *
 * Best effort by design: memory is a compaction of state that exists
 * elsewhere, so a failed refresh is logged and the agent carries on with the
 * previous memory (or none). A lagging schema (0131 unapplied) is a no-op.
 */

/** 0131 post-dates the generated types. */
type Untyped = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const MESSAGE_WINDOW = 30;

async function latestOpportunity(
  businessId: string,
  leadId: string,
): Promise<{ id: string; memory: unknown } | null> {
  const db = createAdminClient() as unknown as Untyped;
  const { data, error } = await db
    .from("opportunities")
    .select("id, memory")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (!isSchemaLag(error)) console.error("[opportunity-memory] read failed", { businessId, leadId, message: error.message });
    return null;
  }
  return (data as { id: string; memory: unknown } | null) ?? null;
}

/** The stored memory for the lead's latest opportunity, or null. */
export async function loadOpportunityMemory(businessId: string, leadId: string): Promise<OpportunityMemory | null> {
  try {
    const row = await latestOpportunity(businessId, leadId);
    return row ? parseMemory(row.memory) : null;
  } catch (error) {
    console.error("[opportunity-memory] load threw", { businessId, leadId, error });
    return null;
  }
}

/**
 * Re-derives and stores the memory for the lead's latest opportunity. No
 * opportunity, no memory: the opportunity is what the memory belongs to.
 */
export async function refreshOpportunityMemory(input: {
  businessId: string;
  leadId: string;
  service?: string | null;
}): Promise<OpportunityMemory | null> {
  try {
    const opportunity = await latestOpportunity(input.businessId, input.leadId);
    if (!opportunity) return null;

    const admin = createAdminClient();
    const [questions, answers, messages, conversations] = await Promise.all([
      loadQuestions(input.businessId),
      admin
        .from("qualification_answers")
        .select("question_id, answer_value")
        .eq("business_id", input.businessId)
        .eq("lead_id", input.leadId),
      admin
        .from("messages")
        .select("direction, body, created_at, channel")
        .eq("business_id", input.businessId)
        .eq("lead_id", input.leadId)
        .order("created_at", { ascending: false })
        .limit(MESSAGE_WINDOW),
      admin.from("conversations").select("id").eq("business_id", input.businessId).eq("lead_id", input.leadId),
    ]);
    logWriteError(answers, "opportunity memory: answers read", { businessId: input.businessId });
    logWriteError(messages, "opportunity memory: messages read", { businessId: input.businessId });

    const conversationIds = (conversations.data ?? []).map((row) => row.id);
    const summaries = conversationIds.length
      ? await admin
          .from("conversation_summaries")
          .select("summary_json, updated_at")
          .eq("business_id", input.businessId)
          .in("conversation_id", conversationIds)
          .order("updated_at", { ascending: false })
          .limit(1)
      : { data: [] as { summary_json: unknown }[] };
    const summaryJson = (summaries.data?.[0]?.summary_json ?? null) as { conciseNarrative?: unknown } | null;

    const answered = new Map(
      (answers.data ?? [])
        .filter((row) => row.answer_value)
        .map((row) => [row.question_id, row.answer_value as string]),
    );
    const byId = new Map(questions.map((question) => [question.id, question]));

    const memory = deriveOpportunityMemory({
      answers: [...answered.entries()]
        .filter(([questionId]) => byId.has(questionId))
        .map(([questionId, value]) => {
          const question = byId.get(questionId)!;
          return { question: question.questionText, value, dimension: inferDimension(question) };
        }),
      unanswered: questions.filter((question) => !answered.has(question.id)).map((question) => question.questionText),
      messages: (messages.data ?? [])
        .slice()
        .reverse()
        .map(
          (row): BriefMessage => ({
            direction: row.direction === "inbound" ? "inbound" : "outbound",
            body: row.body ?? "",
            at: row.created_at,
            channel: row.channel,
          }),
        ),
      service: input.service ?? null,
      summary: typeof summaryJson?.conciseNarrative === "string" ? summaryJson.conciseNarrative : null,
      previous: parseMemory(opportunity.memory),
      now: new Date(),
    });

    const db = createAdminClient() as unknown as Untyped;
    const write = await db
      .from("opportunities")
      .update({ memory, memory_updated_at: memory.updatedAt })
      .eq("business_id", input.businessId)
      .eq("id", opportunity.id);
    if (write.error && !isSchemaLag(write.error)) {
      logWriteError(write, "opportunity memory: write", { businessId: input.businessId, opportunityId: opportunity.id });
    }
    return memory;
  } catch (error) {
    console.error("[opportunity-memory] refresh threw", { businessId: input.businessId, leadId: input.leadId, error });
    return null;
  }
}
