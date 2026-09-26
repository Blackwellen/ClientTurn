/**
 * Meeting types and rep routing (brief §57). Selection, routing and the
 * booking shape are pure (src/lib/bookings/meeting-types.ts); the structural
 * checks hold availability and booking to them, and to the default of one
 * workspace calendar when no meeting types exist.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  bookingShape,
  cleanSpecialisms,
  meetingTypeFromRow,
  meetingTypeInputSchema,
  pickAssignee,
  selectMeetingType,
  type MeetingType,
} from "../src/lib/bookings/meeting-types.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (relative: string) =>
  readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const WEB = "11111111-1111-4111-8111-111111111111";
const SEO = "22222222-2222-4222-8222-222222222222";

function type(overrides: Partial<MeetingType> = {}): MeetingType {
  return {
    id: "mt-1",
    name: "Discovery call",
    durationMinutes: 30,
    bufferMinutes: 10,
    assigneeRule: "ROUND_ROBIN",
    eligibleUserIds: [A, B],
    serviceIds: [],
    specialisms: {},
    calendarIntegrationId: null,
    isDefault: false,
    active: true,
    ...overrides,
  };
}

describe("choosing a meeting type", () => {
  test("no meeting types: null, so the workspace default applies", () => {
    assert.equal(selectMeetingType([], WEB), null);
    assert.equal(selectMeetingType([type({ active: false })], WEB), null);
  });

  test("a type for the lead's service wins", () => {
    const general = type({ id: "general", isDefault: true });
    const web = type({ id: "web", serviceIds: [WEB] });
    assert.equal(selectMeetingType([general, web], WEB)?.id, "web");
  });

  test("otherwise the default, then the first unrestricted type", () => {
    const first = type({ id: "first" });
    const fallback = type({ id: "default", isDefault: true });
    assert.equal(selectMeetingType([first, fallback], SEO)?.id, "default");
    assert.equal(selectMeetingType([first], null)?.id, "first");
  });

  test("a type restricted to other services is never used for this lead", () => {
    const seoOnly = type({ id: "seo", serviceIds: [SEO], isDefault: true });
    assert.equal(selectMeetingType([seoOnly], WEB), null);
  });
});

describe("routing to a rep", () => {
  const counts = (entries: [string, number][]) => new Map(entries);

  test("round robin: the fewest bookings in the next 7 days", () => {
    const decision = pickAssignee({
      rule: "ROUND_ROBIN",
      eligibleUserIds: [A, B, C],
      specialisms: {},
      serviceId: null,
      ownerUserId: null,
      upcomingCounts: counts([[A, 3], [B, 1], [C, 2]]),
    });
    assert.deepEqual(decision, { userId: B, reason: "ROUND_ROBIN" });
  });

  test("a tie goes to whoever was assigned longest ago, never-assigned first", () => {
    const tie = counts([[A, 1], [B, 1], [C, 1]]);
    assert.equal(
      pickAssignee({
        rule: "ROUND_ROBIN",
        eligibleUserIds: [A, B, C],
        specialisms: {},
        serviceId: null,
        ownerUserId: null,
        upcomingCounts: tie,
        lastAssignedAt: new Map([
          [A, "2026-09-25T10:00:00Z"],
          [B, "2026-09-20T10:00:00Z"],
        ]),
      }).userId,
      C,
    );
    assert.equal(
      pickAssignee({
        rule: "ROUND_ROBIN",
        eligibleUserIds: [A, B],
        specialisms: {},
        serviceId: null,
        ownerUserId: null,
        upcomingCounts: tie,
        lastAssignedAt: new Map([
          [A, "2026-09-25T10:00:00Z"],
          [B, "2026-09-20T10:00:00Z"],
        ]),
      }).userId,
      B,
    );
  });

  test("specialism: round robin among the specialists in the lead's service", () => {
    const decision = pickAssignee({
      rule: "SPECIALISM",
      eligibleUserIds: [A, B, C],
      specialisms: { [A]: [WEB], [C]: [WEB, SEO] },
      serviceId: WEB,
      ownerUserId: null,
      upcomingCounts: counts([[A, 4], [B, 0], [C, 2]]),
    });
    assert.deepEqual(decision, { userId: C, reason: "SPECIALIST" });
  });

  test("specialism with no specialist falls back to every eligible rep", () => {
    const decision = pickAssignee({
      rule: "SPECIALISM",
      eligibleUserIds: [A, B],
      specialisms: { [A]: [SEO] },
      serviceId: WEB,
      ownerUserId: null,
      upcomingCounts: counts([[A, 2], [B, 5]]),
    });
    assert.deepEqual(decision, { userId: A, reason: "NO_SPECIALIST" });
  });

  test("owner: the lead's owner when eligible, round robin when not", () => {
    const base = {
      rule: "OWNER" as const,
      eligibleUserIds: [A, B],
      specialisms: {},
      serviceId: null,
      upcomingCounts: counts([[A, 9], [B, 0]]),
    };
    assert.deepEqual(pickAssignee({ ...base, ownerUserId: A }), { userId: A, reason: "OWNER" });
    assert.deepEqual(pickAssignee({ ...base, ownerUserId: C }), { userId: B, reason: "OWNER_NOT_ELIGIBLE" });
  });

  test("nobody eligible: no assignee, as before meeting types existed", () => {
    assert.deepEqual(
      pickAssignee({
        rule: "ROUND_ROBIN",
        eligibleUserIds: [],
        specialisms: {},
        serviceId: null,
        ownerUserId: A,
        upcomingCounts: new Map(),
      }),
      { userId: null, reason: "NO_ELIGIBLE_REPS" },
    );
  });
});

describe("booking shape", () => {
  const defaults = { durationMinutes: 60, bufferMinutes: 0 };

  test("no meeting type keeps the workspace's duration, buffer and calendar", () => {
    assert.deepEqual(bookingShape(defaults, null), {
      durationMinutes: 60,
      bufferMinutes: 0,
      meetingTypeId: null,
      calendarIntegrationId: null,
    });
  });

  test("a meeting type's duration, buffer and calendar apply", () => {
    assert.deepEqual(bookingShape(defaults, type({ calendarIntegrationId: "cal-1" })), {
      durationMinutes: 30,
      bufferMinutes: 10,
      meetingTypeId: "mt-1",
      calendarIntegrationId: "cal-1",
    });
  });
});

describe("validation and rows", () => {
  const valid = {
    name: "Strategy session",
    durationMinutes: 45,
    bufferMinutes: 15,
    assigneeRule: "ROUND_ROBIN" as const,
    eligibleUserIds: [A],
    serviceIds: [],
    isDefault: true,
  };

  test("a well-formed meeting type passes", () => {
    assert.equal(meetingTypeInputSchema.safeParse(valid).success, true);
  });

  test("duration and buffer are bounded", () => {
    assert.equal(meetingTypeInputSchema.safeParse({ ...valid, durationMinutes: 2 }).success, false);
    assert.equal(meetingTypeInputSchema.safeParse({ ...valid, bufferMinutes: 500 }).success, false);
  });

  test("a specialism type needs at least one person", () => {
    assert.equal(
      meetingTypeInputSchema.safeParse({ ...valid, assigneeRule: "SPECIALISM", eligibleUserIds: [] }).success,
      false,
    );
  });

  test("specialisms are kept only for eligible people", () => {
    assert.deepEqual(cleanSpecialisms([A], { [A]: [WEB, WEB], [B]: [SEO] }), { [A]: [WEB] });
  });

  test("a row with an unknown rule reads as round robin", () => {
    const mapped = meetingTypeFromRow({
      id: "x",
      name: "X",
      duration_minutes: 20,
      buffer_minutes: 0,
      assignee_rule: "LOTTERY",
      eligible_user_ids: null,
      service_ids: null,
      specialisms: { [A]: [WEB, 3] },
      calendar_integration_id: null,
      is_default: false,
      active: true,
    });
    assert.equal(mapped.assigneeRule, "ROUND_ROBIN");
    assert.deepEqual(mapped.eligibleUserIds, []);
    assert.deepEqual(mapped.specialisms, { [A]: [WEB] });
  });
});

describe("structure", () => {
  test("the agent's booking context takes duration and buffer from the meeting type", () => {
    const context = read("src/lib/agent/context.ts");
    assert.match(context, /meetingTypeForLead\(business\.businessId, serviceId\)/);
    assert.match(context, /appointmentDurationMinutes: shape\.durationMinutes/);
    assert.match(context, /bookingBufferMinutes: shape\.bufferMinutes/);
  });

  test("availability reads the meeting type's calendar when it has one", () => {
    const availability = read("src/lib/agent/availability/index.ts");
    assert.match(availability, /context\.calendarIntegrationId \?\? null/);
    const orchestrator = read("src/lib/agent/orchestrator.ts");
    assert.equal(
      orchestrator.match(/calendarIntegrationId: context\.booking\.meetingType\?\.calendarIntegrationId \?\? null/g)?.length,
      // Two availability reads plus the booking-time re-check (createBooking).
      3,
    );
  });

  test("the booking records the assignee and the meeting type, and routing never blocks it", () => {
    const tools = read("src/lib/agent/tools.ts");
    assert.match(tools, /assigned_user_id: routing\.assignedUserId/);
    assert.match(tools, /meeting_type_id: routing\.meetingTypeId/);
    assert.match(tools, /return \{ meetingTypeId: null, assignedUserId: null \};\n  \}\n\}/);
  });

  test("round robin counts active bookings over the next seven days", () => {
    const store = read("src/lib/bookings/meeting-type-store.ts");
    assert.match(store, /ROUND_ROBIN_WINDOW_DAYS \* 86_400_000/);
    assert.match(store, /\.in\("status", \[\.\.\.ACTIVE_BOOKING_STATUSES\]\)/);
  });

  test("the migration creates meeting_types and bookings.meeting_type_id", () => {
    const sql = read("supabase/migrations/0127_crm_pull_templates_email_meetings.sql");
    assert.match(sql, /create table if not exists public\.meeting_types/);
    assert.match(sql, /assignee_rule in \('ROUND_ROBIN', 'SPECIALISM', 'OWNER'\)/);
    assert.match(sql, /add column if not exists meeting_type_id uuid/);
    assert.match(sql, /meeting_types_default_idx/);
  });
});
