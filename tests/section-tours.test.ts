import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  FIRST_USE_TOUR,
  SECTION_KEYS,
  SECTION_TOURS,
  firstAvailableIndex,
  isSectionKey,
  sectionTourFor,
  sectionTourForPath,
  tourTargetKeys,
} from "../src/lib/tour/model.ts";
import {
  CONNECTOR_GAP,
  POPOVER_GAP,
  connectorLine,
  connectorPath,
  floatingCaptionRect,
  placeCaption,
  spotlightRect,
} from "../src/lib/tour/geometry.ts";
import {
  parseSectionRecords,
  pickAutoStart,
  recordFor,
  sectionSessionKey,
  withSectionRecord,
} from "../src/lib/tour/persistence.ts";

/** Per-section tours and the tour leader line (Phase 8.29). */

/* ------------------------------------------------------------ helpers */

/** Every `data-tour` key in src/, literal or derived from a template the test knows about. */
function tourKeysInSource(): Set<string> {
  const found = new Set<string>();
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".tsx")) sources.push(readFileSync(full, "utf8"));
    }
  };
  walk(path.join(process.cwd(), "src"));
  const all = sources.join("\n");
  for (const match of all.matchAll(/data-tour="([a-z0-9-]+)"/g)) found.add(match[1]);

  // Three keys are built from data rather than written out; the template must
  // exist for the derived keys to count.
  const derived: [RegExp, string[]][] = [
    [
      /data-tour=\{`nav-\$\{item\.label/,
      ["Dashboard", "Agents", "Inbox", "Leads", "Find Leads", "Follow-Up", "Reactivation", "Analytics", "Settings"].map(
        (label) => `nav-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      ),
    ],
    [
      /data-tour=\{`settings-nav-\$\{section\.id\}`\}/,
      ["workspace", "connections", "business-profile", "ai-selling", "team", "developer", "data-controls", "billing"].map(
        (id) => `settings-nav-${id}`,
      ),
    ],
    [
      /data-tour=\{`agents-\$\{type\.toLowerCase\(\)\}`\}/,
      ["SOURCING", "BOOKING", "REENGAGEMENT", "COMBINED"].map((type) => `agents-${type.toLowerCase()}`),
    ],
  ];
  for (const [template, keys] of derived) {
    assert.match(all, template, `template ${template} is gone`);
    for (const key of keys) found.add(key);
  }
  return found;
}

/* ----------------------------------------------------------- registry */

describe("section tour registry", () => {
  test("every primary destination in the rail has its own tour", () => {
    const source = readFileSync(path.join(process.cwd(), "src", "lib", "app", "nav.ts"), "utf8");
    // The primary rail only: Help is a utility, not a destination with a tour.
    const nav = source.slice(source.indexOf("export const PRIMARY_NAV"), source.indexOf("];", source.indexOf("export const PRIMARY_NAV")));
    const hrefs = [...nav.matchAll(/\{ href: "(\/app[^"]*)", label: "([^"]+)"/g)].map((m) => m[1]);
    assert.ok(hrefs.length >= 8, "nav parse");
    for (const href of hrefs) {
      assert.ok(sectionTourForPath(href), `no section tour for ${href}`);
    }
    for (const key of ["dashboard", "leads", "follow-up", "reactivation", "settings", "find-leads", "agents", "analytics"]) {
      assert.ok(isSectionKey(key), key);
      assert.equal(sectionTourFor(key as never).section, key);
    }
  });

  test("each tour is short: three to six steps, unique ids, copy on every step", () => {
    const tourIds = new Set<string>();
    for (const tour of SECTION_TOURS) {
      assert.ok(!tourIds.has(tour.id), tour.id);
      tourIds.add(tour.id);
      assert.ok(tour.steps.length >= 3 && tour.steps.length <= 6, `${tour.section}: ${tour.steps.length} steps`);
      assert.equal(new Set(tour.steps.map((s) => s.id)).size, tour.steps.length, tour.section);
      for (const step of tour.steps) {
        assert.ok(step.title.trim().length > 3, `${tour.section}/${step.id}`);
        assert.ok(step.body.trim().length > 20, `${tour.section}/${step.id}`);
        assert.ok(step.body.length <= 200, `${tour.section}/${step.id} is too long for a caption`);
      }
    }
    assert.equal(SECTION_TOURS.length, SECTION_KEYS.length);
  });

  test("no step is a centred caption: every step anchors to a component", () => {
    for (const tour of SECTION_TOURS) {
      for (const step of tour.steps) assert.ok(step.targets.length > 0, `${tour.section}/${step.id}`);
    }
  });

  test("requiresTarget is always one of the step's own targets", () => {
    for (const tour of [FIRST_USE_TOUR, ...SECTION_TOURS]) {
      for (const step of tour.steps) {
        if (step.requiresTarget) assert.ok(step.targets.includes(step.requiresTarget), `${tour.id}/${step.id}`);
      }
    }
  });

  test("every target key exists as a data-tour attribute in the source", () => {
    const found = tourKeysInSource();
    for (const tour of [FIRST_USE_TOUR, ...SECTION_TOURS]) {
      const missing = tourTargetKeys(tour).filter((key) => !found.has(key));
      assert.deepEqual(missing, [], `${tour.id}: no element carries data-tour for ${missing.join(", ")}`);
    }
  });

  test("a step's own route stays on its section's page", () => {
    for (const tour of SECTION_TOURS) {
      for (const step of tour.steps) {
        if (step.route) assert.equal(step.route.split("?")[0], tour.path, `${tour.section}/${step.id}`);
      }
    }
  });

  test("path lookup is exact: a record page is not the list page", () => {
    assert.equal(sectionTourForPath("/app")?.section, "dashboard");
    assert.equal(sectionTourForPath("/app/leads")?.section, "leads");
    assert.equal(sectionTourForPath("/app/leads/")?.section, "leads");
    assert.equal(sectionTourForPath("/app/leads/123"), null);
    assert.equal(sectionTourForPath("/app/reactivation/new"), null);
    assert.equal(sectionTourForPath("/app/help"), null);
    assert.equal(isSectionKey("nope"), false);
  });

  test("the first step shown skips plan- or role-gated steps, and a fully gated page shows none", () => {
    const dashboard = sectionTourFor("dashboard");
    // No setup checklist on the page: start at the date range.
    assert.equal(firstAvailableIndex(dashboard.steps, () => false), 1);
    assert.equal(firstAvailableIndex(dashboard.steps, () => true), 0);
    // Find Leads on a plan without sourcing: nothing to show.
    assert.equal(firstAvailableIndex(sectionTourFor("find-leads").steps, () => false), null);
  });
});

/* ------------------------------------------------------ connector line */

describe("connector line", () => {
  const desktop = { width: 1280, height: 800 };

  test("caption below the target: a straight vertical line from caption top to target bottom", () => {
    const target = { top: 100, left: 200, width: 200, height: 40 };
    const caption = { top: 180, left: 120, width: 360, height: 180 };
    const line = connectorLine(caption, target)!;
    assert.equal(line.side, "bottom");
    assert.deepEqual(line.from, { x: 300, y: 180 });
    assert.deepEqual(line.to, { x: 300, y: 140 });
    assert.equal(line.length, 40);
    assert.equal(connectorPath(line), "M300 180L300 140");
  });

  test("caption above, to the right and to the left", () => {
    const target = { top: 400, left: 400, width: 100, height: 100 };
    assert.equal(connectorLine({ top: 100, left: 300, width: 300, height: 200 }, target)!.side, "top");
    const right = connectorLine({ top: 350, left: 560, width: 300, height: 200 }, target)!;
    assert.equal(right.side, "right");
    assert.deepEqual(right.from, { x: 560, y: 450 });
    assert.deepEqual(right.to, { x: 500, y: 450 });
    const left = connectorLine({ top: 350, left: 40, width: 300, height: 200 }, target)!;
    assert.equal(left.side, "left");
    assert.deepEqual(left.to, { x: 400, y: 450 });
  });

  test("slants only when the caption has been slid clear of the target, and stays off the corners", () => {
    // A launcher in the far right corner, caption clamped left of it.
    const target = { top: 60, left: 1220, width: 40, height: 40 };
    const caption = { top: 150, left: 900, width: 360, height: 160 };
    const line = connectorLine(caption, target)!;
    assert.equal(line.side, "bottom");
    assert.ok(line.from.x <= 900 + 360 - 18, "start kept off the caption's corner");
    assert.ok(line.to.x >= 1220 && line.to.x <= 1260, "end on the target");
  });

  test("no line when the two overlap, touch, or are too close to be worth a line", () => {
    const target = { top: 100, left: 100, width: 200, height: 100 };
    assert.equal(connectorLine({ top: 150, left: 150, width: 200, height: 200 }, target), null);
    assert.equal(connectorLine({ top: 200, left: 100, width: 200, height: 100 }, target), null);
    assert.equal(connectorLine({ top: 205, left: 100, width: 200, height: 100 }, target), null);
    assert.equal(connectorLine({ top: 300, left: 100, width: 0, height: 100 }, target), null);
  });

  test("a narrow target gets the line to its centre, not past its edge", () => {
    const target = { top: 100, left: 500, width: 20, height: 20 };
    const line = connectorLine({ top: 200, left: 300, width: 400, height: 100 }, target)!;
    assert.equal(line.to.x, 510);
    assert.equal(line.from.x, 510);
  });

  test("anchored captions leave room for the line, and fall back to tight when there is none", () => {
    const popover = { width: 360, height: 200 };
    const roomy = placeCaption({ target: { top: 200, left: 12, width: 220, height: 44 }, popover, viewport: desktop, preferred: "right" });
    assert.equal(roomy.mode, "anchored");
    if (roomy.mode === "anchored") assert.equal(roomy.left, 12 + 220 + CONNECTOR_GAP);

    // A big panel: no side has room once the line's gap is added, but the
    // right-hand side does with the tight gap.
    const target = { top: 50, left: 40, width: 850, height: 690 };
    const tight = placeCaption({ target, popover, viewport: desktop, preferred: "right" });
    assert.equal(tight.mode, "anchored");
    if (tight.mode === "anchored") {
      assert.equal(tight.side, "right");
      assert.equal(tight.left, 40 + 850 + POPOVER_GAP);
    }
  });

  test("an anchored caption and its spotlight are always joined by a line", () => {
    const popover = { width: 360, height: 200 };
    const target = { top: 200, left: 12, width: 220, height: 44 };
    const hole = spotlightRect(target, desktop);
    const placement = placeCaption({ target: hole, popover, viewport: desktop, preferred: "right" });
    assert.equal(placement.mode, "anchored");
    if (placement.mode !== "anchored") return;
    const line = connectorLine({ top: placement.top, left: placement.left, ...popover }, hole)!;
    assert.ok(line, "a line is drawn");
    assert.equal(line.side, "right");
    assert.equal(line.length, CONNECTOR_GAP);
  });

  test("bottom sheet on a phone: the line runs from the sheet up to a visible target", () => {
    const phone = { width: 390, height: 844 };
    const sheet = floatingCaptionRect(phone, { width: 390, height: 260 }, "bottom");
    assert.deepEqual(sheet, { left: 0, width: 390, height: 260, top: 584 });
    const target = spotlightRect({ top: 120, left: 16, width: 200, height: 48 }, phone);
    const line = connectorLine(sheet, target)!;
    assert.equal(line.side, "bottom");
    assert.equal(line.from.y, 584);
    assert.equal(line.to.y, target.top + target.height);
    assert.equal(line.from.x, line.to.x, "straight up");
  });

  test("a target hidden under the sheet gets no line", () => {
    const phone = { width: 390, height: 844 };
    const sheet = floatingCaptionRect(phone, { width: 390, height: 260 }, "bottom");
    assert.equal(connectorLine(sheet, { top: 600, left: 16, width: 200, height: 48 }), null);
  });

  test("top sheet and centred desktop card positions mirror the CSS", () => {
    const phone = { width: 390, height: 844 };
    assert.equal(floatingCaptionRect(phone, { width: 390, height: 200 }, "top").top, 0);
    const card = floatingCaptionRect(desktop, { width: 400, height: 220 }, "bottom");
    assert.deepEqual(card, { left: 440, width: 400, height: 220, top: 800 - 24 - 220 });
  });
});

/* -------------------------------------------------------- persistence */

describe("section persistence", () => {
  test("per-section records round-trip; junk and bad keys are dropped", () => {
    const at = new Date("2026-09-26T10:00:00Z");
    let records = withSectionRecord({}, "leads", recordFor(1, "completed", at));
    records = withSectionRecord(records, "settings", recordFor(2, "skipped", at));
    assert.deepEqual(parseSectionRecords(JSON.stringify(records)), records);
    assert.deepEqual(parseSectionRecords("not json"), {});
    assert.deepEqual(parseSectionRecords(null), {});
    assert.deepEqual(parseSectionRecords([1, 2]), {});
    assert.deepEqual(
      parseSectionRecords({ leads: { version: 1, outcome: "completed" }, "Bad Key!": { version: 1, outcome: "completed" }, inbox: { version: 0 } }),
      { leads: { version: 1, outcome: "completed", at: "" } },
    );
  });

  test("finishing one section leaves the others untouched", () => {
    const first = withSectionRecord({}, "leads", recordFor(1, "completed"));
    const second = withSectionRecord(first, "inbox", recordFor(1, "skipped"));
    assert.equal(second.leads.outcome, "completed");
    assert.equal(second.inbox.outcome, "skipped");
    assert.equal(Object.keys(first).length, 1, "not mutated");
    assert.notEqual(sectionSessionKey("leads"), sectionSessionKey("inbox"));
  });
});

describe("auto-start never overlaps", () => {
  const firstVersion = FIRST_USE_TOUR.version;
  const leads = sectionTourFor("leads");
  const dashboard = sectionTourFor("dashboard");
  const finished = recordFor(firstVersion, "skipped");

  const section = (tour = leads, extra: Record<string, unknown> = {}) => ({
    key: tour.section,
    path: tour.path,
    version: tour.version,
    server: null,
    local: null,
    shownThisSession: false,
    ...extra,
  });
  const firstUse = (extra: Record<string, unknown> = {}) => ({
    version: firstVersion,
    server: null,
    local: null,
    shownThisSession: false,
    ...extra,
  });

  test("the first-use tour wins on the dashboard until it is finished", () => {
    assert.deepEqual(
      pickAutoStart({ pathname: "/app", tourActive: false, firstUse: firstUse(), section: section(dashboard) }),
      { kind: "first-use" },
    );
  });

  test("a section tour waits for the first-use tour to be completed or skipped", () => {
    assert.equal(
      pickAutoStart({ pathname: "/app/leads", tourActive: false, firstUse: firstUse(), section: section() }),
      null,
    );
    for (const outcome of ["completed", "skipped"] as const) {
      assert.deepEqual(
        pickAutoStart({
          pathname: "/app/leads",
          tourActive: false,
          firstUse: firstUse({ server: recordFor(firstVersion, outcome) }),
          section: section(),
        }),
        { kind: "section", section: "leads" },
      );
    }
    // The browser copy counts too (server unknown).
    assert.deepEqual(
      pickAutoStart({ pathname: "/app/leads", tourActive: false, firstUse: firstUse({ server: undefined, local: finished }), section: section() }),
      { kind: "section", section: "leads" },
    );
  });

  test("after the first-use tour, the dashboard gets its own section tour", () => {
    assert.deepEqual(
      pickAutoStart({ pathname: "/app", tourActive: false, firstUse: firstUse({ server: finished }), section: section(dashboard) }),
      { kind: "section", section: "dashboard" },
    );
  });

  test("nothing starts while another tour is showing", () => {
    assert.equal(
      pickAutoStart({ pathname: "/app", tourActive: true, firstUse: firstUse(), section: section(dashboard) }),
      null,
    );
    assert.equal(
      pickAutoStart({ pathname: "/app/leads", tourActive: true, firstUse: firstUse({ server: finished }), section: section() }),
      null,
    );
  });

  test("a finished section, this version or later, stays quiet; an older version does not", () => {
    const base = { pathname: "/app/leads", tourActive: false, firstUse: firstUse({ server: finished }) };
    assert.equal(pickAutoStart({ ...base, section: section(leads, { server: recordFor(leads.version, "skipped") }) }), null);
    assert.equal(pickAutoStart({ ...base, section: section(leads, { local: recordFor(leads.version, "completed") }) }), null);
    assert.deepEqual(
      pickAutoStart({ ...base, section: section({ ...leads, version: leads.version + 1 }, { server: recordFor(leads.version, "completed") }) }),
      { kind: "section", section: "leads" },
    );
  });

  test("only on the section's own page, and not twice in one session", () => {
    const base = { tourActive: false, firstUse: firstUse({ server: finished }) };
    assert.equal(pickAutoStart({ ...base, pathname: "/app/leads/abc", section: section() }), null);
    assert.equal(pickAutoStart({ ...base, pathname: "/app/leads", section: null }), null);
    assert.equal(pickAutoStart({ ...base, pathname: "/app/leads", section: section(leads, { shownThisSession: true }) }), null);
  });
});
