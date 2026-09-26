import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitAutomationEvent } from "@/lib/automation/events";
import { stopAutomationRuns } from "@/lib/jobs/handlers/shared";
import { onBookingScheduled } from "./reminders";

/**
 * The side effects of a person confirming a requested time (B10, decision
 * Q1): the lead becomes BOOKED, its follow-up stops, and `booking.created`
 * fires. Shared by the dashboard action and the `booking.set_status` service
 * operation (API, MCP, Copilot), so confirming behaves the same everywhere.
 *
 * Call it only after the booking row has been moved to `scheduled`. If the
 * lead cannot be marked BOOKED, the booking is put back to `revertTo` so the
 * two records never disagree, and `false` is returned.
 */
export async function bookLeadOnConfirmation(input: {
  businessId: string;
  bookingId: string;
  leadId: string;
  revertTo: string;
}): Promise<boolean> {
  const supabase = createAdminClient();

  const { error: leadError } = await supabase
    .from("leads")
    .update({ status: "BOOKED", booked_at: new Date().toISOString() })
    .eq("id", input.leadId)
    .eq("business_id", input.businessId);

  if (leadError) {
    await supabase
      .from("bookings")
      .update({ status: input.revertTo })
      .eq("id", input.bookingId)
      .eq("business_id", input.businessId);
    return false;
  }

  await stopAutomationRuns(input.businessId, input.leadId, "booked");
  await emitAutomationEvent({
    businessId: input.businessId,
    leadId: input.leadId,
    eventType: "booking.created",
  });
  await onBookingScheduled({
    businessId: input.businessId,
    leadId: input.leadId,
    bookingId: input.bookingId,
  });
  return true;
}
