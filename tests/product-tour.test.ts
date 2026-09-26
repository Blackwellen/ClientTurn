import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  FIRST_USE_TOUR,
  clampStep,
  isLastStep,
  routeMatches,
  stepCounter,
  tourSelector,
  tourTargetKeys,
} from "../src/lib/tour/model.ts";
import {
  cutoutPath,
  floatingEdge,
  isFullyInView,
  isNarrow,
  isVisibleRect,
  placePopover,
  spotlightRect,
} from "../src/lib/tour/geometry.ts";
import {
  hasFinished,
  parseTourRecord,
  recordFor,
  serialiseTourRecord,
  shouldAutoStart,
} from "../src/lib/tour/persistence.ts";

/** The first-use product tour (Phase 8.4): step model, positioning, persistence. */

describe("step model", () => {
  const steps = FIRST_USE_TOUR.steps;

  test("step ids are unique and every step has copy", () => {
    assert.equal(new Set(steps.map((s) => s.id)).size, steps.length);
    for (const step of steps) {
      assert.ok(step.title.trim(), step.id);
      assert.ok(step.body.trim().length > 20, step.id);
    }
  });

  test("covers every area the brief names", () => {
    const keys = new Set(tourTargetKeys(FIRST_USE_TOUR));
    for (const key of [
      "nav-dashboard",
      "nav-leads",
      "nav-follow-up",
      "nav-reactivation",
      "nav-settings",
      "dashboard-revenue-control",
      "leads-list",
      "lead-drawer",
      "inbox",
      "copilot-button",
      "help-launcher",
      "settings-connections",
    ]) {
      assert.ok(keys.has(key), key);
    }
  });

  test("every sidebar step has a phone fallback (the rail is hidden below lg)", () => {
    for (const step of steps.filter((s) => s.id.startsWith("nav-"))) {
      assert.equal(step.targets.at(-1), "open-nav", step.id);
    }
  });

  test("every target key exists as a data-tour attribute in the source", () => {
    // Walk src/ for data-tour="…" (and the sidebar's derived nav-… keys).
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".tsx")) {
          const text = readFileSync(full, "utf8");
          for (const match of text.matchAll(/data-tour="([a-z0-9-]+)"/g)) found.add(match[1]);
        }
      }
    };
    walk(path.join(process.cwd(), "src"));
    const sidebar = readFileSync(path.join(process.cwd(), "src", "components", "app", "sidebar.tsx"), "utf8");
    assert.match(sidebar, /data-tour=\{`nav-\$\{item\.label/);
    for (const label of ["Dashboard", "Agents", "Leads", "Find Leads", "Follow-Up", "Reactivation", "Analytics", "Settings"]) {
      found.add(`nav-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
    }
    const missing = tourTargetKeys(FIRST_USE_TOUR).filter((key) => !found.has(key));
    assert.deepEqual(missing, [], `No element carries data-tour for: ${missing.join(", ")}`);
  });

  test("no step is a centred caption by design: every step names a target (8.29)", () => {
    for (const step of steps) assert.ok(step.targets.length > 0, step.id);
    // The welcome still reaches a phone, where the rail (and its workspace card) is hidden.
    assert.deepEqual(steps[0].targets, ["workspace-card", "open-nav"]);
    assert.deepEqual(steps.at(-1)!.targets, ["help-launcher"]);
  });

  test("counter, clamping and last-step detection", () => {
    assert.equal(stepCounter(0, 14), "Step 1 of 14");
    assert.equal(stepCounter(99, 14), "Step 14 of 14");
    assert.equal(clampStep(-3, 5), 0);
    assert.equal(clampStep(7, 5), 4);
    assert.equal(clampStep(2, 0), 0);
    assert.equal(isLastStep(4, 5), true);
    assert.equal(isLastStep(3, 5), false);
  });

  test("route matching: exact path, named query params only", () => {
    assert.equal(routeMatches("/app", "/app", ""), true);
    assert.equal(routeMatches("/app", "/app/leads", ""), false);
    assert.equal(routeMatches("/app/leads", "/app/leads/", "?lead=1"), true);
    assert.equal(routeMatches("/app/settings?section=connections", "/app/settings", "?section=connections&x=1"), true);
    assert.equal(routeMatches("/app/settings?section=connections", "/app/settings", "?section=team"), false);
    assert.equal(routeMatches("/app/settings?section=connections", "/app/settings", ""), false);
  });

  test("selectors are escaped", () => {
    assert.equal(tourSelector("nav-leads"), '[data-tour="nav-leads"]');
    assert.equal(tourSelector('a"b'), '[data-tour="a\\"b"]');
  });
});

describe("positioning maths", () => {
  const desktop = { width: 1280, height: 800 };
  const popover = { width: 360, height: 200 };

  test("narrow viewports always use the sheet", () => {
    assert.equal(isNarrow({ width: 360, height: 740 }), true);
    assert.equal(isNarrow({ width: 768, height: 1024 }), false);
    const placement = placePopover({ target: { top: 100, left: 20, width: 40, height: 40 }, popover, viewport: { width: 360, height: 740 } });
    assert.equal(placement.mode, "floating");
  });

  test("no target, or an off-screen target, floats", () => {
    assert.equal(placePopover({ target: null, popover, viewport: desktop }).mode, "floating");
    assert.equal(placePopover({ target: { top: 2000, left: 10, width: 50, height: 50 }, popover, viewport: desktop }).mode, "floating");
  });

  test("a sidebar link gets the caption on its right, arrow at its centre", () => {
    const target = { top: 200, left: 12, width: 220, height: 44 };
    const placement = placePopover({ target, popover, viewport: desktop, preferred: "right" });
    assert.equal(placement.mode, "anchored");
    if (placement.mode !== "anchored") return;
    assert.equal(placement.side, "right");
    assert.equal(placement.left, 12 + 220 + 14);
    assert.equal(placement.top + placement.arrow, 200 + 22);
  });

  test("falls back to another side when the preferred one has no room", () => {
    // Top-bar button: no room above, so it goes below.
    const target = { top: 10, left: 1000, width: 100, height: 36 };
    const placement = placePopover({ target, popover, viewport: desktop, preferred: "top" });
    assert.equal(placement.mode, "anchored");
    if (placement.mode === "anchored") assert.equal(placement.side, "bottom");
  });

  test("stays inside the viewport and the arrow keeps pointing at the target", () => {
    // A launcher in the bottom-right corner.
    const target = { top: 720, left: 1200, width: 60, height: 60 };
    const placement = placePopover({ target, popover, viewport: desktop, preferred: "top" });
    assert.equal(placement.mode, "anchored");
    if (placement.mode !== "anchored") return;
    assert.equal(placement.side, "top");
    assert.ok(placement.left + popover.width <= desktop.width - 12);
    assert.ok(placement.top >= 12);
    assert.ok(placement.arrow <= popover.width - 20 && placement.arrow >= 20);
  });

  test("a target that fills the screen floats rather than overlapping", () => {
    const target = { top: 60, left: 260, width: 1000, height: 730 };
    assert.equal(placePopover({ target, popover, viewport: desktop }).mode, "floating");
  });

  test("the spotlight pads the target and is clipped to the viewport", () => {
    assert.deepEqual(spotlightRect({ top: 100, left: 100, width: 50, height: 20 }, desktop, 8), {
      top: 92,
      left: 92,
      width: 66,
      height: 36,
    });
    assert.deepEqual(spotlightRect({ top: 2, left: 2, width: 10, height: 10 }, desktop, 8), {
      top: 0,
      left: 0,
      width: 20,
      height: 20,
    });
  });

  test("the cut-out path has an outer rect and a rounded hole", () => {
    const outer = cutoutPath(desktop, null);
    assert.equal(outer, "M0 0H1280V800H0Z");
    const withHole = cutoutPath(desktop, { top: 10, left: 20, width: 100, height: 40 }, 12);
    assert.ok(withHole.startsWith(outer));
    assert.equal((withHole.match(/A12 12/g) ?? []).length, 4);
    // The radius never exceeds half the hole.
    assert.match(cutoutPath(desktop, { top: 0, left: 0, width: 10, height: 6 }, 12), /A3 3/);
  });

  test("visibility and in-view checks", () => {
    assert.equal(isVisibleRect({ top: 0, left: 0, width: 0, height: 10 }, desktop), false);
    assert.equal(isVisibleRect({ top: -5, left: 0, width: 10, height: 10 }, desktop), true);
    assert.equal(isFullyInView({ top: -5, left: 0, width: 10, height: 10 }, desktop), false);
    assert.equal(isFullyInView({ top: 5, left: 5, width: 10, height: 10 }, desktop), true);
  });

  test("the floating caption avoids covering a low target", () => {
    assert.equal(floatingEdge({ top: 700, left: 0, width: 50, height: 50 }, desktop), "top");
    assert.equal(floatingEdge({ top: 50, left: 0, width: 50, height: 50 }, desktop), "bottom");
    assert.equal(floatingEdge(null, desktop), "bottom");
  });
});

describe("persistence", () => {
  const version = FIRST_USE_TOUR.version;

  test("records round-trip and junk is rejected", () => {
    const record = recordFor(version, "skipped", new Date("2026-09-26T10:00:00Z"));
    assert.deepEqual(parseTourRecord(serialiseTourRecord(record)), record);
    assert.equal(parseTourRecord("not json"), null);
    assert.equal(parseTourRecord(null), null);
    assert.equal(parseTourRecord({ version: 0, outcome: "completed" }), null);
    assert.equal(parseTourRecord({ version: 1, outcome: "maybe" }), null);
  });

  test("finishing an older version does not count for a newer one", () => {
    assert.equal(hasFinished(recordFor(1, "completed"), 1), true);
    assert.equal(hasFinished(recordFor(1, "completed"), 2), false);
    assert.equal(hasFinished(null, 1), false);
  });

  const base = { pathname: "/app", version, server: null, local: null, shownThisSession: false };

  test("starts on the first dashboard visit when nothing says it was finished", () => {
    assert.equal(shouldAutoStart(base), true);
  });

  test("only on the dashboard", () => {
    assert.equal(shouldAutoStart({ ...base, pathname: "/app/leads" }), false);
    assert.equal(shouldAutoStart({ ...base, pathname: "/onboarding" }), false);
  });

  test("either copy saying finished keeps it quiet, completed or skipped", () => {
    assert.equal(shouldAutoStart({ ...base, server: recordFor(version, "skipped") }), false);
    assert.equal(shouldAutoStart({ ...base, local: recordFor(version, "completed") }), false);
  });

  test("an unknown server state (migration not applied) falls back to the browser copy", () => {
    assert.equal(shouldAutoStart({ ...base, server: undefined }), true);
    assert.equal(shouldAutoStart({ ...base, server: undefined, local: recordFor(version, "skipped") }), false);
  });

  test("not twice in one browser session", () => {
    assert.equal(shouldAutoStart({ ...base, shownThisSession: true }), false);
  });
});
