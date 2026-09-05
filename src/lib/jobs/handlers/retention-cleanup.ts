import "server-only";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { parsePayload } from "./parse";
import { retentionCleanupPayload } from "./payloads";

/** Matches the published Privacy Policy retention table. */
const WEBHOOK_EVENT_DAYS = 90;
const FINISHED_JOB_DAYS = 30;
const MESSAGE_EVENT_DAYS = 365;
const MARKETING_DAYS = 730;
const CLOSED_WORKSPACE_DAYS = 90;

function daysAgo(days: number) {
  return new Date(Date.now() - days * 864e5).toISOString();
}

async function purgeOperationalData() {
  const admin = createAdminClient();

  await admin
    .from("webhook_events")
    .delete()
    .in("status", ["processed", "ignored"])
    .lt("received_at", daysAgo(WEBHOOK_EVENT_DAYS));

  await admin
    .from("jobs")
    .delete()
    .in("state", ["completed", "dead"])
    .lt("created_at", daysAgo(FINISHED_JOB_DAYS));

  await admin
    .from("message_events")
    .delete()
    .lt("occurred_at", daysAgo(MESSAGE_EVENT_DAYS));

  await admin
    .from("marketing_sessions")
    .delete()
    .is("converted_user_id", null)
    .lt("first_seen_at", daysAgo(MARKETING_DAYS));
}

/**
 * Personal data in a closed workspace is anonymised rather than deleted, so
 * aggregate history survives. Opt-out records are deliberately untouched:
 * suppressing future contact requires keeping the suppression.
 */
async function anonymiseClosedWorkspace(businessId: string) {
  const admin = createAdminClient();

  const { data: leads } = await admin
    .from("leads")
    .select("id")
    .eq("business_id", businessId)
    .limit(50_000);

  const ids = (leads ?? []).map((row) => row.id);
  if (ids.length === 0) return 0;

  for (let index = 0; index < ids.length; index += 500) {
    const slice = ids.slice(index, index + 500);

    await admin
      .from("messages")
      .update({ body: "[redacted]" })
      .in("lead_id", slice)
      .neq("body", "[redacted]");

    await admin
      .from("leads")
      .update({
        first_name: null,
        last_name: null,
        phone: null,
        phone_normalized: null,
        email: null,
        postcode: null,
        notes: null,
      })
      .in("id", slice);
  }

  return ids.length;
}

export async function handleRetentionCleanup(job: ClaimedJob) {
  const payload = parsePayload(retentionCleanupPayload, job.payload);
  const admin = createAdminClient();

  await purgeOperationalData();

  const cutoff = daysAgo(payload.retentionDays ?? CLOSED_WORKSPACE_DAYS);

  let query = admin
    .from("businesses")
    .select("id")
    .eq("status", "cancelled")
    .lt("updated_at", cutoff)
    .limit(200);

  if (payload.businessId) query = query.eq("id", payload.businessId);

  const { data: closed } = await query;

  for (const business of closed ?? []) {
    const anonymised = await anonymiseClosedWorkspace(business.id);
    if (anonymised === 0) continue;

    await recordAudit({
      businessId: business.id,
      actorType: "system",
      action: "workspace.delete_requested",
      entityType: "business",
      entityId: business.id,
      metadata: { anonymised_leads: anonymised, cutoff },
    });
  }

  // Expired rate-limit windows are dead weight once their window has passed.
  await admin.rpc("prune_rate_limits", { older_than: "1 day" });
}
