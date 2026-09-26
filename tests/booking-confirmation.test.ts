/**
 * B10 -- "never say booked until the provider confirms it" (brief §57,
 * decision Q1). The booking decisions are pure functions so they can be
 * proven here without a database or a calendar.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVE_BOOKING_STATUSES,
  bookingFailureRoute,
  bookingReplyText,
  calendarIsUsable,
  inviteeEmail,
  isUniqueViolation,
  planBookingRoute,
  staffStatusChange,
} from "../src/lib/bookings/confirmation.ts";
import { isSlotStillFree } from "../src/lib/agent/availability/slots.ts";

const BOOKED = /\bbooked\b|\bis confirmed\b|\bconfirmed for\b|\ball set\b/i;

describe("planBookingRoute", () => {
  test("google_calendar with a usable connection writes to the calendar", () => {
    assert.equal(planBookingRoute({ bookingMode: "google_calendar", calendarUsable: true }), "google_calendar");
  });

  test("google_calendar with a broken or missing connection is only a request", () => {
    assert.equal(planBookingRoute({ bookingMode: "google_calendar", calendarUsable: false }), "pending");
  });

  test("calendly never creates a local booking -- the lead gets the link", () => {
    assert.equal(planBookingRoute({ bookingMode: "calendly", calendarUsable: true }), "calendly_link");
    assert.equal(planBookingRoute({ bookingMode: "calendly", calendarUsable: false }), "calendly_link");
  });

  test("manual / handover / unknown modes are pending the business's confirmation", () => {
    for (const mode of ["manual", "handover", "", "anything"]) {
      assert.equal(planBookingRoute({ bookingMode: mode, calendarUsable: true }), "pending");
    }
  });
});

describe("calendarIsUsable", () => {
  test("missing, disconnected and action-required connections are not usable", () => {
    assert.equal(calendarIsUsable(null), false);
    assert.equal(calendarIsUsable(undefined), false);
    assert.equal(calendarIsUsable("DISCONNECTED"), false);
    assert.equal(calendarIsUsable("ACTION_REQUIRED"), false);
    assert.equal(calendarIsUsable("CONNECTED"), true);
  });
});

describe("isSlotStillFree (re-check at booking time)", () => {
  const slot = { startsAt: "2026-10-06T13:00:00.000Z", endsAt: "2026-10-06T13:30:00.000Z" };
  const at = (iso: string) => Date.parse(iso);

  test("free when nothing overlaps", () => {
    assert.equal(isSlotStillFree(slot, [], 0), true);
    assert.equal(
      isSlotStillFree(slot, [{ start: at("2026-10-06T14:00:00Z"), end: at("2026-10-06T15:00:00Z") }], 0),
      true,
    );
  });

  test("taken when something now overlaps the slot", () => {
    assert.equal(
      isSlotStillFree(slot, [{ start: at("2026-10-06T13:15:00Z"), end: at("2026-10-06T13:45:00Z") }], 0),
      false,
    );
  });

  test("the buffer is honoured on both sides", () => {
    const after = [{ start: at("2026-10-06T13:40:00Z"), end: at("2026-10-06T14:00:00Z") }];
    assert.equal(isSlotStillFree(slot, after, 0), true);
    assert.equal(isSlotStillFree(slot, after, 15), false);
  });

  test("an unparseable slot is never free", () => {
    assert.equal(isSlotStillFree({ startsAt: "nonsense", endsAt: "x" }, [], 0), false);
  });
});

describe("double-booking", () => {
  test("pending requests hold the slot as well as scheduled bookings", () => {
    assert.deepEqual([...ACTIVE_BOOKING_STATUSES].sort(), ["pending", "scheduled"]);
  });

  test("a unique violation is read as 'slot just taken'", () => {
    assert.equal(isUniqueViolation({ code: "23505" }), true);
    assert.equal(isUniqueViolation({ code: "23514" }), false);
    assert.equal(isUniqueViolation(null), false);
  });
});

describe("bookingFailureRoute", () => {
  test("a taken slot offers alternatives", () => {
    assert.equal(bookingFailureRoute("SLOT_TAKEN"), "offer_alternatives");
  });
  test("a calendar that did not confirm tells the lead a person will confirm", () => {
    assert.equal(bookingFailureRoute("CALENDAR_NOT_CONFIRMED"), "pending_handover");
  });
  test("calendly sends the booking link", () => {
    assert.equal(bookingFailureRoute("PROVIDER_BOOKS_ITSELF"), "send_link");
  });
  test("anything else hands over", () => {
    assert.equal(bookingFailureRoute("BOOKING_ALREADY_EXISTS"), "handover");
    assert.equal(bookingFailureRoute("TOOL_ERROR"), "handover");
  });
});

describe("bookingReplyText -- the lead is told exactly what happened", () => {
  const slotLabel = "Tue 6 Oct, 2:00pm";

  test("confirmed says booked, and mentions the invite only when one was sent", () => {
    const invited = bookingReplyText({ kind: "confirmed", firstName: "Sam", slotLabel, invited: true });
    assert.match(invited, BOOKED);
    assert.match(invited, /Tue 6 Oct, 2:00pm/);
    assert.match(invited, /invite/i);

    const notInvited = bookingReplyText({ kind: "confirmed", firstName: null, slotLabel, invited: false });
    assert.match(notInvited, BOOKED);
    assert.doesNotMatch(notInvited, /invite/i);
  });

  test("pending never claims a booking and says the business will confirm", () => {
    const text = bookingReplyText({ kind: "pending", firstName: "Sam", slotLabel });
    assert.doesNotMatch(text, BOOKED);
    assert.match(text, /requested/i);
    assert.match(text, /confirm/i);
    assert.match(text, /not confirmed yet/i);
  });

  test("the calendly link text asks the lead to finish the booking", () => {
    const text = bookingReplyText({ kind: "calendly_link", firstName: "Sam", slotLabel });
    assert.doesNotMatch(text, BOOKED);
    assert.match(text, /Tue 6 Oct, 2:00pm/);
  });

  test("slot taken offers the fresh alternatives and claims nothing", () => {
    const text = bookingReplyText({
      kind: "slot_taken",
      firstName: null,
      slotLabel,
      alternatives: ["Wed 7 Oct, 9:00am", "Wed 7 Oct, 11:00am", "Thu 8 Oct, 3:00pm"],
    });
    assert.doesNotMatch(text, BOOKED);
    assert.match(text, /just been taken/);
    assert.match(text, /Wed 7 Oct, 9:00am, Wed 7 Oct, 11:00am or Thu 8 Oct, 3:00pm/);
  });

  test("texts are deterministic", () => {
    const a = bookingReplyText({ kind: "pending", firstName: "Sam", slotLabel });
    const b = bookingReplyText({ kind: "pending", firstName: "Sam", slotLabel });
    assert.equal(a, b);
  });
});

describe("inviteeEmail", () => {
  test("only a plausible address is invited", () => {
    assert.equal(inviteeEmail(" Sam@Example.co.uk "), "Sam@Example.co.uk");
    assert.equal(inviteeEmail(null), null);
    assert.equal(inviteeEmail(""), null);
    assert.equal(inviteeEmail("not an email"), null);
  });
});

describe("staffStatusChange (confirming a requested time)", () => {
  test("pending -> scheduled confirms and books the lead", () => {
    assert.deepEqual(staffStatusChange("pending", "scheduled"), { ok: true, bookLead: true });
  });
  test("pending -> cancelled declines without booking", () => {
    assert.deepEqual(staffStatusChange("pending", "cancelled"), { ok: true, bookLead: false });
  });
  test("a request cannot be marked completed or no-show before it is confirmed", () => {
    assert.equal(staffStatusChange("pending", "completed").ok, false);
    assert.equal(staffStatusChange("pending", "no_show").ok, false);
  });
  test("nothing can be moved back to pending", () => {
    assert.equal(staffStatusChange("scheduled", "pending").ok, false);
  });
  test("existing outcome transitions are unchanged", () => {
    assert.deepEqual(staffStatusChange("scheduled", "completed"), { ok: true, bookLead: false });
    assert.deepEqual(staffStatusChange("scheduled", "no_show"), { ok: true, bookLead: false });
  });
});
