import "server-only";
import { enqueue } from "@/lib/jobs/queue";
import { advanceLeadOpportunitySafely } from "@/lib/opportunities/service";

/**
 * Starts the workspace's `booking_reminder` automation for a confirmed
 * booking (Phase 3.1).
 *
 * Called at every point a booking becomes `scheduled`: the agent's Google
 * booking, a person confirming a requested time, and a provider webhook. It
 * only enqueues: `automation.advance` reads the published sequence and does
 * nothing when the workspace has no enabled reminder, so this is safe to call
 * unconditionally.
 *
 * The reminder is exempt from the BOOKED stop condition (scheduler.ts
 * `evaluateStopConditions(..., { bookingReminder: true })` and the send guard),
 * which is the whole reason it can run at all once the lead is booked.
 *
 * Keyed on the booking so a replayed webhook or a retried confirmation does
 * not start a second run while the first is queued. A reschedule is the same
 * booking, so it does not start another -- `refreshBookingReminder` moves the
 * existing one. Each reminder step is timed from the booking's `starts_at`
 * (scheduler.ts `planBookingReminder`), not from now.
 */
export async function startBookingReminder(input: {
  businessId: string;
  leadId: string;
  bookingId: string;
}): Promise<void> {
  try {
    await enqueue(
      "automation.advance",
      { leadId: input.leadId, automationType: "booking_reminder" },
      {
        businessId: input.businessId,
        idempotencyKey: `booking-reminder:${input.bookingId}`,
      },
    );
  } catch (error) {
    // The booking is the fact; a reminder that could not be queued is logged,
    // never allowed to undo it.
    console.error("[bookings] could not start booking reminder", { ...input, error });
  }
}

/**
 * Re-plans the booking reminder after the booking moved or ended: a
 * reschedule moves the reminder to the new start, a cancellation (or no-show
 * / completion) stops it. Only enqueues -- `automation.advance` re-reads the
 * lead's bookings and does the rest, and does nothing when there is no active
 * reminder run. `change` names the change (e.g. the new start, or the new
 * status) so each distinct change is queued once. Never throws.
 */
export async function refreshBookingReminder(input: {
  businessId: string;
  leadId: string;
  bookingId: string;
  change: string;
}): Promise<void> {
  try {
    await enqueue(
      "automation.advance",
      { leadId: input.leadId, automationType: "booking_reminder" },
      {
        businessId: input.businessId,
        idempotencyKey: `booking-reminder:${input.bookingId}:${input.change}`,
      },
    );
  } catch (error) {
    console.error("[bookings] could not refresh booking reminder", { ...input, error });
  }
}

/**
 * Everything that follows a booking becoming `scheduled`, in one place so the
 * three confirmation paths (agent, person, provider webhook) cannot drift:
 * the reminder starts and the lead's opportunity moves to MEETING_BOOKED
 * (forward only; skipped on a motion without meetings). Never throws.
 */
export async function onBookingScheduled(input: {
  businessId: string;
  leadId: string;
  bookingId: string;
}): Promise<void> {
  await startBookingReminder(input);
  await advanceLeadOpportunitySafely({
    businessId: input.businessId,
    leadId: input.leadId,
    event: "MEETING_BOOKED",
  });
}
