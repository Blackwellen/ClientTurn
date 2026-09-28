import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  formatCountdown,
  isAnnounceable,
  londonLocalToUtc,
  outboundPauseUntil,
  resolveMaintenance,
  retryAfterSeconds,
  utcToLondonLocal,
  windowPhase,
} from "../src/lib/maintenance/schedule.ts";
import { ANNOUNCE_AHEAD_MS, type PublicMaintenanceWindow } from "../src/lib/maintenance/types.ts";
import { evaluateSend, type SendGuardSnapshot } from "../src/lib/jobs/send-core.ts";

/**
 * Maintenance starts and ends by the clock, evaluated at read (no job flips
 * it), so the boundaries are the whole feature: inclusive start, exclusive
 * end, and "End now" winning over a later scheduled end.
 */

function win(overrides: Partial<PublicMaintenanceWindow> = {}): PublicMaintenanceWindow {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    level: "READ_ONLY",
    startsAt: "2026-10-01T09:00:00.000Z",
    endsAt: "2026-10-01T11:00:00.000Z",
    expectedBackAt: null,
    message: null,
    keepQuotePagesOnline: true,
    keepAutomationRunning: false,
    announceBanner: true,
    ...overrides,
  };
}

const at = (iso: string) => new Date(iso);

describe("window phase boundaries", () => {
  test("scheduled one millisecond before the start", () => {
    assert.equal(windowPhase(win(), at("2026-10-01T08:59:59.999Z")), "SCHEDULED");
  });
  test("active at exactly the start (automatic start)", () => {
    assert.equal(windowPhase(win(), at("2026-10-01T09:00:00.000Z")), "ACTIVE");
  });
  test("active one millisecond before the end", () => {
    assert.equal(windowPhase(win(), at("2026-10-01T10:59:59.999Z")), "ACTIVE");
  });
  test("ended at exactly the end (automatic end)", () => {
    assert.equal(windowPhase(win(), at("2026-10-01T11:00:00.000Z")), "ENDED");
  });
  test("no end time runs until ended", () => {
    assert.equal(windowPhase(win({ endsAt: null }), at("2030-01-01T00:00:00.000Z")), "ACTIVE");
  });
  test("End now ends it before the scheduled end", () => {
    const ended = win({ endedAt: "2026-10-01T09:30:00.000Z" });
    assert.equal(windowPhase(ended, at("2026-10-01T09:29:59.000Z")), "ACTIVE");
    assert.equal(windowPhase(ended, at("2026-10-01T09:30:00.000Z")), "ENDED");
  });
  test("a cancelled window never starts", () => {
    assert.equal(windowPhase(win({ cancelledAt: "2026-09-30T00:00:00.000Z" }), at("2026-10-01T10:00:00.000Z")), "CANCELLED");
  });
});

describe("resolveMaintenance", () => {
  test("off with no windows", () => {
    const status = resolveMaintenance([], at("2026-10-01T10:00:00.000Z"));
    assert.equal(status.phase, "OFF");
    assert.equal(status.level, "OFF");
  });

  test("scheduled before the start, level still OFF", () => {
    const status = resolveMaintenance([win()], at("2026-10-01T08:00:00.000Z"));
    assert.equal(status.phase, "SCHEDULED");
    assert.equal(status.level, "OFF");
    assert.equal(status.upcoming?.id, win().id);
  });

  test("the level turns on and off by itself", () => {
    const windows = [win({ level: "APP_OFFLINE" })];
    assert.equal(resolveMaintenance(windows, at("2026-10-01T09:00:00.000Z")).level, "APP_OFFLINE");
    assert.equal(resolveMaintenance(windows, at("2026-10-01T11:00:00.000Z")).level, "OFF");
  });

  test("overlapping active windows resolve to the most disruptive level", () => {
    const status = resolveMaintenance(
      [win({ id: "a", level: "READ_ONLY" }), win({ id: "b", level: "SITE_OFFLINE" }), win({ id: "c", level: "APP_OFFLINE" })],
      at("2026-10-01T10:00:00.000Z"),
    );
    assert.equal(status.level, "SITE_OFFLINE");
    assert.equal(status.active?.id, "b");
  });

  test("the soonest scheduled window is the upcoming one", () => {
    const status = resolveMaintenance(
      [win({ id: "later", startsAt: "2026-10-05T09:00:00.000Z", endsAt: null }), win({ id: "sooner" })],
      at("2026-10-01T00:00:00.000Z"),
    );
    assert.equal(status.upcoming?.id, "sooner");
  });
});

describe("Retry-After", () => {
  test("seconds until the expected-back time, preferring it over the end", () => {
    const status = resolveMaintenance([win({ expectedBackAt: "2026-10-01T10:30:00.000Z" })], at("2026-10-01T10:00:00.000Z"));
    assert.equal(retryAfterSeconds(status, at("2026-10-01T10:00:00.000Z")), 1800);
  });
  test("never under a minute, never over a day, half an hour when unknown", () => {
    const now = at("2026-10-01T10:59:50.000Z");
    assert.equal(retryAfterSeconds(resolveMaintenance([win()], now), now), 60);
    const far = resolveMaintenance([win({ endsAt: "2026-10-09T00:00:00.000Z" })], at("2026-10-01T10:00:00.000Z"));
    assert.equal(retryAfterSeconds(far, at("2026-10-01T10:00:00.000Z")), 86_400);
    const open = resolveMaintenance([win({ endsAt: null })], at("2026-10-01T10:00:00.000Z"));
    assert.equal(retryAfterSeconds(open, at("2026-10-01T10:00:00.000Z")), 1800);
  });
});

describe("outbound sends during maintenance", () => {
  const now = at("2026-10-01T10:00:00.000Z");
  test("read-only never holds sends", () => {
    assert.equal(outboundPauseUntil(resolveMaintenance([win({ level: "READ_ONLY" })], now), now), null);
  });
  test("offline levels hold sends until the end (re-checked at most every 15 minutes)", () => {
    const soon = win({ level: "APP_OFFLINE", endsAt: "2026-10-01T10:05:00.000Z" });
    assert.equal(outboundPauseUntil(resolveMaintenance([soon], now), now)?.toISOString(), "2026-10-01T10:05:00.000Z");
    const long = win({ level: "SITE_OFFLINE", endsAt: "2026-10-01T14:00:00.000Z" });
    assert.equal(outboundPauseUntil(resolveMaintenance([long], now), now)?.toISOString(), "2026-10-01T10:15:00.000Z");
  });
  test("keep automated follow-up running releases the hold", () => {
    const kept = win({ level: "SITE_OFFLINE", keepAutomationRunning: true });
    assert.equal(outboundPauseUntil(resolveMaintenance([kept], now), now), null);
  });
  test("no hold once the window has ended", () => {
    const after = at("2026-10-01T11:00:00.000Z");
    assert.equal(outboundPauseUntil(resolveMaintenance([win({ level: "APP_OFFLINE" })], after), after), null);
  });

  const snapshot = (pause: Date | null): SendGuardSnapshot => ({
    lead: {
      status: "CONTACTED",
      optedOut: false,
      hasReplied: false,
      humanTakeover: false,
      automationActive: true,
    } as SendGuardSnapshot["lead"],
    channel: { subscriptionActive: true, integrationHealthy: true, contactSuppressed: false } as SendGuardSnapshot["channel"],
    quietHours: { enabled: false, start: "21:00", end: "08:00", timezone: "Europe/London" } as SendGuardSnapshot["quietHours"],
    origin: "automation",
    maintenancePauseUntil: pause,
  });

  test("the send guard reschedules a held send rather than dropping it", () => {
    const until = new Date("2026-10-01T10:15:00.000Z");
    assert.deepEqual(evaluateSend(snapshot(until), now), { action: "reschedule", at: until });
    assert.deepEqual(evaluateSend(snapshot(null), now), { action: "send" });
  });

  test("an opt-out still aborts during maintenance: a hold never outranks a stop", () => {
    const s = snapshot(new Date("2026-10-01T10:15:00.000Z"));
    s.lead = { ...s.lead, optedOut: true };
    assert.equal(evaluateSend(s, now).action, "abort");
  });
});

describe("the upcoming-maintenance notice window", () => {
  const w = win({ startsAt: "2026-10-02T09:00:00.000Z" });
  test("announced from exactly 24 hours before", () => {
    assert.equal(isAnnounceable(w, at("2026-10-01T08:59:59.000Z"), ANNOUNCE_AHEAD_MS), false);
    assert.equal(isAnnounceable(w, at("2026-10-01T09:00:00.000Z"), ANNOUNCE_AHEAD_MS), true);
  });
  test("not once it has started, and not when switched off", () => {
    assert.equal(isAnnounceable(w, at("2026-10-02T09:00:00.000Z"), ANNOUNCE_AHEAD_MS), false);
    assert.equal(isAnnounceable({ ...w, announceBanner: false }, at("2026-10-01T12:00:00.000Z"), ANNOUNCE_AHEAD_MS), false);
  });
});

describe("Europe/London times (shown) versus UTC (stored)", () => {
  test("GMT in winter, BST in summer", () => {
    assert.equal(londonLocalToUtc("2026-01-15T14:30"), "2026-01-15T14:30:00.000Z");
    assert.equal(londonLocalToUtc("2026-07-15T14:30"), "2026-07-15T13:30:00.000Z");
  });
  test("round-trips through the form value", () => {
    for (const iso of ["2026-01-15T14:30:00.000Z", "2026-07-15T13:30:00.000Z", "2026-10-25T02:30:00.000Z"]) {
      assert.equal(londonLocalToUtc(utcToLondonLocal(iso)), iso);
    }
  });
  test("the autumn hour that happens twice reads as GMT (the later one)", () => {
    assert.equal(londonLocalToUtc("2026-10-25T01:30"), "2026-10-25T01:30:00.000Z");
  });
  test("the spring-forward gap moves forward an hour", () => {
    assert.equal(londonLocalToUtc("2026-03-29T01:30"), "2026-03-29T01:30:00.000Z");
  });
  test("rubbish is refused", () => {
    assert.equal(londonLocalToUtc("tomorrow"), null);
    assert.equal(londonLocalToUtc(""), null);
  });
  test("countdown formatting", () => {
    assert.equal(formatCountdown(0), "now");
    assert.equal(formatCountdown(65_000), "1m 05s");
    assert.equal(formatCountdown(2 * 3_600_000 + 5 * 60_000), "2h 05m");
    assert.equal(formatCountdown(3 * 86_400_000 + 2 * 3_600_000), "3d 2h");
  });
});
