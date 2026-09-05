import "server-only";
import { PermanentJobError } from "@/lib/jobs/registry";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { normalisePhone } from "@/lib/messaging/types";
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
      .ilike("email", payload.email)
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

  const leadId = await resolveLeadId(payload);
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
    const { data: existing } = await admin
      .from("bookings")
      .select("id")
      .eq("provider", payload.provider)
      .eq("external_event_id", payload.externalEventId)
      .maybeSingle();

    if (existing) {
      await admin.from("bookings").update(row).eq("id", existing.id);
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

  if (cancelled) {
    await admin
      .from("leads")
      .update({
        status: lead.status === "BOOKED" ? "QUALIFIED" : lead.status,
        booked_at: null,
      })
      .eq("id", lead.id)
      .eq("business_id", payload.businessId);

    await emitAutomationEvent({
      businessId: payload.businessId,
      leadId: lead.id,
      eventType: "booking.cancelled",
      payload: { provider: payload.provider, bookingId },
    });
  } else {
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
      .eq("business_id", payload.businessId);

    await stopAutomationRuns(payload.businessId, lead.id, "booked");

    await admin
      .from("campaign_contacts")
      .update({ state: "stopped", stopped_reason: "booked" })
      .eq("business_id", payload.businessId)
      .eq("lead_id", lead.id)
      .in("state", ["pending", "scheduled"]);

    await enqueueCrmPushes(payload.businessId, lead.id);

    await emitAutomationEvent({
      businessId: payload.businessId,
      leadId: lead.id,
      eventType: "booking.created",
      payload: { provider: payload.provider, bookingId },
    });
  }

  if (payload.webhookEventId) {
    await admin
      .from("webhook_events")
      .update({ status: "processed", processed_at: now })
      .eq("id", payload.webhookEventId);
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
      linkUrl: `/app/leads?lead=${lead.id}&leadTab=booking`,
      dedupeKey: `booking:${bookingId}`,
    });
  }
}
