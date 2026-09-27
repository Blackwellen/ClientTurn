import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { countSmsSegments } from "@/lib/messaging/sms-segments";
import { agentRunIdOf, classifyRows } from "@/lib/reengagement/service";
import {
  ATTRIBUTION_DAYS,
  computeLoopOutcomes,
  type LeadOutcomeEvents,
  type LoopOutcome,
  type LoopTouch,
} from "@/lib/reengagement/outcomes";
import type { RangeBounds } from "./v4-queries";

/**
 * Analytics -> Re-engagement performance: per automated loop (sequences,
 * campaigns, the re-engagement agent, win-back, no-show, NOT_NOW resume,
 * deadline, checkout nudges) what it produced -- meetings, sales and value,
 * opt-outs and complaints -- and what it cost (SMS segments, AI tokens).
 * Reply rate is shown, never used to rank (reengagement/outcomes.ts).
 *
 * Workspace-scoped: every read filters on the signed-in workspace's id, which
 * the page resolved server-side. Bounded: the period's first MAX_TOUCHES
 * automated messages.
 */

export type ReengagementPerformance =
  | { status: "ok"; loops: LoopOutcome[]; truncated: boolean; attributionDays: number }
  | { status: "unavailable"; message: string };

const MAX_TOUCHES = 5000;
const CHUNK = 300;

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

type Row = {
  id: string;
  lead_id: string | null;
  origin: string;
  send_key: string | null;
  agent_run_id: string | null;
  campaign_id: string | null;
  channel: string;
  body: string;
  sent_at: string;
  complained_at: string | null;
};

export async function getReengagementPerformance(businessId: string, bounds: RangeBounds): Promise<ReengagementPerformance> {
  try {
    const { data, error } = await db()
      .from("messages")
      .select("id, lead_id, origin, send_key, agent_run_id, campaign_id, channel, body, sent_at, complained_at")
      .eq("business_id", businessId)
      .eq("direction", "outbound")
      .in("origin", ["automation", "campaign", "agent"])
      .in("status", ["SENT", "DELIVERED"])
      .gte("sent_at", bounds.from.toISOString())
      .lte("sent_at", bounds.to.toISOString())
      .order("sent_at", { ascending: true })
      .limit(MAX_TOUCHES);
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as Row[]).filter((row) => row.lead_id);

    const classes: Awaited<ReturnType<typeof classifyRows>> = [];
    for (let index = 0; index < rows.length; index += CHUNK) {
      classes.push(...(await classifyRows(businessId, rows.slice(index, index + CHUNK))));
    }

    // Tokens: each agent run's once, on its first message.
    const runIds = [...new Set(rows.map((row) => (row.origin === "agent" ? agentRunIdOf(row) : null)).filter((id): id is string => Boolean(id)))];
    const tokensByRun = new Map<string, number>();
    for (let index = 0; index < runIds.length; index += CHUNK) {
      const { data: runs, error: runError } = await db()
        .from("conversation_agent_runs")
        .select("id, input_tokens, output_tokens")
        .eq("business_id", businessId)
        .in("id", runIds.slice(index, index + CHUNK));
      if (runError) throw new Error(runError.message);
      for (const run of (runs ?? []) as { id: string; input_tokens: number; output_tokens: number }[]) {
        tokensByRun.set(run.id, (run.input_tokens ?? 0) + (run.output_tokens ?? 0));
      }
    }

    const touches: LoopTouch[] = [];
    const counted = new Set<string>();
    rows.forEach((row, index) => {
      const touch = classes[index];
      if (!touch?.automated) return;
      const runId = row.origin === "agent" ? agentRunIdOf(row) : null;
      const tokens = runId && !counted.has(runId) ? (tokensByRun.get(runId) ?? 0) : 0;
      if (runId) counted.add(runId);
      touches.push({
        loop: touch.loop,
        leadId: row.lead_id as string,
        sentAt: row.sent_at,
        channel: row.channel,
        smsSegments: row.channel === "sms" ? countSmsSegments(row.body ?? "").segments : 0,
        tokens,
        complained: Boolean(row.complained_at),
      });
    });

    const leadIds = [...new Set(touches.map((touch) => touch.leadId))];
    const until = new Date(bounds.to.getTime() + ATTRIBUTION_DAYS * 86_400_000).toISOString();
    const from = bounds.from.toISOString();
    const leads = new Map<string, LeadOutcomeEvents>();
    const lead = (id: string) => {
      let entry = leads.get(id);
      if (!entry) {
        entry = { leadId: id, bookedAt: [], won: [], inbound: [] };
        leads.set(id, entry);
      }
      return entry;
    };

    for (let index = 0; index < leadIds.length; index += CHUNK) {
      const ids = leadIds.slice(index, index + CHUNK);
      const [bookings, won, inbound] = await Promise.all([
        db()
          .from("bookings")
          .select("lead_id, created_at, status")
          .eq("business_id", businessId)
          .in("lead_id", ids)
          .neq("status", "cancelled")
          .gte("created_at", from)
          .lte("created_at", until),
        db()
          .from("opportunities")
          .select("lead_id, closed_at, value")
          .eq("business_id", businessId)
          .eq("outcome", "WON")
          .in("lead_id", ids)
          .gte("closed_at", from)
          .lte("closed_at", until),
        db()
          .from("messages")
          .select("lead_id, created_at, reply_classification")
          .eq("business_id", businessId)
          .eq("direction", "inbound")
          .in("lead_id", ids)
          .gte("created_at", from)
          .lte("created_at", until)
          .limit(10_000),
      ]);
      if (bookings.error) throw new Error(bookings.error.message);
      if (won.error) throw new Error(won.error.message);
      if (inbound.error) throw new Error(inbound.error.message);
      for (const row of (bookings.data ?? []) as { lead_id: string; created_at: string }[]) lead(row.lead_id).bookedAt.push(row.created_at);
      for (const row of (won.data ?? []) as { lead_id: string; closed_at: string | null; value: number | null }[]) {
        if (row.closed_at) lead(row.lead_id).won.push({ at: row.closed_at, value: Number(row.value) || 0 });
      }
      for (const row of (inbound.data ?? []) as { lead_id: string; created_at: string; reply_classification: string | null }[]) {
        lead(row.lead_id).inbound.push({ at: row.created_at, classification: row.reply_classification });
      }
    }

    return {
      status: "ok",
      loops: computeLoopOutcomes({ touches, leads: [...leads.values()] }),
      truncated: (data ?? []).length >= MAX_TOUCHES,
      attributionDays: ATTRIBUTION_DAYS,
    };
  } catch (error) {
    console.error("[analytics] re-engagement performance failed", {
      businessId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { status: "unavailable", message: "Re-engagement performance could not be loaded. Try again shortly." };
  }
}
