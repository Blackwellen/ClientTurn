import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { enqueue } from "@/lib/jobs/queue";
import { parsePayload } from "./parse";
import { z } from "zod";

const digestPayload = z.object({ businessId: z.uuid() });

/**
 * Once a day, fans out one `notification.slack_digest` job per workspace that
 * has both Slack connected and the digest turned on. Split from the compute
 * step the same way `email.poll` is: the fan-out is cheap and idempotent per
 * workspace, the compute is the part worth retrying independently if one
 * workspace's query is slow.
 */
export async function scheduleSlackDigests() {
  const admin = createAdminClient();
  const dateKey = new Date().toISOString().slice(0, 10);

  const { data: enabled } = await admin
    .from("business_settings")
    .select("business_id")
    .eq("slack_digest_enabled", true);

  if (!enabled?.length) return;

  const businessIds = enabled.map((row) => row.business_id);

  const { data: connected } = await admin
    .from("integrations")
    .select("business_id")
    .eq("provider_type", "slack")
    .neq("status", "DISCONNECTED")
    .in("business_id", businessIds);

  for (const row of connected ?? []) {
    await enqueue(
      "notification.slack_digest",
      { businessId: row.business_id },
      { businessId: row.business_id, idempotencyKey: `slack-digest:${row.business_id}:${dateKey}` },
    );
  }
}

const AGENT_REPLY_OUTCOMES = [
  "MESSAGE_SENT",
  "MESSAGE_QUEUED",
  "MESSAGE_DRAFTED",
  "QUALIFICATION_UPDATED",
  "BOOKING_CREATED",
  "BOOKING_OPTIONS_SENT",
];

export async function handleSlackDigest(job: ClaimedJob) {
  const { businessId } = parsePayload(digestPayload, job.payload);
  const admin = createAdminClient();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [{ count: newLeads }, { count: booked }, { count: handovers }, { count: agentReplies }] =
    await Promise.all([
      admin
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("is_test", false)
        .gte("created_at", since),
      admin
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("is_test", false)
        .eq("status", "BOOKED")
        .gte("booked_at", since),
      admin
        .from("agent_handoffs")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .gte("created_at", since),
      admin
        .from("conversation_agent_runs")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("status", "COMPLETED")
        .in("outcome", AGENT_REPLY_OUTCOMES)
        .gte("created_at", since),
    ]);

  // A quiet 24 hours is not worth a message — it tells a team nothing they
  // don't already know, and a digest that fires every morning regardless
  // trains people to stop reading it.
  if (!newLeads && !booked && !handovers && !agentReplies) return;

  const lines = [`📊 Daily digest — last 24 hours`];
  lines.push(`New leads: ${newLeads ?? 0} · Booked: ${booked ?? 0} · Handovers: ${handovers ?? 0}`);
  if (agentReplies) lines.push(`Assistant handled ${agentReplies} of those turns.`);

  await enqueue(
    "notification.slack",
    { businessId, text: lines.join("\n") },
    { businessId },
  );
}
