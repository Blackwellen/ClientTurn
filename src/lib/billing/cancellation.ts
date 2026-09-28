/**
 * What happens after a subscription ends (gap audit 15, batch 2). Pure: the
 * webhook, the billing page and `tests/entitlement-holes.test.ts` share it.
 *
 * ## The policy
 *
 * 1. **Read-only for 90 days.** From the day the subscription ends (the
 *    customer cancelled at period end, or dunning ran out), the workspace is
 *    read-only (`lifecycle.ts` CANCELLED -> `read_only`): every record stays
 *    readable and exportable, nothing is sent, no AI runs, no call is placed.
 *    Resubscribing (no second trial) restores it exactly as it was.
 *
 * 2. **Then deleted.** On day 90 the workspace counts as closed and its lead
 *    records, messages and workspace data are deleted, as the privacy policy
 *    promises ("90 days after account closure"; privacy page RETENTION).
 *    Suppression records (minimised) and billing/tax records (6 years) are the
 *    stated exceptions and are kept.
 *
 * 3. **The dedicated number is released after 14 days.** The number is rented
 *    by ClientTurn from the carrier every month. Fourteen days after the end
 *    it goes through the existing `voice.number_release` path (warning, then
 *    release, then the 90-day quarantine), so rent stops. Resubscribing
 *    within the 14 days with the number (or the Pro voice item) keeps it.
 */

export const DAY_MS = 86_400_000;

/** Days a cancelled workspace stays readable and exportable before deletion. */
export const READ_ONLY_RETENTION_DAYS = 90;

/** Days after the end before the dedicated number is released. */
export const NUMBER_RELEASE_AFTER_CANCEL_DAYS = 14;

export type RetentionPhase =
  /** Subscription live, nothing scheduled. */
  | "active"
  /** Cancellation requested; access continues until the period end. */
  | "ending"
  /** Ended: read-only, exportable, restorable by resubscribing. */
  | "read_only"
  /** Past the read-only window: due for deletion. */
  | "deletion_due";

export type RetentionSchedule = {
  phase: RetentionPhase;
  /** When access ends (ending) or ended (read_only / deletion_due). */
  endsAt: string | null;
  /** Last day the data is kept, read-only. */
  readOnlyUntil: string | null;
  /** When the dedicated number is released, if the workspace has one. */
  numberReleaseAt: string | null;
};

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
}

export function numberReleaseAt(endedAt: string): string {
  return addDays(endedAt, NUMBER_RELEASE_AFTER_CANCEL_DAYS);
}

/**
 * Where a workspace is in the post-cancellation timeline.
 *
 * @param status `subscriptions.status` (CANCELLED once it has ended)
 * @param cancelledAt when it ended (`subscriptions.cancelled_at`)
 * @param cancelAtPeriodEnd the owner asked to cancel at the period end
 * @param periodEnd the current period end (when a pending cancellation bites)
 */
export function retentionSchedule(input: {
  status: string;
  cancelledAt: string | null;
  cancelAtPeriodEnd: boolean;
  periodEnd: string | null;
  now: Date;
}): RetentionSchedule {
  if (input.status === "CANCELLED") {
    const endedAt = input.cancelledAt ?? input.periodEnd ?? input.now.toISOString();
    const readOnlyUntil = addDays(endedAt, READ_ONLY_RETENTION_DAYS);
    return {
      phase: input.now.getTime() >= new Date(readOnlyUntil).getTime() ? "deletion_due" : "read_only",
      endsAt: endedAt,
      readOnlyUntil,
      numberReleaseAt: numberReleaseAt(endedAt),
    };
  }
  if (input.cancelAtPeriodEnd && input.periodEnd) {
    return {
      phase: "ending",
      endsAt: input.periodEnd,
      readOnlyUntil: addDays(input.periodEnd, READ_ONLY_RETENTION_DAYS),
      numberReleaseAt: numberReleaseAt(input.periodEnd),
    };
  }
  return { phase: "active", endsAt: null, readOnlyUntil: null, numberReleaseAt: null };
}

/** The one sentence of policy shown in Billing, whatever the state. */
export const RETENTION_POLICY_TEXT =
  `If your subscription ends, the workspace stays read-only for ${READ_ONLY_RETENTION_DAYS} days: you can see and export everything, and resubscribing restores it as it was. ` +
  `After ${READ_ONLY_RETENTION_DAYS} days the workspace and its lead data are deleted, as our privacy policy sets out. ` +
  `A dedicated phone number is released ${NUMBER_RELEASE_AFTER_CANCEL_DAYS} days after the end.`;

/** Whether a subscription change ended the subscription (so the number release is due). */
export function subscriptionHasEnded(input: { deleted: boolean; stripeStatus: string | null | undefined }): boolean {
  return input.deleted || input.stripeStatus === "canceled" || input.stripeStatus === "incomplete_expired";
}
