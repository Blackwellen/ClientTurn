import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { PermanentJobError } from "@/lib/jobs/registry";
import { recordAudit } from "@/lib/audit";
import { parsePayload } from "./parse";
import { slackInteractionPayload } from "./payloads";

type StoredInteraction = {
  teamId: string;
  actionId: string;
  value: string;
  userId?: string;
  userName?: string;
  responseUrl?: string;
};

/**
 * Posting the click's outcome back to Slack is provider I/O, so — same rule
 * as every other webhook here — it happens from the job worker, never from
 * the webhook request itself. `response_url` accepts a POST for up to 30
 * minutes after the original message, so the short delay a queued retry adds
 * is invisible to whoever clicked.
 */
async function replyToSlack(responseUrl: string | undefined, text: string) {
  if (!responseUrl) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ replace_original: false, response_type: "in_channel", text }),
  }).catch(() => {
    // Best-effort. The handoff itself is already updated; a customer whose
    // Slack response_url has expired still sees the change in ClientTurn.
  });
}

export async function handleSlackInteraction(job: ClaimedJob) {
  const { externalEventId } = parsePayload(slackInteractionPayload, job.payload);
  const admin = createAdminClient();

  const { data: event } = await admin
    .from("webhook_events")
    .select("id, payload, status")
    .eq("provider", "slack")
    .eq("external_event_id", externalEventId)
    .maybeSingle();

  if (!event) throw new PermanentJobError(`Slack interaction ${externalEventId} was never recorded.`);
  if (event.status === "processed") return;

  const stored = event.payload as unknown as StoredInteraction;

  // Slack team -> business. `.limit(1)` because the schema does not enforce
  // uniqueness on (provider_type, external_account_id) -- see slack.ts -- so
  // this takes the first match deterministically rather than throwing on a
  // theoretical second one.
  const { data: integration } = await admin
    .from("integrations")
    .select("business_id")
    .eq("provider_type", "slack")
    .eq("external_account_id", stored.teamId)
    .neq("status", "DISCONNECTED")
    .limit(1)
    .maybeSingle();

  if (!integration) {
    throw new PermanentJobError(
      `No connected workspace for Slack team ${stored.teamId} — the click cannot be attributed.`,
    );
  }

  const businessId = integration.business_id;
  const actorLabel = stored.userName ? `@${stored.userName} in Slack` : "someone in Slack";

  const { data: handoff } = await admin
    .from("agent_handoffs")
    .select("id, status, lead_id")
    .eq("id", stored.value)
    .eq("business_id", businessId)
    .maybeSingle();

  if (!handoff) {
    await replyToSlack(stored.responseUrl, "That handover no longer exists.");
    await admin.from("webhook_events").update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", event.id);
    return;
  }

  if (stored.actionId === "handoff_ack") {
    if (handoff.status !== "OPEN") {
      await replyToSlack(stored.responseUrl, "That handover has already been picked up.");
    } else {
      await admin
        .from("agent_handoffs")
        .update({ status: "ACKNOWLEDGED", acknowledged_at: new Date().toISOString() })
        .eq("id", handoff.id)
        .eq("business_id", businessId);

      await recordAudit({
        businessId,
        actorType: "provider",
        action: "agent.handover_acknowledged",
        entityType: "agent_handoff",
        entityId: handoff.id,
        metadata: { leadId: handoff.lead_id, via: "slack", slackUserId: stored.userId ?? null },
      });

      await replyToSlack(stored.responseUrl, `✅ Acknowledged by ${actorLabel}.`);
    }
  } else if (stored.actionId === "handoff_resolve") {
    if (handoff.status === "RESOLVED") {
      await replyToSlack(stored.responseUrl, "That handover is already resolved.");
    } else {
      await admin
        .from("agent_handoffs")
        .update({
          status: "RESOLVED",
          resolved_at: new Date().toISOString(),
          resolution_note: `Resolved by ${actorLabel}.`,
        })
        .eq("id", handoff.id)
        .eq("business_id", businessId);

      // Mirrors resolveHandoff's own side effect: leaving needs_attention set
      // would keep the lead in the "needs a person" queue forever.
      await admin
        .from("leads")
        .update({ needs_attention: false, attention_reason: null })
        .eq("id", handoff.lead_id)
        .eq("business_id", businessId);

      await recordAudit({
        businessId,
        actorType: "provider",
        action: "agent.handover_resolved",
        entityType: "agent_handoff",
        entityId: handoff.id,
        metadata: { leadId: handoff.lead_id, via: "slack", slackUserId: stored.userId ?? null },
      });

      await replyToSlack(stored.responseUrl, `✅ Resolved by ${actorLabel}.`);
    }
  } else {
    throw new PermanentJobError(`Unknown Slack interaction action_id: ${stored.actionId}`);
  }

  await admin
    .from("webhook_events")
    .update({ status: "processed", processed_at: new Date().toISOString() })
    .eq("id", event.id);
}
