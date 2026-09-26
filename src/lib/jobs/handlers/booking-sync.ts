import "server-only";
import { PermanentJobError } from "@/lib/jobs/registry";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import { recordAudit } from "@/lib/audit";
import { normalisePhone } from "@/lib/messaging/types";
import { escapeIlike } from "@/lib/supabase/ilike";
import { assertWrite, logWriteError } from "@/lib/supabase/write-result";
import { enqueue } from "@/lib/jobs/queue";
import { enqueueCrmPushes } from "@/lib/integrations/providers/crm-trigger";
import { emitAutomationEvent } from "@/lib/automation/events";
import {
  loadBusinessContext,
  loadLead,
  queueNotification,
  stopAutomationRuns,
} from "./shared";
import { parsePayload } from "./parse";
import { bookingSyncPayload } from "./payloads";
import { promoteOnBookedEvent } from "@/lib/outreach/campaigns/bookings";
import { onBookingScheduled, refreshBookingReminder } from "@/lib/bookings/reminders";

type Payload = ReturnType<typeof bookingSyncPayload.parse>;

async function resolveLeadId(payload: Payload): Promise<string | null> {
  if (payload.leadId) return payload.leadId;

  const admin = createAdminClient();

  if (payload.phone) {
    const normalised = normalisePhone(payload.phone);
    if (normalised) {
      const { data } = await admin
        .from("leads")
        .select("id")
        .eq("business_id", payload.businessId)
        .eq("phone_normalized", normalised)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) return data.id;
    }
  }

  if (payload.email) {
    const { data } = await admin
      .from("leads")
      .select("id")
      .eq("business_id", payload.businessId)
      .ilike("email", escapeIlike(payload.email))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data.id;
  }

  return null;
}

export async function handleBookingSync(job: ClaimedJob) {
  const payload = parsePayload(bookingSyncPayload, job.payload);
  const admin = createAdminClient();

  const business = await loadBusinessContext(payload.businessId);
  if (!business) {
    throw new PermanentJobError(`Business ${payload.businessId} is gone.`);
  }

  let leadId = await resolveLeadId(payload);

  // Nobody matched as a lead. Before treating this as unmatched, check whether
  // a cold prospect booked straight from a campaign email: their campaign may
  // be configured to promote on a booked event, which creates the lead this
  // booking belongs to.
  if (!leadId) {
    const promoted = await promoteOnBookedEvent({
      businessId: payload.businessId,
      email: payload.email,
      phone: payload.phone,
    });
    leadId = promoted?.leadId ?? null;
  }

  if (!leadId) {
    await queueNotification({
      businessId: payload.businessId,
      type: "booking",
      severity: "warning",
      title: "A booking arrived that could not be matched to a lead",
      body: payload.email ?? payload.phone ?? payload.externalEventId ?? "",
      linkUrl: "/app/leads",
      dedupeKey: `booking_unmatched:${payload.externalEventId ?? job.id}`,
    });
    return;
  }

  const lead = await loadLead(leadId);
  if (!lead) {
    throw new PermanentJobError(`Lead ${leadId} is gone.`);
  }

  // ---- Calendly reschedule: one `rescheduled` transition (Phase 3.1) ----
  if (await handleReschedule(payload, lead.id)) return;

  const row = {
    business_id: payload.businessId,
    lead_id: lead.id,
    service_id: payload.serviceId ?? lead.service_id,
    provider: payload.provider,
    external_event_id: payload.externalEventId ?? null,
    booking_url: payload.bookingUrl ?? null,
    reschedule_url: payload.rescheduleUrl ?? null,
    cancel_url: payload.cancelUrl ?? null,
    starts_at: payload.startsAt ?? null,
    ends_at: payload.endsAt ?? null,
    location: payload.location ?? null,
    status: payload.status,
    notes: payload.notes ?? null,
  };

  // The provider event id is the reconciliation key, so a replayed webhook
  // updates the same booking rather than creating a second one.
  let bookingId: string | null = null;

  if (payload.externalEventId) {
    const { data: existing, error: existingError } = await admin
      .from("bookings")
      .select("id")
      .eq("provider", payload.provider)
      .eq("external_event_id", payload.externalEventId)
      .maybeSingle();
    // A failed lookup must not fall through to inserting a second booking.
    if (existingError) throw existingError;

    if (existing) {
      assertWrite(
        await admin.from("bookings").update(row).eq("id", existing.id),
        "booking sync: update booking",
        { businessId: payload.businessId, bookingId: existing.id, leadId: lead.id },
      );
      bookingId = existing.id;
    }
  }

  if (!bookingId) {
    const { data: created, error } = await admin
      .from("bookings")
      .insert(row)
      .select("id")
      .single();
    if (error || !created) {
      throw error ?? new Error("Could not record the booking.");
    }
    bookingId = created.id;
  }

  const cancelled =
    payload.status === "cancelled" || payload.status === "no_show";

  const now = new Date().toISOString();

  // The lead and campaign writes below throw: a retry re-finds the booking by
  // its provider event id and re-applies the same fixed values.
  const writeContext = { businessId: payload.businessId, leadId: lead.id, bookingId };

  if (cancelled) {
    assertWrite(
      await admin
        .from("leads")
        .update({
          status: lead.status === "BOOKED" ? "QUALIFIED" : lead.status,
          booked_at: null,
        })
        .eq("id", lead.id)
        .eq("business_id", payload.businessId),
      "booking sync: lead booking cancelled",
      writeContext,
    );

    await emitAutomationEvent({
      businessId: payload.businessId,
      leadId: lead.id,
      eventType: "booking.cancelled",
      payload: { provider: payload.provider, bookingId },
    });

    // The reminder for this meeting stops (or follows another booking).
    await refreshBookingReminder({
      businessId: payload.businessId,
      leadId: lead.id,
      bookingId,
      change: `status:${payload.status}`,
    });
  } else {
    assertWrite(
      await admin
        .from("leads")
        .update({
          status: "BOOKED",
          booked_at: now,
          automation_active: false,
          needs_attention: false,
          attention_reason: null,
        })
        .eq("id", lead.id)
        .eq("business_id", payload.businessId),
      "booking sync: mark lead booked",
      writeContext,
    );

    await stopAutomationRuns(payload.businessId, lead.id, "booked");

    // A contact left "scheduled" would still be sent a reactivation step
    // after booking.
    assertWrite(
      await admin
        .from("campaign_contacts")
        .update({ state: "stopped", stopped_reason: "booked" })
        .eq("business_id", payload.businessId)
        .eq("lead_id", lead.id)
        .in("state", ["pending", "scheduled"]),
      "booking sync: stop campaign contacts",
      writeContext,
    );

    await enqueueCrmPushes(payload.businessId, lead.id);

    await emitAutomationEvent({
      businessId: payload.businessId,
      leadId: lead.id,
      eventType: "booking.created",
      payload: { provider: payload.provider, bookingId },
    });

    // Reminder + opportunity MEETING_BOOKED (Phase 3.1 / 3.3).
    if (bookingId && payload.status === "scheduled") {
      await onBookingScheduled({ businessId: payload.businessId, leadId: lead.id, bookingId });
    }

    // The booking id doubles as the event id, so a replayed provider webhook
    // re-running this handler does not deliver the same booking twice to the
    // customer's own systems.
    await emitWebhookEvent({
      businessId: payload.businessId,
      type: "booking.created",
      eventId: bookingId ?? undefined,
      data: {
        booking_id: bookingId,
        lead_id: lead.id,
        provider: payload.provider,
        starts_at: payload.startsAt ?? null,
        ends_at: payload.endsAt ?? null,
        location: payload.location ?? null,
        status: payload.status,
      },
    });
  }

  if (payload.webhookEventId) {
    logWriteError(
      await admin
        .from("webhook_events")
        .update({ status: "processed", processed_at: now })
        .eq("id", payload.webhookEventId),
      "booking sync: mark webhook processed",
      { ...writeContext, webhookEventId: payload.webhookEventId },
    );
  }

  await recordAudit({
    businessId: payload.businessId,
    actorType: "provider",
    action: "booking.status_changed",
    entityType: "booking",
    entityId: bookingId,
    metadata: { provider: payload.provider, status: payload.status },
  });

  if (!cancelled && business.notify.booking) {
    await queueNotification({
      businessId: payload.businessId,
      type: "booking",
      severity: "info",
      title: "A lead booked an appointment",
      body: payload.startsAt ?? undefined,
      entityType: "booking",
      entityId: bookingId,
      linkUrl: `/app/leads?lead=${lead.id}&leadTab=summary`,
      dedupeKey: `booking:${bookingId}`,
    });
  }

  if (!cancelled && business.slackNotify.booking) {
    const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "A lead";
    await enqueue(
      "notification.slack",
      {
        businessId: payload.businessId,
        leadId: lead.id,
        text: payload.startsAt
          ? `Booked: ${name} — ${payload.startsAt}`
          : `Booked: ${name}`,
      },
      { businessId: payload.businessId },
    );
  }
}

/**
 * Calendly reports a reschedule as two deliveries: `invitee.canceled` with
 * `rescheduled: true` on the old event, and `invitee.created` on a new event
 * whose `old_invitee` names the old one. Delivery order is not guaranteed.
 *
 * Folded into ONE transition on the existing row:
 *
 *   * the cancel half never cancels anything -- the lead keeps its meeting and
 *     no `booking.cancelled` fires; the row is only stamped `rescheduled_at`;
 *   * the create half moves the existing row to the new event id and time,
 *     keeping the old start in `previous_starts_at`.
 *
 * Returns true when the delivery was a reschedule half and has been handled.
 * A create whose previous event is unknown to us falls through and is
 * recorded as an ordinary new booking.
 */
async function handleReschedule(payload: Payload, leadId: string): Promise<boolean> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const context = { businessId: payload.businessId, leadId };

  const markProcessed = async () => {
    if (!payload.webhookEventId) return;
    logWriteError(
      await admin
        .from("webhook_events")
        .update({ status: "processed", processed_at: now })
        .eq("id", payload.webhookEventId),
      "booking sync: mark reschedule webhook processed",
      context,
    );
  };

  // (a) The cancellation half.
  if (payload.status === "cancelled" && payload.rescheduled) {
    if (payload.externalEventId) {
      const { data: existing, error } = await admin
        .from("bookings")
        .select("id")
        .eq("business_id", payload.businessId)
        .eq("provider", payload.provider)
        .eq("external_event_id", payload.externalEventId)
        .maybeSingle();
      if (error) throw error;
      if (existing) {
        assertWrite(
          await admin
            .from("bookings")
            .update({ rescheduled_at: now } as never)
            .eq("id", existing.id),
          "booking sync: stamp reschedule (cancel half)",
          { ...context, bookingId: existing.id },
        );
      }
      // Not found: the create half already moved the row to the new event.
    }
    await markProcessed();
    return true;
  }

  // (b) The creation half.
  if (payload.status !== "scheduled" || !payload.previousExternalEventId) return false;

  const { data: previous, error: previousError } = await admin
    .from("bookings")
    .select("id, starts_at, reschedule_count" as "id, starts_at")
    .eq("business_id", payload.businessId)
    .eq("provider", payload.provider)
    .eq("external_event_id", payload.previousExternalEventId)
    .maybeSingle();
  if (previousError) throw previousError;
  if (!previous) return false;

  const prior = previous as unknown as {
    id: string;
    starts_at: string | null;
    reschedule_count: number | null;
  };

  assertWrite(
    await admin
      .from("bookings")
      .update({
        external_event_id: payload.externalEventId ?? null,
        starts_at: payload.startsAt ?? null,
        ends_at: payload.endsAt ?? null,
        location: payload.location ?? null,
        status: "scheduled",
        previous_starts_at: prior.starts_at,
        rescheduled_at: now,
        reschedule_count: (prior.reschedule_count ?? 0) + 1,
      } as never)
      .eq("id", prior.id),
    "booking sync: move booking to rescheduled time",
    { ...context, bookingId: prior.id },
  );

  // The meeting still exists; if an earlier, non-flagged cancellation had
  // un-booked the lead, the reschedule books it again.
  assertWrite(
    await admin
      .from("leads")
      .update({ status: "BOOKED" })
      .eq("id", leadId)
      .eq("business_id", payload.businessId)
      .in("status", ["NEW", "CONTACTED", "RESPONDED", "QUALIFIED"]),
    "booking sync: keep lead booked after reschedule",
    { ...context, bookingId: prior.id },
  );

  // The reminder moves with the meeting: re-planned from the new start.
  await refreshBookingReminder({
    businessId: payload.businessId,
    leadId,
    bookingId: prior.id,
    change: `starts:${payload.startsAt ?? ""}`,
  });

  await recordAudit({
    businessId: payload.businessId,
    actorType: "provider",
    action: "booking.rescheduled",
    entityType: "booking",
    entityId: prior.id,
    metadata: {
      provider: payload.provider,
      previous_starts_at: prior.starts_at,
      starts_at: payload.startsAt ?? null,
    },
  });

  await markProcessed();
  return true;
}
