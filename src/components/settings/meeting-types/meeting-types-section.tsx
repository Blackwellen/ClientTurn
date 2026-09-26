import "server-only";
import * as React from "react";
import { randomUUID } from "node:crypto";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { runOperation } from "@/lib/services";
import { getBookingSettings, listServices, listTeamMembers } from "@/lib/settings/queries";
import type { MeetingType } from "@/lib/bookings/meeting-types";
import { ErrorState } from "@/components/ui/feedback";
import { MeetingTypesPanel, type MeetingTypeOption } from "./meeting-types-panel";

const CALENDAR_LABEL: Record<string, string> = {
  google_calendar: "Google Calendar",
  calendly: "Calendly",
};

/**
 * Loads meeting types (through the service operation, with the viewer's own
 * role), the active team, the services and the connected calendars for the
 * meeting-type editor in Settings -> Workspace.
 */
export async function MeetingTypesSection() {
  const workspace = await requireWorkspace();
  const readOnly = !hasRole(workspace.role, "admin");

  const [result, members, services, booking, calendars] = await Promise.all([
    runOperation<{ meetingTypes: MeetingType[] }>(
      "meeting_type.list",
      {},
      {
        businessId: workspace.businessId,
        userId: workspace.userId,
        role: workspace.role,
        caller: "UI",
        correlationId: randomUUID(),
      },
    ),
    listTeamMembers(workspace.businessId),
    listServices(workspace.businessId),
    getBookingSettings(workspace.businessId),
    createAdminClient()
      .from("integrations")
      .select("id, provider_type, display_name")
      .eq("business_id", workspace.businessId)
      .in("provider_type", ["google_calendar", "calendly"])
      .neq("status", "DISCONNECTED"),
  ]);

  if (!result.success) {
    return (
      <section className="border-line bg-surface rounded-xl border shadow-xs">
        <ErrorState
          title="Meeting types could not be loaded"
          description="Nothing has been changed. Refresh the page to try again."
        />
      </section>
    );
  }

  const memberOptions: MeetingTypeOption[] = members
    .filter((member) => member.status === "active" && member.userId)
    .map((member) => ({ id: member.userId as string, label: member.name || member.email }));
  const serviceOptions: MeetingTypeOption[] = services
    .filter((service) => service.active)
    .map((service) => ({ id: service.id, label: service.name }));
  const calendarOptions: MeetingTypeOption[] = (calendars.data ?? []).map((row) => ({
    id: row.id,
    label: row.display_name
      ? `${CALENDAR_LABEL[row.provider_type] ?? row.provider_type} · ${row.display_name}`
      : (CALENDAR_LABEL[row.provider_type] ?? row.provider_type),
  }));

  return (
    <MeetingTypesPanel
      meetingTypes={result.data.meetingTypes}
      members={memberOptions}
      services={serviceOptions}
      calendars={calendarOptions}
      defaults={{ duration: booking.appointmentDurationMinutes, buffer: booking.bookingBufferMinutes }}
      readOnly={readOnly}
    />
  );
}
