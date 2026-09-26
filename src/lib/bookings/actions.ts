"use server";

import { revalidatePath } from "next/cache";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { BOOKING_STATUS_LABEL, bookingStatusSchema } from "./types";
import { staffStatusChange } from "./confirmation";
import { bookLeadOnConfirmation } from "./book-lead";
import { refreshBookingReminder } from "./reminders";

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(error: string): ActionResult {
  return { ok: false, error };
}

/**
 * Records the outcome of an appointment. Provider-side changes (cancelling in
 * Calendly or Google Calendar) are never made from here — a booking is
 * cancelled with the provider by the customer or the team, and the webhook
 * brings that back in.
 */
export async function updateBookingStatus(input: {
  bookingId: string;
  status: string;
}): Promise<ActionResult> {
  const parsed = bookingStatusSchema.safeParse(input);
  if (!parsed.success) return fail("That booking status is not valid.");

  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("member");
  } catch {
    return fail("You do not have permission to change bookings.");
  }

  const supabase = createAdminClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, status, lead_id")
    .eq("business_id", workspace.businessId)
    .eq("id", parsed.data.bookingId)
    .maybeSingle();

  if (!booking) return fail("Booking not found.");
  if (booking.status === parsed.data.status) return { ok: true };

  // B10 / decision Q1: a requested time becomes a booking only when a person
  // confirms it here, and that is the moment the lead becomes BOOKED.
  const change = staffStatusChange(booking.status, parsed.data.status);
  if (!change.ok) return fail(change.error);

  const { error } = await supabase
    .from("bookings")
    .update({ status: parsed.data.status })
    .eq("id", booking.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("Could not update the booking.");

  if (change.bookLead) {
    const booked = await bookLeadOnConfirmation({
      businessId: workspace.businessId,
      bookingId: booking.id,
      leadId: booking.lead_id,
      revertTo: booking.status,
    });
    if (!booked) return fail("Could not mark the lead as booked.");
  }

  // A booking that did not happen puts the lead back in front of a person
  // rather than silently disappearing.
  if (parsed.data.status === "cancelled" || parsed.data.status === "no_show") {
    await supabase
      .from("leads")
      .update({
        needs_attention: true,
        attention_reason:
          parsed.data.status === "no_show" ? "booking_no_show" : "booking_cancelled",
      })
      .eq("id", booking.lead_id)
      .eq("business_id", workspace.businessId);
  }

  // A meeting that is no longer scheduled has nothing to be reminded about.
  if (parsed.data.status !== "scheduled") {
    await refreshBookingReminder({
      businessId: workspace.businessId,
      leadId: booking.lead_id,
      bookingId: booking.id,
      change: `status:${parsed.data.status}`,
    });
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "booking.status_changed",
    entityType: "booking",
    entityId: booking.id,
    metadata: {
      from: booking.status,
      to: parsed.data.status,
      label: BOOKING_STATUS_LABEL[parsed.data.status],
      lead_id: booking.lead_id,
    },
  });

  revalidatePath("/app/bookings");
  revalidatePath("/app/leads");
  revalidatePath("/app");
  return { ok: true };
}
