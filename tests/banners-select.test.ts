import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  audienceMatches,
  bannerDismissStorageKey,
  bannerPhase,
  eligibleBanners,
  isBannerLive,
  maintenanceNotice,
  safeBannerLink,
  selectBanner,
  stackNotices,
} from "../src/lib/banners/select.ts";
import { rowToBanner } from "../src/lib/banners/rows.ts";
import type { Banner, BannerViewer, StackItem } from "../src/lib/banners/types.ts";
import { resolveMaintenance } from "../src/lib/maintenance/schedule.ts";
import type { PublicMaintenanceWindow } from "../src/lib/maintenance/types.ts";

/**
 * Banner selection and stacking (docs/MAINTENANCE.md): who sees which banner,
 * where, in what order, and what a dismissal hides.
 */

const NOW = new Date("2026-10-01T12:00:00.000Z");

function banner(overrides: Partial<Banner> = {}): Banner {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    title: "New: reactivation campaigns",
    body: null,
    linkUrl: null,
    linkLabel: null,
    tone: "info",
    audience: "ALL",
    plans: [],
    businessIds: [],
    placements: ["APP_TOP"],
    startsAt: "2026-10-01T00:00:00.000Z",
    endsAt: null,
    endedAt: null,
    dismissible: true,
    priority: 50,
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const OWNER: BannerViewer = { kind: "app", businessId: "ws-1", plan: "growth", role: "owner" };
const MEMBER: BannerViewer = { kind: "app", businessId: "ws-2", plan: "trial", role: "member" };
const VISITOR: BannerViewer = { kind: "marketing" };

describe("schedule and expiry, evaluated at read", () => {
  test("live from the start, gone at the end", () => {
    const b = banner({ startsAt: "2026-10-01T12:00:00.000Z", endsAt: "2026-10-01T13:00:00.000Z" });
    assert.equal(isBannerLive(b, new Date("2026-10-01T11:59:59.999Z")), false);
    assert.equal(isBannerLive(b, new Date("2026-10-01T12:00:00.000Z")), true);
    assert.equal(isBannerLive(b, new Date("2026-10-01T13:00:00.000Z")), false);
    assert.equal(bannerPhase(b, new Date("2026-10-01T11:00:00.000Z")), "SCHEDULED");
    assert.equal(bannerPhase(b, new Date("2026-10-01T13:00:00.000Z")), "ENDED");
  });
  test("End now takes it down", () => {
    assert.equal(isBannerLive(banner({ endedAt: "2026-10-01T11:00:00.000Z" }), NOW), false);
  });
});

describe("audience", () => {
  test("ALL reaches everyone; APP_USERS only the app; MARKETING_VISITORS only the website", () => {
    assert.ok(audienceMatches(banner({ audience: "ALL" }), OWNER));
    assert.ok(audienceMatches(banner({ audience: "ALL" }), VISITOR));
    assert.ok(audienceMatches(banner({ audience: "APP_USERS" }), MEMBER));
    assert.ok(!audienceMatches(banner({ audience: "APP_USERS" }), VISITOR));
    assert.ok(audienceMatches(banner({ audience: "MARKETING_VISITORS" }), VISITOR));
    assert.ok(!audienceMatches(banner({ audience: "MARKETING_VISITORS" }), OWNER));
  });
  test("specific plans, including trial", () => {
    const b = banner({ audience: "PLANS", plans: ["trial", "starter"] });
    assert.ok(audienceMatches(b, MEMBER));
    assert.ok(!audienceMatches(b, OWNER));
    assert.ok(!audienceMatches(b, VISITOR));
  });
  test("specific workspaces never leak to another workspace", () => {
    const b = banner({ audience: "WORKSPACES", businessIds: ["ws-1"] });
    assert.ok(audienceMatches(b, OWNER));
    assert.ok(!audienceMatches(b, MEMBER));
    assert.ok(!audienceMatches(b, VISITOR));
  });
  test("owners and admins only", () => {
    const b = banner({ audience: "OWNERS_ADMINS" });
    assert.ok(audienceMatches(b, OWNER));
    assert.ok(audienceMatches(b, { ...OWNER, role: "admin" } as BannerViewer));
    assert.ok(!audienceMatches(b, MEMBER));
    assert.ok(!audienceMatches(b, { ...OWNER, role: "viewer" } as BannerViewer));
  });
});

describe("placement and priority: at most one banner per placement", () => {
  test("the highest priority wins; ties go to the most recent start", () => {
    const low = banner({ id: "low", priority: 10 });
    const high = banner({ id: "high", priority: 90 });
    const tieOld = banner({ id: "tie-old", priority: 90, startsAt: "2026-09-01T00:00:00.000Z" });
    assert.equal(selectBanner({ banners: [low, tieOld, high], viewer: OWNER, placement: "APP_TOP", now: NOW })?.id, "high");
  });
  test("a banner only appears in the placements it names", () => {
    const b = banner({ placements: ["DASHBOARD_CARD"] });
    assert.equal(selectBanner({ banners: [b], viewer: OWNER, placement: "APP_TOP", now: NOW }), null);
    assert.equal(selectBanner({ banners: [b], viewer: OWNER, placement: "DASHBOARD_CARD", now: NOW })?.id, b.id);
  });
  test("website visitors only ever get the website top bar; app users never do", () => {
    const b = banner({ placements: ["APP_TOP", "MARKETING_TOP"] });
    assert.equal(eligibleBanners({ banners: [b], viewer: VISITOR, placement: "APP_TOP", now: NOW }).length, 0);
    assert.equal(eligibleBanners({ banners: [b], viewer: VISITOR, placement: "MARKETING_TOP", now: NOW }).length, 1);
    assert.equal(eligibleBanners({ banners: [b], viewer: OWNER, placement: "MARKETING_TOP", now: NOW }).length, 0);
  });
});

describe("dismissal", () => {
  test("a dismissed banner gives way to the next one", () => {
    const first = banner({ id: "first", priority: 90 });
    const second = banner({ id: "second", priority: 10 });
    const picked = selectBanner({ banners: [first, second], viewer: OWNER, placement: "APP_TOP", now: NOW, dismissedIds: new Set(["first"]) });
    assert.equal(picked?.id, "second");
  });
  test("a non-dismissible banner ignores a stale dismissal", () => {
    const pinned = banner({ id: "pinned", dismissible: false });
    const picked = selectBanner({ banners: [pinned], viewer: OWNER, placement: "APP_TOP", now: NOW, dismissedIds: new Set(["pinned"]) });
    assert.equal(picked?.id, "pinned");
  });
  test("website dismissals are keyed per banner in localStorage", () => {
    assert.equal(bannerDismissStorageKey("abc"), "ct-banner-dismissed:abc");
  });
});

describe("the automatic maintenance notice", () => {
  const w = (overrides: Partial<PublicMaintenanceWindow> = {}): PublicMaintenanceWindow => ({
    id: "bbbbbbbb-0000-4000-8000-000000000002",
    level: "APP_OFFLINE",
    startsAt: "2026-10-02T06:00:00.000Z",
    endsAt: "2026-10-02T08:00:00.000Z",
    expectedBackAt: null,
    message: null,
    keepQuotePagesOnline: true,
    keepAutomationRunning: false,
    announceBanner: true,
    ...overrides,
  });

  test("an upcoming window is announced 24 hours ahead, as a dismissible warning", () => {
    const notice = maintenanceNotice(resolveMaintenance([w()], NOW), NOW, OWNER);
    assert.ok(notice);
    assert.equal(notice.tone, "warning");
    assert.equal(notice.dismissible, true);
    assert.equal(notice.id, `maintenance:${w().id}:upcoming`);
  });
  test("not more than 24 hours ahead, and not when the window opts out", () => {
    assert.equal(maintenanceNotice(resolveMaintenance([w({ startsAt: "2026-10-03T13:00:00.000Z", endsAt: null })], NOW), NOW, OWNER), null);
    assert.equal(maintenanceNotice(resolveMaintenance([w({ announceBanner: false })], NOW), NOW, OWNER), null);
  });
  test("website visitors are told only about SITE_OFFLINE", () => {
    assert.equal(maintenanceNotice(resolveMaintenance([w()], NOW), NOW, VISITOR), null);
    assert.ok(maintenanceNotice(resolveMaintenance([w({ level: "SITE_OFFLINE" })], NOW), NOW, VISITOR));
  });
  test("while active it is critical and cannot be dismissed", () => {
    const during = new Date("2026-10-02T07:00:00.000Z");
    const notice = maintenanceNotice(resolveMaintenance([w({ level: "READ_ONLY" })], during), during, OWNER);
    assert.equal(notice?.tone, "critical");
    assert.equal(notice?.dismissible, false);
    assert.match(notice?.title ?? "", /changes are paused/);
  });
});

describe("the stacking rule", () => {
  const item = (key: string, source: StackItem["source"], tone: StackItem["tone"], priority = 0): StackItem => ({ key, source, tone, priority });

  test("critical platform first, then account notices, then other platform notices", () => {
    const { visible, collapsed } = stackNotices([
      item("info-banner", "platform", "info", 99),
      item("trial", "account", "warning"),
      item("maintenance", "maintenance", "critical", 1000),
    ]);
    assert.deepEqual(visible.map((i) => i.key), ["maintenance", "trial"]);
    assert.deepEqual(collapsed.map((i) => i.key), ["info-banner"]);
  });

  test("a dunning notice outranks a non-critical announcement", () => {
    const { visible } = stackNotices([item("feature", "platform", "success", 100), item("dunning", "account", "critical")]);
    assert.deepEqual(visible.map((i) => i.key), ["dunning", "feature"]);
  });

  test("at most two visible, the rest collapsed, in order", () => {
    const { visible, collapsed } = stackNotices([
      item("a", "platform", "critical", 10),
      item("b", "platform", "critical", 20),
      item("c", "account", "warning"),
      item("d", "platform", "warning", 5),
    ]);
    assert.deepEqual(visible.map((i) => i.key), ["b", "a"]);
    assert.deepEqual(collapsed.map((i) => i.key), ["c", "d"]);
  });

  test("nothing to stack is nothing", () => {
    assert.deepEqual(stackNotices([]), { visible: [], collapsed: [] });
  });
});

describe("content safety: plain text plus one safe link", () => {
  test("same-site paths and https URLs are allowed", () => {
    assert.equal(safeBannerLink("/pricing"), "/pricing");
    assert.equal(safeBannerLink("/help/billing?tab=1#x"), "/help/billing?tab=1#x");
    assert.equal(safeBannerLink("https://clientturn.com/blog"), "https://clientturn.com/blog");
  });
  test("script, data, protocol-relative, http and credentialed URLs are refused", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<b>x</b>",
      "//evil.example",
      "/\\evil.example",
      "http://clientturn.com",
      "https://user:pass@evil.example",
      "vbscript:x",
    ]) {
      assert.equal(safeBannerLink(bad), null, bad);
    }
  });
  test("an unknown tone, audience or placement from the database is dropped, not guessed", () => {
    const row = {
      id: "x",
      title: "t",
      body: null,
      link_url: null,
      link_label: null,
      tone: "info",
      audience: "ALL",
      placements: ["APP_TOP"],
      starts_at: NOW.toISOString(),
      ends_at: null,
      dismissible: true,
      priority: 1,
      updated_at: NOW.toISOString(),
    };
    assert.ok(rowToBanner(row));
    assert.equal(rowToBanner({ ...row, tone: "rainbow" }), null);
    assert.equal(rowToBanner({ ...row, audience: "EVERYONE_EVER" }), null);
    assert.equal(rowToBanner({ ...row, placements: ["POPUP"] }), null);
  });
});
