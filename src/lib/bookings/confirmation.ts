/**
 * Booking confirmation rules (B10, brief §57, decision Q1).
 *
 * "Never say a meeting is booked until the provider confirms it." Every
 * decision about whether a chosen time is a *booking* or only a *request*, and
 * every sentence the lead is sent about it, lives here as a pure function so
 * it can be proven in tests/booking-confirmation.test.ts.
 *
 * No `server-only`, no Supabase and no relative imports: this file is loaded
 * directly by `node --test`.
 */

/**
 * Statuses that hold a time slot. A `pending` request holds its slot as firmly
 * as a `scheduled` booking -- the lead was told the time was requested, so it
 * must not be offered to someone else. Mirrored by the partial unique index in
 * migration 0113.
 */
export const ACTIVE_BOOKING_STATUSES = ["scheduled", "pending"] as const;

export type BookingRoute = "google_calendar" | "calendly_link" | "pending";

/** A connection the agent may write through. */
export function calendarIsUsable(status: string | null | undefined): boolean {
  return Boolean(status) && status !== "DISCONNECTED" && status !== "ACTION_REQUIRED";
}

/**
 * How a time the lead chose becomes (or does not become) a booking.
 *
 * * `google_calendar` -- ClientTurn writes the event; only the provider's
 *   success makes it a booking.
 * * `calendly_link` -- ClientTurn cannot book on the lead's behalf through
 *   the Calendly integration (it has webhooks and availability, no scheduling
 *   API). The lead finishes the booking on Calendly and the webhook brings it
 *   back through booking.sync.
 * * `pending` -- no calendar can confirm it, so the business must (Q1).
 */
export function planBookingRoute(input: {
  bookingMode: string;
  calendarUsable: boolean;
}): BookingRoute {
  if (input.bookingMode === "calendly") return "calendly_link";
  if (input.bookingMode === "google_calendar" && input.calendarUsable) return "google_calendar";
  return "pending";
}

/** Postgres unique_violation: another booking already holds this slot. */
export function isUniqueViolation(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "23505";
}

export type BookingFailureRoute = "offer_alternatives" | "pending_handover" | "send_link" | "handover";

/** What the orchestrator does with a `createBooking` failure code. */
export function bookingFailureRoute(code: string): BookingFailureRoute {
  if (code === "SLOT_TAKEN") return "offer_alternatives";
  if (code === "CALENDAR_NOT_CONFIRMED") return "pending_handover";
  if (code === "PROVIDER_BOOKS_ITSELF") return "send_link";
  return "handover";
}

/** Only a plausible address is sent a calendar invitation. */
export function inviteeEmail(email: string | null | undefined): string | null {
  const trimmed = (email ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

export type BookingReply =
  | { kind: "confirmed"; firstName: string | null; slotLabel: string; invited: boolean }
  | { kind: "pending"; firstName: string | null; slotLabel: string }
  | { kind: "calendly_link"; firstName: string | null; slotLabel: string }
  | { kind: "slot_taken"; firstName: string | null; slotLabel: string; alternatives: string[] };

function listOf(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

/**
 * The sentence the lead is sent about the time they chose. Deterministic --
 * never a model output -- because it is the one line that must never be
 * wrong. Only `confirmed` may say "booked", and `confirmed` is only produced
 * after the provider accepted the event.
 */
export function bookingReplyText(reply: BookingReply): string {
  const thanks = reply.firstName ? `Thanks ${reply.firstName} — ` : "Thanks — ";

  switch (reply.kind) {
    case "confirmed":
      return (
        `${thanks}that is booked for ${reply.slotLabel}.` +
        (reply.invited ? " A calendar invite is on its way to your email." : "")
      );
    case "pending":
      return (
        `${thanks}I have requested ${reply.slotLabel} for you. ` +
        "It is not confirmed yet — someone from the team will be in touch to confirm it."
      );
    case "calendly_link":
      // The configured link is appended by the send_booking_link tool.
      return `${thanks}to lock in ${reply.slotLabel}, please pick it here:`;
    case "slot_taken":
      return (
        `Sorry — ${reply.slotLabel} has just been taken. ` +
        `I can do ${listOf(reply.alternatives)}. Which suits you best?`
      );
  }
}

export type StaffStatusChange = { ok: true; bookLead: boolean } | { ok: false; error: string };

/**
 * A person changing a booking's status. The only way a `pending` request
 * becomes a booking is a person confirming it (`scheduled`), and that is the
 * moment the lead becomes BOOKED.
 */
export function staffStatusChange(from: string, to: string): StaffStatusChange {
  if (to === "pending") {
    return { ok: false, error: "A booking cannot be moved back to awaiting confirmation." };
  }
  if (from === "pending") {
    if (to === "scheduled") return { ok: true, bookLead: true };
    if (to === "cancelled") return { ok: true, bookLead: false };
    return { ok: false, error: "Confirm or decline this requested time first." };
  }
  return { ok: true, bookLead: false };
}
