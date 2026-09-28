import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Source-level regression guards for the accessibility audit of 2026-09-28
 * (docs/ACCESSIBILITY_AUDIT_2026-09-28.md). Each asserts the wiring a fix
 * depends on in a shared primitive, so the fix cannot be quietly undone.
 * Static on purpose: the repo has no DOM test environment, and these are
 * questions about markup and ARIA wiring rather than behaviour.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

describe("status messages", () => {
  test("toasts announce through live regions that exist before the message", () => {
    const toast = read("src/components/ui/toast.tsx");
    assert.match(toast, /className="sr-only" role="status" aria-live="polite"/);
    assert.match(toast, /className="sr-only" role="alert" aria-live="assertive"/);
    // The card itself is no longer a live region inserted with its content.
    assert.doesNotMatch(toast, /role=\{toast\.variant === "error" \? "alert" : "status"\}/);
  });

  test("pagination announces the new range", () => {
    assert.match(read("src/components/ui/pagination.tsx"), /aria-live="polite"/);
  });
});

describe("tooltips", () => {
  test("describe the focusable trigger itself, and are hoverable and dismissible", () => {
    const tooltip = read("src/components/ui/tooltip.tsx");
    assert.match(tooltip, /"aria-describedby": \[single\.props\["aria-describedby"\], descId\]/);
    assert.match(tooltip, /<span id=\{descId\} hidden>/);
    assert.match(tooltip, /<span className="sr-only">\{content\}<\/span>/);
    assert.doesNotMatch(tooltip, /pointer-events-none/);
    assert.match(tooltip, /addEventListener\("keydown", onKeyDown, true\)/);
  });
});

describe("tabs and segmented controls", () => {
  test("tab ids are scoped per tab set, not global", () => {
    const tabs = read("src/components/ui/tabs.tsx");
    assert.match(tabs, /export function tabIds\(idBase: string, value: string\)/);
    assert.doesNotMatch(tabs, /id=\{`tab-\$\{item\.value\}`\}/);
    assert.doesNotMatch(tabs, /id=\{`tabpanel-\$\{value\}`\}/);
  });

  test("a segmented control is a radio group (it has no tab panels)", () => {
    const tabs = read("src/components/ui/tabs.tsx");
    const segmented = tabs.slice(tabs.indexOf("export function SegmentedControl"));
    assert.match(segmented, /role="radiogroup"/);
    assert.match(segmented, /role="radio"/);
    assert.match(segmented, /aria-checked=\{active\}/);
    assert.doesNotMatch(segmented, /aria-controls/);
  });
});

describe("keyboard", () => {
  test("a clickable DataTable row takes focus and opens on Enter or Space", () => {
    const table = read("src/components/ui/data-table.tsx");
    assert.match(table, /tabIndex=\{onRowClick \? 0 : undefined\}/);
    assert.match(table, /event\.key === "Enter" \|\| event\.key === " "/);
  });

  test("overflowing tables are keyboard-scrollable", () => {
    assert.match(read("src/components/ui/table.tsx"), /<ScrollRegion className="w-full overflow-x-auto">/);
    assert.match(
      read("src/components/ui/use-scrollable-region.ts"),
      /node\.scrollWidth - node\.clientWidth > 1/,
    );
  });

  test("a popover inside a drawer closes on Escape without closing the drawer", () => {
    assert.match(read("src/components/ui/popover.tsx"), /useEscape\(open, escape, panelRef\)/);
  });

  test("the public skip link lands on a focusable main", () => {
    assert.match(read("src/app/(marketing)/layout.tsx"), /<main id="main" tabIndex=\{-1\}/);
  });
});

describe("structure", () => {
  test("the page header is the page's h1, and the mobile top-bar title is not", () => {
    const header = read("src/components/app/page-header.tsx");
    const pageHeader = header.slice(header.indexOf("export function PageHeader"), header.indexOf("export", header.indexOf("export function PageHeader") + 10));
    assert.match(pageHeader, /<h1\n/);
    assert.doesNotMatch(read("src/components/app/top-bar.tsx"), /<h1 className/);
    assert.match(read("src/components/dashboard/dashboard-header.tsx"), /<h1 /);
  });

  test("the auth pages have a main landmark", () => {
    assert.match(read("src/app/(auth)/layout.tsx"), /<main className=/);
  });

  test("floating listboxes are named", () => {
    const select = read("src/components/ui/select.tsx");
    assert.match(select, /function nameOfControl\(/);
    assert.match(select, /aria-label=\{labelledBy \? undefined : label\}/);
  });
});

describe("focus visibility", () => {
  test("fields use the focus-border token, not lime on white", () => {
    const field = read("src/components/ui/field.ts");
    assert.match(field, /focus:border-\[var\(--lr-focus-border\)\]/);
    assert.doesNotMatch(field, /focus:border-accent-500/);
  });

  test("the switch's off track is a visible colour", () => {
    const form = read("src/components/ui/form.tsx");
    assert.match(form, /bg-\[var\(--lr-switch-off\)\]/);
    assert.doesNotMatch(form, /: "bg-line-strong",/);
  });
});
