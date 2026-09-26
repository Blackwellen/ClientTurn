import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWriteError } from "@/lib/supabase/write-result";
import { recordAudit } from "@/lib/audit";
import { queueNotification } from "@/lib/jobs/handlers/shared";

/**
 * Social -> email fallback that actually enrols (Phase 3.5).
 *
 * Before this, falling back only stamped `email_fallback_at` and nothing sent
 * anything. Now the prospect's email campaign run is made due: if the
 * prospect is on an outreach campaign whose published sequence has an EMAIL
 * step after the one last sent, its recipient run is scheduled now and the
 * normal dispatcher sends that step -- with every one of its own checks
 * (suppression, contactability, caps, sender health, disclosure). Nothing is
 * sent from here.
 *
 * With no such step the fallback is recorded and surfaced to the workspace
 * rather than silently doing nothing.
 */
export type FallbackOutcome =
  | { enrolled: true; campaignId: string; runId: string; stepPosition: number }
  | { enrolled: false; reason: "NO_EMAIL_CAMPAIGN" | "NO_EMAIL_ADDRESS" };

type RunRow = {
  id: string;
  campaign_id: string;
  sequence_id: string;
  status: string;
  current_step_position: number;
  next_step_due_at: string | null;
};

export async function enrolSocialFallbackInEmail(
  businessId: string,
  prospectId: string,
  reason: string,
): Promise<FallbackOutcome> {
  const admin = createAdminClient();

  const { data: prospect } = await admin
    .from("prospects")
    .select("id, email, first_name, last_name")
    .eq("business_id", businessId)
    .eq("id", prospectId)
    .maybeSingle();

  if (!prospect?.email) {
    await surface(businessId, prospectId, "LinkedIn went quiet and this prospect has no email address to fall back to.");
    return { enrolled: false, reason: "NO_EMAIL_ADDRESS" };
  }

  const { data: runs } = await admin
    .from("outreach_recipient_runs")
    .select("id, campaign_id, sequence_id, status, current_step_position, next_step_due_at")
    .eq("business_id", businessId)
    .eq("prospect_id", prospectId)
    .in("status", ["PENDING", "SCHEDULED", "ACTIVE"])
    .order("created_at", { ascending: false });

  for (const run of (runs ?? []) as RunRow[]) {
    const { data: step } = await admin
      .from("outreach_steps")
      .select("position")
      .eq("business_id", businessId)
      .eq("sequence_id", run.sequence_id)
      .eq("channel", "EMAIL")
      .gt("position", run.current_step_position)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!step) continue;

    const now = new Date().toISOString();
    // Only brought forward, never pushed back: an email already due sooner
    // stays as it is.
    const due = run.next_step_due_at && run.next_step_due_at < now ? run.next_step_due_at : now;
    const { error } = await admin
      .from("outreach_recipient_runs")
      .update({ status: run.status === "ACTIVE" ? "ACTIVE" : "SCHEDULED", next_step_due_at: due })
      .eq("business_id", businessId)
      .eq("id", run.id)
      .in("status", ["PENDING", "SCHEDULED", "ACTIVE"]);
    if (!logWriteError({ error }, "social fallback: schedule email step", { businessId, prospectId, runId: run.id })) {
      continue;
    }

    await recordAudit({
      businessId,
      actorType: "system",
      action: "social.fallback_enrolled",
      entityType: "prospect",
      entityId: prospectId,
      metadata: { campaign_id: run.campaign_id, run_id: run.id, step_position: step.position, reason },
    });
    return { enrolled: true, campaignId: run.campaign_id, runId: run.id, stepPosition: step.position };
  }

  await surface(
    businessId,
    prospectId,
    "LinkedIn went quiet and this prospect is not on an email campaign with a step left to send. Add them to one to follow up by email.",
  );
  return { enrolled: false, reason: "NO_EMAIL_CAMPAIGN" };
}

async function surface(businessId: string, prospectId: string, body: string): Promise<void> {
  await queueNotification({
    businessId,
    type: "lead_attention",
    severity: "info",
    title: "A LinkedIn prospect needs an email follow-up",
    body,
    entityType: "prospect",
    entityId: prospectId,
    linkUrl: "/app/find-leads",
    dedupeKey: `social_fallback:${prospectId}`,
  });
}
