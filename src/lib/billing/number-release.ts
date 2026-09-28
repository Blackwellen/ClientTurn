import "server-only";
import { enqueue } from "@/lib/jobs/queue";
import { queueNotification } from "@/lib/jobs/handlers/shared";
import { recordAudit } from "@/lib/audit";
import { readWorkspaceNumber, serverVoiceDeps } from "@/lib/voice/server-deps";
import { applyProvisioningEvent } from "@/lib/voice/numbers/provisioning";
import { NUMBER_RELEASE_AFTER_CANCEL_DAYS, numberReleaseAt } from "./cancellation";

/**
 * The dedicated number after a subscription ends (gap audit 15 top-10 #7d).
 * ClientTurn rents the number from the carrier every month; before this it
 * was never released on cancellation or non-payment, so the rent ran on after
 * the customer had gone.
 *
 *   subscription ended  -> `scheduleNumberReleaseAfterEnd`: queues the
 *                          existing `voice.number_release` job with
 *                          `releaseAfter` = end + 14 days
 *                          (cancellation.ts). That job moves the number to
 *                          RELEASE_SCHEDULED and the provisioning job releases
 *                          it at that time, then quarantines it for 90 days.
 *                          The owner is warned now, with the date.
 *   resubscribed with a voice item within the 14 days
 *                       -> `cancelNumberReleaseOnResubscribe`: CANCEL_RELEASE,
 *                          so the number is kept. The pending provisioning job
 *                          then finds it ACTIVE and does nothing.
 *
 * Both are idempotent: the job is keyed on the subscription, and the state
 * moves are conditional on the record's version.
 */

export async function scheduleNumberReleaseAfterEnd(input: {
  businessId: string;
  subscriptionId: string;
  endedAt: string;
}): Promise<"queued" | "no_number"> {
  const number = await readWorkspaceNumber(input.businessId);
  if (!number || !["ACTIVE", "NUMBER_PURCHASED", "CONFIGURED"].includes(number.state)) return "no_number";

  const releaseAfter = numberReleaseAt(input.endedAt);
  await enqueue(
    "voice.number_release",
    { businessId: input.businessId, releaseAfter },
    {
      businessId: input.businessId,
      idempotencyKey: `voice.number_release:subscription_end:${input.subscriptionId}`,
    },
  );

  const on = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Europe/London" }).format(new Date(releaseAfter));
  await queueNotification({
    businessId: input.businessId,
    type: "billing",
    severity: "warning",
    title: `Your dedicated number will be released on ${on}`,
    body:
      `Your subscription has ended, so your number ${number.e164 ?? ""} is kept for ${NUMBER_RELEASE_AFTER_CANCEL_DAYS} days and then released. ` +
      "Resubscribe with voice before then to keep it. After release a number cannot be recovered.",
    linkUrl: "/app/settings?section=billing",
    dedupeKey: `number_release_warning:${input.subscriptionId}`,
  });
  await recordAudit({
    businessId: input.businessId,
    actorType: "system",
    action: "billing.number_release_scheduled",
    entityType: "business_number",
    entityId: number.id,
    metadata: { release_after: releaseAfter, subscription: input.subscriptionId },
  });
  return "queued";
}

/**
 * A resubscription that carries a voice item keeps a number whose release is
 * still pending. A number already released is not recoverable (quarantine).
 */
export async function cancelNumberReleaseOnResubscribe(businessId: string): Promise<boolean> {
  const deps = serverVoiceDeps();
  const found = await deps.repo.loadNumberRecord(businessId);
  if (!found || found.record.state !== "RELEASE_SCHEDULED" || !found.record.activatedAt) return false;
  const next = applyProvisioningEvent(found.record, { type: "CANCEL_RELEASE" });
  const saved = await deps.repo.saveNumberRecord({ id: found.id, record: next, expectedVersion: found.record.version });
  if (!saved) return false;
  await deps.repo.appendNumberEvents({
    businessId,
    numberId: found.id,
    log: [
      {
        businessId,
        fromState: found.record.state,
        toState: next.state,
        event: "CANCEL_RELEASE",
        at: deps.now().toISOString(),
        detail: { reason: "resubscribed" },
        idempotencyKey: `${businessId}:${next.version}:CANCEL_RELEASE`,
      },
    ],
  });
  await recordAudit({
    businessId,
    actorType: "system",
    action: "billing.number_release_cancelled",
    entityType: "business_number",
    entityId: found.id,
    metadata: { reason: "resubscribed" },
  });
  return true;
}
