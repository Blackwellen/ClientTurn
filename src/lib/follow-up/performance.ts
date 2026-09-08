import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Channel } from "@/lib/automations/types";

/**
 * Follow-Up performance (V4 §19.4).
 *
 * Counted by Postgres with `head: true` + an exact count, never by pulling
 * rows into the app: a workspace with a hundred thousand messages must not
 * ship them to render four numbers.
 *
 * Only automation-origin messages are counted, so a campaign send or a
 * hand-typed reply can never inflate follow-up's figures. Test sends carry a
 * different origin and are therefore excluded by construction (§19.11).
 */

export type ChannelPerformance = {
  channel: Channel;
  sent: number;
  delivered: number;
  failed: number;
  /** Null rather than 0 when nothing was sent — "0% delivery" on an unused
   *  channel reads as failure rather than as absence. */
  deliveryRate: number | null;
};

export type FollowUpPerformance = {
  windowDays: number;
  enrolled: number;
  completed: number;
  stopped: number;
  /** Runs that ended because the lead replied, booked or was won. */
  positiveOutcomes: number;
  messagesSent: number;
  channels: ChannelPerformance[];
  stopReasons: { reason: string; count: number }[];
};

const WINDOW_DAYS = 30;

export async function getFollowUpPerformance(
  businessId: string,
): Promise<FollowUpPerformance> {
  const supabase = await createClient();
  const since = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString();

  function runsBase() {
    return supabase
      .from("automation_runs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gte("created_at", since);
  }

  const [enrolled, completed, stopped, reasons, messages] = await Promise.all([
    runsBase(),
    runsBase().eq("state", "COMPLETED"),
    runsBase().eq("state", "STOPPED"),
    // Both grouped in SQL. These were a 5,000-row and a 20,000-row fetch
    // counted here, so a workspace running enough follow-up for the panel to
    // be interesting was the one whose numbers stopped rising.
    supabase.rpc("automation_stop_reasons", {
      p_business_id: businessId,
      p_since: since,
    }),
    supabase.rpc("automation_message_outcomes", {
      p_business_id: businessId,
      p_since: since,
    }),
  ]);

  const reasonCounts = new Map<string, number>();
  for (const row of reasons.data ?? []) {
    reasonCounts.set(row.stopped_reason, Number(row.runs));
  }

  // "The lead replied" is a success for a follow-up sequence, not a failure.
  // Counting it as a stop without saying so would make a working sequence
  // look broken.
  const positiveOutcomes =
    (reasonCounts.get("replied") ?? 0) +
    (reasonCounts.get("booked") ?? 0) +
    (reasonCounts.get("won") ?? 0);

  const byChannel = new Map<Channel, { sent: number; delivered: number; failed: number }>();
  for (const row of messages.data ?? []) {
    const channel = row.channel as Channel;
    const entry = byChannel.get(channel) ?? { sent: 0, delivered: 0, failed: 0 };
    // A message policy refused was never attempted, so it is not a send.
    // Counting it would depress the delivery rate of exactly the workspace
    // whose suppression list is working (0083).
    if (row.status === "BLOCKED") continue;

    const count = Number(row.messages);
    entry.sent += count;
    if (row.status === "DELIVERED" || row.status === "SENT") entry.delivered += count;
    if (row.status === "FAILED") entry.failed += count;
    byChannel.set(channel, entry);
  }

  return {
    windowDays: WINDOW_DAYS,
    enrolled: enrolled.count ?? 0,
    completed: completed.count ?? 0,
    stopped: stopped.count ?? 0,
    positiveOutcomes,
    messagesSent: messages.data?.length ?? 0,
    channels: [...byChannel.entries()].map(([channel, entry]) => ({
      channel,
      sent: entry.sent,
      delivered: entry.delivered,
      failed: entry.failed,
      deliveryRate: entry.sent > 0 ? entry.delivered / entry.sent : null,
    })),
    stopReasons: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}
