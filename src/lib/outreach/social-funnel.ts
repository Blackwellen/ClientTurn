import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Found → Contacted → Replied → Interested.
 *
 * The four numbers that say whether the channel is working, and the reason they
 * are worth computing together rather than reading off four screens: the useful
 * information is in the *drop* between them, not in any single figure. 354 found
 * and 0 contacted is a queue nobody is working; 300 contacted and 2 replied is a
 * message problem. Those are different days' work, and only the funnel tells
 * them apart.
 *
 * ## Counted from what happened, not from what was intended
 *
 * Every stage reads the append-only log or the state machine rather than a
 * counter incremented alongside the action. A counter can drift from the thing
 * it counts -- a failed send that incremented before it failed, a retry that
 * incremented twice -- and a funnel that disagrees with the queue underneath it
 * is worse than no funnel, because somebody will make a decision from it.
 */

export type FunnelStage = {
  key: "found" | "contacted" | "replied" | "interested";
  label: string;
  value: number;
  /**
   * Conversion from the previous stage, 0-1. Null on the first stage and
   * wherever the previous stage is zero -- a rate with a zero denominator is
   * not 0%, it is unanswerable, and showing 0% invites the wrong conclusion.
   */
  rate: number | null;
  /** What this number actually counts, for the tooltip. */
  hint: string;
};

export type SocialFunnel = {
  stages: FunnelStage[];
  /** Actions per day, for the chart. Oldest first. */
  series: {
    date: string;
    leadsFound: number;
    invitesSent: number;
    messagesSent: number;
    emailsSent: number;
  }[];
};

function rate(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return current / previous;
}

export async function loadSocialFunnel(
  businessId: string,
  days: 7 | 30 = 7,
): Promise<SocialFunnel> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const [
    { count: found },
    { count: contacted },
    { count: replied },
    { count: interested },
    { data: actions },
    { data: created },
  ] = await Promise.all([
    // Found: prospects sourced in the window. `is_test` excluded so a seeded
    // demo workspace does not report numbers it did not earn.
    admin
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("is_test", false)
      .gte("created_at", since),

    // Contacted: an actual send, from the append-only log. Not "queued", and
    // not "approved" -- both of those are intentions, and the gap between
    // intending to contact somebody and contacting them is exactly what the
    // second stage of this funnel exists to show.
    admin
      .from("social_action_log")
      .select("prospect_id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .in("action", ["MESSAGE", "INVITE", "INVITE_WITH_NOTE"])
      .gte("occurred_at", since),

    admin
      .from("social_inbound_replies")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gte("received_at", since),

    // Interested: the classifier's verdict, not a guess. A question counts --
    // somebody asking what it costs is interested, and excluding them would
    // undercount the only stage a customer really cares about.
    admin
      .from("social_inbound_replies")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .in("classification", ["INTERESTED", "QUESTION"])
      .gte("received_at", since),

    admin
      .from("social_action_log")
      .select("action, occurred_at")
      .eq("business_id", businessId)
      .gte("occurred_at", since)
      .limit(5000),

    admin
      .from("prospects")
      .select("created_at")
      .eq("business_id", businessId)
      .eq("is_test", false)
      .gte("created_at", since)
      .limit(5000),
  ]);

  const foundCount = found ?? 0;
  const contactedCount = contacted ?? 0;
  const repliedCount = replied ?? 0;
  const interestedCount = interested ?? 0;

  const stages: FunnelStage[] = [
    {
      key: "found",
      label: "Found",
      value: foundCount,
      rate: null,
      hint: "Prospects sourced in this window, excluding test records.",
    },
    {
      key: "contacted",
      label: "Contacted",
      value: contactedCount,
      rate: rate(contactedCount, foundCount),
      hint: "Invitations and messages that actually went out, counted from the action log rather than from what was queued.",
    },
    {
      key: "replied",
      label: "Replied",
      value: repliedCount,
      rate: rate(repliedCount, contactedCount),
      hint: "Replies received and recorded against a prospect.",
    },
    {
      key: "interested",
      label: "Interested",
      value: interestedCount,
      rate: rate(interestedCount, repliedCount),
      hint: "Replies the classifier read as interested or as a question. Someone asking what it costs is interested.",
    },
  ];

  // One bucket per day, zero-filled. A sparse series draws a chart with holes
  // in it, which reads as missing data rather than as a quiet Tuesday.
  const buckets = new Map<string, SocialFunnel["series"][number]>();
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(Date.now() - index * 86_400_000).toISOString().slice(0, 10);
    buckets.set(date, {
      date,
      leadsFound: 0,
      invitesSent: 0,
      messagesSent: 0,
      emailsSent: 0,
    });
  }

  for (const row of created ?? []) {
    const bucket = buckets.get(row.created_at.slice(0, 10));
    if (bucket) bucket.leadsFound += 1;
  }

  for (const row of actions ?? []) {
    const bucket = buckets.get(row.occurred_at.slice(0, 10));
    if (!bucket) continue;
    if (row.action === "MESSAGE") bucket.messagesSent += 1;
    else if (row.action === "INVITE" || row.action === "INVITE_WITH_NOTE") {
      bucket.invitesSent += 1;
    }
  }

  return { stages, series: [...buckets.values()] };
}
