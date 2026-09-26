import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  bookingReminderSendTime,
  planBookingReminder,
  previousPermittedSendTime,
  isWithinQuietHours,
  type QuietHours,
} from "../src/lib/automation/scheduler.ts";

const HOUR = 3600;
const noQuiet: QuietHours = { enabled: false, start: "20:00", end: "08:00", timezone: "UTC" };
const quietUtc: QuietHours = { enabled: true, start: "20:00", end: "08:00", timezone: "UTC" };
const quietLondon: QuietHours = {
  enabled: true,
  start: "20:00",
  end: "08:00",
  timezone: "Europe/London",
};

const at = (iso: string) => new Date(iso);

describe("booking reminder: timed back from the meeting start", () => {
  test("24 hours before is 24 hours before the meeting, not 24 hours after booking", () => {
    const result = bookingReminderSendTime({
      startsAt: at("2026-10-10T14:00:00Z"),
      offsetSeconds: 24 * HOUR,
      now: at("2026-10-05T09:00:00Z"),
      quiet: noQuiet,
    });
    assert.equal(result?.toISOString(), "2026-10-09T14:00:00.000Z");
  });

  for (const [minutes, expected] of [
    [15, "2026-10-10T13:45:00.000Z"],
    [60, "2026-10-10T13:00:00.000Z"],
    [120, "2026-10-10T12:00:00.000Z"],
    [2880, "2026-10-08T14:00:00.000Z"],
  ] as const) {
    test(`${minutes} minutes before`, () => {
      const result = bookingReminderSendTime({
        startsAt: at("2026-10-10T14:00:00Z"),
        offsetSeconds: minutes * 60,
        now: at("2026-10-01T09:00:00Z"),
        quiet: quietUtc,
      });
      assert.equal(result?.toISOString(), expected);
    });
  }

  test("a send time already passed is skipped, not sent late", () => {
    // Booked two hours out with a 24-hour reminder.
    const result = bookingReminderSendTime({
      startsAt: at("2026-10-10T14:00:00Z"),
      offsetSeconds: 24 * HOUR,
      now: at("2026-10-10T12:00:00Z"),
      quiet: noQuiet,
    });
    assert.equal(result, null);
  });

  test("a job running a little late still sends, at now", () => {
    const now = at("2026-10-09T14:03:00Z");
    const result = bookingReminderSendTime({
      startsAt: at("2026-10-10T14:00:00Z"),
      offsetSeconds: 24 * HOUR,
      now,
      quiet: noQuiet,
    });
    assert.equal(result?.getTime(), now.getTime());
  });

  test("late beyond the grace window is skipped", () => {
    const result = bookingReminderSendTime({
      startsAt: at("2026-10-10T14:00:00Z"),
      offsetSeconds: 24 * HOUR,
      now: at("2026-10-09T14:31:00Z"),
      quiet: noQuiet,
    });
    assert.equal(result, null);
  });

  test("grace never exceeds half the offset (a 15-minute reminder is not sent 10 minutes late)", () => {
    const result = bookingReminderSendTime({
      startsAt: at("2026-10-10T14:00:00Z"),
      offsetSeconds: 15 * 60,
      now: at("2026-10-10T13:55:00Z"),
      quiet: noQuiet,
    });
    assert.equal(result, null);
  });

  test("late inside grace but now in quiet hours is skipped", () => {
    // Pulled back to 19:59; the job runs at 20:05, inside quiet hours.
    const result = bookingReminderSendTime({
      startsAt: at("2026-10-10T07:30:00Z"),
      offsetSeconds: HOUR,
      now: at("2026-10-09T20:05:00Z"),
      quiet: quietUtc,
    });
    assert.equal(result, null);
  });

  test("a meeting already started (or with no valid time) gets nothing", () => {
    assert.equal(
      bookingReminderSendTime({
        startsAt: at("2026-10-10T14:00:00Z"),
        offsetSeconds: HOUR,
        now: at("2026-10-10T14:00:00Z"),
        quiet: noQuiet,
      }),
      null,
    );
    assert.equal(
      bookingReminderSendTime({
        startsAt: new Date(Number.NaN),
        offsetSeconds: HOUR,
        now: at("2026-10-10T10:00:00Z"),
        quiet: noQuiet,
      }),
      null,
    );
  });

  test("a zero or negative offset would land at/after the start and is skipped", () => {
    for (const offset of [0, -600]) {
      assert.equal(
        bookingReminderSendTime({
          startsAt: at("2026-10-10T14:00:00Z"),
          offsetSeconds: offset,
          now: at("2026-10-01T10:00:00Z"),
          quiet: noQuiet,
        }),
        null,
      );
    }
  });
});

describe("booking reminder: quiet hours move it EARLIER", () => {
  test("a reminder landing in quiet hours is pulled to just before they start", () => {
    // 07:30 meeting, 1 hour before = 06:30 (quiet) -> 19:59 the evening before.
    const result = bookingReminderSendTime({
      startsAt: at("2026-10-10T07:30:00Z"),
      offsetSeconds: HOUR,
      now: at("2026-10-09T10:00:00Z"),
      quiet: quietUtc,
    });
    assert.equal(result?.toISOString(), "2026-10-09T19:59:00.000Z");
    assert.equal(isWithinQuietHours(result as Date, quietUtc), false);
    assert.ok((result as Date).getTime() < at("2026-10-10T07:30:00Z").getTime());
  });

  test("never later than the permitted time (would be 08:00, after a 07:30 meeting)", () => {
    const result = bookingReminderSendTime({
      startsAt: at("2026-10-10T07:30:00Z"),
      offsetSeconds: 30 * 60,
      now: at("2026-10-09T10:00:00Z"),
      quiet: quietUtc,
    });
    assert.ok(result);
    assert.ok(result.getTime() < at("2026-10-10T07:30:00Z").getTime());
  });

  test("pulled earlier into the past is skipped", () => {
    // Booked at 23:00 for 07:30: the only permitted time before it was 19:59.
    const result = bookingReminderSendTime({
      startsAt: at("2026-10-10T07:30:00Z"),
      offsetSeconds: HOUR,
      now: at("2026-10-09T23:00:00Z"),
      quiet: quietUtc,
    });
    assert.equal(result, null);
  });

  test("a time outside quiet hours is unchanged", () => {
    const time = at("2026-10-09T12:00:00Z");
    assert.equal(previousPermittedSendTime(time, quietUtc).getTime(), time.getTime());
  });

  test("respects the workspace timezone (London, BST)", () => {
    // 06:30 BST = 05:30Z is quiet; 19:59 BST the evening before = 18:59Z.
    const result = previousPermittedSendTime(at("2026-07-10T05:30:00Z"), quietLondon);
    assert.equal(result.toISOString(), "2026-07-09T18:59:00.000Z");
  });

  test("a time just after quiet hours start rolls back to 19:59", () => {
    const result = previousPermittedSendTime(at("2026-10-09T20:00:30Z"), quietUtc);
    assert.equal(result.toISOString(), "2026-10-09T19:59:00.000Z");
  });
});

describe("booking reminder plan across steps", () => {
  const quiet = noQuiet;

  test("the first step with a moment left is chosen; passed steps are skipped", () => {
    // Steps: 48h, 24h, 1h. Booked 30 hours out.
    const plan = planBookingReminder({
      startsAt: at("2026-10-10T14:00:00Z"),
      offsetsSeconds: [48 * HOUR, 24 * HOUR, HOUR],
      fromIndex: 0,
      now: at("2026-10-09T08:00:00Z"),
      quiet,
    });
    assert.deepEqual(
      plan && { index: plan.stepIndex, at: plan.at.toISOString() },
      { index: 1, at: "2026-10-09T14:00:00.000Z" },
    );
  });

  test("continues from the run's current step", () => {
    const plan = planBookingReminder({
      startsAt: at("2026-10-10T14:00:00Z"),
      offsetsSeconds: [24 * HOUR, HOUR],
      fromIndex: 1,
      now: at("2026-10-09T15:00:00Z"),
      quiet,
    });
    assert.equal(plan?.stepIndex, 1);
    assert.equal(plan?.at.toISOString(), "2026-10-10T13:00:00.000Z");
  });

  test("nothing left to send returns null", () => {
    assert.equal(
      planBookingReminder({
        startsAt: at("2026-10-10T14:00:00Z"),
        offsetsSeconds: [24 * HOUR],
        fromIndex: 0,
        now: at("2026-10-10T13:00:00Z"),
        quiet,
      }),
      null,
    );
    assert.equal(
      planBookingReminder({
        startsAt: at("2026-10-10T14:00:00Z"),
        offsetsSeconds: [24 * HOUR],
        fromIndex: 1,
        now: at("2026-10-01T13:00:00Z"),
        quiet,
      }),
      null,
    );
  });

  test("a reschedule recomputes from the new start (later and earlier)", () => {
    const base = {
      offsetsSeconds: [24 * HOUR],
      fromIndex: 0,
      now: at("2026-10-05T09:00:00Z"),
      quiet,
    };
    const original = planBookingReminder({ ...base, startsAt: at("2026-10-10T14:00:00Z") });
    const later = planBookingReminder({ ...base, startsAt: at("2026-10-12T10:00:00Z") });
    const earlier = planBookingReminder({ ...base, startsAt: at("2026-10-07T09:00:00Z") });
    assert.equal(original?.at.toISOString(), "2026-10-09T14:00:00.000Z");
    assert.equal(later?.at.toISOString(), "2026-10-11T10:00:00.000Z");
    assert.equal(earlier?.at.toISOString(), "2026-10-06T09:00:00.000Z");
  });

  test("a reschedule to sooner than the offset skips that reminder", () => {
    const plan = planBookingReminder({
      startsAt: at("2026-10-05T12:00:00Z"),
      offsetsSeconds: [24 * HOUR, HOUR],
      fromIndex: 0,
      now: at("2026-10-05T09:00:00Z"),
      quiet,
    });
    assert.equal(plan?.stepIndex, 1);
    assert.equal(plan?.at.toISOString(), "2026-10-05T11:00:00.000Z");
  });
});

describe("meeting type calendar reaches the booking-time re-check (B)", () => {
  // tools.ts / availability are server-only (DB + provider I/O), so this is a
  // structural check on the wiring, in the style of tests/meeting-types.test.ts.
  const read = async (path: string) =>
    (await import("node:fs")).readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

  test("confirmBooking passes the meeting type's calendar to createBooking", async () => {
    const orchestrator = await read("src/lib/agent/orchestrator.ts");
    assert.match(
      orchestrator,
      /bufferMinutes: context\.booking\.bookingBufferMinutes,\s*calendarIntegrationId: context\.booking\.meetingType\?\.calendarIntegrationId \?\? null,\s*\}\);/,
    );
  });

  test("createBooking re-checks (and so writes the event) on that calendar", async () => {
    const tools = await read("src/lib/agent/tools.ts");
    assert.match(tools, /recheckGoogleSlot\(\{[^}]*calendarIntegrationId: input\.calendarIntegrationId \?\? null,/);
    assert.match(tools, /integrationId: recheck\.integrationId,\s*calendarId: recheck\.calendarId,/);
  });

  test("the re-check prefers the meeting type's calendar, falling back to the workspace's Google", async () => {
    const availability = await read("src/lib/agent/availability/index.ts");
    assert.match(
      availability,
      /"google_calendar",\s*input\.calendarIntegrationId \?\? null,\s*\);\s*if \(connection && connection\.provider !== "google_calendar"\) \{\s*connection = await loadCalendarConnection\(input\.businessId, "google_calendar"\);/,
    );
  });
});
