import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  dayKeyInZone,
  filterByDate,
  filterByDayPart,
  formatSlotLabel,
  generateCandidateSlots,
  matchOfferedSlot,
  pickOfferedSlots,
  subtractBusy,
  zonedTimeToUtc,
  type Slot,
  type WeekHours,
} from "../src/lib/agent/availability/slots.ts";

const LONDON = "Europe/London";

const OPEN_WEEKDAYS: WeekHours = {
  mon: { open: true, start: "09:00", end: "17:00" },
  tue: { open: true, start: "09:00", end: "17:00" },
  wed: { open: true, start: "09:00", end: "17:00" },
  thu: { open: true, start: "09:00", end: "17:00" },
  fri: { open: true, start: "09:00", end: "17:00" },
  sat: { open: false, start: "09:00", end: "13:00" },
  sun: { open: false, start: "09:00", end: "13:00" },
};

// =====================================================================
// Timezone correctness — the part that silently ruins bookings
// =====================================================================

describe("zonedTimeToUtc", () => {
  test("resolves a summer (BST) wall time to the right instant", () => {
    // 2026-07-15 09:00 London is 08:00 UTC.
    const at = zonedTimeToUtc(2026, 7, 15, 9 * 60, LONDON);
    assert.equal(at.toISOString(), "2026-07-15T08:00:00.000Z");
  });

  test("resolves a winter (GMT) wall time to the right instant", () => {
    // 2026-01-15 09:00 London is 09:00 UTC.
    const at = zonedTimeToUtc(2026, 1, 15, 9 * 60, LONDON);
    assert.equal(at.toISOString(), "2026-01-15T09:00:00.000Z");
  });

  test("holds either side of a DST transition", () => {
    // UK clocks go forward on 2026-03-29.
    const before = zonedTimeToUtc(2026, 3, 28, 10 * 60, LONDON);
    const after = zonedTimeToUtc(2026, 3, 30, 10 * 60, LONDON);
    assert.equal(before.toISOString(), "2026-03-28T10:00:00.000Z");
    assert.equal(after.toISOString(), "2026-03-30T09:00:00.000Z");
  });

  test("works in a zone well off UTC", () => {
    const at = zonedTimeToUtc(2026, 7, 15, 9 * 60, "America/New_York");
    assert.equal(at.toISOString(), "2026-07-15T13:00:00.000Z");
  });
});

describe("dayKeyInZone", () => {
  test("reads the weekday in the workspace zone, not the server's", () => {
    // 22:00 UTC on a Monday is still Monday evening in London (BST) but
    // already Tuesday morning in Sydney.
    const at = new Date("2026-09-07T22:00:00Z");
    assert.equal(dayKeyInZone(at, LONDON), "mon");
    assert.equal(dayKeyInZone(at, "Australia/Sydney"), "tue");
  });
});

describe("formatSlotLabel", () => {
  test("renders a UK-readable label", () => {
    const label = formatSlotLabel(new Date("2026-09-08T13:30:00Z"), LONDON);
    // 13:30 UTC in September London is 14:30 local.
    assert.match(label, /Tue 8 Sept/);
    assert.match(label, /2:30pm/);
  });
});

// =====================================================================
// Slot generation
// =====================================================================

describe("generateCandidateSlots", () => {
  const from = new Date("2026-09-07T06:00:00Z"); // Monday, early

  test("only produces slots inside open business hours", () => {
    const slots = generateCandidateSlots({
      businessHours: OPEN_WEEKDAYS,
      timezone: LONDON,
      from,
      to: new Date(from.getTime() + 7 * 24 * 60 * 60_000),
      durationMinutes: 60,
      bufferMinutes: 0,
    });

    assert.ok(slots.length > 0);
    for (const slot of slots) {
      const day = dayKeyInZone(new Date(slot.startsAt), LONDON);
      assert.ok(day !== "sat" && day !== "sun", `weekend slot offered: ${slot.label}`);
    }
  });

  test("never offers a slot that would run past closing", () => {
    const slots = generateCandidateSlots({
      businessHours: OPEN_WEEKDAYS,
      timezone: LONDON,
      from,
      to: new Date(from.getTime() + 2 * 24 * 60 * 60_000),
      durationMinutes: 60,
      bufferMinutes: 0,
    });

    // 17:00 close with a 60-minute job means the last start is 16:00 local.
    for (const slot of slots) {
      const local = new Intl.DateTimeFormat("en-GB", {
        timeZone: LONDON,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(slot.startsAt));
      assert.ok(local <= "16:00", `slot too late: ${local}`);
    }
  });

  test("honours the minimum-notice window", () => {
    const slots = generateCandidateSlots({
      businessHours: OPEN_WEEKDAYS,
      timezone: LONDON,
      from: new Date("2026-09-07T09:00:00Z"),
      to: new Date("2026-09-08T17:00:00Z"),
      durationMinutes: 60,
      bufferMinutes: 0,
      minimumNoticeMinutes: 240,
    });

    const earliest = Date.parse("2026-09-07T09:00:00Z") + 240 * 60_000;
    for (const slot of slots) {
      assert.ok(Date.parse(slot.startsAt) >= earliest);
    }
  });

  test("the buffer eats into the bookable window", () => {
    const withoutBuffer = generateCandidateSlots({
      businessHours: OPEN_WEEKDAYS,
      timezone: LONDON,
      from,
      to: new Date(from.getTime() + 2 * 24 * 60 * 60_000),
      durationMinutes: 60,
      bufferMinutes: 0,
    });
    const withBuffer = generateCandidateSlots({
      businessHours: OPEN_WEEKDAYS,
      timezone: LONDON,
      from,
      to: new Date(from.getTime() + 2 * 24 * 60 * 60_000),
      durationMinutes: 60,
      bufferMinutes: 30,
    });
    assert.ok(withBuffer.length < withoutBuffer.length);
  });

  test("a closed week produces nothing rather than guessing", () => {
    const closed = Object.fromEntries(
      Object.entries(OPEN_WEEKDAYS).map(([key, value]) => [key, { ...value, open: false }]),
    ) as WeekHours;

    assert.deepEqual(
      generateCandidateSlots({
        businessHours: closed,
        timezone: LONDON,
        from,
        to: new Date(from.getTime() + 7 * 24 * 60 * 60_000),
        durationMinutes: 60,
        bufferMinutes: 0,
      }),
      [],
    );
  });

  test("a nonsensical duration produces nothing rather than throwing", () => {
    assert.deepEqual(
      generateCandidateSlots({
        businessHours: OPEN_WEEKDAYS,
        timezone: LONDON,
        from,
        to: new Date(from.getTime() + 7 * 24 * 60 * 60_000),
        durationMinutes: 0,
        bufferMinutes: 0,
      }),
      [],
    );
  });
});

describe("subtractBusy", () => {
  const slots: Slot[] = [
    { startsAt: "2026-09-08T09:00:00.000Z", endsAt: "2026-09-08T10:00:00.000Z", label: "a" },
    { startsAt: "2026-09-08T11:00:00.000Z", endsAt: "2026-09-08T12:00:00.000Z", label: "b" },
  ];

  test("removes a slot that overlaps a commitment", () => {
    const free = subtractBusy(slots, [
      { start: Date.parse("2026-09-08T09:30:00Z"), end: Date.parse("2026-09-08T10:30:00Z") },
    ]);
    assert.deepEqual(
      free.map((slot) => slot.label),
      ["b"],
    );
  });

  test("keeps a slot that merely abuts one, until a buffer is applied", () => {
    const busy = [
      { start: Date.parse("2026-09-08T10:00:00Z"), end: Date.parse("2026-09-08T11:00:00Z") },
    ];
    assert.equal(subtractBusy(slots, busy).length, 2);
    assert.deepEqual(
      subtractBusy(slots, busy, 15).map((slot) => slot.label),
      [],
    );
  });

  test("no commitments leaves everything free", () => {
    assert.equal(subtractBusy(slots, []).length, 2);
  });
});

describe("filters", () => {
  const slots: Slot[] = [
    { startsAt: "2026-09-08T08:00:00.000Z", endsAt: "", label: "Tue, 9:00am" },
    { startsAt: "2026-09-08T13:00:00.000Z", endsAt: "", label: "Tue, 2:00pm" },
    { startsAt: "2026-09-09T13:00:00.000Z", endsAt: "", label: "Wed, 2:00pm" },
  ];

  test("day part narrows correctly in the workspace zone", () => {
    assert.deepEqual(
      filterByDayPart(slots, "morning", LONDON).map((slot) => slot.label),
      ["Tue, 9:00am"],
    );
    assert.equal(filterByDayPart(slots, "afternoon", LONDON).length, 2);
  });

  test("an unrecognised preference never discards real availability", () => {
    assert.equal(filterByDayPart(slots, "sometime-ish", LONDON).length, 3);
    assert.equal(filterByDayPart(slots, null, LONDON).length, 3);
  });

  test("date narrows to a calendar day in the workspace zone", () => {
    assert.deepEqual(
      filterByDate(slots, "2026-09-09", LONDON).map((slot) => slot.label),
      ["Wed, 2:00pm"],
    );
  });

  test("an unparseable date is ignored rather than obeyed", () => {
    assert.equal(filterByDate(slots, "next tuesday", LONDON).length, 3);
  });
});

describe("pickOfferedSlots", () => {
  test("offers at most three, spread across the window", () => {
    const many: Slot[] = Array.from({ length: 20 }, (_, index) => ({
      startsAt: new Date(Date.UTC(2026, 8, 8, 9 + index)).toISOString(),
      endsAt: "",
      label: `slot ${index}`,
    }));
    const picked = pickOfferedSlots(many);
    assert.equal(picked.length, 3);
    assert.notDeepEqual(picked[0], picked[1]);
  });

  test("offers everything when there is little", () => {
    const two: Slot[] = [
      { startsAt: "a", endsAt: "", label: "one" },
      { startsAt: "b", endsAt: "", label: "two" },
    ];
    assert.equal(pickOfferedSlots(two).length, 2);
  });
});

// =====================================================================
// Confirmation matching — the gate in front of create_booking
// =====================================================================

describe("matchOfferedSlot", () => {
  const offered: Slot[] = [
    { startsAt: "2026-09-08T12:30:00.000Z", endsAt: "", label: "Tue, 8 Sep, 1:30pm" },
    { startsAt: "2026-09-08T14:00:00.000Z", endsAt: "", label: "Tue, 8 Sep, 3:00pm" },
    { startsAt: "2026-09-08T15:30:00.000Z", endsAt: "", label: "Tue, 8 Sep, 4:30pm" },
  ];

  test("matches an exact time", () => {
    assert.equal(matchOfferedSlot("1:30pm please", offered)?.label, "Tue, 8 Sep, 1:30pm");
    assert.equal(matchOfferedSlot("3pm works", offered)?.label, "Tue, 8 Sep, 3:00pm");
  });

  test("reads a bare number as an hour when one slot is at that hour", () => {
    // "3" after 1:30pm / 3:00pm / 4:30pm means three o'clock, not the third
    // option — which would have been 4:30pm and a wrong booking.
    assert.equal(matchOfferedSlot("3", offered)?.label, "Tue, 8 Sep, 3:00pm");
  });

  test("falls back to a positional pick only when no slot is at that hour", () => {
    assert.equal(matchOfferedSlot("2", offered)?.label, "Tue, 8 Sep, 3:00pm");
  });

  test("matches ordinal wording", () => {
    assert.equal(matchOfferedSlot("the first one", offered)?.label, "Tue, 8 Sep, 1:30pm");
    assert.equal(matchOfferedSlot("second please", offered)?.label, "Tue, 8 Sep, 3:00pm");
    assert.equal(matchOfferedSlot("the last one", offered)?.label, "Tue, 8 Sep, 4:30pm");
  });

  test("refuses to guess when the reply is ambiguous", () => {
    const twoAtThree: Slot[] = [
      { startsAt: "2026-09-08T14:00:00.000Z", endsAt: "", label: "Tue, 3:00pm" },
      { startsAt: "2026-09-09T14:00:00.000Z", endsAt: "", label: "Wed, 3:00pm" },
    ];
    assert.equal(matchOfferedSlot("3pm", twoAtThree), null);
  });

  test("returns null for anything it cannot resolve", () => {
    assert.equal(matchOfferedSlot("sounds good", offered), null);
    assert.equal(matchOfferedSlot("what about next week", offered), null);
    assert.equal(matchOfferedSlot("", offered), null);
    assert.equal(matchOfferedSlot("9am", offered), null);
  });

  test("nothing offered can never produce a booking", () => {
    assert.equal(matchOfferedSlot("3pm", []), null);
  });
});
