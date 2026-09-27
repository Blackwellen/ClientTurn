import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  computeQuestionPerformance,
  questionFeaturesOf,
  type FactEvidence,
  type InboundReply,
  type LeadOutcome,
  type QuestionPerformanceRow,
  type QuestionSend,
  type QuestionSlice,
} from "./question-performance";

/**
 * The read behind question performance (design 08 §B.15), for the
 * `question_performance.get` service operation (UI, Copilot, MCP, API).
 *
 * Scoped by business_id on every read: the caller is the service layer, which
 * has already resolved and authorised the workspace. Outcomes are joined from
 * the workspace's own rows; nothing is pooled across workspaces.
 *
 * Fail-safe: a failed read returns `unavailable`, never a table of zeros.
 */

export type QuestionPerformanceResult =
  | { status: "ok"; slice: QuestionSlice; rows: QuestionPerformanceRow[]; sinceDays: number; truncated: boolean }
  | { status: "unavailable"; message: string };

/** messages.features (0131) and lead_qualification_facts (0134) post-date parts of the generated types. */
type Untyped = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const SEND_LIMIT = 5000;
const CHUNK = 200;

class ReadError extends Error {}

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new ReadError(`${what}: ${result.error.message}`);
  return (result.data ?? ([] as unknown)) as T;
}

export async function loadQuestionPerformance(
  businessId: string,
  options: { slice: QuestionSlice; sinceDays?: number },
): Promise<QuestionPerformanceResult> {
  const sinceDays = Math.min(Math.max(options.sinceDays ?? 90, 1), 365);
  const since = new Date(Date.now() - sinceDays * 24 * 3_600_000).toISOString();
  const db = createAdminClient() as unknown as Untyped;

  try {
    const sentRows = must<{ id: string; lead_id: string | null; created_at: string; channel: string; features: unknown }[]>(
      await db
        .from("messages")
        .select("id, lead_id, created_at, channel, features")
        .eq("business_id", businessId)
        .eq("direction", "outbound")
        .gte("created_at", since)
        .not("features->>questionIntent", "is", null)
        .order("created_at", { ascending: true })
        .limit(SEND_LIMIT),
      "question sends",
    );

    const sends: QuestionSend[] = [];
    for (const row of sentRows) {
      const features = questionFeaturesOf(row.features);
      if (!features || !row.lead_id) continue;
      sends.push({ messageId: row.id, leadId: row.lead_id, sentAt: row.created_at, channel: row.channel, industry: null, ...features });
    }

    const leadIds = [...new Set(sends.map((s) => s.leadId))];
    const replies: InboundReply[] = [];
    const facts: FactEvidence[] = [];
    const outcomes: LeadOutcome[] = [];
    const industryByLead = new Map<string, string>();

    for (let i = 0; i < leadIds.length; i += CHUNK) {
      const ids = leadIds.slice(i, i + CHUNK);
      const [inbound, factRows, leads, prospects] = await Promise.all([
        db
          .from("messages")
          .select("id, lead_id, created_at, reply_classification")
          .eq("business_id", businessId)
          .eq("direction", "inbound")
          .gte("created_at", since)
          .in("lead_id", ids),
        db
          .from("lead_qualification_facts")
          .select("lead_id, source_ref, dimension")
          .eq("business_id", businessId)
          .in("lead_id", ids)
          .not("source_ref", "is", null),
        db.from("leads").select("id, qualified_at, booked_at, won_at").eq("business_id", businessId).in("id", ids),
        db
          .from("prospects")
          .select("promoted_to_lead_id, prospect_companies(industry)")
          .eq("business_id", businessId)
          .in("promoted_to_lead_id", ids),
      ]);
      for (const r of must<{ id: string; lead_id: string; created_at: string; reply_classification: string | null }[]>(inbound, "replies")) {
        replies.push({ messageId: r.id, leadId: r.lead_id, at: r.created_at, classification: r.reply_classification });
      }
      for (const f of must<{ lead_id: string; source_ref: string | null; dimension: string }[]>(factRows, "facts")) {
        facts.push({ leadId: f.lead_id, sourceRef: f.source_ref, dimension: f.dimension });
      }
      for (const l of must<{ id: string; qualified_at: string | null; booked_at: string | null; won_at: string | null }[]>(leads, "leads")) {
        outcomes.push({ leadId: l.id, qualifiedAt: l.qualified_at, bookedAt: l.booked_at, wonAt: l.won_at });
      }
      // Industry is known only for leads promoted from a Find Leads prospect.
      if (!prospects.error) {
        for (const p of (prospects.data ?? []) as { promoted_to_lead_id: string | null; prospect_companies: { industry: string | null } | null }[]) {
          if (p.promoted_to_lead_id && p.prospect_companies?.industry) industryByLead.set(p.promoted_to_lead_id, p.prospect_companies.industry);
        }
      }
    }

    for (const send of sends) send.industry = industryByLead.get(send.leadId) ?? null;

    return {
      status: "ok",
      slice: options.slice,
      rows: computeQuestionPerformance({ slice: options.slice, sends, replies, facts, outcomes }),
      sinceDays,
      truncated: sentRows.length >= SEND_LIMIT,
    };
  } catch (error) {
    if (error instanceof ReadError) {
      console.error("[question-performance] read failed", { businessId, message: error.message });
      return { status: "unavailable", message: "Question performance could not be read right now." };
    }
    throw error;
  }
}
