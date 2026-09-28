import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { authorizeSiteChange, OFFLINE_ROLES, SITE_MANAGER_ROLES } from "../src/lib/maintenance/authz.ts";
import {
  MAINTENANCE_NOTICE_KIND,
  maintenanceNoticeEmail,
  maintenanceNoticeJobKey,
  shouldQueueMaintenanceNotice,
} from "../src/lib/maintenance/email.ts";

/**
 * Who may change maintenance and banners, and the owner notice email
 * (render only: nothing here, or anywhere in the suite, sends an email).
 */

const FRESH = 10 * 60 * 1000;

describe("admin role and step-up", () => {
  test("only a platform admin, read from the database, may manage the site", () => {
    assert.deepEqual(authorizeSiteChange({ platformRole: "user", stepUpRemainingMs: FRESH, level: "OFF" }), {
      ok: false,
      code: "forbidden",
      message: "Not permitted.",
    });
    assert.equal(authorizeSiteChange({ platformRole: null, stepUpRemainingMs: FRESH, level: "OFF" }).ok, false);
    assert.equal(authorizeSiteChange({ platformRole: "platform_admin", stepUpRemainingMs: FRESH, level: "OFF" }).ok, true);
  });

  test("every change needs a step-up in the last 30 minutes", () => {
    for (const level of ["OFF", "READ_ONLY", "APP_OFFLINE", "SITE_OFFLINE"] as const) {
      const verdict = authorizeSiteChange({ platformRole: "platform_admin", stepUpRemainingMs: 0, level, confirmText: level });
      assert.equal(verdict.ok, false);
      assert.equal(!verdict.ok && verdict.code, "step_up_required");
    }
  });

  test("read-only needs no typed confirmation", () => {
    assert.equal(authorizeSiteChange({ platformRole: "platform_admin", stepUpRemainingMs: FRESH, level: "READ_ONLY" }).ok, true);
  });

  test("the offline levels need the level's name typed back exactly", () => {
    for (const level of ["APP_OFFLINE", "SITE_OFFLINE"] as const) {
      const base = { platformRole: "platform_admin", stepUpRemainingMs: FRESH, level };
      assert.equal(authorizeSiteChange({ ...base, confirmText: "" }).ok, false);
      assert.equal(authorizeSiteChange({ ...base, confirmText: level.toLowerCase() }).ok, false);
      assert.equal(authorizeSiteChange({ ...base, confirmText: level === "APP_OFFLINE" ? "SITE_OFFLINE" : "APP_OFFLINE" }).ok, false);
      assert.equal(authorizeSiteChange({ ...base, confirmText: ` ${level} ` }).ok, true);
    }
  });

  test("a lower platform tier added later is refused the offline levels by default", () => {
    assert.ok(!SITE_MANAGER_ROLES.has("platform_support"));
    assert.ok(!OFFLINE_ROLES.has("platform_support"));
    const verdict = authorizeSiteChange({ platformRole: "platform_support", stepUpRemainingMs: FRESH, level: "SITE_OFFLINE", confirmText: "SITE_OFFLINE" });
    assert.equal(verdict.ok, false);
  });

  test("every action re-reads platform_role and runs the gate (source check)", () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/maintenance/actions.ts"), "utf8");
    assert.match(source, /^"use server";/);
    assert.match(source, /\.select\("platform_role"\)/);
    assert.match(source, /authorizeSiteChange\(/);
    assert.match(source, /stepUpRemainingMs\(operator\.id\)/);
    // Every exported action goes through siteGate, which audits.
    const exported = [...source.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    assert.ok(exported.length >= 7);
    for (const name of exported) {
      const body = source.slice(source.indexOf(`export async function ${name}`));
      const next = body.indexOf("export async function", 10);
      assert.match(next > 0 ? body.slice(0, next) : body, /siteGate\(/, `${name} bypasses the gate`);
    }
    assert.match(source, /recordAudit\(/);
  });
});

describe("owner notice email (render only)", () => {
  const base = {
    siteUrl: "https://clientturn.com",
    firstName: "Priya",
    level: "APP_OFFLINE" as const,
    startsAt: "2026-10-01T21:00:00.000Z",
    endsAt: "2026-10-01T23:00:00.000Z",
    message: "Database upgrade <b>tonight</b>",
    keepAutomationRunning: false,
  };

  test("says when, what it means and where to follow it, in UK time", () => {
    const email = maintenanceNoticeEmail(base);
    assert.match(email.subject, /^Planned maintenance: /);
    assert.match(email.subject, /BST/);
    assert.match(email.text, /Hi Priya,/);
    assert.match(email.text, /from .* until .* \(UK time\)/);
    assert.match(email.text, /App offline/);
    assert.match(email.text, /https:\/\/clientturn\.com\/status/);
    assert.match(email.text, /wait until we are back/);
  });

  test("the operator's message is escaped in the HTML part", () => {
    const email = maintenanceNoticeEmail(base);
    assert.doesNotMatch(email.html, /<b>tonight<\/b>/);
    assert.match(email.html, /&lt;b&gt;tonight&lt;\/b&gt;/);
  });

  test("read-only and kept automation say follow-up keeps running", () => {
    assert.match(maintenanceNoticeEmail({ ...base, level: "READ_ONLY" }).text, /keeps running/);
    assert.match(maintenanceNoticeEmail({ ...base, keepAutomationRunning: true }).text, /keeps running/);
  });

  test("no dashes as punctuation and no emoji (house style)", () => {
    const { text } = maintenanceNoticeEmail(base);
    assert.doesNotMatch(text, / [–—] /);
    assert.doesNotMatch(text, /[\u{1F300}-\u{1FAFF}]/u);
  });
});

describe("owner notice idempotency", () => {
  test("one job key per window per workspace", () => {
    assert.equal(maintenanceNoticeJobKey("w1", "b1"), "notification.send:maintenance-notice:w1:b1");
    assert.notEqual(maintenanceNoticeJobKey("w1", "b1"), maintenanceNoticeJobKey("w2", "b1"));
    assert.notEqual(maintenanceNoticeJobKey("w1", "b1"), maintenanceNoticeJobKey("w1", "b2"));
  });

  test("queued at most once per window, and never for a finished one", () => {
    const now = new Date("2026-10-01T12:00:00.000Z");
    const window = { notifyOwners: true, noticeQueuedAt: null, cancelledAt: null, endedAt: null, endsAt: "2026-10-02T00:00:00.000Z" };
    assert.equal(shouldQueueMaintenanceNotice(window, now), true);
    assert.equal(shouldQueueMaintenanceNotice({ ...window, noticeQueuedAt: "2026-10-01T11:00:00.000Z" }, now), false);
    assert.equal(shouldQueueMaintenanceNotice({ ...window, notifyOwners: false }, now), false);
    assert.equal(shouldQueueMaintenanceNotice({ ...window, cancelledAt: "2026-10-01T11:00:00.000Z" }, now), false);
    assert.equal(shouldQueueMaintenanceNotice({ ...window, endsAt: "2026-10-01T11:00:00.000Z" }, now), false);
  });

  test("the queue claims the window with a conditional update before queuing (source check)", () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/maintenance/notices.ts"), "utf8");
    const claim = source.indexOf('.is("notice_queued_at", null)');
    const insert = source.indexOf('.from("jobs")');
    assert.ok(claim > 0 && insert > claim, "notice_queued_at must be claimed before any job is inserted");
    assert.match(source, /maintenanceNoticeJobKey\(windowId, businessId\)/);
  });

  test("the send path re-reads the window, counts the system-email cap, and emails owners only (source check)", () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/maintenance/notice-send.ts"), "utf8");
    assert.match(source, /windowPhase\(/);
    assert.match(source, /consumeSystemEmail\(/);
    assert.match(source, /\.eq\("role", "owner"\)/);
    const handler = readFileSync(path.join(process.cwd(), "src/lib/jobs/handlers/notification-send.ts"), "utf8");
    assert.match(handler, /MAINTENANCE_NOTICE_KIND/);
    assert.equal(MAINTENANCE_NOTICE_KIND.length <= 60, true, "fits notificationSendPayload.kind");
  });
});
