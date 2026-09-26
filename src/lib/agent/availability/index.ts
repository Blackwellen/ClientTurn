import "server-only";

/**
 * Calendar availability.
 *
 * Closes the gap that previously forced every booking conversation down to a
 * link or a person: the agent can now ask a real calendar what is free and
 * offer only what comes back.
 *
 * The contract every provider here obeys:
 *
 *   * It returns **busy intervals**, never slots. Slot generation is the pure
 *     code in ./slots.ts, so business hours, duration, buffer and notice are
 *     applied identically no matter which calendar a workspace uses.
 *   * A provider that is not connected, is unhealthy, or errors returns a
 *     typed failure. It never returns an empty list to mean "unknown" -- an
 *     empty list means "genuinely nothing free", which is a different answer
 *     and leads to a different reply.
 *
 * Failure routes the turn to the configured booking link or to a person. That
 * ordering is deliberate: a wrong slot is worse than no slot.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getLiveAccessToken } from "@/lib/integrations/oauth";
import { googleCalendarConfig } from "@/lib/integrations/providers/google-calendar";
import {
  filterByDate,
  filterByDayPart,
  generateCandidateSlots,
  isSlotStillFree,
  pickOfferedSlots,
  subtractBusy,
  type BusyInterval,
  type Slot,
  type WeekHours,
} from "./slots";

export type { Slot } from "./slots";

export type AvailabilityFailureCode =
  | "NOT_CONFIGURED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_ERROR"
  | "NO_BUSINESS_HOURS";

export type AvailabilityResult =
  | { ok: true; slots: Slot[]; provider: string }
  | { ok: false; code: AvailabilityFailureCode; detail: string };

export type AvailabilityRequest = {
  businessId: string;
  timezone: string;
  /** "YYYY-MM-DD" in the workspace timezone, when the lead named a day. */
  date?: string | null;
  /** "morning" | "afternoon" | "evening", when the lead named a part of day. */
  dayPart?: string | null;
  /** How many options to offer. */
  limit?: number;
  now?: Date;
};

const PROVIDER_TIMEOUT_MS = 8000;

async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; detail: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return { ok: false, detail: `Provider returned ${response.status}.` };
    }
    return { ok: true, json };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Provider request failed.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ------------------------------------------------------------------ google

/**
 * Google's freeBusy endpoint. One call covers every calendar the workspace
 * selected, and returns only opaque busy blocks -- no event titles, no
 * attendees. That is the right shape for this: the agent needs to know a time
 * is taken, never what it is taken for.
 */
async function googleBusyIntervals(
  integrationId: string,
  calendarIds: string[],
  from: Date,
  to: Date,
): Promise<{ ok: true; busy: BusyInterval[] } | { ok: false; detail: string }> {
  const config = googleCalendarConfig();
  if (!config) {
    return { ok: false, detail: "Google Calendar is not configured on this environment." };
  }

  let token: string;
  try {
    token = await getLiveAccessToken(integrationId, config);
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Could not refresh the calendar token.",
    };
  }

  const result = await fetchJson("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      items: calendarIds.map((id) => ({ id })),
    }),
  });

  if (!result.ok) return result;

  const calendars = (result.json.calendars ?? {}) as Record<
    string,
    { busy?: { start?: string; end?: string }[]; errors?: unknown[] }
  >;

  const busy: BusyInterval[] = [];
  for (const calendar of Object.values(calendars)) {
    // A calendar the workspace can no longer read must not read as "free".
    if (calendar.errors?.length) {
      return { ok: false, detail: "A selected calendar could not be read." };
    }
    for (const interval of calendar.busy ?? []) {
      const start = Date.parse(interval.start ?? "");
      const end = Date.parse(interval.end ?? "");
      if (Number.isFinite(start) && Number.isFinite(end)) busy.push({ start, end });
    }
  }

  return { ok: true, busy };
}

// ---------------------------------------------------------------- calendly

/**
 * Calendly owns its own availability rules, so unlike Google it is asked for
 * free times directly rather than for busy blocks. Its answer is authoritative
 * and is not re-filtered through business hours -- the workspace already
 * configured those inside Calendly.
 */
async function calendlyAvailableSlots(
  integrationId: string,
  eventTypeUri: string,
  from: Date,
  to: Date,
  timezone: string,
): Promise<{ ok: true; slots: Slot[] } | { ok: false; detail: string }> {
  const { data: secret } = await createAdminClient()
    .from("integration_secrets")
    .select("access_token")
    .eq("integration_id", integrationId)
    .maybeSingle();

  if (!secret?.access_token) {
    return { ok: false, detail: "No stored Calendly credential." };
  }

  // Calendly caps the window at 7 days per request.
  const cappedTo = new Date(Math.min(to.getTime(), from.getTime() + 7 * 24 * 60 * 60_000));

  const url = new URL("https://api.calendly.com/event_type_available_times");
  url.searchParams.set("event_type", eventTypeUri);
  url.searchParams.set("start_time", from.toISOString());
  url.searchParams.set("end_time", cappedTo.toISOString());

  const result = await fetchJson(url.toString(), {
    method: "GET",
    headers: { authorization: `Bearer ${secret.access_token}` },
  });

  if (!result.ok) return result;

  const collection = (result.json.collection ?? []) as {
    start_time?: string;
    status?: string;
    scheduling_url?: string;
  }[];

  const { formatSlotLabel } = await import("./slots");

  const slots = collection
    .filter((entry) => entry.status === "available" && entry.start_time)
    .map((entry) => {
      const startsAt = new Date(entry.start_time as string);
      return {
        startsAt: startsAt.toISOString(),
        // Calendly does not return a duration on this endpoint; the booking
        // itself is created by Calendly, so the end is informational only.
        endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
        label: formatSlotLabel(startsAt, timezone),
      };
    });

  return { ok: true, slots };
}

// ---------------------------------------------------------------- resolver

type CalendarConnection = {
  provider: "google_calendar" | "calendly";
  integrationId: string;
  config: Record<string, unknown>;
  status: string;
};

async function loadCalendarConnection(
  businessId: string,
  bookingMode: string,
  /** A meeting type's own calendar (§57). Wins over the booking mode's. */
  integrationId?: string | null,
): Promise<CalendarConnection | null> {
  if (integrationId) {
    const { data } = await createAdminClient()
      .from("integrations")
      .select("id, provider_type, config, status")
      .eq("business_id", businessId)
      .eq("id", integrationId)
      .maybeSingle();
    if (data && (data.provider_type === "google_calendar" || data.provider_type === "calendly")) {
      return {
        provider: data.provider_type,
        integrationId: data.id,
        config: (data.config ?? {}) as Record<string, unknown>,
        status: data.status,
      };
    }
    // A meeting type pointing at a calendar that is gone falls back to the
    // workspace's own, rather than to "no availability".
  }

  if (bookingMode !== "google_calendar" && bookingMode !== "calendly") return null;

  const { data } = await createAdminClient()
    .from("integrations")
    .select("id, provider_type, config, status")
    .eq("business_id", businessId)
    .eq("provider_type", bookingMode)
    .maybeSingle();

  if (!data) return null;

  return {
    provider: bookingMode,
    integrationId: data.id,
    config: (data.config ?? {}) as Record<string, unknown>,
    status: data.status,
  };
}

export type AvailabilityContext = {
  bookingMode: string;
  businessHours: WeekHours;
  appointmentDurationMinutes: number;
  bookingBufferMinutes: number;
  /** The lead's meeting type's calendar (§57); null = the booking mode's. */
  calendarIntegrationId?: string | null;
};

/**
 * The one function the agent calls. Everything about "can we offer a time" is
 * decided here and returned as a typed result the runtime can act on without
 * interpretation.
 */
export async function getAvailability(
  request: AvailabilityRequest,
  context: AvailabilityContext,
): Promise<AvailabilityResult> {
  const now = request.now ?? new Date();
  const from = now;
  const to = new Date(now.getTime() + 14 * 24 * 60 * 60_000);

  const connection = await loadCalendarConnection(
    request.businessId,
    context.bookingMode,
    context.calendarIntegrationId ?? null,
  );

  if (!connection) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      detail: "This workspace has no calendar connected for availability.",
    };
  }

  if (connection.status === "DISCONNECTED" || connection.status === "ACTION_REQUIRED") {
    return {
      ok: false,
      code: "PROVIDER_UNAVAILABLE",
      detail: `The ${connection.provider} connection needs attention.`,
    };
  }

  if (connection.provider === "calendly") {
    const eventTypeUri =
      typeof connection.config.event_type_uri === "string"
        ? connection.config.event_type_uri
        : null;

    if (!eventTypeUri) {
      return {
        ok: false,
        code: "NOT_CONFIGURED",
        detail: "No Calendly event type has been selected.",
      };
    }

    const result = await calendlyAvailableSlots(
      connection.integrationId,
      eventTypeUri,
      from,
      to,
      request.timezone,
    );
    if (!result.ok) {
      return { ok: false, code: "PROVIDER_ERROR", detail: result.detail };
    }

    const narrowed = filterByDayPart(
      filterByDate(result.slots, request.date, request.timezone),
      request.dayPart,
      request.timezone,
    );

    return {
      ok: true,
      slots: pickOfferedSlots(narrowed, request.limit ?? 3),
      provider: "calendly",
    };
  }

  // ---- google
  const calendarIds = Array.isArray(connection.config.calendar_ids)
    ? (connection.config.calendar_ids as string[]).filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      )
    : ["primary"];

  const openDays = Object.values(context.businessHours ?? {}).filter((day) => day?.open);
  if (openDays.length === 0) {
    return {
      ok: false,
      code: "NO_BUSINESS_HOURS",
      detail: "No business hours are configured, so no time can be offered.",
    };
  }

  const busy = await googleBusyIntervals(connection.integrationId, calendarIds, from, to);
  if (!busy.ok) {
    return { ok: false, code: "PROVIDER_ERROR", detail: busy.detail };
  }

  const candidates = generateCandidateSlots({
    businessHours: context.businessHours,
    timezone: request.timezone,
    from,
    to,
    durationMinutes: context.appointmentDurationMinutes,
    bufferMinutes: context.bookingBufferMinutes,
  });

  const free = subtractBusy(candidates, busy.busy, context.bookingBufferMinutes);
  const narrowed = filterByDayPart(
    filterByDate(free, request.date, request.timezone),
    request.dayPart,
    request.timezone,
  );

  return {
    ok: true,
    slots: pickOfferedSlots(narrowed, request.limit ?? 3),
    provider: "google_calendar",
  };
}

/**
 * Whether a workspace *could* be asked for availability. Used by the context
 * assembler so the model is told the truth about what is possible before it
 * proposes anything.
 */
export async function availabilityIsQueryable(
  businessId: string,
  bookingMode: string,
): Promise<boolean> {
  const connection = await loadCalendarConnection(businessId, bookingMode);
  return Boolean(
    connection &&
      connection.status !== "DISCONNECTED" &&
      connection.status !== "ACTION_REQUIRED",
  );
}

// ---------------------------------------------------------------- re-check

export type SlotRecheckResult =
  | { ok: true; free: boolean; integrationId: string; calendarId: string }
  | { ok: false; code: AvailabilityFailureCode; detail: string };

/**
 * The booking-time re-check (B10). A slot offered on an earlier turn may have
 * been taken since -- by the business's own diary, or by another lead. Asked
 * immediately before the Google event is written, over just the slot plus its
 * buffer, so a slot is only booked if the calendar still says it is free.
 *
 * Google only: Calendly books on its own side and ClientTurn never writes a
 * Calendly booking. A provider that cannot answer is a typed failure, never
 * "free".
 */
export async function recheckGoogleSlot(input: {
  businessId: string;
  slot: { startsAt: string; endsAt: string };
  bufferMinutes: number;
  /**
   * The lead's meeting type's calendar (§57), the same one availability was
   * read from. Only a Google connection can be re-checked and written to here;
   * a meeting type on Calendly (or a calendar that is gone) falls back to the
   * workspace's own Google connection.
   */
  calendarIntegrationId?: string | null;
}): Promise<SlotRecheckResult> {
  let connection = await loadCalendarConnection(
    input.businessId,
    "google_calendar",
    input.calendarIntegrationId ?? null,
  );
  if (connection && connection.provider !== "google_calendar") {
    connection = await loadCalendarConnection(input.businessId, "google_calendar");
  }
  if (!connection) {
    return { ok: false, code: "NOT_CONFIGURED", detail: "No Google Calendar is connected." };
  }
  if (connection.status === "DISCONNECTED" || connection.status === "ACTION_REQUIRED") {
    return {
      ok: false,
      code: "PROVIDER_UNAVAILABLE",
      detail: "The google_calendar connection needs attention.",
    };
  }

  const calendarIds = Array.isArray(connection.config.calendar_ids)
    ? (connection.config.calendar_ids as unknown[]).filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      )
    : [];
  const readFrom = calendarIds.length > 0 ? calendarIds : ["primary"];

  const start = Date.parse(input.slot.startsAt);
  const end = Date.parse(input.slot.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { ok: false, code: "PROVIDER_ERROR", detail: "The slot has no valid time." };
  }
  const buffer = input.bufferMinutes * 60_000;

  const busy = await googleBusyIntervals(
    connection.integrationId,
    readFrom,
    new Date(start - buffer),
    new Date(end + buffer),
  );
  if (!busy.ok) return { ok: false, code: "PROVIDER_ERROR", detail: busy.detail };

  return {
    ok: true,
    free: isSlotStillFree(input.slot, busy.busy, input.bufferMinutes),
    integrationId: connection.integrationId,
    // The event is written to the first selected calendar, or the primary.
    calendarId: readFrom[0],
  };
}
